import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { FieldValue } from 'firebase-admin/firestore';
import type { Conversation, Message, TeamMember } from '@aditum-chat/shared';
import { db, messaging } from './lib/admin.js';
import { attachmentSummary, markdownToPlain } from './lib/markdown.js';

/**
 * Web Push (FCM) a los AGENTES de la consola cuando un usuario escribe.
 * Los tokens viven en team/{uid}.fcmTokens (los registra el dashboard con la
 * VAPID key del proyecto propio). Con conversación asignada notifica solo al
 * asignado; sin asignar, a todos los agentes del sitio.
 *
 * En el emulador (proyecto demo-*) el envío falla contra FCM real: se captura
 * y se loguea como warning sin romper el flujo.
 */
export const notifyAgentsOnMessage = onDocumentCreated(
  {
    document: 'conversations/{convId}/messages/{msgId}',
    region: 'us-central1',
    memory: '256MiB',
  },
  async (event) => {
    const msg = event.data?.data() as Message | undefined;
    if (!msg || msg.interno) return;
    // User messages notify; system messages only when they are the bot
    // escalation handoff (botConvRef) — the moment the chat reaches agents.
    const esEscalacion = msg.sender.tipo === 'sistema' && Boolean(msg.botConvRef);
    if (msg.sender.tipo !== 'user' && !esEscalacion) return;

    const convId = event.params.convId;
    const convSnap = await db.doc(`conversations/${convId}`).get();
    if (!convSnap.exists) return;
    const conv = convSnap.data() as Conversation;

    // The bot is autonomous: agents are never pushed while it attends
    // (estado 'bot' or the bot-channel registry); they get notified via the
    // escalation into the agent channel.
    if (conv.estado === 'bot' || conv.subcanal === 'bot') return;

    // Destinatarios: TODOS los agentes con acceso al sitio, siempre
    // (sin importar a quién esté asignada la conversación).
    const teamSnap = await db.collection('team').get();
    const destinatarios = teamSnap.docs.filter((d) => {
      const m = d.data() as TeamMember;
      return !m.sitios || m.sitios.length === 0 || m.sitios.includes(conv.siteId);
    });

    const tokenDuenos = new Map<string, string>(); // token → uid (para limpiar inválidos)
    for (const d of destinatarios) {
      for (const t of (d.data() as TeamMember).fcmTokens ?? []) tokenDuenos.set(t, d.id);
    }
    const tokens = [...tokenDuenos.keys()];
    if (tokens.length === 0) return;

    const titulo = [conv.contactNombre ?? msg.sender.nombre, conv.clientNombre]
      .filter(Boolean)
      .join(' · ');
    const textoPlano =
      markdownToPlain(msg.texto) || attachmentSummary(msg.adjuntos, 'es');
    const cuerpo =
      textoPlano.length > 120 ? `${textoPlano.slice(0, 117)}…` : textoPlano || 'Nuevo mensaje';
    const link = `/inbox?c=${convId}`;

    try {
      // Data-only: el service worker construye la notificación desde `data`.
      // Evita el auto-display de FCM (que dependía de config en el SW) y duplicados.
      const res = await messaging.sendEachForMulticast({
        tokens,
        // msgId keys the browser notification tag: unique per message so
        // notifications STACK instead of replacing each other.
        data: { title: titulo, body: cuerpo, convId, msgId: event.params.msgId, link },
        webpush: { fcmOptions: { link } },
      });

      // Limpieza de tokens muertos.
      const bajas: Promise<unknown>[] = [];
      res.responses.forEach((r, i) => {
        const code = (r.error as { code?: string } | undefined)?.code;
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-argument'
        ) {
          const token = tokens[i];
          const uid = tokenDuenos.get(token)!;
          bajas.push(
            db.doc(`team/${uid}`).update({ fcmTokens: FieldValue.arrayRemove(token) }),
          );
        }
      });
      await Promise.all(bajas);
      logger.info('notifyAgentsOnMessage', {
        convId,
        tokens: tokens.length,
        ok: res.successCount,
        fallidos: res.failureCount,
      });
    } catch (err) {
      // Emulador / proyecto demo sin FCM: no romper el pipeline de mensajes.
      logger.warn('notifyAgentsOnMessage: envío FCM omitido', {
        convId,
        tokens: tokens.length,
        error: (err as Error).message,
      });
    }
  },
);
