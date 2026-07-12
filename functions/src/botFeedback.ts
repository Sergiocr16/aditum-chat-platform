import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import type { BotFeedback, Conversation, Message } from '@aditum-chat/shared';
import { db, FieldValue } from './lib/admin.js';
import { handoffAAgente } from './bot.js';

/**
 * Trigger de bot_feedback/{`${convId}_${msgId}`} — voto "¿te sirvió?" sobre una
 * respuesta del bot:
 * - En el create: estampa `feedback` en el mensaje del bot (Admin SDK, las
 *   rules de messages no cambian) y agrega los contadores a metrics_daily.
 * - Cuando `escalate` pasa a true (aceptó la oferta tras un voto negativo):
 *   ejecuta el mismo handoff que usa el bot — deja el contexto en la
 *   conversación del canal agente y marca escaladoA/escaladoAt en la del bot,
 *   con lo que el widget salta solo al canal agente.
 */
export const onBotFeedbackWrite = onDocumentWritten(
  { document: 'bot_feedback/{feedbackId}', region: 'us-central1' },
  async (event) => {
    const after = event.data?.after.data() as BotFeedback | undefined;
    if (!after) return; // delete (no permitido por rules, pero por las dudas)
    const before = event.data?.before.data() as BotFeedback | undefined;
    const created = !event.data?.before.exists;

    // Anti-fabricación: la conversación debe ser del contacto que votó.
    const convRef = db.doc(`conversations/${after.conversationId}`);
    const convSnap = await convRef.get();
    const conv = convSnap.data() as Conversation | undefined;
    if (!conv || conv.contactId !== after.contactId) {
      logger.warn('bot_feedback sobre conversación ajena o inexistente', {
        feedbackId: event.params.feedbackId,
      });
      return;
    }

    // El mensaje votado debe existir y ser una respuesta del bot.
    const msgRef = convRef.collection('messages').doc(after.messageId);
    const msgSnap = await msgRef.get();
    const msg = msgSnap.data() as Message | undefined;
    if (!msg || msg.sender.tipo !== 'bot') {
      logger.warn('bot_feedback sobre mensaje inválido', {
        feedbackId: event.params.feedbackId,
      });
      return;
    }

    if (created) {
      await msgRef
        .update({ feedback: after.helpful ? 'helpful' : 'not_helpful' })
        .catch(() => {});
      const fecha = new Date().toISOString().slice(0, 10);
      await db.doc(`metrics_daily/${fecha}`).set(
        {
          fecha,
          botHelpfulCount: FieldValue.increment(after.helpful ? 1 : 0),
          botNotHelpfulCount: FieldValue.increment(after.helpful ? 0 : 1),
        },
        { merge: true },
      );
      // 👍 cierra el ciclo con el bot: la conversación queda resuelta y la
      // próxima consulta abre un segmento nuevo. Con 👎 no se resuelve nada
      // acá — decide la oferta de agente (escalate) o el usuario sigue.
      if (after.helpful && conv.subcanal === 'bot' && conv.estado !== 'resolved') {
        await convRef.update({
          estado: 'resolved',
          resueltaPor: 'bot',
          resueltaAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    // Transición escalate → true (cubre create-con-escalate y el update normal).
    if (after.escalate === true && before?.escalate !== true) {
      const ultimaConsulta = await lastUserQuery(after.conversationId, msg);
      const motivo =
        conv.idioma === 'en'
          ? 'The user indicated the bot answer was not helpful'
          : 'El usuario indicó que la respuesta del bot no fue útil';
      const agenteConvId = await handoffAAgente(conv, after.conversationId, ultimaConsulta, motivo);
      // El ciclo con el bot se cierra ("no fue útil") y continúa en la
      // conversación de agente — una sola línea activa por contacto.
      await convRef.update({
        estado: 'resolved',
        resueltaPor: 'bot',
        resueltaAt: FieldValue.serverTimestamp(),
        escaladoA: agenteConvId,
        escaladoAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await convRef.collection('messages').add({
        sender: { tipo: 'sistema', id: 'sistema', nombre: 'Sistema' },
        texto:
          conv.idioma === 'en'
            ? 'We are transferring you to the agent chat…'
            : 'Te pasamos al chat con un agente…',
        tipoContenido: 'sistema',
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  },
);

/** Última consulta del usuario anterior (o igual) a la respuesta del bot votada. */
async function lastUserQuery(conversationId: string, botMsg: Message): Promise<string> {
  try {
    const snap = await db
      .collection(`conversations/${conversationId}/messages`)
      .where('createdAt', '<=', botMsg.createdAt)
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();
    const userMsg = snap.docs
      .map((d) => d.data() as Message)
      .find((m) => m.sender.tipo === 'user' && !m.interno && m.texto?.trim());
    return userMsg?.texto?.trim() ?? '';
  } catch {
    return '';
  }
}
