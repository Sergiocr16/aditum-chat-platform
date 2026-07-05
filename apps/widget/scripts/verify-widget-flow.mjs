// Verificación headless del flujo del widget contra los emuladores:
// payload cifrado → widgetSession → signInWithCustomToken → Firestore con rules.
// Uso: node scripts/verify-widget-flow.mjs   (emuladores + seed corriendo)

import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithCustomToken } from 'firebase/auth';
import {
  addDoc, collection, connectFirestoreEmulator, doc, getDoc, getDocs,
  getFirestore, limit, orderBy, query, serverTimestamp, setDoc, updateDoc, where,
} from 'firebase/firestore';

const FN = 'http://127.0.0.1:5201/demo-aditum-chat/us-central1';
let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`  ✔ ${name}`); };
const bad = (name, e) => { fail++; console.log(`  ✘ ${name}: ${e?.message ?? e}`); };

async function expectOk(name, fn) { try { const r = await fn(); ok(name); return r; } catch (e) { bad(name, e); } }
async function expectDenied(name, fn) {
  try { await fn(); bad(name, 'debió ser DENEGADO y pasó'); }
  catch (e) { /permission|insufficient/i.test(String(e?.code ?? e?.message)) ? ok(name) : bad(name, e); }
}

// Sesión de Juan (admin de Vistas del Este en app-aditum).
const demoRes = await fetch(`${FN}/demoPayload?user=juan`);
const { siteId, payload } = await demoRes.json();
const sessionRes = await fetch(`${FN}/widgetSession`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ siteId, payload }),
});
const session = await sessionRes.json();
console.log(`Sesión: ${session.contactId} (${session.clientId}) idioma=${session.idioma} grupo=${session.grupoConversationId}`);

const app = initializeApp({ projectId: 'demo-aditum-chat', apiKey: 'demo', appId: 'demo' });
const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9101', { disableWarnings: true });
const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8181);
await signInWithCustomToken(auth, session.token);
console.log('\nComo CONTACTO (Juan):');

await expectOk('leer mi conversación directa', async () => {
  const q = query(collection(db, 'conversations'),
    where('tipo', '==', 'directa'), where('contactId', '==', session.contactId),
    orderBy('updatedAt', 'desc'), limit(1));
  const s = await getDocs(q);
  if (s.empty) throw new Error('sin conversación (¿seed?)');
  return s.docs[0].id;
});

await expectOk('leer mensajes y NO ver notas internas', async () => {
  const s = await getDocs(query(collection(db, 'conversations/conv-juan-cobros/messages'), orderBy('createdAt', 'asc')));
  if (s.docs.some((d) => d.data().interno)) throw new Error('vio nota interna');
  if (s.empty) throw new Error('sin mensajes');
});

await expectOk('enviar mensaje en mi conversación', () =>
  addDoc(collection(db, 'conversations/conv-juan-cobros/messages'), {
    sender: { tipo: 'user', id: session.contactId, nombre: 'Juan Rodríguez' },
    texto: 'Mensaje de prueba headless', tipoContenido: 'texto', createdAt: serverTimestamp(),
  }));

await expectOk('leer el chat global de mi cliente', () =>
  getDoc(doc(db, `conversations/${session.grupoConversationId}`)).then((s) => {
    if (!s.exists()) throw new Error('no existe');
  }));

await expectOk('escribir en el chat global', () =>
  addDoc(collection(db, `conversations/${session.grupoConversationId}/messages`), {
    sender: { tipo: 'user', id: session.contactId, nombre: 'Juan Rodríguez' },
    texto: 'Hola equipo (prueba)', tipoContenido: 'texto', createdAt: serverTimestamp(),
  }));

await expectDenied('NO leer conversación de otro contacto', () =>
  getDoc(doc(db, 'conversations/conv-ana-reservas')));

await expectOk('leer mis tickets', async () => {
  const s = await getDocs(query(collection(db, 'tickets'),
    where('contactId', '==', session.contactId), orderBy('updatedAt', 'desc')));
  if (s.empty) throw new Error('sin tickets');
});

await expectOk('leer tickets públicos del sistema', async () => {
  const s = await getDocs(query(collection(db, 'tickets'),
    where('publico', '==', true), where('ambito', '==', 'sistema'), orderBy('updatedAt', 'desc')));
  if (s.empty) throw new Error('sin tickets de sistema');
});

await expectDenied('NO leer notas internas de un ticket', () =>
  getDocs(collection(db, 'tickets/tk-0042/notas')));

await expectDenied('NO crear ticket directamente', () =>
  setDoc(doc(db, 'tickets/tk-hack'), { numero: 999, asunto: 'hack', estado: 'abierto' }));

await expectDenied('NO leer settings', () => getDoc(doc(db, 'settings/global')));

await expectDenied('NO leer claves del sitio', () =>
  getDoc(doc(db, 'sites/app-aditum/secrets/current')));

await expectOk('historial de ticket propio visible', async () => {
  const s = await getDocs(collection(db, 'tickets/tk-0042/historial'));
  if (s.empty) throw new Error('sin historial');
});

// Payload expirado debe rechazarse.
const expiredRes = await fetch(`${FN}/widgetSession`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ siteId, payload: 'AAAA' + payload.slice(4) }),
});
expiredRes.status === 401 ? ok('payload alterado → 401') : bad('payload alterado', `status ${expiredRes.status}`);

console.log(`\nResultado: ${pass} ✔ · ${fail} ✘`);
process.exit(fail ? 1 : 0);
