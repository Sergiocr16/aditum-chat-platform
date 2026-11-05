'use client';

// Investigaciones: el agente pide un análisis desde el chat y el analizador en la
// Raspberry Pi lo resuelve. Firestore es solo lectura desde acá; todo pasa por functions.

import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  getCountFromServer,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  type QueryConstraint,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type {
  Conversation,
  Investigation,
  InvestigationEvent,
  InvestigationMessageRef,
  InvestigationQueryRecord,
  InvestigationTurn,
  InvestigatorGatewayState,
  InvestigatorRunnerState,
  InvestigationCondominium,
} from '@aditum-chat/shared';
import { confirmPassword } from './auth';
import { db, fns, storage } from './firebase';
import { randomFileToken, useDoc, type Row } from './data';

/** Con este tiempo sin noticias de la Pi, se le avisa al agente. */
const RUNNER_OFFLINE_MS = 3 * 60_000;

function useRows<T>(path: string | null, constraints: QueryConstraint[]): Row<T>[] {
  const [rows, setRows] = useState<Row<T>[]>([]);
  useEffect(() => {
    if (!path) {
      setRows([]);
      return;
    }
    return onSnapshot(query(collection(db, path), ...constraints), (snap) => {
      setRows(snap.docs.map((d) => ({ id: d.id, data: d.data() as T })));
    });
  }, [path, constraints]);
  return rows;
}

/** `contact:{id}` or `group:{id}`: what ties a chat's investigations together across its segments. */
export function threadKeyOf(conv: Conversation): string | null {
  if (conv.tipo === 'grupo') return conv.groupId ? `group:${conv.groupId}` : null;
  return conv.contactId ? `contact:${conv.contactId}` : null;
}

const INVESTIGATIONS_PAGE = 25;

export interface InvestigationList {
  rows: Row<Investigation>[];
  loading: boolean;
  error: boolean;
  hasMore: boolean;
  loadMore(): void;
}

/** Every saved investigation, newest first: of one chat, or of all of them when `threadKey` is null. */
export function useInvestigationList(threadKey: string | null, pageSize = INVESTIGATIONS_PAGE): InvestigationList {
  const [max, setMax] = useState(pageSize);
  const [state, setState] = useState<{ key: string; rows: Row<Investigation>[]; error: boolean } | null>(null);
  const listKey = threadKey ?? '*';

  useEffect(() => {
    setMax(pageSize);
  }, [listKey, pageSize]);

  useEffect(() => {
    const constraints: QueryConstraint[] = [
      ...(threadKey ? [where('threadKey', '==', threadKey)] : []),
      orderBy('createdAt', 'desc'),
      fsLimit(max),
    ];
    return onSnapshot(
      query(collection(db, 'investigations'), ...constraints),
      (snap) => setState({ key: listKey, rows: snap.docs.map((d) => ({ id: d.id, data: d.data() as Investigation })), error: false }),
      () => setState({ key: listKey, rows: [], error: true }),
    );
  }, [threadKey, listKey, max]);

  const current = state?.key === listKey ? state : null;
  return {
    rows: current?.rows ?? [],
    loading: current === null,
    error: current?.error ?? false,
    hasMore: (current?.rows.length ?? 0) >= max,
    loadMore: () => setMax((n) => n + pageSize),
  };
}

/** How many investigations of this chat are queued or running. */
export function useActiveInvestigations(threadKey: string | null): number {
  const constraints = useMemo<QueryConstraint[]>(
    () => (threadKey ? [where('threadKey', '==', threadKey), where('status', 'in', ['queued', 'running'])] : []),
    [threadKey],
  );
  return useRows<Investigation>(threadKey ? 'investigations' : null, constraints).length;
}

/** What a running investigation is broadly doing, for the agent. The individual steps aren't shown. */
export type InvestigationPhase = 'starting' | 'preparing' | 'files' | 'code' | 'database';

const PHASE_OF: Record<InvestigationEvent['kind'], InvestigationPhase> = {
  status: 'preparing',
  attachment: 'files',
  code: 'code',
  database: 'database',
};

