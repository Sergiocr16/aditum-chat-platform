import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { db, FieldValue } from './lib/admin.js';
import { decryptJson, encryptJson } from './lib/crypto.js';

// El deviceToken del payload pertenece al proyecto Firebase del HOST (p. ej. la
// app móvil de Aditum), no a este proyecto. Para enviar push hay que usar el
// service account de ESE proyecto. Se guarda cifrado (AES-256-GCM con una KEK
// interna) en sites/{siteId}/secrets/fcm — subcolección denegada a clientes.

const configKek = defineSecret('CONFIG_KEK');

/** KEK de 32 bytes (hex de 64). En emulador hay un fallback fijo de desarrollo. */
export function getKek(): string {
  const kek = process.env.CONFIG_KEK;
  if (kek && /^[0-9a-f]{64}$/i.test(kek.trim())) return kek.trim();
  if (process.env.FUNCTIONS_EMULATOR) return 'c'.repeat(64);
  throw new HttpsError(
    'failed-precondition',
    'Falta el secret CONFIG_KEK (hex de 64). Configuralo con: firebase functions:secrets:set CONFIG_KEK',
  );
}

interface ServiceAccountJson {
  type?: string;
  project_id?: string;
  client_email?: string;
  private_key?: string;
  [k: string]: unknown;
}

/**
 * Guarda (o elimina) el service account del proyecto Firebase del host para un
 * sitio, cifrado. Solo admins. Devuelve la info enmascarada para mostrar.
 */
export const setSiteFcmCredentials = onCall(
  { region: 'us-central1', secrets: [configKek] },
  async (req) => {
    if (req.auth?.token.kind !== 'agent' || req.auth.token.rol !== 'admin') {
      throw new HttpsError('permission-denied', 'Solo admins.');
    }
    const { siteId, serviceAccountJson, eliminar } = req.data as {
      siteId: string;
      serviceAccountJson?: string;
      eliminar?: boolean;
    };
    const siteRef = db.doc(`sites/${siteId}`);
    if (!(await siteRef.get()).exists) throw new HttpsError('not-found', 'Sitio no encontrado.');

    if (eliminar) {
      await siteRef.collection('secrets').doc('fcm').delete();
      await siteRef.update({ pushInfo: null, pushActivo: false });
      return { ok: true };
    }

    let sa: ServiceAccountJson;
    try {
      sa = JSON.parse(serviceAccountJson ?? '');
    } catch {
      throw new HttpsError('invalid-argument', 'El JSON no es válido.');
    }
    if (sa.type !== 'service_account' || !sa.project_id || !sa.client_email || !sa.private_key) {
      throw new HttpsError(
        'invalid-argument',
        'Ese archivo no parece un service account de Firebase (esperaba type, project_id, client_email y private_key). Descargalo en Consola de Firebase → Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada.',
      );
    }

    // Cifrado con la KEK interna (mismo esquema AES-256-GCM del payload).
    const cipher = encryptJson(getKek(), sa);

    await siteRef.collection('secrets').doc('fcm').set({
      cipher,
      enc: 'aes-256-gcm+kek',
      projectId: sa.project_id,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const pushInfo = { projectId: sa.project_id, clientEmail: sa.client_email };
    await siteRef.update({ pushInfo, pushActivo: true });
    return { ok: true, pushInfo };
  },
);

/** Descifra el service account de un sitio; null si no está configurado. */
export async function getSiteServiceAccount(siteId: string): Promise<ServiceAccountJson | null> {
  const snap = await db.doc(`sites/${siteId}/secrets/fcm`).get();
  if (!snap.exists) return null;
  const { cipher } = snap.data() as { cipher: string };
  return decryptJson<ServiceAccountJson>(getKek(), cipher);
}
