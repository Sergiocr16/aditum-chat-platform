import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import type { Contact, Conversation, Message, Site } from '@aditum-chat/shared';
import { db, messaging as defaultMessaging } from './lib/admin.js';
import { attachmentSummary, markdownToPlain } from './lib/markdown.js';
import { getSiteServiceAccount } from './pushConfig.js';

const configKek = defineSecret('CONFIG_KEK');

// El deviceToken viene del proyecto Firebase del HOST (app de Aditum), así que
// el envío usa el service account configurado por sitio (cifrado en secrets/fcm).
// Cache de apps secundarias por sitio.
const siteApps = new Map<string, Messaging | null>();

async function messagingForSite(siteId: string): Promise<Messaging | null> {
  if (siteApps.has(siteId)) return siteApps.get(siteId)!;
  let result: Messaging | null = null;
  try {
    const sa = await getSiteServiceAccount(siteId);
    if (sa) {
      const nombre = `fcm-${siteId}`;
      const existente = getApps().find((a: App) => a.name === nombre);
      const app =
        existente ??
        initializeApp(
          {
            credential: cert({
              projectId: sa.project_id,
              clientEmail: sa.client_email,
              privateKey: sa.private_key,
            }),
            projectId: sa.project_id,
          },
          nombre,
        );
      result = getMessaging(app);
    }
  } catch (err) {
    logger.warn('No se pudo inicializar FCM del sitio', {
      siteId,
      message: (err as Error).message,
    });
  }
  // Only cache SUCCESSFUL inits: a warm instance that saw "no credentials yet"
  // must retry once the admin saves them (otherwise it silently falls back to
  // the platform project until the instance dies).
  if (result) siteApps.set(siteId, result);
  return result;
}

/** Invalida el cache cuando cambian las credenciales (proceso nuevo lo relee solo). */
export function resetSiteMessagingCache(siteId?: string): void {
  if (siteId) siteApps.delete(siteId);
  else siteApps.clear();
}

/**
 * Push al teléfono del contacto cuando un agente o el bot le responde.
 * Usa el proyecto Firebase del host si está configurado (Configuración →
 * Sitios conectados → Notificaciones push); si no, intenta con el propio.
 */
export const pushNotify = onDocumentCreated(
  {
    document: 'conversations/{convId}/messages/{msgId}',
    region: 'us-central1',
    secrets: [configKek],
  },
  async (event) => {
    const msg = event.data?.data() as Message | undefined;
    if (!msg || msg.interno || msg.bienvenida) return;
    if (msg.sender.tipo !== 'agent' && msg.sender.tipo !== 'bot') return;

    const convSnap = await db.doc(`conversations/${event.params.convId}`).get();
    const conv = convSnap.data() as Conversation | undefined;
    if (!conv) return;

    const siteSnap = await db.doc(`sites/${conv.siteId}`).get();
    const site = siteSnap.data() as Site | undefined;
    if (site?.pushActivo === false) return;

    const contactIds =
      conv.tipo === 'directa'
        ? conv.contactId
          ? [conv.contactId]
          : []
        : (conv.participantes ?? []).filter((p) => p.includes('_'));

    const senderSitio = await messagingForSite(conv.siteId);
    const sender = senderSitio ?? defaultMessaging;

    // Presence del widget (RTDB): si el contacto está VIENDO esta conversación
    // ahora mismo, no hay que molestarlo con un push.
    const PRESENCE_FRESH_MS = 90_000;
    async function viendoConversacion(contactId: string): Promise<boolean> {
      try {
        const snap = await getDatabase().ref(`presence/${contactId}`).get();
        const p = snap.val() as { convId?: string; at?: number } | null;
        if (!p || p.convId !== event.params.convId) return false;
        return typeof p.at === 'number' && Date.now() - p.at < PRESENCE_FRESH_MS;
      } catch {
        return false; // sin RTDB: mejor notificar de más que perder avisos
      }
    }

    for (const contactId of contactIds) {
      if (contactId === msg.sender.id) continue;
      // Respeta el silenciado por usuario (chats grupales).
      if (conv.silenciado?.[contactId]) continue;
      // No molestar si tiene la conversación abierta en pantalla.
      if (await viendoConversacion(contactId)) continue;

      const contactSnap = await db.doc(`contacts/${contactId}`).get();
      const contact = contactSnap.data() as Contact | undefined;
      const tokens = contact?.deviceTokens ?? [];
      if (tokens.length === 0) continue;

      const idioma = contact?.idioma === 'en' ? 'en' : 'es';
      const titulo =
        conv.tipo === 'grupo'
          ? (conv.clientNombre ?? 'Chat de equipo')
          : idioma === 'es'
            ? `${msg.sender.nombre} te respondió`
            : `${msg.sender.nombre} replied`;
      // Plain text: bot replies carry markdown that reads as noise in a push.
      // Attachment-only messages fall back to a "📷 Foto"-style summary.
      const textoPlano =
        markdownToPlain(msg.texto) || attachmentSummary(msg.adjuntos, idioma);
      const body =
        conv.tipo === 'grupo'
          ? `${msg.sender.nombre}: ${textoPlano}`.slice(0, 140)
          : textoPlano.slice(0, 140);

      try {
        const res = await sender.sendEachForMulticast({
          tokens,
          notification: { title: titulo, body },
          data: { conversationId: event.params.convId, tipo: conv.tipo, siteId: conv.siteId },
        });
        const invalidos = res.responses
          .map((r, i) =>
            r.error?.code === 'messaging/registration-token-not-registered' ? tokens[i] : null,
          )
          .filter((t): t is string => Boolean(t));
        if (invalidos.length) {
          await contactSnap.ref.update({
            deviceTokens: tokens.filter((t) => !invalidos.includes(t)),
          });
        }
        logger.info('push enviado', {
          siteId: conv.siteId,
          // The ACTUAL sender project (pushInfo alone lies when init fails
          // and the send falls back to the platform project).
          proyecto: senderSitio ? (site?.pushInfo?.projectId ?? 'sitio') : 'propio',
          exitosos: res.successCount,
          fallidos: res.failureCount,
          ...(res.failureCount > 0
            ? {
                errores: res.responses
                  .filter((r) => r.error)
                  .map((r) => r.error!.code ?? r.error!.message),
              }
            : {}),
        });
      } catch (err) {
        // En emuladores FCM no está disponible — no es un error fatal.
        logger.debug('pushNotify omitido', { message: (err as Error).message });
      }
    }
  },
);
