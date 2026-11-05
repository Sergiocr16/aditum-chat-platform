import { createHash } from 'node:crypto';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import {
  writeConfirmationPhrase,
  writeProposalProblems,
  type InvestigationProductionWrite,
  type InvestigationReport,
  type InvestigatorWriterConfig,
  type WriteApproval,
  type WriteAuditEntry,
  type WriteAuditEvent,
  type WriteOperation,
  type WriteProposal,
  type WriteReversal,
  type WriteRowResult,
} from '@aditum-chat/shared';
import { db, FieldValue } from './lib/admin.js';
import { decryptJson, encryptJson } from './lib/crypto.js';
import { requireActiveAdmin } from './lib/guards.js';
import { getKek } from './pushConfig.js';
import { callerIp, dbSettingsProblem, secretMatches, type DbSettingsInput } from './investigations.js';

/**
 * The only way a change reaches production. Claude proposes, an admin rehearses and confirms, and
 * the writer on the Pi applies exactly that. The writer asks for work over an outbound connection,
 * and the write password only leaves here together with a job an admin asked for.
 */

const writerSecret = defineSecret('WRITER_SHARED_SECRET');
const configKek = defineSecret('CONFIG_KEK');

const WRITER_DOC = 'investigator/writer';
const WRITER_SECRET_DOC = 'investigator_secrets/writer';
const SWITCH_DOC = 'investigator/writes';
const STATE_DOC = 'investigator/writerState';

export const APPROVAL_WINDOW_MS = 10 * 60_000;
/** The password was just typed: a stolen open session isn't enough for the last step. */
export const RECENT_LOGIN_MS = 5 * 60_000;
/** A job nobody picked up in this long is off: an approval shouldn't take effect hours later. */
export const JOB_EXPIRY_MS = 2 * 60_000;
const WRITER_OFFLINE_MS = 90_000;
const STUCK_REHEARSAL_MS = 5 * 60_000;
/** Bytes, because that's what counts: two of these and the proposal still fit in a Firestore document. */
const MAX_RESULT_BYTES = 250_000;
const MAX_CA_BYTES = 512_000;

/** A follow-up with a new proposal replaces these. What already ran, or may have, stays as it is. */
export const REPLACEABLE: WriteProposal['status'][] = ['proposed', 'rehearsing', 'rehearsed', 'rehearsal_failed', 'aborted'];
const CAN_REHEARSE: WriteProposal['status'][] = ['proposed', 'rehearsed', 'rehearsal_failed', 'aborted'];

const millis = (value: unknown) => (value as { toMillis?: () => number } | null | undefined)?.toMillis?.() ?? 0;

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as object).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

export const operationsHash = (operations: WriteOperation[]) => sha256(stable(operations));
/** What an approval is given over. Any difference in the operations or the result means a new one. */
export const rehearsalHash = (opsHash: string, rows: WriteRowResult[], reversal: WriteReversal) => sha256(`${opsHash}:${stable({ rows, reversal })}`);

/** The document a turn's proposal becomes, or why it never reached an admin. */
export function proposalFrom(report: InvestigationReport, turn: number): { proposal: WriteProposal | null; problems: string[] } {
  const draft = report.writeProposal;
  if (!draft) return { proposal: null, problems: [] };
  const problems = writeProposalProblems(draft, report);
  if (problems.length > 0) return { proposal: null, problems };
  return {
    problems: [],
    proposal: {
      ...draft,
      turn,
      status: 'proposed',
      opsHash: operationsHash(draft.operations),
      createdAt: FieldValue.serverTimestamp(),
      reverseOf: null,
      error: null,
      rehearsal: null,
      approval: null,
      execution: null,
    },
  };
}

/** The report without the draft: from here on, the proposal is its own document with its own state. */
export function reportWithProposal(report: InvestigationReport, proposalId: string | null, problems: string[]): InvestigationReport {
  const { writeProposal: _draft, ...rest } = report;
  return { ...rest, proposalId, ...(problems.length > 0 && { proposalProblems: problems }) };
}

export interface StepInput {
  uid: string;
  step: unknown;
  hash: unknown;
  typed?: unknown;
  authTimeSeconds?: unknown;
  now: number;
}

