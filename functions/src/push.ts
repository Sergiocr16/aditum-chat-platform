import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import type { Contact, Conversation, Message, Site } from '@aditum-chat/shared';
import { db, messaging as defaultMessaging } from './lib/admin.js';
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
  siteApps.set(siteId, result);
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
    if (!msg || msg.interno) return;
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

    const sender = (await messagingForSite(conv.siteId)) ?? defaultMessaging;

    for (const contactId of contactIds) {
      if (contactId === msg.sender.id) continue;
      // Respeta el silenciado por usuario (chats grupales).
      if (conv.silenciado?.[contactId]) continue;

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
      const body =
        conv.tipo === 'grupo' ? `${msg.sender.nombre}: ${msg.texto}`.slice(0, 140) : msg.texto.slice(0, 140);

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
          proyecto: site?.pushInfo?.projectId ?? 'propio',
          exitosos: res.successCount,
          fallidos: res.failureCount,
        });
      } catch (err) {
        // En emuladores FCM no está disponible — no es un error fatal.
        logger.debug('pushNotify omitido', { message: (err as Error).message });
      }
    }
  },
);
