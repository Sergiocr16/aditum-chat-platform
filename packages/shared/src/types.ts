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
  /** Color del botón flotante (launcher). Por defecto usa `color`. */
  colorBurbuja?: string;
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
  /** Let the bot use the private index of the production repository as evidence. Off by default. */
  codeRagEnabled?: boolean;
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
  /**
   * Cierre "de arrastre": el agente resolvió el chat del contacto y con él se
   * cerró este segmento del canal bot que había quedado vivo. No es una
   * resolución propia, así que `metricsOnResolve` no lo contabiliza.
   */
  cierreArrastrado?: boolean;
  /**
   * Set while estado is 'pending' ("waiting on customer"): when the agent parked
   * the conversation. Cleared when the customer replies or the agent reopens it.
   */
  waitingSince?: unknown;
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
  /**
   * Auto-resolve conversations left "waiting on customer" (estado 'pending')
   * after N hours without a customer reply (24). 0 = off.
   */
  autoResolveWaitingHours: number;
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
// Code index (private RAG over the production repository)
// ---------------------------------------------------------------------------

/** code_chunks/{id} — Admin SDK only; clients are denied in firestore.rules. */
export type CodeAudience = 'manager' | 'accountant';

export interface CodeChunk {
  path: string;
  startLine: number;
  endLine: number;
  symbol: string | null;
  language: string | null;
  text: string;
  commitSha: string;
  /** Who may get answers built from this chunk; equality pre-filters of the vector search. */
  forManager: boolean;
  forAccountant: boolean;
  /** FieldValue.vector(...) on write. */
  embedding: unknown;
}

/** code_files/{sha1(path)} — manifest used to diff the repository against the index. */
export interface CodeFileEntry {
  path: string;
  blobSha: string;
  chunks: number;
  /** Empty means nobody in the chat can reach this file, so it isn't indexed. */
  audiences: CodeAudience[];
  /** Secret-scan rule names that kept this file out of the index; empty if indexed. */
  skipReasons: string[];
}

/** code_index/state — progress of the sync; readable by admins, no code content. */
export interface CodeIndexState {
  repo?: string;
  targetSha?: string;
  indexedSha?: string;
  indexedAt?: number;
  lastCheckAt?: number;
  lastError?: string;
  pendingFiles?: number;
  failedFiles?: number;
  files?: number;
  chunks?: number;
  skippedForSecrets?: string[];
  lockUntil?: number;
}

/** bot_evidence/{messageId} — what backed a bot reply. References only, never source text. */
export interface BotEvidence {
  conversationId: string;
  sources: { kind: 'kb' | 'code' | 'context'; ref: string }[];
  createdAt: unknown;
}