/** Why this step can't be confirmed. Null means it can. Pure, because this is what guards production. */
export function stepProblem(proposal: WriteProposal | undefined, enabled: boolean, input: StepInput): string | null {
  if (!enabled) return 'Las escrituras están apagadas.';
  if (!proposal) return 'No existe esa propuesta.';
  if (proposal.status !== 'rehearsed' || !proposal.rehearsal) return 'Esta propuesta no está lista para aprobar.';
  if (input.step !== 1 && input.step !== 2 && input.step !== 3) return 'El paso no es válido.';
  if (input.hash !== proposal.rehearsal.hash) return 'La propuesta o su ensayo cambiaron. Hay que revisarla de nuevo.';

  const approval: WriteApproval | null = proposal.approval ?? null;
  const live = approval !== null && input.now - millis(approval.startedAt) < APPROVAL_WINDOW_MS;
  if (live && approval.by.uid !== input.uid) return `${approval.by.nombre} la está aprobando en este momento.`;
  if (input.step === 1) return null;

  if (!approval || !live) return 'Se venció el tiempo para aprobar. Empezá de nuevo.';
  if (approval.hash !== input.hash) return 'La propuesta o su ensayo cambiaron. Hay que revisarla de nuevo.';
  if (approval.step !== input.step - 1) return 'Hay que confirmar los pasos en orden.';
  if (input.step === 2) return null;

  if (input.typed !== writeConfirmationPhrase(proposal.operations)) return 'El texto no coincide.';
  const authTime = typeof input.authTimeSeconds === 'number' ? input.authTimeSeconds * 1000 : 0;
  if (input.now - authTime > RECENT_LOGIN_MS) return 'Volvé a ingresar tu contraseña.';
  return null;
}

/** Why the writer shouldn't get this job any more, if so. */
export function jobExpired(createdAtMs: number, now: number): boolean {
  return now - createdAtMs > JOB_EXPIRY_MS;
}

export function writerOnline(lastSeenMs: number, now: number): boolean {
  return now - lastSeenMs < WRITER_OFFLINE_MS;
}

/** A stuck rehearsal can be asked for again, and only the job asked for last counts. */
export function resultCounts(proposal: Pick<WriteProposal, 'status' | 'rehearsalJobId'> | undefined, kind: 'rehearse' | 'execute' | 'recover', jobId: string): boolean {
  if (kind === 'rehearse') return proposal?.status === 'rehearsing' && (!proposal.rehearsalJobId || proposal.rehearsalJobId === jobId);
  return proposal?.status === 'executing';
}

export function caProblem(ca: unknown): string | null {
  if (ca === undefined || ca === '') return null;
  if (typeof ca !== 'string' || !/-----BEGIN CERTIFICATE-----/.test(ca)) return 'El certificado no es válido: pegá el PEM.';
  return Buffer.byteLength(ca) > MAX_CA_BYTES ? 'El certificado es demasiado grande.' : null;
}

export function canRehearse(status: WriteProposal['status'], requestedAtMs: number, now: number): boolean {
  if (CAN_REHEARSE.includes(status)) return true;
  return status === 'rehearsing' && now - requestedAtMs > STUCK_REHEARSAL_MS;
}

type By = { uid: string; nombre: string } | null;

function audit(tx: FirebaseFirestore.Transaction, event: WriteAuditEvent, by: By, extra: Omit<WriteAuditEntry, 'event' | 'at' | 'by'> = {}) {
  tx.set(db.collection('prod_write_audit').doc(), { event, by, at: FieldValue.serverTimestamp(), ...extra } satisfies WriteAuditEntry);
}

async function isEnabled(tx?: FirebaseFirestore.Transaction) {
  const ref = db.doc(SWITCH_DOC);
  const snap = tx ? await tx.get(ref) : await ref.get();
  return (snap.data() as { enabled?: boolean } | undefined)?.enabled === true;
}

async function requireWriterOnline() {
  const state = (await db.doc(STATE_DOC).get()).data();
  if (!writerOnline(millis(state?.lastSeenAt), Date.now())) throw new HttpsError('failed-precondition', 'El writer de la Pi no está conectado.');
}

