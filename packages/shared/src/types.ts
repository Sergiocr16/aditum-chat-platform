// Modelo de datos multitenant de Aditum Chat sobre Firestore.
// Tenancy a dos niveles: Sitios conectados (siteId) → Clientes/Condominios (clientId).
// Los timestamps se tipan como `unknown` porque el tipo concreto difiere entre
// firebase (cliente), firebase-admin (functions) y JSON serializado.

export type Idioma = 'es' | 'en';
export type BotTono = 'vos' | 'usted';

export type ConversationTipo = 'directa' | 'grupo';
export type ConversationStatus = 'bot' | 'open' | 'pending' | 'resolved';
export type ConversationCanal = string; // = siteId de origen

export type TicketStatus = 'abierto' | 'en_progreso' | 'en_desarrollo' | 'resuelto' | 'pendiente';
export type TicketPriority = 'alta' | 'media' | 'baja';
export type TicketAmbito = 'cliente' | 'grupo' | 'sistema';
export type SlaEstado = 'en_sla' | 'por_vencer' | 'vencido' | 'cumplido' | 'pausado';

export type SenderType = 'user' | 'agent' | 'bot' | 'sistema';
export type MessageContent = 'texto' | 'imagen' | 'video' | 'archivo' | 'sistema' | 'csat';

export type TeamRole = 'admin' | 'agente';
export type Presencia = 'en_linea' | 'ausente' | 'desconectado';

export type KbDocTipo = 'pdf' | 'text' | 'url';
export type KbDocEstado = 'indexado' | 'sincronizando' | 'error';

// ---------------------------------------------------------------------------
// Sitios conectados (nivel 1 de tenancy) — pantalla 1o
// ---------------------------------------------------------------------------

export interface ScheduleDay {
  /** 0=domingo … 6=sábado */
  dia: number;
  abierto: boolean;
  desde?: string; // "08:00"
  hasta?: string; // "17:00"
}

export interface WidgetConfig {
  color: string;
  /** Color de acento: fondo del ítem activo en el menú (tinte claro del primario por defecto). */
  accent?: string;
  posicion: 'bottom-right' | 'bottom-left';
  titulo: string;
  saludo: string;
  /** Logo del sitio: burbuja, header del panel y avatar del chat. */
  logoUrl?: string;
  /** Botones de inicio: preguntas al bot / hablar con agente / chat de equipo. */
  botonBot: boolean;
  botonAgente: boolean;
  /** Chat de equipo por clientId — el botón solo aparece si está activo. */
  botonChatEquipo: boolean;
  /**
   * Overrides opcionales del texto e icono de cada botón de inicio. Si el texto
   * está vacío se usa el default de i18n; si el icono está vacío se usa el icono
   * Material por defecto (smart_toy / support_agent / groups). El icono es la URL
   * de una imagen subida a Storage.
   */
  botonBotTexto?: string;
  botonBotIcono?: string;
  botonAgenteTexto?: string;
  botonAgenteIcono?: string;
  botonEquipoTexto?: string;
  botonEquipoIcono?: string;
  /**
   * Primer mensaje (bienvenida) que ve el usuario al iniciar una conversación,
   * por canal. Soportan `{nombre}`. Si `mensajeAI` está vacío, se usa el
   * `saludo` del bot; si `mensajeAgente` está vacío, un default de i18n.
   */
  mensajeAI?: string;
  mensajeAgente?: string;
  /** Respuesta automática del canal de agente cuando escriben fuera de horario. */
  mensajeFueraHorario?: string;
  ocultarBurbuja: boolean;
  zIndex?: number;
}

export interface BotConfig {
  activo: boolean;
  nombre: string;
  /** Se incluye en cada llamada al modelo. Máx 10 000 caracteres. */
  instrucciones: string;
  tono: BotTono;
  avatarUrl?: string;
  escalarTrasIntentos: number; // "Tras 2 intentos sin resolver"
  responderFueraDeHorario: boolean;
  crearTicketsAutomaticamente: boolean;
  saludo: string;
  /** Permitir adjuntar archivos en el chat del bot (el bot analiza imágenes y PDF). */
  adjuntos?: boolean;
}

export interface ScheduleConfig {
  timezone: string; // "America/Costa_Rica"
  dias: ScheduleDay[];
  /** Texto mostrado en el widget ({{scheduleTextVal}}). */
  textoHorario?: Record<Idioma, string>;
}

