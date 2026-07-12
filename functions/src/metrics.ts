import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import type { Conversation, CsatRating, Message } from '@aditum-chat/shared';
import { db, FieldValue } from './lib/admin.js';

// Métricas agregadas incrementalmente en metrics_daily/{yyyy-mm-dd} (pantalla 1h).

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

function dailyRef() {
  const fecha = hoy();
  return { ref: db.doc(`metrics_daily/${fecha}`), fecha };
}

/** Nueva conversación directa → conversacionesNuevas. */
export const metricsOnConversation = onDocumentCreated(
  { document: 'conversations/{convId}', region: 'us-central1' },
  async (event) => {
    const conv = event.data?.data() as Conversation | undefined;
    if (!conv || conv.tipo !== 'directa') return;
    const { ref, fecha } = dailyRef();
    await ref.set(
      {
        fecha,
        siteId: conv.siteId,
        conversacionesNuevas: FieldValue.increment(1),
      },
      { merge: true },
    );
  },
);

/** Conversación resuelta → resueltasBot / resueltasAgente + encuesta CSAT. */
export const metricsOnResolve = onDocumentUpdated(
  { document: 'conversations/{convId}', region: 'us-central1' },
  async (event) => {
    const antes = event.data?.before.data() as Conversation | undefined;
    const despues = event.data?.after.data() as Conversation | undefined;
    if (!antes || !despues) return;
    if (antes.estado === 'resolved' || despues.estado !== 'resolved') return;
    if (despues.tipo !== 'directa') return;

    // ¿La resolvió el bot (nunca hubo agente asignado) o un agente? Una conversación
    // bot ESCALADA (escaladoA) no cuenta para ninguno: el ciclo sigue en la
    // conversación de agente, que contará cuando se resuelva.
    const eraBot = antes.estado === 'bot';
    const escalada = eraBot && Boolean(despues.escaladoA);
    const porBot = !despues.asignadoA && eraBot && !escalada;
    const { ref, fecha } = dailyRef();
    await ref.set(
      {
        fecha,
        resueltasBot: FieldValue.increment(porBot ? 1 : 0),
        resueltasAgente: FieldValue.increment(porBot || escalada ? 0 : 1),
        ...(despues.asignadoA
          ? { [`porAgente.${despues.asignadoA}.resueltas`]: FieldValue.increment(1) }
          : {}),
      },
      { merge: true },
    );

    // Encuesta CSAT en el chat (el widget la renderiza con estrellas). El canal
    // bot no la lleva: el feedback "¿te sirvió?" ya captura la satisfacción.
    if (despues.subcanal === 'bot') return;
    const idioma = despues.idioma === 'en' ? 'en' : 'es';
    const msgs = await event.data!.after.ref
      .collection('messages')
      .where('tipoContenido', '==', 'csat')
      .limit(1)
      .get();
    if (msgs.empty) {
      await event.data!.after.ref.collection('messages').add({
        sender: { tipo: 'sistema', id: 'sistema', nombre: 'Sistema' },
        texto:
          idioma === 'es'
            ? '¿Cómo calificás la atención que recibiste?'
            : 'How would you rate the support you received?',
        tipoContenido: 'csat',
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  },
);

/** Valoración CSAT registrada → suma diaria + promedio del contacto. */
export const metricsOnCsat = onDocumentCreated(
  { document: 'csat/{id}', region: 'us-central1' },
  async (event) => {
    const rating = event.data?.data() as CsatRating | undefined;
    if (!rating) return;
    // Marcar la conversación como calificada para que el widget no vuelva a pedir CSAT.
    if (rating.conversationId) {
      await db
        .doc(`conversations/${rating.conversationId}`)
        .update({ csatRating: rating.rating, csatAt: FieldValue.serverTimestamp() })
        .catch(() => {});
    }
    const { ref, fecha } = dailyRef();
    await ref.set(
      {
        fecha,
        csatSum: FieldValue.increment(rating.rating),
        csatCount: FieldValue.increment(1),
      },
      { merge: true },
    );
    if (rating.contactId) {
      const csats = await db
        .collection('csat')
        .where('contactId', '==', rating.contactId)
        .limit(50)
        .get();
      const vals = csats.docs.map((d) => (d.data() as CsatRating).rating);
      const prom = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
      await db
        .doc(`contacts/${rating.contactId}`)
        .update({ csatPromedio: Math.round(prom * 10) / 10 })
        .catch(() => {});
    }
  },
);

/** Mensajes: contadores de actividad del contacto (directorio 1r). */
export const metricsOnMessage = onDocumentCreated(
  { document: 'conversations/{convId}/messages/{msgId}', region: 'us-central1' },
  async (event) => {
    const msg = event.data?.data() as Message | undefined;
    if (!msg || msg.sender.tipo !== 'user') return;
    await db
      .doc(`contacts/${msg.sender.id}`)
      .update({ lastActivity: FieldValue.serverTimestamp() })
      .catch(() => {});
  },
);
