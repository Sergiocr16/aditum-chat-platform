import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import type { Conversation, Message, Site } from '@aditum-chat/shared';
import { db, FieldValue } from './lib/admin.js';
import { isWithinSchedule, resolveSiteConfig } from './lib/config.js';

/**
 * Saludo automático del BOT al crear una conversación directa del canal bot
 * (primer mensaje, antes de que el usuario escriba). El canal de AGENTE NO lleva
 * saludo al crear: responde tras el primer mensaje del usuario (`agentAutoReply`).
 * Texto: `widget.mensajeAI` (fallback `bot.saludo`), soporta `{nombre}`. Se marca
 * `bienvenida: true` para NO disparar SLA ni push.
 */
export const welcomeOnConversation = onDocumentCreated(
  { document: 'conversations/{convId}', region: 'us-central1' },
  async (event) => {
    const conv = event.data?.data() as Conversation | undefined;
    if (!conv || conv.tipo !== 'directa') return;
    const esBot = conv.subcanal === 'bot' || conv.estado === 'bot';
    if (!esBot) return; // el canal de agente responde tras el primer mensaje

    const msgsRef = event.data!.ref.collection('messages');
    const siteSnap = await db.doc(`sites/${conv.siteId}`).get();
    const cfg = await resolveSiteConfig((siteSnap.data() as Site) ?? null);
    if (!cfg.bot.activo) return; // sin bot activo no hay saludo automático

    const nombre = (conv.contactNombre ?? '').split(' ')[0] ?? '';
    let texto = (cfg.widget.mensajeAI?.trim() || cfg.bot.saludo || '').trim();
    if (!texto) return;
    texto = texto.replace(/\{nombre\}/g, nombre);
    const sender = { tipo: 'bot' as const, id: 'bot', nombre: cfg.bot.nombre };

    // Doc con id fijo + `.create()` = idempotente (reintentos no duplican). El
    // `createdAt` es el de la conversación para que la bienvenida quede SIEMPRE
    // primera, aunque el usuario haya escrito al crear la conversación.
    await msgsRef
      .doc('_bienvenida')
      .create({
        sender,
        texto,
        tipoContenido: 'texto',
        bienvenida: true,
        createdAt: conv.createdAt ?? FieldValue.serverTimestamp(),
      })
      .catch(() => {}); // ya existía → nada que hacer
  },
);

/**
 * Respuesta automática del canal de AGENTE: se envía UNA vez, tras el primer
 * mensaje del usuario (no al abrir). Usa `widget.mensajeAgente` en horario o
 * `widget.mensajeFueraHorario` fuera de horario. Idempotente (`_autorespuesta`),
 * marcada `bienvenida: true` para no disparar SLA ni push.
 */
export const agentAutoReply = onDocumentCreated(
  { document: 'conversations/{convId}/messages/{msgId}', region: 'us-central1' },
  async (event) => {
    const msg = event.data?.data() as Message | undefined;
    if (!msg || msg.sender.tipo !== 'user' || msg.interno) return;

    const convRef = db.doc(`conversations/${event.params.convId}`);
    const conv = (await convRef.get()).data() as Conversation | undefined;
    if (!conv || conv.tipo !== 'directa') return;
    // Solo el canal de agente (el bot responde con `botReply`).
    if ((conv.subcanal ?? 'agente') !== 'agente') return;

    const siteSnap = await db.doc(`sites/${conv.siteId}`).get();
    const cfg = await resolveSiteConfig((siteSnap.data() as Site) ?? null);
    const enHorario = isWithinSchedule(cfg.schedule);
    const idioma = conv.idioma === 'en' ? 'en' : 'es';
    const nombre = (conv.contactNombre ?? '').split(' ')[0] ?? '';

    const defIn =
      idioma === 'es'
        ? '¡Gracias por escribir, {nombre}! Un agente del equipo te responde en breve.'
        : 'Thanks for reaching out, {nombre}! A team agent will reply shortly.';
    const defOut =
      idioma === 'es'
        ? 'Estamos fuera del horario de atención. Dejanos tu mensaje y te respondemos apenas volvamos.'
        : "We're outside business hours right now. Leave your message and we'll reply as soon as we're back.";

    let texto = enHorario
      ? cfg.widget.mensajeAgente?.trim() || defIn
      : cfg.widget.mensajeFueraHorario?.trim() || defOut;
    if (!texto) return;
    texto = texto.replace(/\{nombre\}/g, nombre);

    await convRef
      .collection('messages')
      .doc('_autorespuesta')
      .create({
        sender: { tipo: 'agent', id: 'sistema', nombre: cfg.widget.titulo || 'Soporte' },
        texto,
        tipoContenido: 'texto',
        bienvenida: true,
        createdAt: FieldValue.serverTimestamp(),
      })
      .catch(() => {}); // ya se respondió antes en esta conversación
  },
);
