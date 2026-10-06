import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import type { Conversation, Message } from '@aditum-chat/shared';
import { db, FieldValue, Timestamp } from './lib/admin.js';

/** Category stamped on conversations auto-resolved after waiting on the customer. */
const NO_REPLY_CATEGORY = 'sin_respuesta';

/**
 * "Waiting on customer" (estado 'pending') ends when the customer writes again:
 * the conversation goes back to 'open' so it re-enters the agents' active
 * queue. Agent messages never change it (an agent can nudge while waiting).
 * The widget cannot do this itself: rules forbid contacts from touching `estado`.
 */
export const reopenOnCustomerReply = onDocumentCreated(
  { document: 'conversations/{convId}/messages/{msgId}', region: 'us-central1' },
  async (event) => {
    const msg = event.data?.data() as Message | undefined;
    if (!msg || msg.sender.tipo !== 'user') return;

    const convRef = db.doc(`conversations/${event.params.convId}`);
    await db.runTransaction(async (tx) => {
      const conv = (await tx.get(convRef)).data() as Conversation | undefined;
      if (conv?.estado !== 'pending') return;
      tx.update(convRef, { estado: 'open', waitingSince: FieldValue.delete() });
    });
  },
);

/**
 * Resolves conversations that have been "waiting on customer" for more than
 * `hours` (settings/sla `autoResolveWaitingHours`, 0 = off). Called from
 * `slaEngine` every minute. Resolving goes through the normal lifecycle
 * (`metricsOnResolve` counts it and posts the CSAT survey).
 */
export async function autoResolveWaiting(hours: number, now: number): Promise<void> {
  if (!(hours > 0)) return;
  const cutoff = now - hours * 3600_000;
  // Equality-only query (no composite index); the waiting set stays small
  // because this job keeps draining it.
  const snap = await db.collection('conversations').where('estado', '==', 'pending').limit(500).get();

  for (const doc of snap.docs) {
    const since = (doc.data().waitingSince as Timestamp | undefined)?.toMillis();
    if (!since || since > cutoff) continue;
    // Re-check inside a transaction: the customer may have replied meanwhile.
    const closing = {
      estado: 'resolved',
      categoria: NO_REPLY_CATEGORY,
      resueltaPor: 'sistema',
      resueltaAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    const resolved = await db.runTransaction(async (tx) => {
      const fresh = (await tx.get(doc.ref)).data() as Conversation | undefined;
      const freshSince = (fresh?.waitingSince as Timestamp | undefined)?.toMillis();
      if (fresh?.estado !== 'pending' || !freshSince || freshSince > cutoff) return false;
      tx.update(doc.ref, { ...closing, waitingSince: FieldValue.delete() });
      return true;
    });
    if (!resolved) continue;
    logger.info('Waiting conversation auto-resolved', { convId: doc.id, hours });

    // Same as a manual resolve (`resolveConversation` in the console): close the
    // contact's dangling live bot segment too, flagged `cierreArrastrado` so
    // `metricsOnResolve` does not count it as a resolution of its own.
    const contactId = (doc.data() as Conversation).contactId;
    if (!contactId) continue;
    const ofContact = await db.collection('conversations').where('contactId', '==', contactId).get();
    await Promise.all(
      ofContact.docs
        .filter((d) => {
          const c = d.data() as Conversation;
          return d.id !== doc.id && c.estado === 'bot' && (c.subcanal ?? 'agente') === 'bot';
        })
        .map((d) => d.ref.update({ ...closing, cierreArrastrado: true })),
    );
  }
}
