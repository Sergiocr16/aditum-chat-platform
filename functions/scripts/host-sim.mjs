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

const USERS = {
  juan: { userId: 'usr_1001', nombre: 'Juan Rodríguez', email: 'jrodriguez@vistasdeleste.cr', rol: 'Administrador', condominio: 'Condominio Vistas del Este', clientId: 'vistas-del-este', idioma: 'es' },
  roberto: { userId: 'usr_1002', nombre: 'Roberto Jiménez', email: 'rjimenez@vistasdeleste.cr', rol: 'Administrador', condominio: 'Condominio Vistas del Este', clientId: 'vistas-del-este', idioma: 'es' },
  ana: { userId: 'usr_2001', nombre: 'Ana Brenes', email: 'ana.brenes@gmail.com', rol: 'Residente (filial B-14)', condominio: 'Torres de Sabana', clientId: 'torres-de-sabana', idioma: 'en' },
};

initializeApp({ projectId: PROJECT, credential: applicationDefault() });
const db = getFirestore();
const { keyHex } = (await db.doc(`sites/${SITE_ID}/secrets/current`).get()).data() ?? {};
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
  const now = Math.floor(Date.now() / 1000);
  const payload = encrypt({ ...user, iat: now, exp: now + 300 });
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ siteId: SITE_ID, payload }));
}).listen(PORT, '127.0.0.1', () => console.log(`host-sim en http://127.0.0.1:${PORT}/payload (paylods de PRODUCCIÓN)`));
