import { randomUUID } from 'node:crypto';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { formatTicketNumber } from '@aditum-chat/shared';
import type {
  Conversation,
  Investigation,
  InvestigationBacklogDraft,
  InvestigationBacklogRow,
  InvestigationBacklogType,
  InvestigatorBacklogConfig,
  MessageSender,
  TicketPriority,
} from '@aditum-chat/shared';
import { db, FieldValue } from './lib/admin.js';
import { decryptJson, encryptJson } from './lib/crypto.js';
import { requireActiveAdmin, requireActiveAgent } from './lib/guards.js';
import { getKek } from './pushConfig.js';
import { crearTicketInterno, type CrearTicketParams } from './tickets.js';

/**
 * Turns what an investigation found, a bug or an improvement, into a row of the product backlog in
 * Notion, as the `aditum-backlog-definer` skill in the production repo would. Claude on the Pi writes
 * the definition and looks for duplicates, since it has no Notion access: this reads the board for it
 * and creates the row. If the skill's templates or the board's columns change, this and the Pi's
 * prompt follow. The same click can open the client's ticket in the chat for the same thing.
 */

const configKek = defineSecret('CONFIG_KEK');

const CONFIG_DOC = 'investigator/backlog';
const SECRET_DOC = 'investigator_secrets/backlog';
const NOTION_VERSION = '2022-06-28';
const NOTION_TIMEOUT_MS = 15_000;
const INITIAL_STATE = 'Sin empezar';
const INACTIVE_STATES = ['Finalizada', 'Archivadas', 'Desarrollo realizado'];
/** Rows Claude compares against. A board bigger than this loses the oldest from the comparison. */
const MAX_ACTIVE_ROWS = 300;
const MAX_DESCRIPTION_CHARS = 200;
const MAX_TEXT_CHARS = 2000;
const MAX_LIST_ITEMS = 20;
/** A click that died halfway doesn't lock the investigation out of the backlog forever. */
const CREATING_STALE_MS = 2 * 60_000;
const MAX_TICKET_DESCRIPTION_CHARS = 4000;

/** Whatever the draft says, the board only gets one of its two types. Drafts from before improvements are bugs. */
export const backlogTypeOf = (draft: InvestigationBacklogDraft): InvestigationBacklogType =>
  draft.type === 'Missing Feature' ? 'Missing Feature' : 'Bug';

/** The columns the board has to have, as the skill describes them. */
const REQUIRED_COLUMNS: Record<string, string> = {
  'Nombre de tarea': 'title',
  Descripción: 'rich_text',
  Tipo: 'select',
  Prioridad: 'select',
  Módulo: 'multi_select',
  'Rol afectado': 'multi_select',
  'Cliente Afectado': 'rich_text',
  Estado: 'status',
};

export interface BoardSchema {
  title?: { plain_text: string }[];
  properties: Record<
    string,
    {
      type: string;
      select?: { options: { name: string }[] };
      multi_select?: { options: { name: string }[] };
      status?: { options: { name: string }[] };
    }
  >;
}

const optionsOf = (schema: BoardSchema, column: string): string[] => {
  const property = schema.properties[column];
  const holder = property?.select ?? property?.multi_select ?? property?.status;
  return holder?.options.map((option) => option.name) ?? [];
};

export function boardProblems(schema: BoardSchema): string[] {
  const problems = Object.entries(REQUIRED_COLUMNS).flatMap(([column, type]) => {
    const found = schema.properties[column]?.type;
    if (!found) return [`Falta la columna "${column}".`];
    return found === type ? [] : [`La columna "${column}" debería ser de tipo ${type}.`];
  });
  if (schema.properties.Tipo && !optionsOf(schema, 'Tipo').includes('Bug')) problems.push('La columna "Tipo" no tiene la opción "Bug".');
  if (schema.properties.Estado && !optionsOf(schema, 'Estado').includes(INITIAL_STATE)) {
    problems.push(`La columna "Estado" no tiene la opción "${INITIAL_STATE}".`);
  }
  return problems;
}

