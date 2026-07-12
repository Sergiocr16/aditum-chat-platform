import Anthropic from '@anthropic-ai/sdk';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import type {
  BotConfig,
  Contact,
  Conversation,
  Idioma,
  Message,
  Site,
  Ticket,
} from '@aditum-chat/shared';
import { formatTicketNumber } from '@aditum-chat/shared';
import { db, FieldValue } from './lib/admin.js';
import { isWithinSchedule, resolveSiteConfig } from './lib/config.js';
import { searchKb } from './kb.js';
import { crearTicketInterno } from './tickets.js';

const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY');

// El plan aprobado fija claude-sonnet-5 para el bot (velocidad/costo de primera línea).
// Bot del widget y "Probar el bot": Haiku, el modelo más barato funcional.
// Fijo en código, sin override por entorno.
const BOT_MODEL = 'claude-haiku-4-5';
// Asistencia IA para agentes (bajo volumen): prioriza calidad de redacción.
const AI_ASSIST_MODEL = 'claude-sonnet-5';

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'escalar_a_agente',
    description:
      'Escala la conversación a un agente humano de soporte. Usala cuando el usuario lo pida explícitamente, cuando no puedas resolver su problema, o cuando el tema requiera acceso a datos internos que no tenés.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        motivo: { type: 'string', description: 'Resumen breve del motivo del escalamiento.' },
      },
      required: ['motivo'],
      additionalProperties: false,
    },
  },
  {
    name: 'crear_ticket',
    description:
      'Crea un ticket de soporte. Usala SOLO cuando detectás un error del sistema reproducible que el equipo debe corregir (no para consultas de uso).',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        asunto: { type: 'string', description: 'Asunto corto del ticket.' },
        descripcion: { type: 'string', description: 'Descripción detallada del problema.' },
        prioridad: { type: 'string', enum: ['alta', 'media', 'baja'] },
      },
      required: ['asunto', 'descripcion', 'prioridad'],
      additionalProperties: false,
    },
  },
];

interface BotContext {
  conv: Conversation;
  convId: string;
  bot: BotConfig;
  contact: Contact | null;
  openTickets: Ticket[];
  kbContext: string;
}

/**
 * System prompt en dos bloques: el ESTABLE (igual para todas las conversaciones
 * del sitio en un idioma) lleva cache_control — con prompt caching la parte
 * repetida se cobra a ~10% del precio. Lo VARIABLE (usuario, tickets, contexto
 * de la KB por pregunta) va después del breakpoint para no invalidar el cache.
 */
function buildSystemBlocks(ctx: BotContext): Anthropic.TextBlockParam[] {
  const idioma: Idioma = ctx.conv.idioma === 'en' ? 'en' : 'es';
  const estables: string[] = [];

  estables.push(
    idioma === 'es'
      ? `Sos "${ctx.bot.nombre}", el asistente de soporte de Aditum (software de administración de condominios en Costa Rica). Respondés en el chat embebido de la app.`
      : `You are "${ctx.bot.nombre}", the support assistant for Aditum (condominium management software in Costa Rica). You reply inside the embedded app chat.`,
  );
  if (ctx.bot.instrucciones?.trim()) estables.push(ctx.bot.instrucciones.trim());

  estables.push(
    idioma === 'es'
      ? ctx.bot.tono === 'usted'
        ? 'Tratá al usuario de "usted" (formal).'
        : 'Tratá al usuario de "vos" (cercano, español de Costa Rica).'
      : 'Reply in English.',
  );
  estables.push(
    idioma === 'es'
      ? 'Sé breve y práctico: respuestas de 1 a 4 oraciones. Formato permitido: **negritas**, listas con "-" o "1.", y `código`; NO uses encabezados (#), tablas ni bloques de código. Si no podés resolver algo o el usuario pide hablar con una persona, usá la herramienta escalar_a_agente.'
      : 'Be brief and practical: 1-4 sentence replies. Allowed formatting: **bold**, "-" or "1." lists, and `code`; do NOT use headings (#), tables or code blocks. If you cannot resolve something or the user asks for a person, use the escalar_a_agente tool.',
  );

  const variables: string[] = [];
  if (ctx.contact) {
    const c = ctx.contact;
    variables.push(
      `Contexto del usuario: ${c.nombre}${c.rol ? ` (${c.rol})` : ''}${
        ctx.conv.clientNombre ? ` · ${ctx.conv.clientNombre}` : ''
      }.`,
    );
  }
  if (ctx.openTickets.length > 0) {
    variables.push(
      'Tickets abiertos del usuario: ' +
        ctx.openTickets
          .map((t) => `${formatTicketNumber(t.numero)} "${t.asunto}" (${t.estado})`)
          .join(' · '),
    );
  }
  if (ctx.kbContext) {
    variables.push(`Información de la base de conocimiento relevante:\n${ctx.kbContext}`);
  }

  const blocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: estables.join('\n\n'), cache_control: { type: 'ephemeral' } },
  ];
  if (variables.length > 0) blocks.push({ type: 'text', text: variables.join('\n\n') });
  return blocks;
}

