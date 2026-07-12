import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { FieldValue as AdminFieldValue } from 'firebase-admin/firestore';
import type { KbDoc } from '@aditum-chat/shared';
import { db, storage } from './lib/admin.js';

// Embeddings: Voyage AI (partner recomendado de Anthropic; Claude no genera
// embeddings). El código lee VOYAGE_API_KEY de process.env y, si no está,
// cae a búsqueda por keywords. Es OPCIONAL: para activar vector search, seteá
// el secret (`firebase functions:secrets:set VOYAGE_API_KEY`) y volvé a agregar
// `secrets: [defineSecret('VOYAGE_API_KEY')]` a kbIngestPdf/kbSyncHelpCenter/kbSyncNow.
const VOYAGE_MODEL = 'voyage-3.5-lite';
const EMBEDDING_DIM = 768; // debe coincidir con firestore.indexes.json (vectorConfig)

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;
const TOP_K = 4;

async function embed(apiKey: string, texts: string[], inputType: 'document' | 'query'): Promise<number[][]> {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: texts,
      input_type: inputType,
      output_dimension: EMBEDDING_DIM,
    }),
  });
  if (!res.ok) throw new Error(`Voyage embeddings ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { data: { embedding: number[] }[] };
  return body.data.map((d) => d.embedding);
}

function chunkText(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  const chunks: string[] = [];
  for (let i = 0; i < clean.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
    const chunk = clean.slice(i, i + CHUNK_SIZE).trim();
    if (chunk.length > 50) chunks.push(chunk);
  }
  return chunks;
}

async function indexDoc(docId: string, nombre: string, texto: string): Promise<number> {
  const chunks = chunkText(texto);
  const ref = db.doc(`kb/${docId}`);

  // Limpia chunks previos.
  const prev = await ref.collection('chunks').limit(500).get();
  const batchDel = db.batch();
  prev.docs.forEach((d) => batchDel.delete(d.ref));
  await batchDel.commit();

  const apiKey = process.env.VOYAGE_API_KEY;
  let embeddings: number[][] | null = null;
  if (apiKey) {
    embeddings = [];
    for (let i = 0; i < chunks.length; i += 96) {
      embeddings.push(...(await embed(apiKey, chunks.slice(i, i + 96), 'document')));
    }
  }

  let batch = db.batch();
  chunks.forEach((texto, i) => {
    const data: Record<string, unknown> = { texto, orden: i, fuente: nombre };
    if (embeddings) data.embedding = AdminFieldValue.vector(embeddings[i]);
    batch.set(ref.collection('chunks').doc(`c${String(i).padStart(4, '0')}`), data);
    if ((i + 1) % 400 === 0) {
      void batch.commit();
      batch = db.batch();
    }
  });
  await batch.commit();
  return chunks.length;
}

/**
 * Busca contexto relevante en la KB del sitio (docs con sitio == 'TODOS' o el siteId).
 * Vector search con Voyage + findNearest; fallback por keywords si no hay API key.
 */
export async function searchKb(_anthropicKey: string, siteId: string, query: string): Promise<string> {
  const docsSnap = await db.collection('kb').where('estado', '==', 'indexado').get();
  const docIds = docsSnap.docs
    .filter((d) => {
      const kd = d.data() as KbDoc;
      return kd.sitio === 'TODOS' || kd.sitio === siteId;
    })
    .map((d) => d.id);
  if (docIds.length === 0) return '';

  const apiKey = process.env.VOYAGE_API_KEY;
  const resultados: { texto: string; fuente: string; score: number }[] = [];

  if (apiKey) {
    const [queryVec] = await embed(apiKey, [query], 'query');
    for (const docId of docIds) {
      const vq = db
        .collection(`kb/${docId}/chunks`)
        .findNearest({
          vectorField: 'embedding',
          queryVector: queryVec,
          limit: TOP_K,
          distanceMeasure: 'COSINE',
          distanceResultField: 'distancia',
        });
      const snap = await vq.get();
      snap.docs.forEach((d) => {
        const data = d.data();
        resultados.push({
          texto: data.texto as string,
          fuente: data.fuente as string,
          score: 1 - ((data.distancia as number) ?? 1),
        });
      });
    }
  } else {
    // Fallback dev: scoring simple por keywords.
    const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
    for (const docId of docIds) {
      const snap = await db.collection(`kb/${docId}/chunks`).limit(200).get();
      snap.docs.forEach((d) => {
        const texto = (d.data().texto as string) ?? '';
        const lower = texto.toLowerCase();
        const score = terms.reduce((acc, t) => acc + (lower.includes(t) ? 1 : 0), 0);
        if (score > 0) resultados.push({ texto, fuente: d.data().fuente as string, score });
      });
    }
  }

  return resultados
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K)
    .map((r) => `[${r.fuente}] ${r.texto}`)
    .join('\n---\n');
}

/**
 * Storage trigger: indexa archivos subidos a kb/ — PDF (pdf-parse) y texto
 * plano (.txt/.md). Mantiene el nombre exportado kbIngestPdf para no renombrar
 * la function desplegada.
 */
export const kbIngestPdf = onObjectFinalized(
  { region: 'us-central1', memory: '1GiB', timeoutSeconds: 300 },
  async (event) => {
    const filePath = event.data.name;
    const match = filePath?.match(/^kb\/(.+)\.(pdf|txt|md)$/i);
    if (!match) return;
    const docId = match[1];
    const ext = match[2].toLowerCase();

    // kb/{docId}.{ext} → doc kb/{docId} debe existir (lo crea la consola al subir).
    const ref = db.doc(`kb/${docId}`);
    const snap = await ref.get();
    if (!snap.exists) {
      logger.warn('Archivo sin doc kb correspondiente', { filePath });
      return;
    }
    await ref.update({ estado: 'sincronizando', updatedAt: AdminFieldValue.serverTimestamp() });
    try {
      const [buffer] = await storage.bucket(event.data.bucket).file(filePath!).download();
      let texto: string;
      let paginas: number | undefined;
      if (ext === 'pdf') {
        const pdfParse = (await import('pdf-parse')).default;
        const parsed = await pdfParse(buffer);
        texto = parsed.text;
        paginas = parsed.numpages;
      } else {
        texto = buffer.toString('utf8');
      }
      const chunks = await indexDoc(docId, (snap.data() as KbDoc).nombre, texto);
      await ref.update({
        estado: 'indexado',
        chunks,
        ...(paginas !== undefined ? { paginas } : {}),
        updatedAt: AdminFieldValue.serverTimestamp(),
      });
    } catch (err) {
      logger.error('kbIngestPdf falló', { filePath, message: (err as Error).message });
      await ref.update({ estado: 'error', updatedAt: AdminFieldValue.serverTimestamp() });
    }
  },
);

/** Re-indexa las URLs (centro de ayuda) a diario. */
export const kbSyncHelpCenter = onSchedule(
  { schedule: 'every day 03:00', timeZone: 'America/Costa_Rica', region: 'us-central1', memory: '1GiB', timeoutSeconds: 540 },
  async () => {
    const snap = await db.collection('kb').where('tipo', '==', 'url').get();
    for (const d of snap.docs) {
      await syncUrlDoc(d.id, d.data() as KbDoc).catch((err) =>
        logger.error('kbSyncHelpCenter doc falló', { docId: d.id, message: (err as Error).message }),
      );
    }
  },
);

/** Callable para forzar la sincronización de una URL desde la consola. */
export const kbSyncNow = onCall(
  { region: 'us-central1', timeoutSeconds: 300 },
  async (req) => {
    if (req.auth?.token.kind !== 'agent' || req.auth.token.rol !== 'admin') {
      throw new HttpsError('permission-denied', 'Solo admins.');
    }
    const { docId } = req.data as { docId: string };
    const snap = await db.doc(`kb/${docId}`).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Documento no encontrado.');
    await syncUrlDoc(docId, snap.data() as KbDoc);
    return { ok: true };
  },
);

async function syncUrlDoc(docId: string, doc: KbDoc): Promise<void> {
  if (doc.tipo !== 'url' || !doc.url) return;
  const ref = db.doc(`kb/${docId}`);
  await ref.update({ estado: 'sincronizando', updatedAt: AdminFieldValue.serverTimestamp() });
  try {
    const res = await fetch(doc.url, { headers: { 'User-Agent': 'aditum-chat-kb/1.0' } });
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const html = await res.text();
    // Extracción simple de texto (sin dependencias pesadas).
    const texto = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ');
    const chunks = await indexDoc(docId, doc.nombre, texto);
    await ref.update({ estado: 'indexado', chunks, updatedAt: AdminFieldValue.serverTimestamp() });
  } catch (err) {
    await ref.update({ estado: 'error', updatedAt: AdminFieldValue.serverTimestamp() });
    throw err;
  }
}
