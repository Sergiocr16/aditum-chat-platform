// Simulador del backend del host (Aditum) para probar el widget contra PRODUCCIÓN.
// Genera el payload cifrado con la clave real del sitio, igual que lo haría tu
// server. La página standalone (modo Producción) le pide el payload a este endpoint.
//   GOOGLE_APPLICATION_CREDENTIALS=<sa.json> node scripts/host-sim.mjs
// Escucha en http://127.0.0.1:4186/payload?user=juan|roberto|ana

import { createServer } from 'node:http';
import { createCipheriv, randomBytes } from 'node:crypto';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT = 'aditum-chat-1a5cd';
const SITE_ID = 'app-aditum';
const PORT = 4186;

const GROUP = {
  groupId: 'adm-horizonte',
  groupName: 'Administradora Horizonte',
  groupChatEnabled: true,
  groupClients: [
    { id: 'vistas-del-este', name: 'Condominio Vistas del Este' },
    { id: 'hacienda-real-cariari', name: 'Hacienda Real Cariari' },
  ],
};

const VISTAS_INFO = { location: 'Curridabat, San José', units: 148, plan: 'Empresarial', customerSince: 2023, modules: ['Cobros', 'Reservas', 'Mant.'] };

const USERS = {
  juan: { userId: 'usr_1001', name: 'Juan Rodríguez', email: 'jrodriguez@vistasdeleste.cr', role: 'Administrador', clientId: 'vistas-del-este', clientName: 'Condominio Vistas del Este', clientInfo: VISTAS_INFO, ...GROUP, language: 'es' },
  roberto: { userId: 'usr_1002', name: 'Roberto Jiménez', email: 'rjimenez@vistasdeleste.cr', role: 'Administrador', clientId: 'vistas-del-este', clientName: 'Condominio Vistas del Este', clientInfo: VISTAS_INFO, ...GROUP, language: 'es' },
  ana: { userId: 'usr_2001', name: 'Ana Brenes', email: 'ana.brenes@gmail.com', role: 'Residente (filial B-14)', clientId: 'torres-de-sabana', clientName: 'Torres de Sabana', clientInfo: { location: 'Sabana, San José', units: 96, plan: 'Empresarial', customerSince: 2024, modules: ['Cobros', 'Reservas'] }, language: 'en' },
};

// Site key: SITE_KEY_HEX env (sin credenciales) o lectura de Firestore prod
// (requiere GOOGLE_APPLICATION_CREDENTIALS / ADC).
let keyHex = process.env.SITE_KEY_HEX?.trim();
if (!keyHex) {
  initializeApp({ projectId: PROJECT, credential: applicationDefault() });
  const db = getFirestore();
  ({ keyHex } = (await db.doc(`sites/${SITE_ID}/secrets/current`).get()).data() ?? {});
}
if (!keyHex) { console.error('No hay clave del sitio en prod. ¿Seedeaste?'); process.exit(1); }
const key = Buffer.from(keyHex, 'hex');

function encrypt(claims) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(claims), 'utf8'), c.final()]);
  return Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64');
}

createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/payload') { res.statusCode = 404; return res.end('nope'); }
  const user = USERS[url.searchParams.get('user') ?? 'juan'] ?? USERS.juan;
  // Push testing: FCM device token via ?deviceToken=… (or DEVICE_TOKEN env default).
  const deviceToken = url.searchParams.get('deviceToken') || process.env.DEVICE_TOKEN || '';
  const now = Math.floor(Date.now() / 1000);
  const payload = encrypt({
    ...user,
    ...(deviceToken ? { deviceToken } : {}),
    iat: now,
    exp: now + 300,
  });
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ siteId: SITE_ID, payload }));
}).listen(PORT, '127.0.0.1', () => console.log(`host-sim en http://127.0.0.1:${PORT}/payload (paylods de PRODUCCIÓN)`));