/** Notion creates a select option it doesn't know without saying so, which would litter the board. */
export function draftProblems(draft: InvestigationBacklogDraft, schema: BoardSchema): string[] {
  const unknown = (column: string, values: string[]) => {
    const options = optionsOf(schema, column);
    return values.filter((value) => !options.includes(value)).map((value) => `"${value}" no existe en la columna "${column}" del tablero.`);
  };
  return [
    ...unknown('Tipo', [backlogTypeOf(draft)]),
    ...unknown('Prioridad', [draft.priority]),
    ...unknown('Módulo', draft.modules),
    ...unknown('Rol afectado', draft.roles),
  ];
}

const text = (content: string) => ({ type: 'text', text: { content: content.slice(0, MAX_TEXT_CHARS) } });
const bold = (content: string) => ({ ...text(content), annotations: { bold: true } });
const block = (type: string, richText: object[], extra: object = {}) => ({ object: 'block', type, [type]: { rich_text: richText, ...extra } });
const label = (content: string) => block('paragraph', [bold(content)]);

/** The columns. The client, the state and the type come from here, never from what the model wrote. */
export function pageProperties(draft: InvestigationBacklogDraft, clientNombre: string | null | undefined) {
  return {
    'Nombre de tarea': { title: [text(draft.name)] },
    Descripción: { rich_text: [text(draft.description)] },
    Tipo: { select: { name: backlogTypeOf(draft) } },
    Prioridad: { select: { name: draft.priority } },
    Módulo: { multi_select: draft.modules.map((name) => ({ name })) },
    'Rol afectado': { multi_select: draft.roles.map((name) => ({ name })) },
    ...(clientNombre && { 'Cliente Afectado': { rich_text: [text(clientNombre)] } }),
    Estado: { status: { name: INITIAL_STATE } },
  };
}

/**
 * The page body, following the skill's template for the type. All of it is plain text: a link in
 * what the model wrote stays inert, and the only real link is the one built here.
 */
export function pageBlocks(draft: InvestigationBacklogDraft, investigationUrl: string) {
  const list = (items: string[]) => items.slice(0, MAX_LIST_ITEMS);
  const notes = draft.notes.trim();
  const opening =
    backlogTypeOf(draft) === 'Missing Feature'
      ? [
          label('Qué se necesita (objetivo):'),
          block('paragraph', [text(draft.problem)]),
          label('Resultado esperado (cómo se ve/usa cuando esté listo):'),
          block('paragraph', [text(draft.expected)]),
        ]
      : [
          label('Qué pasa (problema actual):'),
          block('paragraph', [text(draft.problem)]),
          label('Qué debería pasar (esperado):'),
          block('paragraph', [text(draft.expected)]),
          label('Pasos para reproducir:'),
          ...list(draft.steps).map((step) => block('numbered_list_item', [text(step)])),
        ];
  return [
    block('heading_2', [text('Descripción de la Tarea')]),
    ...opening,
    label('Módulo / Pantalla afectada:'),
    block('bulleted_list_item', [text(`Nombre en la app: ${draft.screenName}`)]),
    block('bulleted_list_item', [text(`Cómo llegar: ${draft.howToReach}`)]),
    label('Criterios de aceptación:'),
    ...list(draft.acceptance).map((item) => block('to_do', [text(item)], { checked: false })),
    label('Notas / contexto adicional:'),
    ...(notes ? [block('paragraph', [text(notes)])] : []),
    block('paragraph', [
      text('Investigación en Aditum Chat: '),
      // Notion rejects a link it considers invalid, like a local address.
      investigationUrl.startsWith('https://')
        ? { type: 'text', text: { content: investigationUrl, link: { url: investigationUrl } } }
        : text(investigationUrl),
    ]),
  ];
}

