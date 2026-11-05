import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import {
  INVESTIGATION_MAX_FILE_BYTES,
  INVESTIGATION_MAX_FILES,
  INVESTIGATION_MAX_TOTAL_BYTES,
  investigationFileKind,
  type InvestigationFileKind,
} from '@aditum-chat/shared';
import type {
  InvestigationBacklogDraft,
  InvestigationTurn,
  InvestigationSentMessage,
  InvestigationSource,
  InvestigatorPiConfig,
  Contact,
  Conversation,
  Investigation,
  InvestigationEvent,
  InvestigationFile,
  InvestigationMessageRef,
  InvestigationQueryRecord,
  InvestigationReport,
  InvestigationStatus,
  InvestigatorDbCheck,
  InvestigatorDbConfig,
  Message,
  WriteProposal,
} from '@aditum-chat/shared';
import { activeBacklogRows } from './backlog.js';
import { db, FieldValue, storage } from './lib/admin.js';
import { decryptJson, encryptJson } from './lib/crypto.js';
import { requireActiveAdmin } from './lib/guards.js';
import { getKek } from './pushConfig.js';
import { checkPi } from './piCheck.js';
import { installOnPi, isCleanSetting } from './piInstall.js';
import { proposalFrom, REPLACEABLE, reportWithProposal } from './writes.js';

/**
 * Agents ask from the console, the analyzer on the Raspberry Pi does the work. The Pi
 * only makes outbound calls to `investigationRunner`, so nothing on it is exposed.
 *
 * Agents can read investigations but nothing here accepts text from the client as the
 * case itself: messages are read by id on the server, so what gets analyzed is what's
 * really in the chat.
 */

const runnerSecret = defineSecret('RUNNER_SHARED_SECRET');
const configKek = defineSecret('CONFIG_KEK');

const MAX_MESSAGES = 100;
const MIN_QUESTION_CHARS = 10;
const MAX_QUESTION_CHARS = 1000;
const MAX_PER_AGENT_PER_DAY = 30;
const MIN_FOLLOW_UP_CHARS = 3;
const MAX_TURNS_PER_INVESTIGATION = 20;
/** Old rounds go back to Claude as context. This keeps a long conversation from filling the prompt. */
const MAX_HISTORY_CHARS = 40_000;
const MAX_HISTORY_QUERIES = 200;
/** A running job reports every few seconds. This long without news means the Pi lost it. */
const STALE_RUNNING_MS = 10 * 60_000;
const MAX_REPORT_BYTES = 500_000;

export type TranscriptMessage = InvestigationSentMessage;

export function investigationSource(
  conv: Pick<Conversation, 'contactId' | 'contactNombre' | 'clientId' | 'clientNombre' | 'groupName'>,
  contact: Pick<Contact, 'nombre'> | undefined,
): InvestigationSource {
  return {
    contactId: conv.contactId ?? null,
    contactNombre: conv.contactNombre ?? contact?.nombre ?? null,
    clientId: conv.clientId ?? null,
    clientNombre: conv.clientNombre ?? conv.groupName ?? null,
  };
}

/** What the analyzer needs to fetch a file. The path stays here: it asks by id. */
export type InvestigationInputFile = InvestigationFile & { kind: InvestigationFileKind; md5: string | null };

export function threadKeyOf(conv: Pick<Conversation, 'tipo' | 'contactId' | 'groupId'>): string | null {
  if (conv.tipo === 'grupo') return conv.groupId ? `group:${conv.groupId}` : null;
  return conv.contactId ? `contact:${conv.contactId}` : null;
}

export function validateRequest(question: unknown, messages: unknown): string | null {
  if (typeof question !== 'string') return 'Falta la pregunta.';
  const length = question.trim().length;
  if (length < MIN_QUESTION_CHARS || length > MAX_QUESTION_CHARS) {
    return `La pregunta debe tener entre ${MIN_QUESTION_CHARS} y ${MAX_QUESTION_CHARS} caracteres.`;
  }
  if (!Array.isArray(messages) || messages.length === 0) return 'Seleccioná al menos un mensaje.';
  if (messages.length > MAX_MESSAGES) return `Se pueden analizar hasta ${MAX_MESSAGES} mensajes.`;
  const valid = messages.every(
    (m) => typeof m?.conversationId === 'string' && m.conversationId && typeof m?.messageId === 'string' && m.messageId,
  );
  return valid ? null : 'La selección de mensajes no es válida.';
}