/** sites/{siteId} — ej. app-aditum, portal-residentes. */
export interface Site {
  nombre: string;
  dominio: string;
  /** Nombre de ícono Material Symbols (apartment, home_work…). */
  icono: string;
  activo: boolean;
  /** null = hereda de settings/global. */
  widgetConfig?: Partial<WidgetConfig> | null;
  botConfig?: Partial<BotConfig> | null;
  scheduleConfig?: ScheduleConfig | null;
  /** Push al teléfono vía el proyecto Firebase DEL HOST (deviceToken del payload). */
  pushActivo?: boolean;
  /** Info visible del service account configurado (la clave vive cifrada en secrets/). */
  pushInfo?: { projectId: string; clientEmail: string } | null;
  stats?: { conversaciones: number; tickets: number; usuarios: number };
  createdAt: unknown;
}

/** sites/{siteId}/secrets/{current|previous} — SOLO Admin SDK, denegado por rules. */
export interface SiteSecret {
  /** Clave AES-256-GCM, hex de 64 chars. Se muestra una vez como pk_<siteId>_<hex>. */
  keyHex: string;
  createdAt: unknown;
  /** Para `previous`: fin del período de gracia tras rotación. */
  validaHasta?: unknown;
}

// ---------------------------------------------------------------------------
// Clientes / Condominios (nivel 2 de tenancy)
// ---------------------------------------------------------------------------

/** clients/{clientId} */
export interface Client {
  nombre: string;
  ubicacion?: string; // "Curridabat, San José"
  filiales?: number;
  plan?: string; // "Empresarial"
  clienteDesde?: number; // 2023
  modulos?: string[]; // ["Cobros","Reservas","Mant."]
  csatPromedio?: number;
  /** Etiquetas asignadas al condominio (catálogo `tags`, por sitio). */
  tags?: string[];
  chatGlobalActivo: boolean;
  createdAt: unknown;
}

// ---------------------------------------------------------------------------
// Grupos (organizaciones con varios admins que administran N clientes)
// ---------------------------------------------------------------------------

/**
 * groups/{groupId} — p. ej. una administradora que maneja varios condominios.
 * Se upsertea desde widgetSession con lo que declara el host (last-write-wins).
 */
export interface Group {
  siteId: string;
  name: string;
  /** Si el grupo tiene chat grupal contratado (lo dicta el host). */
  chatEnabled: boolean;
  /** Unidades que administra (condominios para Aditum). */
  clients: GroupClientRef[];
  /** Etiquetas asignadas al grupo (catálogo `tags`, por sitio). */
  tags?: string[];
  createdAt: unknown;
  updatedAt: unknown;
}

// ---------------------------------------------------------------------------
// Contactos (directorio auto-poblado) — pantalla 1r
// ---------------------------------------------------------------------------

/** contacts/{contactId} con contactId = `${siteId}_${externalId}`. */
export interface Contact {
  externalId: string;
  siteId: string;
  clientId?: string;
  /** Organización del admin (si vino en el payload). */
  groupId?: string;
  groupName?: string;
  nombre: string;
  email?: string;
  telefono?: string;
  /** "Administrador", "Residente (filial B-14)", etc. */
  rol?: string;
  filial?: string;
  idioma: Idioma;
  deviceTokens?: string[];
  metadata?: Record<string, string | number | boolean>;
  conversacionesCount: number;
  ticketsCount: number;
  csatPromedio?: number;
  /** IDs de etiquetas asignadas (catálogo `tags`, por sitio). */
  tags?: string[];
  lastActivity: unknown;
  createdAt: unknown;
}

/**
 * Etiqueta configurable por sitio (Configuración → Etiquetas).
 * Se asignan a los contactos/residentes; `color` es un hex libre.
 */
export interface Tag {
  siteId: string;
  nombre: string;
  color: string; // hex, ej. "#123C68"
  orden?: number;
  createdAt: unknown;
}

// ---------------------------------------------------------------------------
// Conversaciones y mensajes
// ---------------------------------------------------------------------------

export interface MessageSender {
  tipo: SenderType;
  /** contactId, uid del agente, 'bot' o 'sistema'. */
  id: string;
  nombre: string;
}

export interface Attachment {
  tipo: 'imagen' | 'video' | 'archivo';
  storagePath: string;
  url?: string;
  nombre?: string;
  mimeType?: string;
  /** Segundos, para video-mensajes. */
  duracion?: number;
  thumbnailPath?: string;
}

export interface ConversationSla {
  primeraRespuestaDue?: unknown;
  primeraRespuestaAt?: unknown;
  pausada: boolean;
  motivoPausa?: 'bot' | 'fuera_horario' | null;
}

