import { HttpsError } from 'firebase-functions/v2/https';
import { db } from './admin.js';

type Auth = { uid: string; token: Record<string, unknown> } | undefined;

interface Member {
  rol?: string;
  activo?: boolean;
  nombre?: string;
}

/** The token can outlive a demotion, and this guards production credentials. */
export async function requireActiveAdmin(auth: Auth): Promise<Member> {
  if (auth?.token.kind !== 'agent') throw new HttpsError('permission-denied', 'Solo admins.');
  const member = (await db.doc(`team/${auth.uid}`).get()).data() as Member | undefined;
  if (member?.rol !== 'admin' || member.activo === false) throw new HttpsError('permission-denied', 'Solo admins.');
  return member;
}

/** For actions that reach outside the console: the token can also outlive an agent being disabled. */
export async function requireActiveAgent(auth: Auth): Promise<Member> {
  if (auth?.token.kind !== 'agent') throw new HttpsError('permission-denied', 'Solo agentes.');
  const member = (await db.doc(`team/${auth.uid}`).get()).data() as Member | undefined;
  if (!member || member.activo === false) throw new HttpsError('permission-denied', 'Solo agentes.');
  return member;
}
