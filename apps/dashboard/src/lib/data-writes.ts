'use client';

// Writes to production: every step goes through functions, which decide. Nothing here is a permission.

import { useEffect, useMemo, useState } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { collection, limit as fsLimit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { WriteAuditEntry, WriteProposal } from '@aditum-chat/shared';
import { auth, db, fns } from './firebase';
import type { Row } from './data';

function useList<T>(path: string | null, field: string, direction: 'asc' | 'desc', max: number): Row<T>[] {
  const [rows, setRows] = useState<Row<T>[]>([]);
  const built = useMemo(() => (path ? query(collection(db, path), orderBy(field, direction), fsLimit(max)) : null), [path, field, direction, max]);
  useEffect(() => {
    if (!built) {
      setRows([]);
      return;
    }
    return onSnapshot(
      built,
      (snap) => setRows(snap.docs.map((d) => ({ id: d.id, data: d.data() as T }))),
      () => setRows([]),
    );
  }, [built]);
  return rows;
}

export const useWriteProposals = (id: string | null) => useList<WriteProposal>(id ? `investigations/${id}/proposals` : null, 'createdAt', 'asc', 50);
export const useWriteAudit = (enabled: boolean) => useList<WriteAuditEntry>(enabled ? 'prod_write_audit' : null, 'at', 'desc', 15);

interface ProposalIds {
  investigationId: string;
  proposalId: string;
}

export async function rehearseWriteProposal(ids: ProposalIds): Promise<void> {
  await httpsCallable(fns, 'rehearseWriteProposal')(ids);
}

export async function confirmWriteStep(ids: ProposalIds, step: 1 | 2, hash: string): Promise<void> {
  await httpsCallable(fns, 'confirmWriteStep')({ ...ids, step, hash });
}

export async function cancelWriteApproval(ids: ProposalIds): Promise<void> {
  await httpsCallable(fns, 'confirmWriteStep')({ ...ids, cancel: true });
}

/** The password is checked by Firebase and never sent to functions, which only see that the login is recent. */
export async function runApprovedWrite(ids: ProposalIds, hash: string, typed: string, password: string): Promise<void> {
  const user = auth.currentUser;
  if (!user?.email) throw new Error('No hay sesión.');
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
  await user.getIdToken(true);
  await httpsCallable(fns, 'confirmWriteStep')({ ...ids, step: 3, hash, typed });
}

export async function createReverseProposal(ids: ProposalIds): Promise<void> {
  await httpsCallable(fns, 'createReverseProposal')(ids);
}

export async function saveInvestigatorWriter(input: { host: string; port: number; user: string; database: string; password: string; ca: string }): Promise<void> {
  await httpsCallable(fns, 'setInvestigatorWriter')(input);
}

export async function testInvestigatorWriter(): Promise<void> {
  await httpsCallable(fns, 'testInvestigatorWriter')({});
}

export async function removeInvestigatorWriter(): Promise<void> {
  await httpsCallable(fns, 'setInvestigatorWriter')({ remove: true });
}

export async function setWritesEnabled(enabled: boolean): Promise<void> {
  await httpsCallable(fns, 'setWritesEnabled')({ enabled });
}
