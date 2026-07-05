// Verificación headless del flujo de la CONSOLA contra los emuladores:
// login de agente → inbox → responder → nota interna → createTicket (callable).
// Uso: node scripts/verify-console-flow.mjs   (emuladores + seed corriendo)

import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  addDoc, collection, connectFirestoreEmulator, doc, getDoc, getDocs,
  getFirestore, limit, orderBy, query, serverTimestamp, where,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ✔ ${n}`); };
const bad = (n, e) => { fail++; console.log(`  ✘ ${n}: ${e?.message ?? e}`); };
async function expectOk(n, fn) { try { const r = await fn(); ok(n); return r; } catch (e) { bad(n, e); } }

const app = initializeApp({ projectId: 'demo-aditum-chat', apiKey: 'demo', appId: 'demo' });
const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9101', { disableWarnings: true });
const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8181);
const fns = getFunctions(app, 'us-central1'); connectFunctionsEmulator(fns, '127.0.0.1', 5201);

await signInWithEmailAndPassword(auth, 'laura@aditumcr.com', 'aditum123');
console.log('Como AGENTE (Laura):');

await expectOk('leer inbox (todas, ordenado)', async () => {
  const s = await getDocs(query(collection(db, 'conversations'), orderBy('updatedAt', 'desc'), limit(50)));
  if (s.empty) throw new Error('inbox vacío');
});

await expectOk('filtro estado=bot', async () => {
  const s = await getDocs(query(collection(db, 'conversations'), where('estado', '==', 'bot'), orderBy('updatedAt', 'desc')));
  if (s.empty) throw new Error('sin conversaciones bot');
});

await expectOk('ver notas internas en mensajes', async () => {
  const s = await getDocs(collection(db, 'tickets/tk-0042/notas'));
  if (s.empty) throw new Error('sin notas');
});

await expectOk('responder una conversación', () =>
  addDoc(collection(db, 'conversations/conv-juan-cobros/messages'), {
    sender: { tipo: 'agent', id: auth.currentUser.uid, nombre: 'Laura de Aditum' },
    texto: 'Respuesta de prueba de la consola', tipoContenido: 'texto', createdAt: serverTimestamp(),
  }));

await expectOk('nota interna en conversación', () =>
  addDoc(collection(db, 'conversations/conv-juan-cobros/messages'), {
    sender: { tipo: 'agent', id: auth.currentUser.uid, nombre: 'Laura de Aditum' },
    texto: 'Nota interna de prueba', tipoContenido: 'texto', interno: true, createdAt: serverTimestamp(),
  }));

await expectOk('leer settings y sitios', async () => {
  const g = await getDoc(doc(db, 'settings/global'));
  const s = await getDocs(collection(db, 'sites'));
  if (!g.exists() || s.empty) throw new Error('faltan settings/sites');
});

const res = await expectOk('createTicket callable con numeración', async () => {
  const call = httpsCallable(fns, 'createTicket');
  const { data } = await call({
    siteId: 'app-aditum',
    clientId: 'vistas-del-este',
    clientNombre: 'Condominio Vistas del Este',
    contactId: 'app-aditum_usr_1001',
    contactNombre: 'Juan Rodríguez',
    conversationId: 'conv-juan-cobros',
    asunto: 'Ticket de prueba e2e',
    descripcion: 'Creado por verify-console-flow',
    prioridad: 'media',
    publico: false,
    ambito: 'cliente',
    asignadoA: auth.currentUser.uid,
    asignadoNombre: 'Laura Campos',
  });
  if (data.numero !== 43) throw new Error(`número esperado 43, vino ${data.numero}`);
  return data;
});

if (res) {
  await expectOk('historial del ticket creado', async () => {
    const s = await getDocs(collection(db, `tickets/${res.ticketId}/historial`));
    if (s.size < 2) throw new Error('historial incompleto');
  });
  await expectOk('chip de ticket en la conversación', async () => {
    const s = await getDocs(query(collection(db, 'conversations/conv-juan-cobros/messages'), orderBy('createdAt', 'desc'), limit(3)));
    if (!s.docs.some((d) => d.data().ticketRef?.ticketId === res.ticketId)) throw new Error('sin chip');
  });
}

console.log(`\nResultado: ${pass} ✔ · ${fail} ✘`);
process.exit(fail ? 1 : 0);