/**
 * A progress flush shares one timestamp, and the database wins inside it: it's the rarer, more telling
 * step. `sinceMs` leaves out what earlier rounds of the same investigation did.
 */
export function useInvestigationPhase(id: string | null, sinceMs = 0): InvestigationPhase {
  const constraints = useMemo<QueryConstraint[]>(() => [orderBy('at', 'desc'), fsLimit(10)], []);
  const rows = useRows<InvestigationEvent>(id ? `investigations/${id}/events` : null, constraints);
  const millisOf = (e: Row<InvestigationEvent>) => (e.data.at as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;
  const events = rows.filter((e) => millisOf(e) >= sinceMs);
  if (events.length === 0) return 'starting';
  const latest = events.filter((e) => millisOf(e) === millisOf(events[0]));
  return latest.some((e) => e.data.kind === 'database') ? 'database' : PHASE_OF[latest[0].data.kind];
}

/** The rounds already over, oldest first. The current one is on the investigation itself. */
export function useInvestigationTurns(id: string | null): Row<InvestigationTurn>[] {
  const constraints = useMemo<QueryConstraint[]>(() => [orderBy('n', 'asc')], []);
  return useRows<InvestigationTurn>(id ? `investigations/${id}/turns` : null, constraints);
}

export function useInvestigationQueries(id: string | null): Row<InvestigationQueryRecord>[] {
  const constraints = useMemo<QueryConstraint[]>(() => [orderBy('at', 'asc'), fsLimit(100)], []);
  return useRows<InvestigationQueryRecord>(id ? `investigations/${id}/queries` : null, constraints);
}

export interface InvestigationStats {
  confirmed: number;
  hypothesis: number;
  undetermined: number;
  noResult: number;
  active: number;
}

/**
 * Totals over every investigation, not just the loaded page. Firestore counts aren't live, so they're
 * read again whenever `refreshKey` changes.
 */
export function useInvestigationStats(siteId: string | null, refreshKey: string): { stats: InvestigationStats | null; error: boolean } {
  const [state, setState] = useState<{ stats: InvestigationStats | null; error: boolean }>({ stats: null, error: false });
  useEffect(() => {
    let stale = false;
    const count = (constraint: QueryConstraint) =>
      getCountFromServer(
        query(collection(db, 'investigations'), ...(siteId ? [where('siteId', '==', siteId)] : []), constraint),
      ).then((snap) => snap.data().count);
    Promise.all([
      count(where('report.conclusion', '==', 'confirmed')),
      count(where('report.conclusion', '==', 'hypothesis')),
      count(where('report.conclusion', '==', 'undetermined')),
      count(where('status', 'in', ['failed', 'rate_limited', 'cancelled'])),
      count(where('status', 'in', ['queued', 'running'])),
    ]).then(
      ([confirmed, hypothesis, undetermined, noResult, active]) => {
        if (!stale) setState({ stats: { confirmed, hypothesis, undetermined, noResult, active }, error: false });
      },
      () => {
        if (!stale) setState({ stats: null, error: true });
      },
    );
    return () => {
      stale = true;
    };
  }, [siteId, refreshKey]);
  return state;
}

export function useRunnerOnline(now: number): { online: boolean; tokenDaysLeft: number | null; lastSeenAt: unknown } {
  const runner = useDoc<InvestigatorRunnerState>('investigator/runner');
  const seen = (runner?.data.lastSeenAt as { toMillis?: () => number } | undefined)?.toMillis?.();
  return {
    online: seen !== undefined && now - seen < RUNNER_OFFLINE_MS,
    tokenDaysLeft: runner?.data.tokenDaysLeft ?? null,
    lastSeenAt: runner?.data.lastSeenAt ?? null,
  };
}

export async function requestInvestigation(input: {
  conversationId: string;
  messages: InvestigationMessageRef[];
  question: string;
  uploads: { storagePath: string; name: string }[];
  condominiums: InvestigationCondominium[];
  /** The investigation this one repeats: its files may be another agent's, and the server allows them. */
  retryOf?: string;
}): Promise<string> {
  const { data } = (await httpsCallable(fns, 'requestInvestigation')(input)) as { data: { id: string } };
  return data.id;
}

const TYPE_BY_EXTENSION: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  csv: 'text/csv',
  md: 'text/markdown',
  txt: 'text/plain',
  pdf: 'application/pdf',
};