const byOf = (auth: { uid: string }, member: { nombre?: string }) => ({ uid: auth.uid, nombre: member.nombre ?? 'Admin' });
const proposalRef = (investigationId: string, proposalId: string) => db.doc(`investigations/${investigationId}/proposals/${proposalId}`);

function idsFrom(data: unknown) {
  const { investigationId, proposalId } = data as { investigationId?: unknown; proposalId?: unknown };
  const valid = (id: unknown): id is string => typeof id === 'string' && /^[\w-]{1,128}$/.test(id);
  if (!valid(investigationId) || !valid(proposalId)) throw new HttpsError('invalid-argument', 'Falta la propuesta.');
  return { investigationId, proposalId };
}

export const rehearseWriteProposal = onCall({ region: 'us-central1' }, async (req) => {
  const member = await requireActiveAdmin(req.auth);
  const { investigationId, proposalId } = idsFrom(req.data);
  await requireWriterOnline();
  const by = byOf(req.auth!, member);
  const ref = proposalRef(investigationId, proposalId);
  await db.runTransaction(async (tx) => {
    const proposal = (await tx.get(ref)).data() as WriteProposal | undefined;
    if (!(await isEnabled(tx))) throw new HttpsError('failed-precondition', 'Las escrituras están apagadas.');
    if (!proposal) throw new HttpsError('not-found', 'No existe esa propuesta.');
    if (!canRehearse(proposal.status, millis(proposal.rehearsalRequestedAt), Date.now())) {
      throw new HttpsError('failed-precondition', 'Esta propuesta ya no se puede ensayar.');
    }
    const job = db.collection('writer_jobs').doc();
    tx.update(ref, { status: 'rehearsing', error: null, rehearsal: null, approval: null, rehearsalRequestedAt: FieldValue.serverTimestamp(), rehearsedBy: by, rehearsalJobId: job.id });
    tx.set(job, {
      kind: 'rehearse',
      status: 'queued',
      investigationId,
      proposalId,
      operations: proposal.operations,
      by,
      createdAt: FieldValue.serverTimestamp(),
    });
    audit(tx, 'rehearsal_requested', by, { investigationId, proposalId, hash: proposal.opsHash });
  });
  return { ok: true };
});

export const confirmWriteStep = onCall({ region: 'us-central1' }, async (req) => {
  const member = await requireActiveAdmin(req.auth);
  const { investigationId, proposalId } = idsFrom(req.data);
  const { step, hash, typed, cancel } = req.data as { step?: unknown; hash?: unknown; typed?: unknown; cancel?: unknown };
  const by = byOf(req.auth!, member);
  const ref = proposalRef(investigationId, proposalId);
  if (step === 3) await requireWriterOnline();

  await db.runTransaction(async (tx) => {
    const proposal = (await tx.get(ref)).data() as WriteProposal | undefined;
    if (cancel === true) {
      if (proposal?.approval?.by.uid === by.uid && proposal.status === 'rehearsed') {
        tx.update(ref, { approval: null });
        audit(tx, 'approval_cancelled', by, { investigationId, proposalId });
      }
      return;
    }
    const enabled = await isEnabled(tx);
    const problem = stepProblem(proposal, enabled, { uid: by.uid, step, hash, typed, authTimeSeconds: req.auth!.token.auth_time, now: Date.now() });
    if (problem) throw new HttpsError('failed-precondition', problem);
    const { rehearsal, operations, opsHash } = proposal!;
    audit(tx, 'step_confirmed', by, { investigationId, proposalId, hash: rehearsal!.hash, detail: `Paso ${String(step)}` });
    if (step === 1) {
      tx.update(ref, { approval: { by, startedAt: FieldValue.serverTimestamp(), step: 1, hash: rehearsal!.hash } satisfies WriteApproval });
    } else if (step === 2) {
      tx.update(ref, { 'approval.step': 2 });
    } else {
      tx.update(ref, { status: 'executing', execution: { by, requestedAt: FieldValue.serverTimestamp() } });
      tx.set(db.collection('writer_jobs').doc(), {
        kind: 'execute',
        status: 'queued',
        investigationId,
        proposalId,
        operations,
        expected: rehearsal!.rows.map(({ beforeHash, afterHash, affected }) => ({ beforeHash, afterHash, affected })),
        by,
        createdAt: FieldValue.serverTimestamp(),
      });
      audit(tx, 'execution_requested', by, { investigationId, proposalId, hash: opsHash });
    }
  });
  return { ok: true };
});

