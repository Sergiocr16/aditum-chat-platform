'use client';

// Investigaciones: el agente pide un análisis desde el chat y el analizador en la
// Raspberry Pi lo resuelve. Firestore es solo lectura desde acá; todo pasa por functions.

import { useEffect, useMemo, useState } from 'react';
import { collection, limit as fsLimit, onSnapshot, orderBy, query, type QueryConstraint, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type {
  Investigation,
  InvestigationEvent,
  InvestigationMessageRef,
  InvestigationQueryRecord,
  InvestigatorGatewayState,
  InvestigatorRunnerState,
} from '@aditum-chat/shared';
import { db, fns } from './firebase';
import { useDoc, type Row } from './data';

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

export function useThreadInvestigations(threadKey: string | null): Row<Investigation>[] {
  const constraints = useMemo<QueryConstraint[]>(
    () => (threadKey ? [where('threadKey', '==', threadKey), orderBy('createdAt', 'desc'), fsLimit(20)] : []),
    [threadKey],
  );
  return useRows<Investigation>(threadKey ? 'investigations' : null, constraints);
}

export function useInvestigationEvents(id: string | null): Row<InvestigationEvent>[] {
  const constraints = useMemo<QueryConstraint[]>(() => [orderBy('at', 'asc'), fsLimit(200)], []);
  return useRows<InvestigationEvent>(id ? `investigations/${id}/events` : null, constraints);
}

export function useInvestigationQueries(id: string | null): Row<InvestigationQueryRecord>[] {
  const constraints = useMemo<QueryConstraint[]>(() => [orderBy('at', 'asc'), fsLimit(100)], []);
  return useRows<InvestigationQueryRecord>(id ? `investigations/${id}/queries` : null, constraints);
}

export function useRunnerOnline(now: number): { online: boolean; tokenDaysLeft: number | null } {
  const runner = useDoc<InvestigatorRunnerState>('investigator/runner');
  const seen = (runner?.data.lastSeenAt as { toMillis?: () => number } | undefined)?.toMillis?.();
  return {
    online: seen !== undefined && now - seen < RUNNER_OFFLINE_MS,
    tokenDaysLeft: runner?.data.tokenDaysLeft ?? null,
  };
}

export async function requestInvestigation(input: {
  conversationId: string;
  messages: InvestigationMessageRef[];
  question: string;
}): Promise<string> {
  const { data } = (await httpsCallable(fns, 'requestInvestigation')(input)) as { data: { id: string } };
  return data.id;
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
export async function installInvestigatorOnPi(claudeToken: string): Promise<void> {
  await httpsCallable(fns, 'installInvestigatorOnPi', { timeout: 1_560_000 })({ claudeToken });
}

export async function removeInvestigatorPi(): Promise<void> {
  await httpsCallable(fns, 'setInvestigatorPi')({ remove: true });
}

export async function removeInvestigatorDb(): Promise<void> {
  await httpsCallable(fns, 'setInvestigatorDb')({ remove: true });
}