export function databaseIdFrom(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  // The id is the last 32 hex digits before any query, with or without dashes.
  const path = input.trim().split(/[?#]/)[0];
  const match = path.replace(/-/g, '').match(/([0-9a-f]{32})$/i);
  if (!match) return null;
  const id = match[1].toLowerCase();
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

interface NotionPage {
  id: string;
  url: string;
  properties: Record<string, { title?: { plain_text: string }[]; rich_text?: { plain_text: string }[]; multi_select?: { name: string }[] }>;
}

export function activeRowFrom(page: NotionPage): InvestigationBacklogRow {
  const plain = (parts: { plain_text: string }[] | undefined) => (parts ?? []).map((part) => part.plain_text).join('');
  return {
    id: page.id,
    url: page.url,
    title: plain(page.properties['Nombre de tarea']?.title),
    description: plain(page.properties['Descripción']?.rich_text).slice(0, MAX_DESCRIPTION_CHARS),
    modules: (page.properties['Módulo']?.multi_select ?? []).map((option) => option.name),
  };
}

class NotionError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function notionBase(): string {
  // So the emulators can run against a stand-in. Production always talks to Notion itself.
  return (process.env.FUNCTIONS_EMULATOR === 'true' && process.env.NOTION_API_URL) || 'https://api.notion.com';
}

async function notion<T>(token: string, method: string, path: string, body?: object): Promise<T> {
  const response = await fetch(`${notionBase()}/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'notion-version': NOTION_VERSION, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(NOTION_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new NotionError(response.status, detail?.message ?? `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

function explainNotionError(error: unknown): string {
  if (error instanceof NotionError) {
    if (error.status === 401) return 'Notion rechazó el token.';
    if (error.status === 403 || error.status === 404) return 'La integración de Notion no tiene acceso a ese tablero.';
    return `Notion respondió con un error: ${error.message.slice(0, 200)}`;
  }
  return 'No se pudo llegar a Notion.';
}

async function loadConnection() {
  const [config, secret] = await Promise.all([db.doc(CONFIG_DOC).get(), db.doc(SECRET_DOC).get()]);
  const cipher = (secret.data() as { cipher?: string } | undefined)?.cipher;
  if (!config.exists || !cipher) return null;
  const { token } = decryptJson<{ token: string }>(getKek(), cipher);
  return { config: config.data() as InvestigatorBacklogConfig, token };
}

/**
 * What's still open on the board, so Claude can tell whether this is already there. Null when it
 * couldn't be read: the investigation goes on, and the console says it wasn't checked.
 */
export async function activeBacklogRows(): Promise<InvestigationBacklogRow[] | null> {
  try {
    const connection = await loadConnection();
    if (!connection || connection.config.test.status !== 'ok') return null;
    const rows: InvestigationBacklogRow[] = [];
    let cursor: string | undefined;
    do {
      const page = await notion<{ results: NotionPage[]; has_more: boolean; next_cursor: string | null }>(
        connection.token,
        'POST',
        `/databases/${connection.config.databaseId}/query`,
        {
          page_size: 100,
          sorts: [{ timestamp: 'created_time', direction: 'descending' }],
          filter: { and: INACTIVE_STATES.map((state) => ({ property: 'Estado', status: { does_not_equal: state } })) },
          ...(cursor && { start_cursor: cursor }),
        },
      );
      rows.push(...page.results.map(activeRowFrom));
      cursor = page.has_more ? (page.next_cursor ?? undefined) : undefined;
    } while (cursor && rows.length < MAX_ACTIVE_ROWS);
    return rows.slice(0, MAX_ACTIVE_ROWS);
  } catch (e) {
    logger.warn('activeBacklogRows', { message: (e as Error).message });
    return null;
  }
}

async function testBoard(token: string, databaseId: string) {
  try {
    const schema = await notion<BoardSchema>(token, 'GET', `/databases/${databaseId}`);
    const problems = boardProblems(schema);
    return {
      status: problems.length ? ('failed' as const) : ('ok' as const),
      title: (schema.title ?? []).map((part) => part.plain_text).join('') || null,
      problems,
    };
  } catch (e) {
    return { status: 'failed' as const, title: null, problems: [explainNotionError(e)] };
  }
}

export const setInvestigatorBacklog = onCall({ region: 'us-central1', secrets: [configKek], timeoutSeconds: 60 }, async (req) => {
  const admin = await requireActiveAdmin(req.auth);
  const input = req.data as { database?: unknown; token?: unknown; remove?: boolean };
  if (input.remove) {
    await Promise.all([db.doc(CONFIG_DOC).delete(), db.doc(SECRET_DOC).delete()]);
    return { ok: true };
  }
  const databaseId = databaseIdFrom(input.database);
  if (!databaseId) throw new HttpsError('invalid-argument', 'No se reconoce el tablero. Pegá el enlace de Notion.');
  const stored = (await db.doc(SECRET_DOC).get()).data() as { cipher?: string } | undefined;
  const given = typeof input.token === 'string' ? input.token.trim() : '';
  if (given && !/^[\w-]{20,300}$/.test(given)) throw new HttpsError('invalid-argument', 'El token no es válido.');
  if (!given && !stored?.cipher) throw new HttpsError('invalid-argument', 'Falta el token de Notion.');
  const token = given || decryptJson<{ token: string }>(getKek(), stored!.cipher!).token;

  const test = await testBoard(token, databaseId);
  if (given) await db.doc(SECRET_DOC).set({ cipher: encryptJson(getKek(), { token }), enc: 'aes-256-gcm+kek' });
  const config: InvestigatorBacklogConfig = {
    databaseId,
    version: randomUUID(),
    updatedBy: admin.nombre ?? req.auth!.uid,
    updatedAt: FieldValue.serverTimestamp(),
    test: { ...test, finishedAt: FieldValue.serverTimestamp() },
  };
  await db.doc(CONFIG_DOC).set(config);
  return { ok: true };
});

export const testInvestigatorBacklog = onCall({ region: 'us-central1', secrets: [configKek], timeoutSeconds: 60 }, async (req) => {
  await requireActiveAdmin(req.auth);
  const connection = await loadConnection();
  if (!connection) throw new HttpsError('failed-precondition', 'Primero guardá el tablero.');
  const test = await testBoard(connection.token, connection.config.databaseId);
  await db.doc(CONFIG_DOC).update({ test: { ...test, finishedAt: FieldValue.serverTimestamp() } });
  return { ok: true };
});

const consoleBaseUrl = () => (process.env.CONSOLE_BASE_URL || `https://${process.env.GCLOUD_PROJECT}.web.app`).replace(/\/$/, '');

/** Why this click can't go ahead, if it can't. Pure, so the rules around it can be tested. */
export function backlogRefusal(
  investigation: Investigation | undefined,
  force: boolean,
  now: number,
): 'missing' | 'no-draft' | 'duplicate' | 'in-progress' | 'done' | null {
  if (!investigation) return 'missing';
  const item = investigation.backlogItem;
  if (item?.status === 'created') return 'done';
  if (item?.status === 'creating' && now - millisOf(item.at) < CREATING_STALE_MS) return 'in-progress';
  const { status, report } = investigation;
  if (status !== 'done' || !report?.backlogDraft) return 'no-draft';
  // A bug claims the product is wrong, so it has to be confirmed. An improvement only needs evidence that held.
  const bug = backlogTypeOf(report.backlogDraft) === 'Bug';
  if (bug ? report.conclusion !== 'confirmed' : report.conclusion === 'undetermined') return 'no-draft';
  if (report.backlogDraft.duplicateOf && !force) return 'duplicate';
  return null;
}

const millisOf = (at: unknown) => (at as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;

/** Whether this click should open the client's ticket: one per backlog row, and not two at once. */
export function ticketClaim(item: Investigation['backlogItem'], now: number): 'create' | 'in-progress' | 'done' {
  const ticket = item?.ticket;
  if (ticket?.status === 'created') return 'done';
  if (ticket?.status === 'creating' && now - millisOf(ticket.at) < CREATING_STALE_MS) return 'in-progress';
  return 'create';
}

const TICKET_PRIORITY: Record<InvestigationBacklogDraft['priority'], TicketPriority> = { Urgente: 'alta', Alta: 'alta', Media: 'media', Baja: 'baja' };

/** What the client reads in their ticket. The draft is already in product language, without personal data. */
export function ticketDescription(draft: InvestigationBacklogDraft): string {
  const improvement = backlogTypeOf(draft) === 'Missing Feature';
  const screen = draft.screenName && draft.howToReach ? `${draft.screenName} (${draft.howToReach})` : draft.screenName || draft.howToReach;
  return [
    draft.description,
    draft.problem && `${improvement ? 'Qué se necesita' : 'Qué pasa'}:\n${draft.problem}`,
    draft.expected && `${improvement ? 'Resultado esperado' : 'Qué debería pasar'}:\n${draft.expected}`,
    screen && `Pantalla: ${screen}`,
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, MAX_TICKET_DESCRIPTION_CHARS);
}

/**
 * The client's ticket for a backlog row, as the console's "convert to ticket" would open it from
 * that chat: who it belongs to comes from the conversation, never from the model.
 */
export function ticketParamsFrom(
  draft: InvestigationBacklogDraft,
  conversationId: string,
  conversation: Conversation,
  creadoPor: MessageSender,
): CrearTicketParams {
  const group = conversation.tipo === 'grupo';
  return {
    siteId: conversation.siteId,
    ...(conversation.clientId && { clientId: conversation.clientId }),
    ...(conversation.clientNombre && { clientNombre: conversation.clientNombre }),
    ...(conversation.groupId && { groupId: conversation.groupId }),
    ...(conversation.groupName && { groupName: conversation.groupName }),
    ...(conversation.contactId && { contactId: conversation.contactId }),
    ...(conversation.contactNombre && { contactNombre: conversation.contactNombre }),
    conversationId,
    asunto: draft.name,
    descripcion: ticketDescription(draft),
    prioridad: TICKET_PRIORITY[draft.priority] ?? 'media',
    // A group's ticket is for the whole group, like the ones opened from its chat.
    publico: group,
    ambito: group ? 'grupo' : 'cliente',
    creadoPor,
  };
}

/**
 * The client's ticket for the row, with the way back to the row and the investigation in an internal
 * note. The ticket itself is readable by the client, so those links don't go in it.
 */
async function openClientTicket(
  ref: FirebaseFirestore.DocumentReference,
  investigation: Investigation,
  draft: InvestigationBacklogDraft,
  row: { url: string | null; pageId: string | null },
  by: { uid: string; nombre: string },
  investigationUrl: string,
): Promise<{ ticketId: string; numero: number }> {
  const creadoPor: MessageSender = { tipo: 'agent', id: by.uid, nombre: by.nombre };
  let created: { ticketId: string; numero: number };
  try {
    const conversation = (await db.doc(`conversations/${investigation.conversationId}`).get()).data() as Conversation | undefined;
    if (!conversation) throw new HttpsError('failed-precondition', 'Quedó en el backlog, pero no se encontró el chat para crear el ticket.');
    created = await crearTicketInterno(ticketParamsFrom(draft, investigation.conversationId, conversation, creadoPor));
    await ref.update({ 'backlogItem.ticket': { status: 'created', ...created, at: FieldValue.serverTimestamp() } });
  } catch (e) {
    await ref.update({ 'backlogItem.ticket': FieldValue.delete() });
    if (e instanceof HttpsError) throw e;
    logger.error('addInvestigationToBacklog: ticket', { message: (e as Error).message });
    throw new HttpsError('unavailable', 'Quedó en el backlog, pero no se pudo crear el ticket. Intentá de nuevo.');
  }

  // From here on the ticket exists: a cross-reference that fails is logged, and never repeats the ticket.
  const number = formatTicketNumber(created.numero);
  await db
    .collection(`tickets/${created.ticketId}/notas`)
    .add({
      autor: creadoPor,
      texto: [`Tarea en el backlog: ${row.url ?? 'sin enlace'}`, `Investigación: ${investigationUrl}`].join('\n'),
      createdAt: FieldValue.serverTimestamp(),
    })
    .catch((e) => logger.warn('addInvestigationToBacklog: ticket note', { message: (e as Error).message }));
  if (row.pageId) {
    await loadConnection()
      .then((connection) =>
        connection &&
        notion(connection.token, 'PATCH', `/blocks/${row.pageId}/children`, {
          children: [block('paragraph', [text(`Ticket del cliente en Aditum Chat: ${number}`)])],
        }),
      )
      .catch((e) => logger.warn('addInvestigationToBacklog: ticket on the row', { message: (e as Error).message }));
  }
  return created;
}

/**
 * One click and it's there: the definition isn't confirmed first, by decision. Any agent can do it.
 * With `ticket`, the same click also opens the client's ticket, or adds it to a row that already exists.
 */
export const addInvestigationToBacklog = onCall({ region: 'us-central1', secrets: [configKek], timeoutSeconds: 60 }, async (req) => {
  const member = await requireActiveAgent(req.auth);
  const { id, force, ticket } = req.data as { id?: unknown; force?: unknown; ticket?: unknown };
  if (typeof id !== 'string' || !id) throw new HttpsError('invalid-argument', 'Falta la investigación.');
  const wantsTicket = ticket === true;
  const ref = db.doc(`investigations/${id}`);
  const by = { uid: req.auth!.uid, nombre: member.nombre ?? 'Agente' };
  const claimingTicket = { status: 'creating', ticketId: null, numero: null, at: FieldValue.serverTimestamp() };

  // Taken in a transaction, so a double click can't create two rows or two tickets.
  const claimed = await db.runTransaction(async (tx) => {
    const investigation = (await tx.get(ref)).data() as Investigation | undefined;
    const now = Date.now();
    const refusal = backlogRefusal(investigation, force === true, now);
    if (refusal === 'missing') throw new HttpsError('not-found', 'No existe la investigación.');
    if (refusal === 'in-progress') return { inProgress: true };
    if (refusal === 'no-draft') throw new HttpsError('failed-precondition', 'Esta investigación no definió nada para el backlog.');
    if (refusal === 'duplicate') throw new HttpsError('failed-precondition', 'Ya hay una tarea parecida en el backlog.');
    if (refusal === 'done') {
      const item = investigation!.backlogItem!;
      const state = wantsTicket ? ticketClaim(item, now) : 'done';
      if (state === 'in-progress') return { inProgress: true };
      if (state === 'done') return { url: item.url, ticket: item.ticket?.status === 'created' ? { ticketId: item.ticket.ticketId, numero: item.ticket.numero } : null };
      // The row is there and the ticket isn't. A later round may have dropped the definition it needs.
      if (!investigation!.report?.backlogDraft) throw new HttpsError('failed-precondition', 'Esta investigación ya no tiene la definición para crear el ticket.');
      tx.update(ref, { 'backlogItem.ticket': claimingTicket });
      return { investigation: investigation!, row: { url: item.url, pageId: item.pageId ?? null } };
    }
    tx.update(ref, { backlogItem: { status: 'creating', url: null, by, at: FieldValue.serverTimestamp() } });
    return { investigation: investigation!, row: null };
  });
  const { investigation } = claimed;
  if (!investigation) return claimed;
  const draft = investigation.report!.backlogDraft!;
  const investigationUrl = `${consoleBaseUrl()}/inbox?c=${investigation.conversationId}&inv=${id}`;

  let row = claimed.row;
  if (!row) {
    try {
      const connection = await loadConnection();
      if (!connection) throw new HttpsError('failed-precondition', 'Falta conectar el tablero de Notion en Configuración.');
      const schema = await notion<BoardSchema>(connection.token, 'GET', `/databases/${connection.config.databaseId}`);
      const problems = [...boardProblems(schema), ...draftProblems(draft, schema)];
      if (problems.length) throw new HttpsError('failed-precondition', problems.join(' '));
      const page = await notion<{ id?: string; url: string }>(connection.token, 'POST', '/pages', {
        parent: { database_id: connection.config.databaseId },
        properties: pageProperties(draft, investigation.source?.clientNombre),
        children: pageBlocks(draft, investigationUrl),
      });
      row = { url: page.url, pageId: page.id ?? null };
      await ref.update({
        backlogItem: { status: 'created', ...row, by, at: FieldValue.serverTimestamp(), ...(wantsTicket && { ticket: claimingTicket }) },
      });
    } catch (e) {
      await ref.update({ backlogItem: FieldValue.delete() });
      if (e instanceof HttpsError) throw e;
      logger.error('addInvestigationToBacklog', { message: (e as Error).message });
      throw new HttpsError('unavailable', explainNotionError(e));
    }
  }
  if (!wantsTicket) return { url: row.url };
  return { url: row.url, ticket: await openClientTicket(ref, investigation, draft, row, by, investigationUrl) };
});