/** Undoing goes through the same rehearsal and the same three steps, because it's another write. */
export const createReverseProposal = onCall({ region: 'us-central1' }, async (req) => {
  const member = await requireActiveAdmin(req.auth);
  const { investigationId, proposalId } = idsFrom(req.data);
  const by = byOf(req.auth!, member);
  const source = proposalRef(investigationId, proposalId);
  const target = proposalRef(investigationId, `r-${proposalId}`);
  await db.runTransaction(async (tx) => {
    const [original, existing] = [await tx.get(source), await tx.get(target)];
    // A newer proposal may have replaced an earlier reversal, and undoing has to stay possible.
    if (existing.exists && (existing.data() as WriteProposal).status !== 'superseded') return;
    const proposal = original.data() as WriteProposal | undefined;
    const operations = proposal?.execution?.reversal?.operations ?? [];
    if (proposal?.status !== 'executed' || operations.length === 0) {
      throw new HttpsError('failed-precondition', 'Esta propuesta no tiene una reversa que se pueda correr.');
    }
    const reverse: WriteProposal = {
      reason: 'Deja las filas como estaban antes de esta escritura.',
      operations,
      consequence: proposal.consequence,
      consequenceEvidence: proposal.consequenceEvidence,
      riskLevel: proposal.riskLevel,
      risk: proposal.risk,
      cache: proposal.cache,
      turn: proposal.turn,
      status: 'proposed',
      opsHash: operationsHash(operations),
      createdAt: FieldValue.serverTimestamp(),
      reverseOf: proposalId,
      error: null,
      rehearsal: null,
      approval: null,
      execution: null,
    };
    tx.set(target, reverse);
    audit(tx, 'reversal_proposed', by, { investigationId, proposalId: target.id, hash: reverse.opsHash });
  });
  return { id: target.id };
});

// ---------------------------------------------------------------------------
// Settings, for admins
// ---------------------------------------------------------------------------

async function queueCheck(by: By) {
  await db.collection('writer_jobs').add({ kind: 'check', status: 'queued', by, createdAt: FieldValue.serverTimestamp() });
}

export const setInvestigatorWriter = onCall({ region: 'us-central1', secrets: [configKek] }, async (req) => {
  const member = await requireActiveAdmin(req.auth);
  const by = byOf(req.auth!, member);
  const input = req.data as DbSettingsInput & { remove?: boolean; ca?: unknown };
  // A different connection may be a different set of permissions, so it starts off again.
  const off = { enabled: false, by: by.nombre, at: FieldValue.serverTimestamp() };
  if (input.remove) {
    await Promise.all([db.doc(WRITER_DOC).delete(), db.doc(WRITER_SECRET_DOC).delete(), db.doc(SWITCH_DOC).set(off)]);
    return { ok: true };
  }
  const [stored, current] = await Promise.all([
    db.doc(WRITER_SECRET_DOC).get().then((doc) => doc.data() as { cipher?: string; ca?: string } | undefined),
    db.doc(WRITER_DOC).get().then((doc) => doc.data() as InvestigatorWriterConfig | undefined),
  ]);
  // The saved password only goes where it already was: an open session can't point it at another server.
  const sameTarget =
    current?.host === input.host && current?.port === input.port && current?.user === input.user && (!input.ca || input.ca === stored?.ca);
  const problem = dbSettingsProblem(input, Boolean(stored?.cipher) && sameTarget) ?? caProblem(input.ca);
  if (problem) throw new HttpsError('invalid-argument', problem);
  const cipher = input.password ? encryptJson(getKek(), { password: input.password }) : stored!.cipher!;
  const ca = (input.ca as string | undefined) || stored?.ca || null;
  const config: InvestigatorWriterConfig = {
    host: input.host as string,
    port: input.port as number,
    user: input.user as string,
    database: input.database as string,
    hasCa: ca !== null,
    version: createHash('sha256').update(`${Date.now()}${req.auth!.uid}`).digest('hex').slice(0, 16),
    updatedBy: by.nombre,
    updatedAt: FieldValue.serverTimestamp(),
    test: { status: 'pending', requestedAt: FieldValue.serverTimestamp() },
  };
  await db.doc(WRITER_SECRET_DOC).set({ cipher, enc: 'aes-256-gcm+kek', ca });
  await db.doc(WRITER_DOC).set(config);
  await db.doc(SWITCH_DOC).set(off);
  await queueCheck(by);
  return { ok: true };
});