function historyToMessages(msgs: Message[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of msgs) {
    if (m.interno || m.sender.tipo === 'sistema') continue;
    const role = m.sender.tipo === 'user' ? 'user' : 'assistant';
    const texto = m.texto?.trim();
    if (!texto) continue;
    out.push({ role, content: texto });
  }
  // La API exige empezar con user.
  while (out.length && out[0].role !== 'user') out.shift();
  return out.slice(-20);
}

async function runBot(
  apiKey: string,
  ctx: BotContext,
): Promise<{ texto: string; escalar?: { motivo: string }; ticket?: { asunto: string; descripcion: string; prioridad: 'alta' | 'media' | 'baja' } }> {
  const client = new Anthropic({ apiKey });
  const msgsSnap = await db
    .collection(`conversations/${ctx.convId}/messages`)
    .orderBy('createdAt', 'asc')
    .limitToLast(30)
    .get();
  const history = historyToMessages(msgsSnap.docs.map((d) => d.data() as Message));
  if (history.length === 0) return { texto: '' };

  const messages: Anthropic.MessageParam[] = [...history];
  let escalar: { motivo: string } | undefined;
  let ticket: { asunto: string; descripcion: string; prioridad: 'alta' | 'media' | 'baja' } | undefined;
  let texto = '';

  for (let i = 0; i < 3; i++) {
    const response = await client.messages.create({
      model: BOT_MODEL,
      max_tokens: 1024,
      system: buildSystemBlocks(ctx),
      tools: TOOLS,
      messages,
    });

    for (const block of response.content) {
      if (block.type === 'text') texto += block.text;
    }
    if (response.stop_reason !== 'tool_use') break;

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );
    messages.push({ role: 'assistant', content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      if (tu.name === 'escalar_a_agente') {
        escalar = tu.input as { motivo: string };
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: 'Escalado registrado. Avisale al usuario que un agente lo atenderá en breve.',
        });
      } else if (tu.name === 'crear_ticket') {
        ticket = tu.input as typeof ticket;
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: 'Ticket registrado. Confirmale al usuario que quedó creado.',
        });
      } else {
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Herramienta desconocida.', is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }

  return { texto: texto.trim(), escalar, ticket };
}

/**
 * Trigger: responde con el bot cada mensaje de usuario en conversaciones
 * directas con estado 'bot'. Escala según config y crea tickets si el bot
 * detecta errores del sistema (si el toggle lo permite).
 */
