import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import {
  contactIdFor,
  groupConversationIdFor,
  type Contact,
  type ContactClaims,
  type EncryptedPayloadClaims,
  type Idioma,
  type Site,
  type SiteSecret,
  type WidgetSessionResponse,
} from '@aditum-chat/shared';
import { auth, db, FieldValue } from './lib/admin.js';
import { decryptPayload, validateClaims } from './lib/crypto.js';
import { isWithinSchedule, resolveSiteConfig, scheduleText } from './lib/config.js';

/**
 * POST /widgetSession  { siteId, payload }
 * Descifra el payload del host con la clave del sitio (current, luego previous
 * si sigue en período de gracia), hace upsert del contacto y del cliente,
 * garantiza el chat de grupo del clientId y devuelve un custom token.
 */
export const widgetSession = onRequest({ cors: true, region: 'us-central1' }, async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }
    const { siteId, payload } = req.body as { siteId?: string; payload?: string };
    if (!siteId || !payload) {
      res.status(400).json({ error: 'missing_params', message: 'siteId y payload son requeridos.' });
      return;
    }

    const siteSnap = await db.doc(`sites/${siteId}`).get();
    if (!siteSnap.exists || (siteSnap.data() as Site).activo === false) {
      res.status(404).json({ error: 'site_not_found' });
      return;
    }
    const site = siteSnap.data() as Site;

    const claims = await decryptWithSiteKeys(siteId, payload);
    validateClaims(claims);

    const idioma: Idioma = claims.idioma === 'en' ? 'en' : 'es';
    const contactId = contactIdFor(siteId, claims.userId);

    // Upsert del contacto (directorio automático).
    const contactRef = db.doc(`contacts/${contactId}`);
    const contactSnap = await contactRef.get();
    const base: Partial<Contact> = {
      externalId: claims.userId,
      siteId,
      clientId: claims.clientId,
      nombre: claims.nombre,
      email: claims.email,
      rol: claims.rol,
      idioma,
      metadata: claims.metadata,
      lastActivity: FieldValue.serverTimestamp(),
    };
    stripUndefined(base);
    if (contactSnap.exists) {
      const update: Record<string, unknown> = { ...base };
      if (claims.deviceToken) update.deviceTokens = FieldValue.arrayUnion(claims.deviceToken);
      await contactRef.update(update);
    } else {
      await contactRef.set({
        ...base,
        deviceTokens: claims.deviceToken ? [claims.deviceToken] : [],
        conversacionesCount: 0,
        ticketsCount: 0,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    // Upsert mínimo del cliente/condominio.
    if (claims.clientId) {
      await db.doc(`clients/${claims.clientId}`).set(
        {
          nombre: claims.condominio ?? claims.clientId,
          chatGlobalActivo: true,
          createdAt: FieldValue.serverTimestamp(),
        },
        { mergeFields: ['nombre'] },
      );
    }

    const config = await resolveSiteConfig(site);

    // Chat global por clientId: solo si el toggle del sitio está activo y el
    // contacto es del equipo administrador.
    let grupoConversationId: string | undefined;
    if (claims.clientId && config.widget.botonChatEquipo && esAdministrador(claims)) {
      grupoConversationId = await ensureGroupConversation(siteId, claims.clientId, contactId, claims);
    }

    const tokenClaims: Record<string, unknown> = {
      kind: 'contact',
      siteId,
      contactId,
    } satisfies Omit<ContactClaims, 'clientId'>;
    if (claims.clientId) tokenClaims.clientId = claims.clientId;
    const token = await auth.createCustomToken(contactId, tokenClaims);

    const response: WidgetSessionResponse = {
      token,
      contactId,
      siteId,
      clientId: claims.clientId,
      nombre: claims.nombre,
      rol: claims.rol,
      clientNombre: claims.condominio,
      idioma,
      widgetConfig: config.widget,
      botConfig: {
        activo: config.bot.activo,
        nombre: config.bot.nombre,
        avatarUrl: config.bot.avatarUrl,
        saludo: config.bot.saludo,
      },
      scheduleText: scheduleText(config.schedule, idioma),
      enHorario: isWithinSchedule(config.schedule),
      grupoConversationId,
    };
    res.json(response);
  } catch (err) {
    logger.warn('widgetSession rechazada', { message: (err as Error).message });
    res.status(401).json({ error: 'invalid_payload', message: (err as Error).message });
  }
});

async function decryptWithSiteKeys(siteId: string, payload: string): Promise<EncryptedPayloadClaims> {
  const currentSnap = await db.doc(`sites/${siteId}/secrets/current`).get();
  if (!currentSnap.exists) throw new Error('El sitio no tiene clave configurada.');
  const current = currentSnap.data() as SiteSecret;
  try {
    return decryptPayload(current.keyHex, payload);
  } catch {
    // Período de gracia tras rotación.
    const prevSnap = await db.doc(`sites/${siteId}/secrets/previous`).get();
    if (prevSnap.exists) {
      const prev = prevSnap.data() as SiteSecret;
      const validaHasta = prev.validaHasta as { toMillis?: () => number } | undefined;
      if (!validaHasta?.toMillis || validaHasta.toMillis() > Date.now()) {
        return decryptPayload(prev.keyHex, payload);
      }
    }
    throw new Error('No se pudo descifrar el payload con las claves del sitio.');
  }
}

function esAdministrador(claims: EncryptedPayloadClaims): boolean {
  return (claims.rol ?? '').toLowerCase().includes('admin');
}

async function ensureGroupConversation(
  siteId: string,
  clientId: string,
  contactId: string,
  claims: EncryptedPayloadClaims,
): Promise<string> {
  const convId = groupConversationIdFor(siteId, clientId);
  const ref = db.doc(`conversations/${convId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      tipo: 'grupo',
      siteId,
      clientId,
      clientNombre: claims.condominio ?? clientId,
      participantes: [contactId],
      participantesInfo: {
        [contactId]: { nombre: claims.nombre, tipo: 'user', rol: claims.rol ?? '' },
      },
      estado: 'open',
      unread: {},
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } else {
    await ref.update({
      participantes: FieldValue.arrayUnion(contactId),
      [`participantesInfo.${contactId}`]: {
        nombre: claims.nombre,
        tipo: 'user',
        rol: claims.rol ?? '',
      },
    });
  }
  return convId;
}

function stripUndefined(obj: Record<string, unknown>): void {
  for (const k of Object.keys(obj)) if (obj[k] === undefined) delete obj[k];
}