export const testInvestigatorWriter = onCall({ region: 'us-central1' }, async (req) => {
  const member = await requireActiveAdmin(req.auth);
  const ref = db.doc(WRITER_DOC);
  if (!(await ref.get()).exists) throw new HttpsError('failed-precondition', 'Primero guardá la conexión.');
  await ref.update({ test: { status: 'pending', requestedAt: FieldValue.serverTimestamp() } });
  await queueCheck(byOf(req.auth!, member));
  return { ok: true };
});

export const setWritesEnabled = onCall({ region: 'us-central1' }, async (req) => {
  const member = await requireActiveAdmin(req.auth);
  const by = byOf(req.auth!, member);
  const enabled = (req.data as { enabled?: unknown }).enabled === true;
  await db.runTransaction(async (tx) => {
    const config = (await tx.get(db.doc(WRITER_DOC))).data() as InvestigatorWriterConfig | undefined;
    if (enabled && config?.test.status !== 'ok') throw new HttpsError('failed-precondition', 'Primero probá la conexión de escritura.');
    tx.set(db.doc(SWITCH_DOC), { enabled, by: by.nombre, at: FieldValue.serverTimestamp() });
    audit(tx, 'switch_changed', by, { detail: enabled ? 'Encendió las escrituras' : 'Apagó las escrituras' });
  });
  return { ok: true };
});

// ---------------------------------------------------------------------------
// The writer on the Pi
// ---------------------------------------------------------------------------

interface WriterJobDoc {
  kind: 'check' | 'rehearse' | 'execute' | 'recover';
  status: 'queued' | 'running' | 'done';
  investigationId?: string;
  proposalId?: string;
  operations?: WriteOperation[];
  expected?: unknown[];
  /** What it was about to commit, recorded just before doing so. */
  pending?: WriteRowResult[] | null;
  by: By;
  createdAt: unknown;
}

interface ResultBody {
  jobId: string;
  outcome: 'ok' | 'failed' | 'applied' | 'not_applied' | 'unknown';
  detail?: string | null;
  rows?: WriteRowResult[];
  reversal?: WriteReversal;
  checks?: unknown[];
  tables?: { name: string; privileges: string[] }[];
}

/** Moves a proposal to where its job ended. Only from the state that job left it in, so a late report changes nothing. */
/** What the investigation keeps of a write, so a list can show it without reading each proposal. */
export function productionWriteMark(
  proposalId: string,
  proposal: Pick<WriteProposal, 'operations' | 'reverseOf'>,
  status: 'executed' | 'unknown' | 'aborted',
  by: { uid: string; nombre: string },
  at: unknown,
): InvestigationProductionWrite | null {
  if (status === 'aborted') return null;
  return { proposalId, status, reversal: Boolean(proposal.reverseOf), rows: proposal.operations.length, by, at };
}