export const botReply = onDocumentCreated(
  {
    document: 'conversations/{convId}/messages/{msgId}',
    secrets: [anthropicApiKey],
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async (event) => {
    const msg = event.data?.data() as Message | undefined;
    if (!msg || msg.sender.tipo !== 'user' || msg.interno) return;

    const convId = event.params.convId;
    const convRef = db.doc(`conversations/${convId}`);
    const convSnap = await convRef.get();
    if (!convSnap.exists) return;
    const conv = convSnap.data() as Conversation;
    if (conv.tipo !== 'directa' || conv.estado !== 'bot') return;

    const siteSnap = await db.doc(`sites/${conv.siteId}`).get();
    const config = await resolveSiteConfig((siteSnap.data() as Site) ?? null);
    if (!config.bot.activo) return;
    // Fuera de horario el bot responde solo si el toggle lo permite.
    if (!config.bot.responderFueraDeHorario && !isWithinSchedule(config.schedule)) return;

    const contactSnap = conv.contactId ? await db.doc(`contacts/${conv.contactId}`).get() : null;
    const contact = (contactSnap?.data() as Contact | undefined) ?? null;

    const ticketsSnap = conv.contactId
      ? await db
          .collection('tickets')
          .where('contactId', '==', conv.contactId)
          .where('estado', 'in', ['abierto', 'en_progreso', 'en_desarrollo'])
          .limit(5)
          .get()
      : null;
    const openTickets = ticketsSnap?.docs.map((d) => d.data() as Ticket) ?? [];

    const kbContext = await searchKb(anthropicApiKey.value(), conv.siteId, msg.texto).catch((e) => {
      logger.warn('searchKb falló', { message: (e as Error).message });
      return '';
    });

    const ctx: BotContext = { conv, convId, bot: config.bot, contact, openTickets, kbContext };
    const result = await runBot(anthropicApiKey.value(), ctx);
    if (!result.texto && !result.escalar) return;

    // Ticket automático (si el toggle lo permite).
    let ticketRef: { ticketId: string; numero: number } | null = null;
    if (result.ticket && config.bot.crearTicketsAutomaticamente) {
      ticketRef = await crearTicketInterno({
        siteId: conv.siteId,
        clientId: conv.clientId,
        clientNombre: conv.clientNombre,
        contactId: conv.contactId,
        contactNombre: conv.contactNombre,
        conversationId: convId,
        asunto: result.ticket.asunto,
        descripcion: result.ticket.descripcion,
        prioridad: result.ticket.prioridad,
        publico: false,
        ambito: 'cliente',
        creadoPor: { tipo: 'bot', id: 'bot', nombre: config.bot.nombre },
      });
    }

    if (result.texto) {
      await convRef.collection('messages').add({
        sender: { tipo: 'bot', id: 'bot', nombre: config.bot.nombre },
        texto: result.texto,
        tipoContenido: 'texto',
        ...(ticketRef ? { ticketRef } : {}),
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    const intentos = (conv.botIntentos ?? 0) + 1;
    const debeEscalar =
      Boolean(result.escalar) || intentos >= (config.bot.escalarTrasIntentos || 2) * 2;

    const update: Record<string, unknown> = {
      botIntentos: intentos,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (result.texto) {
      update.lastMessage = {
        texto: result.texto,
        senderTipo: 'bot',
        senderId: 'bot',
        senderNombre: config.bot.nombre,
        at: FieldValue.serverTimestamp(),
      };
      if (conv.contactId) update[`unread.${conv.contactId}`] = FieldValue.increment(1);
    }
    if (debeEscalar) {
      // Handoff: el canal del bot NO se convierte en chat de agente — se pasa
      // el contexto a la conversación del canal 'agente' (se crea si no existe)
      // y el widget lleva al usuario ahí (campo escaladoA).
      const motivo =
        result.escalar?.motivo ??
        (conv.idioma === 'en'
          ? 'The bot could not resolve the query'
          : 'El bot no pudo resolver la consulta');
      const agenteConvId = await handoffAAgente(conv, convId, msg.texto, motivo);
      update.escaladoA = agenteConvId;
      update.escaladoAt = FieldValue.serverTimestamp();
      update.botIntentos = 0;
    }
    await convRef.update(update);

    if (debeEscalar) {
      await convRef.collection('messages').add({
        sender: { tipo: 'sistema', id: 'sistema', nombre: 'Sistema' },
        texto:
          conv.idioma === 'en'
            ? 'We are transferring you to the agent chat…'
            : 'Te pasamos al chat con un agente…',
        tipoContenido: 'sistema',
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  },
);

/**
 * Busca (o crea) la conversación del canal 'agente' del contacto y le deja el
 * contexto del escalamiento: motivo del bot + la última consulta del usuario.
 * También la usa onBotFeedbackWrite ("no me sirvió → hablar con un agente").
 */
export async function handoffAAgente(
  conv: Conversation,
  botConvId: string,
  ultimaConsulta: string,
  motivo: string,
): Promise<string> {
  const q = await db
    .collection('conversations')
    .where('tipo', '==', 'directa')
    .where('contactId', '==', conv.contactId)
    .where('estado', 'in', ['open', 'pending'])
    .orderBy('updatedAt', 'desc')
    .limit(10)
    .get();
  const existente = q.docs.find(
    (d) => ((d.data() as Conversation).subcanal ?? 'agente') === 'agente',
  );

  let ref = existente?.ref;
  if (!ref) {
    ref = db.collection('conversations').doc();
    await ref.set({
      tipo: 'directa',
      subcanal: 'agente',
      siteId: conv.siteId,
      ...(conv.clientId ? { clientId: conv.clientId } : {}),
      ...(conv.clientNombre ? { clientNombre: conv.clientNombre } : {}),
      contactId: conv.contactId,
      contactNombre: conv.contactNombre,
      estado: 'open',
      asignadoA: null,
      idioma: conv.idioma ?? 'es',
      unread: {},
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  const contexto =
    conv.idioma === 'en'
      ? `Escalated from the bot · ${motivo} · Query: "${ultimaConsulta}"`
      : `Escalado desde el bot · ${motivo} · Consulta: "${ultimaConsulta}"`;
  await ref.collection('messages').add({
    sender: { tipo: 'sistema', id: 'sistema', nombre: 'Sistema' },
    texto: contexto,
    tipoContenido: 'sistema',
    botConvRef: botConvId,
    createdAt: FieldValue.serverTimestamp(),
  });
  await ref.update({
    lastMessage: {
      texto: contexto,
      senderTipo: 'sistema',
      senderId: 'sistema',
      senderNombre: 'Sistema',
      at: FieldValue.serverTimestamp(),
    },
    updatedAt: FieldValue.serverTimestamp(),
    'unread.agentes': FieldValue.increment(1),
  });
  return ref.id;
}

/** Media types de imagen que acepta la API de Anthropic para visión. */
const TEST_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type TestImageType = (typeof TEST_IMAGE_TYPES)[number];

/**
 * Callable para la pantalla "Probar el bot" (1i). Solo agentes.
 * Réplica de la conversación del widget: multi-turno (historial) y con
 * adjuntos de imagen que el modelo analiza vía visión.
 */
export const testBot = onCall(
  { secrets: [anthropicApiKey], region: 'us-central1', timeoutSeconds: 60 },
  async (req) => {
    if (req.auth?.token.kind !== 'agent') {
      throw new HttpsError('permission-denied', 'Solo agentes.');
    }
    const { siteId, pregunta, botConfigOverride, historial, imagen } = req.data as {
      siteId: string;
      pregunta: string;
      botConfigOverride?: Partial<BotConfig>;
      /** Turnos previos de la conversación de prueba (sin errores). */
      historial?: { rol: 'user' | 'bot'; texto: string }[];
      /** Imagen adjunta del turno actual, base64 sin prefijo data:. */
      imagen?: { data: string; mimeType: string };
    };
    if (!pregunta?.trim() && !imagen) {
      throw new HttpsError('invalid-argument', 'Mandá una pregunta o una imagen.');
    }
    if (imagen && !TEST_IMAGE_TYPES.includes(imagen.mimeType as TestImageType)) {
      throw new HttpsError('invalid-argument', 'Formato de imagen no soportado (JPG/PNG/GIF/WebP).');
    }
    const siteSnap = await db.doc(`sites/${siteId}`).get();
    const config = await resolveSiteConfig((siteSnap.data() as Site) ?? null);
    const bot = { ...config.bot, ...botConfigOverride };

    const kbContext = await searchKb(anthropicApiKey.value(), siteId, pregunta).catch(() => '');
    const client = new Anthropic({ apiKey: anthropicApiKey.value() });
    const ctx: BotContext = {
      conv: { idioma: 'es', clientNombre: 'Condominio de prueba' } as Conversation,
      convId: '_test',
      bot,
      contact: null,
      openTickets: [],
      kbContext,
    };

    const turnoActual: Anthropic.MessageParam = imagen
      ? {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: imagen.mimeType as TestImageType,
                data: imagen.data,
              },
            },
            ...(pregunta?.trim() ? [{ type: 'text' as const, text: pregunta }] : []),
          ],
        }
      : { role: 'user', content: pregunta };

    const response = await client.messages.create({
      model: BOT_MODEL,
      max_tokens: 1024,
      system: buildSystemBlocks(ctx),
      messages: [
        ...(historial ?? []).slice(-12).map(
          (h): Anthropic.MessageParam => ({
            role: h.rol === 'bot' ? 'assistant' : 'user',
            content: h.texto || '…',
          }),
        ),
        turnoActual,
      ],
    });
    const texto = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return { texto };
  },
);

/** Asistencia IA para agentes (auto_awesome): descripción de ticket o respuesta sugerida. */
export const aiAssist = onCall(
  { secrets: [anthropicApiKey], region: 'us-central1', timeoutSeconds: 60 },
  async (req) => {
    if (req.auth?.token.kind !== 'agent') {
      throw new HttpsError('permission-denied', 'Solo agentes.');
    }
    const { conversationId, modo } = req.data as {
      conversationId: string;
      modo: 'descripcion_ticket' | 'sugerir_respuesta';
    };
    const msgsSnap = await db
      .collection(`conversations/${conversationId}/messages`)
      .orderBy('createdAt', 'asc')
      .limitToLast(30)
      .get();
    const transcript = msgsSnap.docs
      .map((d) => d.data() as Message)
      .filter((m) => !m.interno && m.sender.tipo !== 'sistema')
      .map((m) => `${m.sender.nombre} (${m.sender.tipo}): ${m.texto}`)
      .join('\n');

    const prompt =
      modo === 'descripcion_ticket'
        ? `A partir de esta conversación de soporte, redactá la descripción de un ticket: qué reporta el usuario, pasos/contexto, e impacto. Español neutro, 3-6 líneas, sin encabezados.\n\n${transcript}`
        : `A partir de esta conversación de soporte, sugerí la siguiente respuesta del agente. Voseo costarricense, breve, práctica.\n\n${transcript}`;

    const client = new Anthropic({ apiKey: anthropicApiKey.value() });
    const response = await client.messages.create({
      model: AI_ASSIST_MODEL,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });
    const texto = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return { texto: texto.trim() };
  },
);