export function contentHash(question: string, transcript: TranscriptMessage[], files: { id: string; md5: string | null }[] = []): string {
  const content = files.length ? { question, transcript, files: files.map(({ id, md5 }) => ({ id, md5 })) } : { question, transcript };
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

/**
 * A contact writes their own messages, so `storagePath` on one could point anywhere: only
 * what's under that conversation's folder counts as its attachment. Same check as the bot's.
 */
export function isOwnChatAttachment(storagePath: unknown, conversationId: string): storagePath is string {
  return typeof storagePath === 'string' && storagePath.startsWith(`adjuntos/${conversationId}/`) && !storagePath.includes('..');
}

/** An agent can only hand in what they uploaded themselves. */
export function validateUploads(uploads: unknown, uid: string): string | null {
  if (uploads === undefined) return null;
  if (!Array.isArray(uploads) || uploads.length > INVESTIGATION_MAX_FILES) return 'Hay demasiados archivos.';
  const valid = uploads.every(
    (u) =>
      typeof u?.storagePath === 'string' &&
      u.storagePath.startsWith(`investigaciones/${uid}/`) &&
      !u.storagePath.includes('..') &&
      typeof u?.name === 'string' &&
      u.name.length > 0 &&
      u.name.length <= 200,
  );
  return valid ? null : 'Los archivos no son válidos.';
}

/** Checks that apply once every file's real size is known. */
export function filesProblem(files: { size: number }[]): string | null {
  if (files.length > INVESTIGATION_MAX_FILES) return `Se pueden analizar hasta ${INVESTIGATION_MAX_FILES} archivos. Quitá algunos o desmarcá mensajes.`;
  if (files.some((f) => f.size > INVESTIGATION_MAX_FILE_BYTES)) return 'Hay un archivo de más de 25 MB.';
  if (files.reduce((total, f) => total + f.size, 0) > INVESTIGATION_MAX_TOTAL_BYTES) return 'Los archivos suman más de 60 MB. Quitá algunos o desmarcá mensajes.';
  return null;
}

/** The type comes from Storage, not from what the client said it was uploading. */
async function fileFromStorage(
  id: string,
  source: InvestigationFile['source'],
  storagePath: string,
  name: string,
): Promise<InvestigationInputFile | null> {
  const [metadata] = await storage.bucket().file(storagePath).getMetadata().catch(() => [null]);
  if (!metadata) return null;
  const mimeType = metadata.contentType ?? '';
  const kind = investigationFileKind(mimeType, name);
  if (!kind) return null;
  return { id, source, storagePath, name, mimeType, size: Number(metadata.size ?? 0), kind, md5: metadata.md5Hash ?? null };
}

export function secretMatches(given: string, expected: string): boolean {
  if (!expected) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

const toDate = (value: unknown): Date | null =>
  typeof (value as { toDate?: unknown })?.toDate === 'function' ? (value as { toDate(): Date }).toDate() : null;

/** Costa Rica's calendar day, since that's the day the limit resets for the team. */
const dayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(new Date());

export const requestInvestigation = onCall({ region: 'us-central1' }, async (req) => {
  if (req.auth?.token.kind !== 'agent') throw new HttpsError('permission-denied', 'Solo agentes.');
  const { conversationId, messages, question, uploads } = req.data as {
    conversationId: string;
    messages: InvestigationMessageRef[];
    question: string;
    uploads?: { storagePath: string; name: string }[];
  };
  const invalid = validateRequest(question, messages) ?? validateUploads(uploads, req.auth.uid);
  if (invalid || typeof conversationId !== 'string' || !conversationId) {
    throw new HttpsError('invalid-argument', invalid ?? 'Falta la conversación.');
  }

  const anchor = (await db.doc(`conversations/${conversationId}`).get()).data() as Conversation | undefined;
  const threadKey = anchor ? threadKeyOf(anchor) : null;
  if (!anchor || !threadKey) throw new HttpsError('not-found', 'No existe la conversación.');

  // Every message has to belong to this chat, whatever the client claims.
  const conversationIds = [...new Set(messages.map((m) => m.conversationId))];
  const conversations = await db.getAll(...conversationIds.map((id) => db.doc(`conversations/${id}`)));
  for (const snap of conversations) {
    const conv = snap.data() as Conversation | undefined;
    if (!conv || threadKeyOf(conv) !== threadKey) {
      throw new HttpsError('permission-denied', 'Hay mensajes que no son de este chat.');
    }
  }

  const uniqueRefs = [...new Map(messages.map((m) => [`${m.conversationId}/${m.messageId}`, m])).values()];
  const snaps = await db.getAll(...uniqueRefs.map((m) => db.doc(`conversations/${m.conversationId}/messages/${m.messageId}`)));
  if (snaps.some((snap) => !snap.exists)) throw new HttpsError('not-found', 'Hay mensajes que ya no existen.');

  const files: InvestigationInputFile[] = [];
  const transcript: TranscriptMessage[] = [];
  const ordered = snaps
    .map((snap) => ({ message: snap.data() as Message, at: toDate((snap.data() as Message).createdAt), convId: snap.ref.parent.parent!.id }))
    .sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
  for (const { message, at, convId } of ordered) {
    const attachments: TranscriptMessage['attachments'] = [];
    for (const a of message.adjuntos ?? []) {
      const name = a.nombre ?? a.storagePath?.split('/').pop() ?? 'archivo';
      const file = isOwnChatAttachment(a.storagePath, convId)
        ? await fileFromStorage(`f${files.length + 1}`, 'chat', a.storagePath, name)
        : null;
      if (file) files.push(file);
      attachments.push({ type: a.tipo, name: a.nombre ?? null, mimeType: a.mimeType ?? null, ...(file && { fileId: file.id }) });
    }
    transcript.push({
      at: at?.toISOString() ?? null,
      senderType: message.sender.tipo,
      senderName: message.sender.nombre,
      internalNote: message.interno === true,
      text: message.texto ?? '',
      attachments,
    });
  }

  for (const upload of uploads ?? []) {
    const file = await fileFromStorage(`f${files.length + 1}`, 'agent', upload.storagePath, upload.name);
    if (!file) throw new HttpsError('invalid-argument', `No se puede analizar ${upload.name}.`);
    files.push(file);
  }
  const tooMany = filesProblem(files);
  if (tooMany) throw new HttpsError('invalid-argument', tooMany);

  const contact = anchor.contactId
    ? ((await db.doc(`contacts/${anchor.contactId}`).get()).data() as Contact | undefined)
    : undefined;
  const agent = (await db.doc(`team/${req.auth.uid}`).get()).data() as { nombre?: string } | undefined;
  const trimmed = question.trim();
  const source = investigationSource(anchor, contact);

  const ref = db.collection('investigations').doc();
  const counterRef = db.doc(`counters/investigations_${req.auth.uid}_${dayKey()}`);
  const data: Investigation = {
    threadKey,
    conversationId,
    siteId: anchor.siteId,
    source,
    question: trimmed,
    messageCount: transcript.length,
    messageRefs: uniqueRefs.map(({ conversationId: c, messageId }) => ({ conversationId: c, messageId })),
    files: files.map(({ id, source, storagePath, name, mimeType, size }) => ({ id, source, storagePath, name, mimeType, size })),
    contentHash: contentHash(trimmed, transcript, files),
    requestedBy: { uid: req.auth.uid, nombre: agent?.nombre ?? req.auth.token.email ?? 'Agente' },
    status: 'queued',
    turn: 1,
    queuedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  };

  await db.runTransaction(async (tx) => {
    const count = ((await tx.get(counterRef)).data()?.count as number | undefined) ?? 0;
    if (count >= MAX_PER_AGENT_PER_DAY) {
      throw new HttpsError('resource-exhausted', `Se alcanzó el límite de ${MAX_PER_AGENT_PER_DAY} investigaciones por día.`);
    }
    tx.set(counterRef, { count: count + 1 }, { merge: true });
    tx.set(ref, data);
    tx.set(ref.collection('sent').doc('messages'), { messages: transcript });
    // What the analyzer reads. Kept apart so a later edit to the chat can't change a case
    // after the fact, and denied to every client in the rules.
    tx.set(db.doc(`investigation_inputs/${ref.id}`), {
      question: trimmed,
      transcript,
      files,
      context: {
        siteId: anchor.siteId,
        clientNombre: source.clientNombre,
        contactNombre: source.contactNombre,
        contactRol: contact?.rol ?? null,
      },
    });
  });
  return { id: ref.id };
});

export function followUpProblem(question: unknown): string | null {
  if (typeof question !== 'string') return 'Falta la pregunta.';
  const length = question.trim().length;
  if (length < MIN_FOLLOW_UP_CHARS || length > MAX_QUESTION_CHARS) {
    return `La pregunta debe tener entre ${MIN_FOLLOW_UP_CHARS} y ${MAX_QUESTION_CHARS} caracteres.`;
  }
  return null;
}

/** The round as it ended, without the fields that only make sense while one is under way. */
export function archivedTurn(investigation: Investigation): InvestigationTurn {
  return {
    n: investigation.turn ?? 1,
    question: investigation.followUp?.question ?? investigation.question,
    by: investigation.followUp?.by ?? investigation.requestedBy,
    status: investigation.status,
    report: investigation.report ?? null,
    error: investigation.error ?? null,
    sha: investigation.sha ?? null,
    usedDatabase: investigation.usedDatabase === true,
    costUsd: investigation.costUsd ?? null,
    unreadableFiles: investigation.unreadableFiles ?? [],
    askedAt: investigation.queuedAt ?? investigation.createdAt,
    finishedAt: investigation.finishedAt ?? null,
  };
}

export const requestFollowUp = onCall({ region: 'us-central1' }, async (req) => {
  if (req.auth?.token.kind !== 'agent') throw new HttpsError('permission-denied', 'Solo agentes.');
  const { id, question } = req.data as { id?: unknown; question?: unknown };
  const invalid = followUpProblem(question);
  if (invalid || typeof id !== 'string' || !id) throw new HttpsError('invalid-argument', invalid ?? 'Falta la investigación.');
  const uid = req.auth.uid;
  const agent = (await db.doc(`team/${uid}`).get()).data() as { nombre?: string } | undefined;
  const by = { uid, nombre: agent?.nombre ?? req.auth.token.email ?? 'Agente' };
  const ref = db.doc(`investigations/${id}`);
  const counterRef = db.doc(`counters/investigations_${uid}_${dayKey()}`);

  await db.runTransaction(async (tx) => {
    const investigation = (await tx.get(ref)).data() as Investigation | undefined;
    if (!investigation) throw new HttpsError('not-found', 'No existe la investigación.');
    if (investigation.status === 'queued' || investigation.status === 'running') {
      throw new HttpsError('failed-precondition', 'Esperá a que termine esta respuesta.');
    }
    const turn = investigation.turn ?? 1;
    // Without a first answer there's nothing to continue: that's asking again.
    if (turn === 1 && !investigation.report) throw new HttpsError('failed-precondition', 'Esta investigación no tiene respuesta todavía.');
    if (turn >= MAX_TURNS_PER_INVESTIGATION) {
      throw new HttpsError('resource-exhausted', `Se llegó al máximo de ${MAX_TURNS_PER_INVESTIGATION} preguntas en una investigación.`);
    }
    const count = ((await tx.get(counterRef)).data()?.count as number | undefined) ?? 0;
    if (count >= MAX_PER_AGENT_PER_DAY) {
      throw new HttpsError('resource-exhausted', `Se alcanzó el límite de ${MAX_PER_AGENT_PER_DAY} investigaciones por día.`);
    }
    tx.set(counterRef, { count: count + 1 }, { merge: true });
    tx.set(ref.collection('turns').doc(String(turn)), archivedTurn(investigation));
    // The report moves out, so the totals only ever count an investigation's latest conclusion.
    tx.update(ref, {
      turn: turn + 1,
      followUp: { question: (question as string).trim(), by },
      status: 'queued',
      queuedAt: FieldValue.serverTimestamp(),
      report: null,
      error: null,
      startedAt: FieldValue.delete(),
      heartbeatAt: FieldValue.delete(),
      finishedAt: FieldValue.delete(),
    });
  });
  return { ok: true };
});

export const cancelInvestigation = onCall({ region: 'us-central1' }, async (req) => {
  if (req.auth?.token.kind !== 'agent') throw new HttpsError('permission-denied', 'Solo agentes.');
  const { id } = req.data as { id: string };
  if (typeof id !== 'string' || !id) throw new HttpsError('invalid-argument', 'Falta la investigación.');
  const ref = db.doc(`investigations/${id}`);
  await db.runTransaction(async (tx) => {
    const status = (await tx.get(ref)).data()?.status as InvestigationStatus | undefined;
    if (status === 'queued' || status === 'running') {
      tx.update(ref, { status: 'cancelled', finishedAt: FieldValue.serverTimestamp() });
    }
  });
  return { ok: true };
});

async function failStaleJobs() {
  const running = await db.collection('investigations').where('status', '==', 'running').get();
  const cutoff = Date.now() - STALE_RUNNING_MS;
  await Promise.all(
    running.docs
      .filter((doc) => (toDate(doc.get('heartbeatAt') ?? doc.get('startedAt'))?.getTime() ?? 0) < cutoff)
      .map((doc) =>
        doc.ref.update({
          status: 'failed',
          error: 'El analizador dejó de responder.',
          finishedAt: FieldValue.serverTimestamp(),
        }),
      ),
  );
}

/** A past round as Claude gets it. Query results never go back: it has to look at the data again. */
export interface JobTurn {
  n: number;
  question: string;
  status: InvestigationStatus;
  conclusion: InvestigationReport['conclusion'] | null;
  summary: string;
  cause: string;
  recommendation: string;
  missing: string[];
  queries: { purpose: string; sql: string; rowCount: number; error: string | null }[];
  /** The ticket it defined, so the agent can ask for changes to it. */
  backlogDraft: InvestigationBacklogDraft | null;
  /** The change it proposed and what became of it, so a failed rehearsal can be corrected. */
  proposal: { status: string; error: string | null; operations: unknown[] } | null;
}

/** Most recent rounds first in line for the space: what the agent is reacting to is the last one. */
export function boundedHistory(turns: JobTurn[], maxChars = MAX_HISTORY_CHARS): { history: JobTurn[]; omittedTurns: number } {
  const kept: JobTurn[] = [];
  let used = 0;
  for (const turn of [...turns].sort((a, b) => b.n - a.n)) {
    used += JSON.stringify(turn).length;
    if (used > maxChars) break;
    kept.unshift(turn);
  }
  return { history: kept, omittedTurns: turns.length - kept.length };
}

async function historyOf(ref: FirebaseFirestore.DocumentReference) {
  const [turns, queries, proposals] = await Promise.all([
    ref.collection('turns').orderBy('n', 'asc').get(),
    ref.collection('queries').orderBy('at', 'asc').limit(MAX_HISTORY_QUERIES).get(),
    ref.collection('proposals').get(),
  ]);
  const records = queries.docs.map((doc) => doc.data() as InvestigationQueryRecord);
  const proposalOf = (id: string | null | undefined) => {
    const proposal = proposals.docs.find((doc) => doc.id === id)?.data() as WriteProposal | undefined;
    return proposal ? { status: proposal.status, error: proposal.error ?? proposal.execution?.detail ?? null, operations: proposal.operations } : null;
  };
  return boundedHistory(
    turns.docs.map((doc) => {
      const turn = doc.data() as InvestigationTurn;
      return {
        n: turn.n,
        question: turn.question,
        status: turn.status,
        conclusion: turn.report?.conclusion ?? null,
        summary: turn.report?.summary ?? '',
        cause: turn.report?.cause ?? '',
        recommendation: turn.report?.recommendation ?? '',
        missing: turn.report?.missing ?? [],
        backlogDraft: turn.report?.backlogDraft ?? null,
        proposal: proposalOf(turn.report?.proposalId),
        queries: records
          .filter((record) => (record.turn ?? 1) === turn.n)
          .map(({ purpose, sql, rowCount, error }) => ({ purpose, sql, rowCount, error })),
      };
    }),
  );
}

async function claimNext() {
  const queued = await db.collection('investigations').where('status', '==', 'queued').orderBy('queuedAt', 'asc').limit(1).get();
  const doc = queued.docs[0];
  if (!doc) return null;
  const claimed = await db.runTransaction(async (tx) => {
    if ((await tx.get(doc.ref)).data()?.status !== 'queued') return false;
    tx.update(doc.ref, {
      status: 'running',
      startedAt: FieldValue.serverTimestamp(),
      heartbeatAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
  if (!claimed) return null;
  const input = (await db.doc(`investigation_inputs/${doc.id}`).get()).data();
  const { turn = 1, followUp } = doc.data() as Investigation;
  return {
    id: doc.id,
    ...input,
    turn,
    followUp: followUp?.question ?? null,
    backlogRows: await activeBacklogRows(),
    ...(turn > 1 && (await historyOf(doc.ref))),
  };
}

interface ProgressBody {
  id: string;
  /** Which round the Pi is working on. An older Pi doesn't say, so it counts as the current one. */
  turn?: number;
  /** Lets the console know the Pi is alive during a long round, when it isn't claiming anything. */
  heartbeat?: boolean;
  events?: Pick<InvestigationEvent, 'kind' | 'text'>[];
  queries?: (Omit<InvestigationQueryRecord, 'at'> & { queryId: string })[];
}

/** A round is over for the Pi once it's cancelled, or once the agent has already moved on to another. */
export function isCurrentRound(investigation: Pick<Investigation, 'status' | 'turn'> | undefined, turn: number | undefined): boolean {
  if (investigation?.status !== 'running') return false;
  return turn === undefined || turn === (investigation.turn ?? 1);
}

async function saveProgress({ id, turn, heartbeat, events = [], queries = [] }: ProgressBody) {
  const ref = db.doc(`investigations/${id}`);
  const investigation = (await ref.get()).data() as Investigation | undefined;
  const current = isCurrentRound(investigation, turn);
  const batch = db.batch();
  const at = FieldValue.serverTimestamp();
  if (heartbeat) batch.set(db.doc('investigator/runner'), { lastSeenAt: at }, { merge: true });
  if (current) {
    batch.update(ref, { heartbeatAt: at });
    for (const { kind, text } of events) {
      batch.set(ref.collection('events').doc(), { kind, text: String(text).slice(0, 500), at });
    }
  }
  // Kept even for a round that's over: it's the record of what was asked of production.
  for (const { queryId, dataQuestion, purpose, sql, rowCount, truncated, ms, error } of queries) {
    const round = turn ?? investigation?.turn ?? 1;
    batch.set(ref.collection('queries').doc(queryId), { turn: round, dataQuestion, purpose, sql, rowCount, truncated, ms, error, at });
  }
  await batch.commit();
  return { cancel: !current };
}

const FINAL_STATUSES: InvestigationStatus[] = ['done', 'failed', 'rate_limited'];

interface CompleteBody {
  id: string;
  turn?: number;
  status: InvestigationStatus;
  sha?: string | null;
  error?: string | null;
  usedDatabase?: boolean;
  costUsd?: number | null;
  report?: InvestigationReport | null;
  unreadableFiles?: string[];
}

/** Only while its job runs, and only files that job was given: the Pi asks by id, never by path. */
async function attachmentFor(id: unknown, fileId: unknown): Promise<InvestigationInputFile | null> {
  if (typeof id !== 'string' || !id || typeof fileId !== 'string') return null;
  const investigation = await db.doc(`investigations/${id}`).get();
  if (investigation.data()?.status !== 'running') return null;
  const input = (await db.doc(`investigation_inputs/${id}`).get()).data() as { files?: InvestigationInputFile[] } | undefined;
  return input?.files?.find((file) => file.id === fileId) ?? null;
}

async function complete(body: CompleteBody) {
  if (!FINAL_STATUSES.includes(body.status)) throw new Error('invalid status');
  if (JSON.stringify(body.report ?? null).length > MAX_REPORT_BYTES) {
    body = { ...body, status: 'failed', report: null, error: 'El reporte es demasiado grande.' };
  }
  const ref = db.doc(`investigations/${body.id}`);
  await db.runTransaction(async (tx) => {
    // A case the agent cancelled stays cancelled, even if the Pi finishes it.
    const investigation = (await tx.get(ref)).data() as Investigation | undefined;
    if (!isCurrentRound(investigation, body.turn)) return;
    const turn = investigation?.turn ?? 1;
    const earlier = await tx.get(ref.collection('proposals').where('status', 'in', REPLACEABLE));
    const { proposal, problems } = body.report ? proposalFrom(body.report, turn) : { proposal: null, problems: [] };
    const proposalId = proposal ? `t${turn}` : null;
    if (proposal) {
      // Only one can be in play: approving an old one after asking for a change would run the wrong thing.
      earlier.docs.forEach((doc) => tx.update(doc.ref, { status: 'superseded', approval: null }));
      tx.set(ref.collection('proposals').doc(proposalId!), proposal);
    }
    tx.update(ref, {
      status: body.status,
      sha: body.sha ?? null,
      error: body.error ?? null,
      usedDatabase: body.usedDatabase === true,
      costUsd: body.costUsd ?? null,
      report: body.report ? reportWithProposal(body.report, proposalId, problems) : null,
      unreadableFiles: (body.unreadableFiles ?? []).slice(0, INVESTIGATION_MAX_FILES).map((name) => String(name).slice(0, 200)),
      finishedAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true };
}

export const investigationRunner = onRequest(
  // Sending a file to the Pi is what takes the time and the memory.
  { region: 'us-central1', secrets: [runnerSecret, configKek], timeoutSeconds: 180, memory: '512MiB' },
  async (req, res) => {
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (req.method !== 'POST' || !secretMatches(bearer, runnerSecret.value())) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    try {
      const body = req.body as { action?: string; heartbeat?: boolean; tokenDaysLeft?: number | null };
      if (body.action === 'claim') {
        if (body.heartbeat) {
          await db.doc('investigator/runner').set({
            lastSeenAt: FieldValue.serverTimestamp(),
            tokenDaysLeft: body.tokenDaysLeft ?? null,
          });
          await failStaleJobs();
        }
        res.json({ job: await claimNext() });
      } else if (body.action === 'progress') {
        res.json(await saveProgress(req.body as ProgressBody));
      } else if (body.action === 'complete') {
        res.json(await complete(req.body as CompleteBody));
      } else if (body.action === 'attachment') {
        const { id, fileId } = req.body as { id?: unknown; fileId?: unknown };
        const file = await attachmentFor(id, fileId);
        if (!file) {
          res.status(404).json({ error: 'not found' });
          return;
        }
        const [buffer] = await storage.bucket().file(file.storagePath).download();
        res.set('content-type', 'application/octet-stream').send(buffer);
      } else {
        res.status(400).json({ error: 'unknown action' });
      }
    } catch (e) {
      logger.error('investigationRunner', { message: (e as Error).message });
      res.status(500).json({ error: 'internal' });
    }
  },
);

// ---------------------------------------------------------------------------
// Production connection, set from the console and tested from the Pi
// ---------------------------------------------------------------------------

const gatewaySecret = defineSecret('GATEWAY_SHARED_SECRET');
const writerSecret = defineSecret('WRITER_SHARED_SECRET');
const githubCodeToken = defineSecret('GITHUB_CODE_TOKEN');

const DB_DOC = 'investigator/db';
const DB_SECRET_DOC = 'investigator_secrets/db';
const SYSTEM_SCHEMAS = ['mysql', 'sys', 'information_schema', 'performance_schema'];

export interface DbSettingsInput {
  host: unknown;
  port: unknown;
  user: unknown;
  database: unknown;
  password?: unknown;
}

export type PiSettingsInput = Omit<DbSettingsInput, 'database'>;

export function piSettingsProblem(input: PiSettingsInput, hasStoredPassword: boolean): string | null {
  if (typeof input.host !== 'string' || !/^[A-Za-z0-9.:-]{1,253}$/.test(input.host)) return 'La IP o el host no son válidos.';
  if (!Number.isInteger(input.port) || (input.port as number) < 1 || (input.port as number) > 65535) return 'El puerto no es válido.';
  if (typeof input.user !== 'string' || !/^[\w.-]{1,32}$/.test(input.user)) return 'El usuario no es válido.';
  const password = input.password;
  if (password !== undefined && password !== '' && (typeof password !== 'string' || password.length > 256)) return 'La contraseña no es válida.';
  if (!password && !hasStoredPassword) return 'Falta la contraseña.';
  return null;
}

export function dbSettingsProblem(input: DbSettingsInput, hasStoredPassword: boolean): string | null {
  const problem = piSettingsProblem(input, hasStoredPassword);
  if (problem) return problem;
  if (typeof input.database !== 'string' || !/^\w{1,64}$/.test(input.database)) return 'La base no es válida.';
  if (SYSTEM_SCHEMAS.includes(input.database.toLowerCase())) return 'Esa es una base del sistema.';
  return null;
}

const pendingTest = () => ({ status: 'pending', requestedAt: FieldValue.serverTimestamp() });

export const setInvestigatorDb = onCall({ region: 'us-central1', secrets: [configKek] }, async (req) => {
  const admin = await requireActiveAdmin(req.auth);
  const input = req.data as DbSettingsInput & { remove?: boolean };
  if (input.remove) {
    await Promise.all([db.doc(DB_DOC).delete(), db.doc(DB_SECRET_DOC).delete()]);
    return { ok: true };
  }
  const stored = (await db.doc(DB_SECRET_DOC).get()).data() as { cipher?: string } | undefined;
  const problem = dbSettingsProblem(input, Boolean(stored?.cipher));
  if (problem) throw new HttpsError('invalid-argument', problem);

  const cipher = input.password ? encryptJson(getKek(), { password: input.password }) : stored!.cipher!;
  await db.doc(DB_SECRET_DOC).set({ cipher, enc: 'aes-256-gcm+kek' });
  await db.doc(DB_DOC).set({
    host: input.host,
    port: input.port,
    user: input.user,
    database: input.database,
    version: randomUUID(),
    updatedBy: admin.nombre ?? req.auth!.uid,
    updatedAt: FieldValue.serverTimestamp(),
    test: pendingTest(),
  });
  return { ok: true };
});

export const testInvestigatorDb = onCall({ region: 'us-central1' }, async (req) => {
  await requireActiveAdmin(req.auth);
  const ref = db.doc(DB_DOC);
  if (!(await ref.get()).exists) throw new HttpsError('failed-precondition', 'Primero guardá la conexión.');
  await ref.update({ test: pendingTest() });
  return { ok: true };
});

const PI_DOC = 'investigator/pi';
const PI_SECRET_DOC = 'investigator_secrets/pi';

/** Unlike the MySQL test, this one runs here: it's the server that logs in to the Pi. */
async function testPi(version: string) {
  const ref = db.doc(PI_DOC);
  const config = (await ref.get()).data() as InvestigatorPiConfig;
  const secret = (await db.doc(PI_SECRET_DOC).get()).data() as { cipher: string };
  const { password } = decryptJson<{ password: string }>(getKek(), secret.cipher);
  const result = await checkPi({ host: config.host, port: config.port, user: config.user, password }, config.hostKeyFingerprint);
  await db.runTransaction(async (tx) => {
    // A result for a connection that has since been replaced says nothing about the new one.
    if ((await tx.get(ref)).data()?.version !== version) return;
    tx.update(ref, {
      ...(result.fingerprint && { hostKeyFingerprint: result.fingerprint }),
      'test.status': result.connected ? 'ok' : 'failed',
      'test.checks': result.checks,
      'test.finishedAt': FieldValue.serverTimestamp(),
    });
  });
}

export const setInvestigatorPi = onCall({ region: 'us-central1', secrets: [configKek], timeoutSeconds: 90 }, async (req) => {
  const admin = await requireActiveAdmin(req.auth);
  const input = req.data as PiSettingsInput & { remove?: boolean };
  if (input.remove) {
    await Promise.all([db.doc(PI_DOC).delete(), db.doc(PI_SECRET_DOC).delete()]);
    return { ok: true };
  }
  const stored = (await db.doc(PI_SECRET_DOC).get()).data() as { cipher?: string } | undefined;
  const problem = piSettingsProblem(input, Boolean(stored?.cipher));
  if (problem) throw new HttpsError('invalid-argument', problem);
  const previous = (await db.doc(PI_DOC).get()).data() as InvestigatorPiConfig | undefined;
  // Another address is another machine, whose key is unknown. A new password or user is the same machine.
  const pinned = previous && previous.host === input.host && previous.port === input.port ? previous.hostKeyFingerprint : null;

  const cipher = input.password ? encryptJson(getKek(), { password: input.password }) : stored!.cipher!;
  const version = randomUUID();
  await db.doc(PI_SECRET_DOC).set({ cipher, enc: 'aes-256-gcm+kek' }, { merge: true });
  await db.doc(PI_DOC).set({
    ...(previous?.hasClaudeToken && { hasClaudeToken: true }),
    ...(previous?.claudeTokenIssuedAt && { claudeTokenIssuedAt: previous.claudeTokenIssuedAt }),
    ...(previous?.install && { install: previous.install }),
    host: input.host,
    port: input.port,
    user: input.user,
    hostKeyFingerprint: pinned,
    version,
    updatedBy: admin.nombre ?? req.auth!.uid,
    updatedAt: FieldValue.serverTimestamp(),
    test: pendingTest(),
  });
  await testPi(version);
  return { ok: true };
});

export const testInvestigatorPi = onCall({ region: 'us-central1', secrets: [configKek], timeoutSeconds: 90 }, async (req) => {
  await requireActiveAdmin(req.auth);
  const ref = db.doc(PI_DOC);
  const config = (await ref.get()).data() as InvestigatorPiConfig | undefined;
  if (!config) throw new HttpsError('failed-precondition', 'Primero guardá la conexión.');
  await ref.update({ test: pendingTest() });
  await testPi(config.version);
  return { ok: true };
});

const INSTALL_STALE_MS = 30 * 60_000;

/** The address the Pi calls back. The emulators have no public one, so it has to be set. */
function functionsBaseUrl(): string {
  const configured = process.env.INVESTIGATOR_PUBLIC_FUNCTIONS_URL;
  if (configured) return configured.replace(/\/$/, '');
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    throw new HttpsError('failed-precondition', 'En el emulador falta INVESTIGATOR_PUBLIC_FUNCTIONS_URL en functions/.env.local.');
  }
  return `https://us-central1-${process.env.GCLOUD_PROJECT}.cloudfunctions.net`;
}

/** Long, but the Pi builds on its own and the script can run again if this one is cut short. */
export const installInvestigatorOnPi = onCall(
  {
    region: 'us-central1',
    secrets: [configKek, runnerSecret, gatewaySecret, writerSecret, githubCodeToken],
    timeoutSeconds: 1500,
  },
  async (req) => {
    const admin = await requireActiveAdmin(req.auth);
    const claudeToken = (req.data as { claudeToken?: unknown }).claudeToken;
    if (claudeToken !== undefined && claudeToken !== '' && !isCleanSetting(claudeToken)) {
      throw new HttpsError('invalid-argument', 'El token de Claude Code no es válido.');
    }
    const ref = db.doc(PI_DOC);
    const secretRef = db.doc(PI_SECRET_DOC);
    const baseUrl = functionsBaseUrl();
    const gitRef = process.env.INVESTIGATOR_GIT_REF || 'main';

    await db.runTransaction(async (tx) => {
      const config = (await tx.get(ref)).data() as InvestigatorPiConfig | undefined;
      // Only a login that worked pins the key: this runs commands as root, so it needs a known machine.
      if (!config?.hostKeyFingerprint) throw new HttpsError('failed-precondition', 'Primero probá la conexión a la Pi.');
      const started = config.install?.startedAt as { toMillis?: () => number } | undefined;
      if (config.install?.status === 'running' && Date.now() - (started?.toMillis?.() ?? 0) < INSTALL_STALE_MS) {
        throw new HttpsError('failed-precondition', 'Ya hay una instalación corriendo.');
      }
      tx.update(ref, {
        install: { status: 'running', step: 'connect', log: [], startedBy: admin.nombre ?? req.auth!.uid, startedAt: FieldValue.serverTimestamp() },
      });
    });

    try {
      if (claudeToken) {
        await secretRef.set({ claudeCipher: encryptJson(getKek(), { token: claudeToken }) }, { merge: true });
        await ref.update({ hasClaudeToken: true, claudeTokenIssuedAt: new Date().toISOString().slice(0, 10) });
      }
      const [config, secret] = await Promise.all([ref.get(), secretRef.get()]).then(
        ([a, b]) => [a.data() as InvestigatorPiConfig, b.data() as { cipher: string; claudeCipher?: string }] as const,
      );
      if (!secret.claudeCipher) throw new HttpsError('failed-precondition', 'Falta el token de Claude Code.');
      const { password } = decryptJson<{ password: string }>(getKek(), secret.cipher);
      const { token } = decryptJson<{ token: string }>(getKek(), secret.claudeCipher);

      const settings = {
        RUNNER_FUNCTION_URL: `${baseUrl}/investigationRunner`,
        GATEWAY_FUNCTION_URL: `${baseUrl}/investigationGateway`,
        WRITER_FUNCTION_URL: `${baseUrl}/investigationWriter`,
        RUNNER_SHARED_SECRET: runnerSecret.value(),
        GATEWAY_SHARED_SECRET: gatewaySecret.value(),
        WRITER_SHARED_SECRET: writerSecret.value(),
        GITHUB_CODE_TOKEN: githubCodeToken.value(),
        CLAUDE_CODE_OAUTH_TOKEN: token,
        CLAUDE_TOKEN_ISSUED_AT: config.claudeTokenIssuedAt ?? new Date().toISOString().slice(0, 10),
      };
      const result = await installOnPi(
        { host: config.host, port: config.port, user: config.user, password },
        config.hostKeyFingerprint!,
        { gitRef, settings },
        (progress) => ref.update({ 'install.step': progress.step, 'install.log': progress.log, ...(progress.commit && { 'install.commit': progress.commit }) }),
      );
      await ref.update({
        'install.status': result.ok ? 'ok' : 'failed',
        'install.step': result.step,
        'install.log': result.log,
        ...(result.commit && { 'install.commit': result.commit }),
        ...(result.detail && { 'install.detail': result.detail }),
        'install.finishedAt': FieldValue.serverTimestamp(),
      });
      return { ok: result.ok };
    } catch (e) {
      await ref.update({
        'install.status': 'failed',
        'install.detail': e instanceof HttpsError ? e.message : 'La instalación se interrumpió.',
        'install.finishedAt': FieldValue.serverTimestamp(),
      });
      if (e instanceof HttpsError) throw e;
      logger.error('installInvestigatorOnPi', { message: (e as Error).message });
      return { ok: false };
    }
  },
);

/** Behind the load balancer, the first forwarded address is the one that reached us. */
export const callerIp = (forwarded: string | string[] | undefined, fallback: string | undefined) =>
  (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() || fallback || null;

/**
 * Called by the gateway on the Pi, which is the only thing that needs the password and the
 * machine production's firewall has to allow. It has its own secret, so the runner, which
 * doesn't need the password, can't ask for it.
 */
export const investigationGateway = onRequest(
  { region: 'us-central1', secrets: [gatewaySecret, configKek], timeoutSeconds: 60 },
  async (req, res) => {
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (req.method !== 'POST' || !secretMatches(bearer, gatewaySecret.value())) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    try {
      const body = req.body as {
        action?: string;
        knownVersion?: string | null;
        heartbeat?: boolean;
        version?: string;
        ok?: boolean;
        checks?: InvestigatorDbCheck[];
      };
      const ref = db.doc(DB_DOC);
      if (body.action === 'sync') {
        if (body.heartbeat) {
          await db.doc('investigator/gateway').set({
            lastSeenAt: FieldValue.serverTimestamp(),
            publicIp: callerIp(req.headers['x-forwarded-for'], req.ip),
          });
        }
        const config = (await ref.get()).data() as InvestigatorDbConfig | undefined;
        if (!config) {
          res.json(body.knownVersion ? { config: null } : {});
          return;
        }
        if (config.version === body.knownVersion && config.test.status !== 'pending') {
          res.json({});
          return;
        }
        const secret = (await db.doc(DB_SECRET_DOC).get()).data() as { cipher: string };
        const { password } = decryptJson<{ password: string }>(getKek(), secret.cipher);
        const { host, port, user, database, version } = config;
        res.json({ config: { host, port, user, database, version, password } });
      } else if (body.action === 'testResult') {
        await db.runTransaction(async (tx) => {
          // A result for a connection that has since been replaced says nothing about the new one.
          if ((await tx.get(ref)).data()?.version !== body.version) return;
          tx.update(ref, {
            'test.status': body.ok === true ? 'ok' : 'failed',
            'test.checks': body.checks ?? [],
            'test.finishedAt': FieldValue.serverTimestamp(),
          });
        });
        res.json({ ok: true });
      } else {
        res.status(400).json({ error: 'unknown action' });
      }
    } catch (e) {
      logger.error('investigationGateway', { message: (e as Error).message });
      res.status(500).json({ error: 'internal' });
    }
  },
);