function settle(tx: FirebaseFirestore.Transaction, jobId: string, job: WriterJobDoc, result: Omit<ResultBody, 'jobId'>, proposal: WriteProposal | undefined) {
  if (job.kind === 'check' || !resultCounts(proposal, job.kind, jobId)) return;
  const ref = proposalRef(job.investigationId!, job.proposalId!);
  const ids = { investigationId: job.investigationId, proposalId: job.proposalId };
  const detail = result.detail?.slice(0, 2000) ?? null;
  if (job.kind === 'rehearse') {
    if (result.outcome !== 'ok' || !result.rows || !result.reversal) {
      tx.update(ref, { status: 'rehearsal_failed', error: detail ?? 'El ensayo falló.' });
      audit(tx, 'rehearsal_failed', job.by, { ...ids, detail });
      return;
    }
    const hash = rehearsalHash(proposal!.opsHash, result.rows, result.reversal);
    tx.update(ref, { status: 'rehearsed', error: null, rehearsal: { rows: result.rows, reversal: result.reversal, hash, by: job.by, at: FieldValue.serverTimestamp() } });
    audit(tx, 'rehearsed', job.by, { ...ids, hash, rows: result.rows });
    return;
  }
  const execution = {
    ...proposal!.execution,
    finishedAt: FieldValue.serverTimestamp(),
    detail,
    ...(result.rows && { rows: result.rows }),
    ...(result.reversal && { reversal: result.reversal }),
  };
  const status = result.outcome === 'applied' ? 'executed' : result.outcome === 'unknown' ? 'unknown' : 'aborted';
  tx.update(ref, { status, execution, approval: null });
  const mark = productionWriteMark(job.proposalId!, proposal!, status, job.by!, FieldValue.serverTimestamp());
  // `set`, because a missing document can't be what fails the report of a write that already ran.
  if (mark) tx.set(db.doc(`investigations/${job.investigationId}`), { productionWrite: mark }, { merge: true });
  audit(tx, status === 'executed' ? 'executed' : status === 'unknown' ? 'unknown' : 'aborted', job.by, { ...ids, detail, rows: result.rows ?? [] });
}

function finishJob(
  tx: FirebaseFirestore.Transaction,
  ref: FirebaseFirestore.DocumentReference,
  job: WriterJobDoc,
  result: Omit<ResultBody, 'jobId'>,
  proposal: WriteProposal | undefined,
) {
  tx.update(ref, { status: 'done', outcome: result.outcome, finishedAt: FieldValue.serverTimestamp() });
  settle(tx, ref.id, job, result, proposal);
}

async function saveResult(body: ResultBody) {
  if (typeof body.jobId !== 'string' || !body.jobId) throw new Error('invalid job');
  const oversized = Buffer.byteLength(JSON.stringify(body)) > MAX_RESULT_BYTES;
  const ref = db.doc(`writer_jobs/${body.jobId}`);
  await db.runTransaction(async (tx) => {
    const job = (await tx.get(ref)).data() as WriterJobDoc | undefined;
    if (job?.status !== 'running') return;
    const proposal = job.proposalId ? ((await tx.get(proposalRef(job.investigationId!, job.proposalId))).data() as WriteProposal | undefined) : undefined;
    let result: Omit<ResultBody, 'jobId'> = body;
    if (oversized) {
      // Too big for a rehearsal means no approval. For a write that already ran, the rows have to be checked.
      result = job.kind === 'rehearse' ? { outcome: 'failed', detail: 'El resultado del ensayo es demasiado grande.' } : { outcome: body.outcome, detail: 'El resultado es demasiado grande para guardarlo.' };
    }
    if (job.kind === 'check') {
      const writer = db.doc(WRITER_DOC);
      if ((await tx.get(writer)).exists) {
        tx.update(writer, {
          'test.status': result.outcome === 'ok' ? 'ok' : 'failed',
          'test.finishedAt': FieldValue.serverTimestamp(),
          'test.checks': result.checks ?? [],
          'test.tables': result.tables ?? [],
        });
      }
    }
    finishJob(tx, ref, job, result, proposal);
  });
  return { ok: true };
}