/** bot_gate_events/{id} — a reply the evidence gate blocked, kept to measure over-blocking. */
export interface BotGateEvent {
  conversationId: string;
  reason: string;
  usedCode: boolean;
  createdAt: unknown;
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
  botConfig: Pick<
    BotConfig,
    'activo' | 'nombre' | 'avatarUrl' | 'saludo' | 'adjuntos' | 'responderFueraDeHorario'
  >;
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

// ---------------------------------------------------------------------------
// Investigations (agent console → analyzer on the Raspberry Pi)
// ---------------------------------------------------------------------------

export type InvestigationStatus = 'queued' | 'running' | 'done' | 'failed' | 'rate_limited' | 'cancelled';

/** `confirmed` is only ever granted by the runner, after checking the evidence. */
export type InvestigationConclusion = 'confirmed' | 'hypothesis' | 'undetermined';

export interface InvestigationCodeEvidence {
  path: string;
  startLine: number;
  endLine: number;
  quote: string;
}

/** What kind of thing it turned out to be, which decides what can be done about it. */
export type InvestigationClassification = 'bug' | 'data_error' | 'missing_feature' | 'expected_behavior' | 'question' | 'unknown';

/** A row of the product backlog in Notion, as compared against. */
export interface InvestigationBacklogRow {
  id: string;
  url: string;
  title: string;
  description: string;
  modules: string[];
}

/** The ticket Claude defined for a confirmed bug, following the backlog's template. */
export interface InvestigationBacklogDraft {
  name: string;
  /** One or two lines. The detail goes in the fields below. */
  description: string;
  priority: 'Urgente' | 'Alta' | 'Media' | 'Baja';
  modules: string[];
  roles: string[];
  problem: string;
  expected: string;
  steps: string[];
  screenName: string;
  howToReach: string;
  acceptance: string[];
  notes: string;
  /** An open task on the board about the same thing, when Claude found one. */
  duplicateOf: Pick<InvestigationBacklogRow, 'id' | 'title' | 'url'> | null;
  /** False when the board couldn't be read, so "no duplicate" means nothing. */
  duplicateChecked: boolean;
}

export interface InvestigationDataEvidence {
  queryId: string;
  values: string[];
}

export interface InvestigationReport {
  conclusion: InvestigationConclusion;
  /** What the model claimed before the check lowered it, when it did. */
  downgradedFrom: InvestigationConclusion | null;
  summary: string;
  cause: string;
  recommendation: string;
  /** Only with a `confirmed` conclusion. Never sent by itself. */
  suggestedReply: string | null;
  /** What's left to find out. */
  missing: string[];
  codeEvidence: InvestigationCodeEvidence[];
  dataEvidence: InvestigationDataEvidence[];
  /** Why each evidence item the model gave didn't check out. */
  rejectedEvidence: string[];
  /** Missing on reports from before it existed. */
  classification?: InvestigationClassification;
  /** Only for a confirmed bug. */
  backlogDraft?: InvestigationBacklogDraft | null;
  /** Comes from the Pi, and functions moves it out to `proposals` once it passes. */
  writeProposal?: WriteProposalDraft | null;
  /** investigations/{id}/proposals/{proposalId}, when this round proposed a change that passed. */
  proposalId?: string | null;
  /** Why the change it proposed never reached an admin. */
  proposalProblems?: string[];
}

/** A selected message: conversations can span segments, so it carries its own. */
export interface InvestigationMessageRef {
  conversationId: string;
  messageId: string;
}

/** investigations/{id}. Agents read, only functions write. */
/** A file an investigation reads. It never comes from the client as text: the server checks each one. */
export interface InvestigationFile {
  id: string;
  /** `chat`: attached to a selected message. `agent`: uploaded for this investigation, the client never sees it. */
  source: 'chat' | 'agent';
  storagePath: string;
  name: string;
  mimeType: string;
  size: number;
}

/** Who the chat was with when the investigation was requested. A group chat has no single contact. */
/** A condominium the agent said the case is about. No `id` means they typed a name that isn't on the chat's list. */
export interface InvestigationCondominium {
  id: string | null;
  name: string;
}

/** The same cap the host has on its list of a group's condominiums. */
export const INVESTIGATION_MAX_CONDOMINIUMS = GROUP_CLIENTS_MAX;

export interface InvestigationSource {
  contactId: string | null;
  contactNombre: string | null;
  clientId: string | null;
  clientNombre: string | null;
}

/** A message as the analyzer received it. */
export interface InvestigationSentMessage {
  at: string | null;
  senderType: string;
  senderName: string;
  internalNote: boolean;
  text: string;
  attachments: { type: string; name: string | null; mimeType: string | null; fileId?: string }[];
}

/**
 * investigations/{id}/sent/messages: exactly what went to the analyzer, frozen at request time so a
 * later edit to the chat doesn't change it. Apart from the investigation so lists don't load it.
 */
export interface InvestigationSentMessages {
  messages: InvestigationSentMessage[];
}

export interface Investigation {
  /** `contact:{id}` or `group:{id}`: the chat this belongs to across segments. */
  threadKey: string;
  /** The conversation it was requested from. */
  conversationId: string;
  siteId: string;
  /** Missing on investigations from before it was saved. */
  source?: InvestigationSource;
  /** Which condominiums it's about, chosen by the agent. Missing on older investigations. */
  condominiums?: InvestigationCondominium[];
  question: string;
  messageCount: number;
  messageRefs: InvestigationMessageRef[];
  /** Files it was given: from the selected messages, and uploaded by the agent. */
  files?: InvestigationFile[];
  /** Names of the files the analyzer couldn't open. */
  unreadableFiles?: string[];
  /** SHA-256 of exactly what the analyzer received. */
  contentHash: string;
  requestedBy: { uid: string; nombre: string };
  status: InvestigationStatus;
  /** Which round of questions this is. Missing means the first one. */
  turn?: number;
  /** What the current round asks, from the second one on. `question` stays the original. */
  followUp?: { question: string; by: { uid: string; nombre: string } } | null;
  /** When it last went into the queue, which is what orders the queue. */
  queuedAt?: unknown;
  /** The row it became in the backlog. `creating` holds it while the click is in flight. */
  backlogItem?: { status: 'creating' | 'created'; url: string | null; by: { uid: string; nombre: string }; at: unknown };
  /** The latest approved write that changed production, or may have. The rows are in its proposal. */
  productionWrite?: InvestigationProductionWrite;
  /** Commit of the production branch that was read. */
  sha?: string | null;
  report?: InvestigationReport | null;
  error?: string | null;
  usedDatabase?: boolean;
  costUsd?: number | null;
  createdAt: unknown;
  startedAt?: unknown;
  finishedAt?: unknown;
  heartbeatAt?: unknown;
}

/** investigations/{id}/turns/{n}: a finished round, moved here when the agent asks something else. */
export interface InvestigationTurn {
  n: number;
  question: string;
  by: { uid: string; nombre: string };
  status: InvestigationStatus;
  report: InvestigationReport | null;
  error: string | null;
  sha: string | null;
  usedDatabase: boolean;
  costUsd: number | null;
  unreadableFiles: string[];
  askedAt: unknown;
  finishedAt: unknown;
}

/** investigations/{id}/events/{eventId}: progress shown while it runs. */
export interface InvestigationEvent {
  kind: 'code' | 'database' | 'attachment' | 'status';
  text: string;
  at: unknown;
}

/** investigations/{id}/queries/{queryId}: what was asked of production. Rows stay on the Pi. */
export interface InvestigationQueryRecord {
  /** The round that ran it. Missing means the first one. */
  turn?: number;
  dataQuestion: string;
  purpose: string;
  sql: string;
  rowCount: number;
  truncated: boolean;
  ms: number;
  error: string | null;
  at: unknown;
}

export type WriteValue = string | number | boolean | null;

/** One row each, by its full primary key. There's no way to express a condition, or to delete. */
export type WriteOperation =
  | { op: 'update'; table: string; key: Record<string, WriteValue>; set: Record<string, WriteValue> }
  | { op: 'insert'; table: string; values: Record<string, WriteValue> };

export type WriteRiskLevel = 'low' | 'medium' | 'high' | 'undetermined';

/** What Claude proposes running in production. It never has a tool to run it. */
export interface WriteProposalDraft {
  reason: string;
  operations: WriteOperation[];
  /** Who or what reads these data. */
  consequence: string;
  consequenceEvidence: InvestigationCodeEvidence[];
  riskLevel: WriteRiskLevel;
  risk: string;
  /** What stays out of date, since a direct write skips the app's cache eviction. */
  cache: string;
}

export type WriteProposalStatus =
  | 'proposed'
  | 'superseded'
  | 'rehearsing'
  | 'rehearsed'
  | 'rehearsal_failed'
  | 'executing'
  | 'executed'
  | 'aborted'
  | 'unknown';

/** One row, as the database really left it. Only the columns involved, so nothing else is kept here. */
export interface WriteRowResult {
  op: 'update' | 'insert';
  table: string;
  key: Record<string, WriteValue>;
  before: Record<string, WriteValue> | null;
  after: Record<string, WriteValue>;
  /** Every column of the row, hashed: detects a change without keeping the rest of its data. */
  beforeHash: string | null;
  /** Leaves out what legitimately differs between two runs, to compare a run with its rehearsal. */
  afterHash: string;
  /** Every column as this run left it: what tells afterwards whether this run's COMMIT landed. */
  afterFullHash: string;
  /** Columns that ended up different, including what triggers changed. */
  changed: string[];
  /** Columns the operation set that didn't end up with that value, because a trigger overrode it. */
  notAsRequested: string[];
  /** Changed columns MySQL computes, which can't be set back. */
  generated: string[];
  affected: number;
}

/** How to undo it. Built from what the database returned, never by the model. */
export interface WriteReversal {
  operations: WriteOperation[];
  /** What can't be undone this way, like an insert: the writer has no permission to delete. */
  manual: string[];
}

export interface WriteRehearsal {
  rows: WriteRowResult[];
  reversal: WriteReversal;
  /** What the approval is given over: these operations and this result. */
  hash: string;
  by: { uid: string; nombre: string };
  at: unknown;
}

export interface WriteApproval {
  by: { uid: string; nombre: string };
  startedAt: unknown;
  /** The last step confirmed. */
  step: 1 | 2;
  hash: string;
}

export interface InvestigationProductionWrite {
  proposalId: string;
  /** `unknown`: it may have been applied, and someone has to check the rows. */
  status: 'executed' | 'unknown';
  /** It undid an earlier write. */
  reversal: boolean;
  rows: number;
  by: { uid: string; nombre: string };
  at: unknown;
}

export interface WriteExecution {
  by: { uid: string; nombre: string };
  requestedAt: unknown;
  finishedAt?: unknown;
  rows?: WriteRowResult[];
  reversal?: WriteReversal;
  /** Why it stopped without changing anything, or why the outcome isn't known. */
  detail?: string | null;
}

/** investigations/{id}/proposals/{proposalId}. Agents read, only functions writes. */
export interface WriteProposal extends WriteProposalDraft {
  turn: number;
  status: WriteProposalStatus;
  opsHash: string;
  createdAt: unknown;
  /** The proposal this one undoes. */
  reverseOf?: string | null;
  rehearsalRequestedAt?: unknown;
  /** The job whose result counts: an older one reporting late doesn't. */
  rehearsalJobId?: string | null;
  rehearsedBy?: { uid: string; nombre: string };
  error?: string | null;
  rehearsal?: WriteRehearsal | null;
  approval?: WriteApproval | null;
  execution?: WriteExecution | null;
}

/** investigator/writes: whether writing is on at all. Starts off, and only a function changes it. */
export interface InvestigatorWritesSwitch {
  enabled: boolean;
  by: string;
  at: unknown;
}

export interface InvestigatorWriterCheck {
  id: 'connect' | 'tls' | 'grants';
  ok: boolean;
  detail: string;
}

/** investigator/writer: the write connection, admins only. The password is kept apart, encrypted. */
export interface InvestigatorWriterConfig {
  host: string;
  port: number;
  user: string;
  database: string;
  /** Whether the certificate that verifies the server is saved. Writes need it. */
  hasCa: boolean;
  version: string;
  updatedBy: string;
  updatedAt: unknown;
  test: {
    status: 'pending' | 'ok' | 'failed';
    requestedAt: unknown;
    finishedAt?: unknown;
    checks?: InvestigatorWriterCheck[];
    /** What its GRANTs allow, which is all it can touch. */
    tables?: { name: string; privileges: string[] }[];
  };
}

/** investigator/writerState: whether the writer on the Pi is alive. */
export interface InvestigatorWriterState {
  lastSeenAt: unknown;
  publicIp?: string | null;
}

export type WriteAuditEvent =
  | 'rehearsal_requested'
  | 'rehearsed'
  | 'rehearsal_failed'
  | 'step_confirmed'
  | 'approval_cancelled'
  | 'execution_requested'
  | 'executed'
  | 'aborted'
  | 'unknown'
  | 'switch_changed'
  | 'reversal_proposed';

/** prod_write_audit/{id}: every step of every write. Admins read, functions writes, and nothing deletes it. */
export interface WriteAuditEntry {
  event: WriteAuditEvent;
  at: unknown;
  by: { uid: string; nombre: string } | null;
  investigationId?: string;
  proposalId?: string;
  hash?: string;
  detail?: string | null;
  rows?: WriteRowResult[];
}

/** investigator/backlog: which Notion board bugs go to. The token is kept apart, encrypted. Agents read it. */
export interface InvestigatorBacklogConfig {
  databaseId: string;
  version: string;
  updatedBy: string;
  updatedAt: unknown;
  test: { status: 'ok' | 'failed'; title: string | null; problems: string[]; finishedAt: unknown };
}

/** investigator/runner: lets the console tell when the analyzer is offline. */
export interface InvestigatorRunnerState {
  lastSeenAt: unknown;
  /** Days until the Claude Code token expires, when known. */
  tokenDaysLeft?: number | null;
}

export interface InvestigatorDbCheck {
  id: 'connect' | 'tls' | 'grants' | 'tables' | 'read';
  ok: boolean;
  detail: string;
}

/** investigator/db: the production connection, admins only. The password is kept apart, encrypted. */
export interface InvestigatorDbConfig {
  host: string;
  port: number;
  user: string;
  database: string;
  /** Changes on every save, so the gateway knows when to reload. */
  version: string;
  updatedBy: string;
  updatedAt: unknown;
  test: {
    status: 'pending' | 'ok' | 'failed';
    requestedAt: unknown;
    finishedAt?: unknown;
    checks?: InvestigatorDbCheck[];
  };
}

export interface InvestigatorPiCheck {
  id: 'connect' | 'hostKey' | 'system' | 'claude';
  ok: boolean;
  detail: string;
}

/** investigator/pi: how to reach the Raspberry Pi over SSH, admins only. The password is kept apart, encrypted. */
export interface InvestigatorPiConfig {
  host: string;
  port: number;
  user: string;
  /** Pinned on the first successful login. A different key stops the login before the password is sent. */
  hostKeyFingerprint: string | null;
  /** Changes on every save, so a test still running can't overwrite the result of a newer one. */
  version: string;
  updatedBy: string;
  updatedAt: unknown;
  test: {
    status: 'pending' | 'ok' | 'failed';
    requestedAt: unknown;
    finishedAt?: unknown;
    checks?: InvestigatorPiCheck[];
  };
  /** Whether a Claude Code token is saved, so the console doesn't ask for it again. */
  hasClaudeToken?: boolean;
  /** When the saved token was issued. It lasts a year and the runner warns before it expires. */
  claudeTokenIssuedAt?: string;
  install?: InvestigatorPiInstall;
}

export type InvestigatorPiInstallStep = 'connect' | 'prepare' | 'users' | 'node' | 'build' | 'claude' | 'config' | 'services' | 'verify';

/** Progress of the last install or update. The log has secrets removed before it's stored. */
export interface InvestigatorPiInstall {
  status: 'running' | 'ok' | 'failed';
  step: InvestigatorPiInstallStep;
  /** Commit being installed. */
  commit?: string;
  log: string[];
  detail?: string;
  startedBy: string;
  startedAt: unknown;
  finishedAt?: unknown;
}

/** investigator/gateway: what the Pi's gateway last reported, admins only. */
export interface InvestigatorGatewayState {
  lastSeenAt: unknown;
  /** The address production's firewall has to allow. */
  publicIp: string | null;
}
