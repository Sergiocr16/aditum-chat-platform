// Empties the demo CONTENT from the local emulator while keeping the base
// operational: sites (+encryption keys), team accounts, settings and tags stay;
// conversations, tickets, contacts, clients, groups, KB, votes and metrics go.
//   node functions/scripts/clean.mjs
// Emulator-only by design (never touches prod).

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8181';

initializeApp({ projectId: 'demo-aditum-chat' });
const db = getFirestore();

// Collections with subcollections (messages, historial, chunks…) need recursive delete.
const RECURSIVE = ['conversations', 'tickets', 'kb'];
const FLAT = [
  'contacts',
  'clients',
  'groups',
  'csat',
  'bot_feedback',
  'metrics_daily',
  'notifications',
  'counters',
];

console.log('Limpiando contenido demo del emulador…');
for (const col of RECURSIVE) {
  const docs = await db.collection(col).listDocuments();
  for (const ref of docs) await db.recursiveDelete(ref);
  console.log(`  ${col}: ${docs.length} docs`);
}
for (const col of FLAT) {
  const docs = await db.collection(col).listDocuments();
  if (docs.length > 0) {
    const batch = db.batch();
    docs.forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
  console.log(`  ${col}: ${docs.length} docs`);
}
console.log('✔ Base vacía y operativa (sitios, claves, agentes y settings intactos).');
process.exit(0);