/** Called right before COMMIT. Failing here makes the writer roll back, so this is also the last chance to stop it. */
async function recordCommitting(body: { jobId?: unknown; rows?: unknown }) {
  if (typeof body.jobId !== 'string' || !Array.isArray(body.rows)) throw new Error('invalid job');
  const ref = db.doc(`writer_jobs/${body.jobId}`);
  await db.runTransaction(async (tx) => {
    const job = (await tx.get(ref)).data() as WriterJobDoc | undefined;
    if (job?.status !== 'running' || job.kind !== 'execute') throw new Error('not running');
    if (!(await isEnabled(tx))) throw new Error('writes are off');
    tx.update(ref, { pending: body.rows, committingAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
}

/** A process that died left its transaction to roll back, unless it got as far as saying it would commit. */
async function reviveInterrupted() {
  const running = await db.collection('writer_jobs').where('status', '==', 'running').get();
  await Promise.all(
    running.docs.map((doc) =>
      db.runTransaction(async (tx) => {
        const job = (await tx.get(doc.ref)).data() as WriterJobDoc;
        if (job.status !== 'running') return;
        if (job.kind === 'execute' || job.kind === 'recover') {
          tx.update(doc.ref, { kind: 'recover', status: 'queued', createdAt: FieldValue.serverTimestamp() });
          return;
        }
        const proposal = job.proposalId ? ((await tx.get(proposalRef(job.investigationId!, job.proposalId))).data() as WriteProposal | undefined) : undefined;
        finishJob(tx, doc.ref, job, { outcome: 'failed', detail: 'El proceso se interrumpió. No quedó nada aplicado.' }, proposal);
      }),
    ),
  );
}

async function loadConnection() {
  const [config, secret] = await Promise.all([db.doc(WRITER_DOC).get(), db.doc(WRITER_SECRET_DOC).get()]);
  const { cipher, ca } = (secret.data() ?? {}) as { cipher?: string; ca?: string | null };
  if (!config.exists || !cipher) return null;
  const { host, port, user, database } = config.data() as InvestigatorWriterConfig;
  return { connection: { host, port, user, database, password: decryptJson<{ password: string }>(getKek(), cipher).password }, ca: ca ?? null };
}

async function claimJob(startup: boolean) {
  if (startup) await reviveInterrupted();
  const queued = await db.collection('writer_jobs').where('status', '==', 'queued').orderBy('createdAt', 'asc').limit(5).get();
  for (const doc of queued.docs) {
    const reason = await db.runTransaction(async (tx) => {
      const job = (await tx.get(doc.ref)).data() as WriterJobDoc;
      if (job.status !== 'queued') return 'taken';
      const proposal = job.proposalId ? ((await tx.get(proposalRef(job.investigationId!, job.proposalId))).data() as WriteProposal | undefined) : undefined;
      // Only touches the database for an admin's job. A recovery only reads, and has to work with writes off.
      const writes = job.kind === 'rehearse' || job.kind === 'execute';
      const expired = writes && jobExpired(millis(job.createdAt), Date.now());
      const off = writes && !(await isEnabled(tx));
      if (expired || off) {
        const detail = off ? 'Las escrituras están apagadas.' : 'El writer no la tomó a tiempo. No se aplicó nada.';
        finishJob(tx, doc.ref, job, { outcome: 'failed', detail }, proposal);
        return 'refused';
      }
      tx.update(doc.ref, { status: 'running', claimedAt: FieldValue.serverTimestamp() });
      return 'claimed';
    });
    if (reason !== 'claimed') continue;
    const job = doc.data() as WriterJobDoc;
    const target = await loadConnection();
    if (!target) {
      await saveResult({ jobId: doc.id, outcome: job.kind === 'recover' ? 'unknown' : 'failed', detail: 'Falta la conexión de escritura.' });
      continue;
    }
    return { id: doc.id, kind: job.kind, connection: target.connection, ca: target.ca, operations: job.operations, expected: job.expected, pending: job.pending ?? null };
  }
  return null;
}

export const investigationWriter = onRequest(
  { region: 'us-central1', secrets: [writerSecret, configKek], timeoutSeconds: 60 },
  async (req, res) => {
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (req.method !== 'POST' || !secretMatches(bearer, writerSecret.value())) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    try {
      const body = req.body as { action?: string; heartbeat?: boolean; startup?: boolean };
      if (body.action === 'claim') {
        if (body.heartbeat || body.startup) {
          await db.doc(STATE_DOC).set({
            lastSeenAt: FieldValue.serverTimestamp(),
            publicIp: callerIp(req.headers['x-forwarded-for'], req.ip),
          });
        }
        res.json({ job: await claimJob(body.startup === true) });
      } else if (body.action === 'committing') {
        res.json(await recordCommitting(req.body as { jobId?: unknown; rows?: unknown }));
      } else if (body.action === 'result') {
        res.json(await saveResult(req.body as ResultBody));
      } else {
        res.status(400).json({ error: 'unknown action' });
      }
    } catch (e) {
      logger.error('investigationWriter', { message: (e as Error).message });
      res.status(500).json({ error: 'internal' });
    }
  },
);
