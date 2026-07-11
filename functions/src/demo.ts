import { onRequest } from 'firebase-functions/v2/https';
import type { EncryptedPayloadClaims, SiteSecret } from '@aditum-chat/shared';
import { db } from './lib/admin.js';
import { encryptPayload } from './lib/crypto.js';

// SOLO EMULADOR: genera el payload cifrado que en producción crea el server
// del host (Aditum). Permite probar el widget end-to-end sin backend del host.

const DEMO_GROUP = {
  groupId: 'adm-horizonte',
  groupName: 'Administradora Horizonte',
  groupChatEnabled: true,
  groupClients: [
    { id: 'vistas-del-este', name: 'Condominio Vistas del Este' },
    { id: 'hacienda-real-cariari', name: 'Hacienda Real Cariari' },
  ],
};

const DEMO_USERS: Record<string, Omit<EncryptedPayloadClaims, 'iat' | 'exp'>> = {
  juan: {
    userId: 'usr_1001',
    name: 'Juan Rodríguez',
    email: 'jrodriguez@vistasdeleste.cr',
    role: 'Administrador',
    clientId: 'vistas-del-este',
    clientName: 'Condominio Vistas del Este',
    clientInfo: {
      location: 'Curridabat, San José',
      units: 148,
      plan: 'Empresarial',
      customerSince: 2023,
      modules: ['Cobros', 'Reservas', 'Mant.'],
    },
    ...DEMO_GROUP,
    language: 'es',
  },
  roberto: {
    userId: 'usr_1002',
    name: 'Roberto Jiménez',
    email: 'rjimenez@vistasdeleste.cr',
    role: 'Administrador',
    clientId: 'vistas-del-este',
    clientName: 'Condominio Vistas del Este',
    clientInfo: {
      location: 'Curridabat, San José',
      units: 148,
      plan: 'Empresarial',
      customerSince: 2023,
      modules: ['Cobros', 'Reservas', 'Mant.'],
    },
    ...DEMO_GROUP,
    language: 'es',
  },
  ana: {
    userId: 'usr_2001',
    name: 'Ana Brenes',
    email: 'ana.brenes@gmail.com',
    role: 'Residente (filial B-14)',
    clientId: 'torres-de-sabana',
    clientName: 'Torres de Sabana',
    clientInfo: {
      location: 'Sabana, San José',
      units: 96,
      plan: 'Empresarial',
      customerSince: 2024,
      modules: ['Cobros', 'Reservas'],
    },
    language: 'en',
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
