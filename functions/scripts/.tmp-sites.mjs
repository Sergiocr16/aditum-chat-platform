import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const snap = await db.collection('sites').get();
for (const d of snap.docs) {
  const s = d.data();
  const secrets = await d.ref.collection('secrets').listDocuments();
  console.log(`${d.id} · nombre="${s.nombre}" · pushInfo=${s.pushInfo?.projectId ?? '—'} · secrets=[${secrets.map((r) => r.id).join(', ')}]`);
}
process.exit(0);