/** conversations/{id} */
export interface Conversation {
  tipo: ConversationTipo;
  siteId: string;
  clientId?: string;
  clientNombre?: string;
  /** Para tipo 'grupo': organización dueña del canal. */
  groupId?: string;
  groupName?: string;
  /** Para tipo 'directa'. */
  contactId?: string;
  contactNombre?: string;
  /** Para tipo 'grupo': contactIds + uids de agentes. */
  participantes?: string[];
  participantesInfo?: Record<string, { nombre: string; tipo: SenderType; rol?: string }>;
  estado: ConversationStatus;
  /**
   * Canal de una conversación directa: 'bot' (Preguntas del sistema) o
   * 'agente' (Hablar con un agente). Ausente en datos viejos = 'agente'.
   */
  subcanal?: 'bot' | 'agente';
  /** Si el bot escaló: id de la conversación de agente a la que se pasó el contexto. */
  escaladoA?: string | null;
  /**
   * Timestamp del ÚLTIMO escalamiento. El widget salta al canal agente cuando
   * este valor crece (re-escalar a la misma conversación no cambia escaladoA).
   */
  escaladoAt?: unknown;
  asignadoA?: string | null;
  asignadoNombre?: string | null;
  /** Foto del agente asignado (para el header del chat en el widget). */
  asignadoFoto?: string | null;
  /** Categoría/topic asignada al resolver (clave de CONVERSATION_CATEGORIES o texto libre). */
  categoria?: string;
  resueltaPor?: string;
  resueltaNombre?: string;
  resueltaAt?: unknown;
  /** Calificación CSAT recibida para esta conversación (1–5). La escribe `metricsOnCsat`. */
  csatRating?: 1 | 2 | 3 | 4 | 5;
  csatAt?: unknown;
  /** Intentos del bot sin resolver (para escalamiento automático). */
  botIntentos?: number;
  lastMessage?: {
    texto: string;
    senderTipo: SenderType;
    senderId?: string;
    senderNombre?: string;
    at: unknown;
  };
  /** Contadores de no-leídos por participante (contactId/uid → n). */
  unread?: Record<string, number>;
  /** Silenciado por participante (contactId/uid → true): sin sonido ni badge. */
  silenciado?: Record<string, boolean>;
  sla?: ConversationSla;
  idioma?: Idioma;
  createdAt: unknown;
  updatedAt: unknown;
}

