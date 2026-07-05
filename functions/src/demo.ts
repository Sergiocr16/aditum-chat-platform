import { onRequest } from 'firebase-functions/v2/https';
import type { EncryptedPayloadClaims, SiteSecret } from '@aditum-chat/shared';
import { db } from './lib/admin.js';
import { encryptPayload } from './lib/crypto.js';

// SOLO EMULADOR: genera el payload cifrado que en producción crea el server
// del host (Aditum). Permite probar el widget end-to-end sin backend del host.

const DEMO_USERS: Record<string, Omit<EncryptedPayloadClaims, 'iat' | 'exp'>> = {
  juan: {
    userId: 'usr_1001',
    nombre: 'Juan Rodríguez',
    email: 'jrodriguez@vistasdeleste.cr',
    rol: 'Administrador',
    condominio: 'Condominio Vistas del Este',
    clientId: 'vistas-del-este',
    idioma: 'es',
  },
  roberto: {
    userId: 'usr_1002',
    nombre: 'Roberto Jiménez',
    email: 'rjimenez@vistasdeleste.cr',
    rol: 'Administrador',
    condominio: 'Condominio Vistas del Este',
    clientId: 'vistas-del-este',
    idioma: 'es',
  },
  ana: {
    userId: 'usr_2001',
    nombre: 'Ana Brenes',
    email: 'ana.brenes@gmail.com',
    rol: 'Residente (filial B-14)',
    condominio: 'Torres de Sabana',
    clientId: 'torres-de-sabana',
    idioma: 'en',
  },
};

export const demoPayload = onRequest({ cors: true }, async (req, res) => {
  if (!process.env.FUNCTIONS_EMULATOR) {
    res.status(403).json({ error: 'solo_emulador' });
    return;
  }
  const user = DEMO_USERS[(req.query.user as string) ?? 'juan'] ?? DEMO_USERS.juan;
  const siteId = (req.query.siteId as string) ?? 'app-aditum';
  const secretSnap = await db.doc(`sites/${siteId}/secrets/current`).get();
  if (!secretSnap.exists) {
    res.status(404).json({ error: 'sin_clave', message: 'Corré el seed primero.' });
    return;
  }
  const { keyHex } = secretSnap.data() as SiteSecret;
  const now = Math.floor(Date.now() / 1000);
  const payload = encryptPayload(keyHex, { ...user, iat: now, exp: now + 300 });
  res.json({ siteId, payload });
});