/** Private to the investigation: it doesn't go through the chat, so the client never sees it. */
export async function uploadInvestigationFile(uid: string, file: File): Promise<string> {
  const { ref, uploadBytes } = await import('firebase/storage');
  const storagePath = `investigaciones/${uid}/${randomFileToken()}_${file.name}`;
  const extension = file.name.toLowerCase().split('.').pop() ?? '';
  // Browsers leave the type empty for some of these, and report CSV as an Excel file on Windows.
  const contentType = TYPE_BY_EXTENSION[extension] ?? file.type;
  await uploadBytes(ref(storage, storagePath), file, { contentType });
  return storagePath;
}

export async function investigationFileUrl(storagePath: string): Promise<string> {
  const { getDownloadURL, ref } = await import('firebase/storage');
  return getDownloadURL(ref(storage, storagePath));
}

export async function requestFollowUp(id: string, question: string): Promise<void> {
  await httpsCallable(fns, 'requestFollowUp')({ id, question });
}

export async function cancelInvestigation(id: string): Promise<void> {
  await httpsCallable(fns, 'cancelInvestigation')({ id });
}

export function useGatewayOnline(state: InvestigatorGatewayState | null): boolean {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const seen = (state?.lastSeenAt as { toMillis?: () => number } | undefined)?.toMillis?.();
  return seen !== undefined && now - seen < RUNNER_OFFLINE_MS;
}

/** One click and the row exists. `force` creates it even though Claude found a similar one. */
export async function addInvestigationToBacklog(id: string, force = false): Promise<void> {
  await httpsCallable(fns, 'addInvestigationToBacklog')({ id, force });
}

export async function saveInvestigatorBacklog(input: { database: string; token: string }): Promise<void> {
  await httpsCallable(fns, 'setInvestigatorBacklog')(input);
}

export async function testInvestigatorBacklog(): Promise<void> {
  await httpsCallable(fns, 'testInvestigatorBacklog')({});
}

export async function removeInvestigatorBacklog(): Promise<void> {
  await httpsCallable(fns, 'setInvestigatorBacklog')({ remove: true });
}

export async function saveInvestigatorDb(input: {
  host: string;
  port: number;
  user: string;
  database: string;
  password: string;
}): Promise<void> {
  await httpsCallable(fns, 'setInvestigatorDb')(input);
}

export async function testInvestigatorDb(): Promise<void> {
  await httpsCallable(fns, 'testInvestigatorDb')({});
}

export async function saveInvestigatorPi(input: { host: string; port: number; user: string; password: string }): Promise<void> {
  await httpsCallable(fns, 'setInvestigatorPi', { timeout: 95_000 })(input);
}

export async function testInvestigatorPi(): Promise<void> {
  await httpsCallable(fns, 'testInvestigatorPi', { timeout: 95_000 })({});
}

/** Waits for the whole install, which reports its progress on investigator/pi. */
/** The install hands the Pi its secrets, so functions ask for a login that just happened. */
export async function installInvestigatorOnPi(claudeToken: string, password: string): Promise<void> {
  await confirmPassword(password);
  await httpsCallable(fns, 'installInvestigatorOnPi', { timeout: 1_560_000 })({ claudeToken });
}

export async function removeInvestigatorPi(): Promise<void> {
  await httpsCallable(fns, 'setInvestigatorPi')({ remove: true });
}

export async function removeInvestigatorDb(): Promise<void> {
  await httpsCallable(fns, 'setInvestigatorDb')({ remove: true });
}