/** conversations/{id}/messages/{id} */
export interface Message {
  sender: MessageSender;
  texto: string;
  tipoContenido: MessageContent;
  adjuntos?: Attachment[];
  /** emoji → lista de ids (contactId/uid) que reaccionaron. */
  reacciones?: Record<string, string[]>;
  editadoAt?: unknown;
  /** Texto previo a la última edición (se muestra en hover del "editado"). */
  textoAnterior?: string;
  replyTo?: { messageId: string; texto: string; senderNombre: string } | null;
  /** Chip de referencia a ticket (ej. "quedó el ticket #TK-0042"). */
  ticketRef?: { ticketId: string; numero: number } | null;
  /**
   * Voto del contacto sobre una respuesta del bot ("¿te sirvió?").
   * Lo estampa el trigger onBotFeedbackWrite (Admin SDK).
   */
  feedback?: 'helpful' | 'not_helpful';
  /** En el mensaje de contexto del canal agente: id de la conversación bot de origen. */
  botConvRef?: string;
  /** Nota interna de agente — nunca visible en el widget. */
  interno?: boolean;
  /** Mensaje de bienvenida automático (primer mensaje). No dispara SLA ni push. */
  bienvenida?: boolean;
  leidoPor?: string[];
  createdAt: unknown;
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

export interface TicketSla {
  policyId?: string;
  dueAt?: unknown;
  estado: SlaEstado;
  pausas?: { desde: unknown; hasta?: unknown; motivo: string }[];
}

/** tickets/{id} */
export interface Ticket {
  numero: number;
  siteId: string;
  clientId?: string;
  clientNombre?: string;
  /** Para ambito 'grupo': organización a la que pertenece el ticket. */
  groupId?: string;
  groupName?: string;
  contactId?: string;
  contactNombre?: string;
  conversationId?: string | null;
  asunto: string;
  descripcion: string;
  estado: TicketStatus;
  prioridad: TicketPriority;
  ambito: TicketAmbito;
  /** Público: visible para todos los contactos del cliente (o de todos, si ambito=sistema). */
  publico: boolean;
  asignadoA?: string | null;
  asignadoNombre?: string | null;
  /** Referencia al tracker de desarrollo, ej. "DEV-318". */
  devRef?: string | null;
  sla?: TicketSla;
  resolucion?: { texto: string; adjuntos?: Attachment[]; por: string; porNombre: string; at: unknown } | null;
  createdAt: unknown;
  updatedAt: unknown;
  resueltoAt?: unknown;
}

export type TicketEventTipo =
  | 'creado'
  | 'asignado'
  | 'estado'
  | 'prioridad'
  | 'publico'
  | 'desarrollo'
  | 'resolucion'
  | 'edicion'
  | 'comentario';

/** tickets/{id}/historial/{id} — timeline visible en el widget (si ticket visible). */
export interface TicketEvent {
  tipo: TicketEventTipo;
  descripcion: string;
  /** Para tipo 'estado': { de, a }. */
  de?: string;
  a?: string;
  por?: MessageSender;
  createdAt: unknown;
}

/** tickets/{id}/notas/{id} — internas, nunca visibles en el widget. */
export interface TicketNote {
  autor: MessageSender;
  texto: string;
  createdAt: unknown;
  /** Presente si la nota fue editada. */
  editadoAt?: unknown;
}

// ---------------------------------------------------------------------------
// Equipo — pantallas 1j / 1m
// ---------------------------------------------------------------------------

/** team/{uid} */
export interface TeamMember {
  nombre: string;
  email: string;
  rol: TeamRole;
  /** Nombre visible en el chat (ej. "Laura de Aditum"). */
  nombreChat: string;
  fotoUrl?: string;
  /** Sitios asignados; vacío = todos. */
  sitios: string[];
  /** Tokens FCM Web Push del agente (notificaciones de escritorio de la consola). */
  fcmTokens?: string[];
  activo: boolean;
  idioma: Idioma;
  presencia: Presencia;
  carga?: { chats: number; tickets: number };
  createdAt: unknown;
}

// ---------------------------------------------------------------------------
// Settings globales — pantallas 1i / 1k / 1p
// ---------------------------------------------------------------------------

/** settings/global */
export interface GlobalSettings {
  widgetConfig: WidgetConfig;
  botConfig: BotConfig;
  scheduleConfig: ScheduleConfig;
}

/** settings/sla — pantalla 1p */
export interface SlaPolicy {
  /** Minutos objetivo de primera respuesta (15). */
  primeraRespuestaMin: number;
  pausarConBot: boolean;
  pausarFueraHorario: boolean;
  /** Horas objetivo de resolución por prioridad. */
  resolucionHoras: Record<TicketPriority, number>;
  /** Avisar al agente cuando quede este % del tiempo (25). */
  avisoPorcentaje: number;
  escalarAlAdminAlVencer: boolean;
  /** Reasignar si el agente no responde en N minutos (30). 0 = off. */
  reasignarTrasMin: number;
}

// ---------------------------------------------------------------------------
// Base de conocimiento (RAG) — pantalla 1i
// ---------------------------------------------------------------------------

/** kb/{docId} */
export interface KbDoc {
  tipo: KbDocTipo;
  nombre: string;
  /** 'TODOS' o un siteId. */
  sitio: string;
  estado: KbDocEstado;
  storagePath?: string;
  url?: string;
  paginas?: number;
  articulos?: number;
  chunks?: number;
  updatedAt: unknown;
  createdAt: unknown;
}

/** kb/{docId}/chunks/{id} — texto + embedding para findNearest. */
export interface KbChunk {
  texto: string;
  /** FieldValue.vector(...) en escritura. */
  embedding: unknown;
  orden: number;
  fuente: string;
}

// ---------------------------------------------------------------------------
// CSAT y métricas — pantalla 1h
// ---------------------------------------------------------------------------

/** csat/{id} */
export interface CsatRating {
  rating: 1 | 2 | 3 | 4 | 5;
  conversationId?: string;
  ticketId?: string;
  contactId: string;
  siteId: string;
  agenteId?: string | null;
  comentario?: string;
  createdAt: unknown;
}

/**
 * bot_feedback/{`${conversationId}_${messageId}`} — voto "¿te sirvió?" sobre
 * una respuesta del bot. docId determinístico = un voto por mensaje.
 * Inmutable salvo la transición escalate: ausente → true (aceptó la oferta
 * de hablar con un agente tras un voto negativo).
 */
export interface BotFeedback {
  conversationId: string;
  messageId: string;
  contactId: string;
  siteId: string;
  helpful: boolean;
  escalate?: boolean;
  createdAt: unknown;
}

/** metrics/daily/{yyyy-mm-dd} */
export interface DailyMetrics {
  fecha: string;
  siteId?: string;
  conversacionesNuevas: number;
  resueltasBot: number;
  resueltasAgente: number;
  /** Milisegundos de primera respuesta (para mediana se guardan buckets). */
  primeraRespuestaMs: number[];
  slaCumplidos: number;
  slaVencidos: number;
  csatSum: number;
  csatCount: number;
  /** Votos "¿te sirvió?" sobre respuestas del bot (onBotFeedbackWrite). */
  botHelpfulCount?: number;
  botNotHelpfulCount?: number;
  porAgente?: Record<string, { resueltas: number; slaCumplidos: number; slaTotal: number }>;
}

// ---------------------------------------------------------------------------
// Payload cifrado del host y settings del snippet — pantalla 1o
// ---------------------------------------------------------------------------

/** Unidad administrada por un grupo (condominio, sitio, sucursal…). */
export interface GroupClientRef {
  id: string;
  name: string;
}

/** Máximo de unidades aceptadas en `groupClients` por payload. */
export const GROUP_CLIENTS_MAX = 300;

/**
 * Metadatos del cliente que el host manda en el payload para el panel de
 * contexto de la consola. Se upsertean en clients/{clientId} en cada sesión.
 */
export interface ClientInfo {
  /** "Sabana, San José" */
  location?: string;
  /** Cantidad de filiales/unidades. */
  units?: number;
  /** "Empresarial" */
  plan?: string;
  /** Año desde el que es cliente. */
  customerSince?: number;
  /** ["Cobros", "Reservas", "Mant."] */
  modules?: string[];
}

/** JSON que el server del host cifra con la clave del sitio (AES-256-GCM). */
export interface EncryptedPayloadClaims {
  userId: string;
  name: string;
  email?: string;
  role?: string;
  /** Cliente/condominio del usuario (tenencia de directas y tickets). */
  clientId?: string;
  clientName?: string;
  /** Metadatos del cliente para el panel de contexto (requiere clientId). */
  clientInfo?: ClientInfo;
  /** Organización a la que pertenece un admin (tiene la lista de clientes). */
  groupId?: string;
  groupName?: string;
  /** El host dicta si el grupo tiene chat grupal contratado. */
  groupChatEnabled?: boolean;
  /** Unidades que administra el grupo. Máx GROUP_CLIENTS_MAX. */
  groupClients?: GroupClientRef[];
  deviceToken?: string;
  language?: Idioma;
  metadata?: Record<string, string | number | boolean>;
  /** Epoch seconds. exp máx = iat + 300 (5 min). */
  iat: number;
  exp: number;
}

/** window.AditumChatSettings que embebe el host. */
export interface AditumChatSettings {
  siteId: string;
  /** base64(iv ‖ ciphertext ‖ tag) generado server-side por el host. */
  payload?: string;
  /**
   * Endpoint del host que devuelve `{ payload }` fresco (mismo formato que
   * `payload`). El payload embebido vence a los 5 min; con esta URL el widget
   * pide uno nuevo al momento de iniciar sesión — recomendado para páginas que
   * viven más que eso (SPAs). Se llama con `credentials: 'include'`.
   */
  payloadUrl?: string;
  config?: Partial<WidgetConfig>;
  /** Override del endpoint (emuladores / staging). */
  apiUrl?: string;
}

/** Respuesta de la function widgetSession. */
export interface WidgetSessionResponse {
  token: string;
  contactId: string;
  siteId: string;
  clientId?: string;
  nombre: string;
  rol?: string;
  clientNombre?: string;
  groupId?: string;
  groupName?: string;
  idioma: Idioma;
  widgetConfig: WidgetConfig;
  botConfig: Pick<BotConfig, 'activo' | 'nombre' | 'avatarUrl' | 'saludo' | 'adjuntos'>;
  scheduleText: string;
  enHorario: boolean;
  grupoConversationId?: string;
}

// ---------------------------------------------------------------------------
// Claims de auth
// ---------------------------------------------------------------------------

export interface ContactClaims {
  kind: 'contact';
  siteId: string;
  clientId?: string;
  groupId?: string;
  contactId: string;
}

export interface AgentClaims {
  kind: 'agent';
  rol: TeamRole;
}
