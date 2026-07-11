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
 * si sigue en período de gracia), hace upsert del contacto, del cliente y del
 * grupo (organización), garantiza el chat grupal del groupId cuando el host lo
 * habilita y devuelve un custom token.
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

    const idioma: Idioma = claims.language === 'en' ? 'en' : 'es';
    const contactId = contactIdFor(siteId, claims.userId);

    // Upsert del contacto (directorio automático).
    const contactRef = db.doc(`contacts/${contactId}`);
    const contactSnap = await contactRef.get();
    const base: Partial<Contact> = {
      externalId: claims.userId,
      siteId,
      clientId: claims.clientId,
      groupId: claims.groupId,
      groupName: claims.groupName,
      nombre: claims.name,
      email: claims.email,
      rol: claims.role,
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

    // Upsert del cliente/condominio: nombre + metadatos del panel de contexto
    // (solo los campos que el host declara — last-write-wins, preserva el resto).
    if (claims.clientId) {
      const info = claims.clientInfo ?? {};
      const clientData: Record<string, unknown> = {
        nombre: claims.clientName ?? claims.clientId,
      };
      if (info.location !== undefined) clientData.ubicacion = info.location;
      if (info.units !== undefined) clientData.filiales = info.units;
      if (info.plan !== undefined) clientData.plan = info.plan;
      if (info.customerSince !== undefined) clientData.clienteDesde = info.customerSince;
      if (info.modules !== undefined) clientData.modulos = info.modules;
      await db.doc(`clients/${claims.clientId}`).set(clientData, { merge: true });
    }

    // Upsert del grupo (organización): nombre, flag de chat y lista de unidades
    // que administra. Last-write-wins con lo que declara el host en cada sesión.
    if (claims.groupId) {
      await upsertGroup(siteId, claims);
    }

    const config = await resolveSiteConfig(site);

    // Chat grupal por groupId: el host dicta si el grupo lo tiene contratado
    // (groupChatEnabled); botonChatEquipo queda como kill-switch del sitio y
    // solo aplica a admins.
    let grupoConversationId: string | undefined;
    if (
      claims.groupId &&
      claims.groupChatEnabled === true &&
      config.widget.botonChatEquipo &&
      esAdministrador(claims)
    ) {
      grupoConversationId = await ensureGroupConversation(siteId, claims.groupId, contactId, claims);
    }

    const tokenClaims: Record<string, unknown> = {
      kind: 'contact',
      siteId,
      contactId,
    } satisfies Omit<ContactClaims, 'clientId' | 'groupId'>;
    if (claims.clientId) tokenClaims.clientId = claims.clientId;
    if (claims.groupId) tokenClaims.groupId = claims.groupId;
    const token = await auth.createCustomToken(contactId, tokenClaims);

    const response: WidgetSessionResponse = {
      token,
      contactId,
      siteId,
      clientId: claims.clientId,
      nombre: claims.name,
      rol: claims.role,
      clientNombre: claims.clientName,
      groupId: claims.groupId,
      groupName: claims.groupName,
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
  return (claims.role ?? '').toLowerCase().includes('admin');
}

/** Upsert de groups/{groupId} preservando createdAt. */
async function upsertGroup(siteId: string, claims: EncryptedPayloadClaims): Promise<void> {
  const ref = db.doc(`groups/${claims.groupId}`);
  const snap = await ref.get();
  const data: Record<string, unknown> = {
    siteId,
    name: claims.groupName ?? claims.groupId,
    chatEnabled: claims.groupChatEnabled === true,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (claims.groupClients) data.clients = claims.groupClients;
  if (snap.exists) {
    await ref.set(data, { merge: true });
  } else {
    await ref.set({ clients: [], ...data, createdAt: FieldValue.serverTimestamp() });
  }
}

/**
 * El chat grupal se segmenta como las directas: varias conversaciones por
 * grupo, la activa = la más reciente no resuelta. Esta función NO crea
 * segmentos nuevos vacíos (eso ocurre al escribir); solo garantiza el canal la
 * primera vez y agrega a este admin como participante de TODOS los segmentos
 * (para que pueda leer el historial), devolviendo el más reciente.
 */
async function ensureGroupConversation(
  siteId: string,
  groupId: string,
  contactId: string,
  claims: EncryptedPayloadClaims,
): Promise<string> {
  const info = { nombre: claims.name, tipo: 'user', rol: claims.role ?? '' };
  const snap = await db
    .collection('conversations')
    .where('tipo', '==', 'grupo')
    .where('groupId', '==', groupId)
    .orderBy('updatedAt', 'desc')
    .limit(20)
    .get();

  if (snap.empty) {
    // Primera vez: crea el segmento base con id determinístico.
    const convId = groupConversationIdFor(siteId, groupId);
    await db.doc(`conversations/${convId}`).set({
      tipo: 'grupo',
      siteId,
      groupId,
      groupName: claims.groupName ?? groupId,
      participantes: [contactId],
      participantesInfo: { [contactId]: info },
      estado: 'open',
      unread: {},
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return convId;
  }

  // Suma a este admin a todos los segmentos existentes (acceso al historial).
  const batch = db.batch();
  for (const d of snap.docs) {
    batch.update(d.ref, {
      participantes: FieldValue.arrayUnion(contactId),
      [`participantesInfo.${contactId}`]: info,
    });
  }
  await batch.commit();
  return snap.docs[0].id; // el más reciente (activo o resuelto)
}

function stripUndefined(obj: Record<string, unknown>): void {
  for (const k of Object.keys(obj)) if (obj[k] === undefined) delete obj[k];
}
