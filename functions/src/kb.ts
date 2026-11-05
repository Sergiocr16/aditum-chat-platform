import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { FieldValue as AdminFieldValue, type DocumentReference } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import type { KbDoc } from '@aditum-chat/shared';
import { embed, KB_EMBEDDINGS } from './embeddings.js';
import type { EvidenceSource } from './evidence.js';
import { db, storage } from './lib/admin.js';
import { requireActiveAdmin } from './lib/guards.js';
import { isKbDocId, ownKbFile } from './kbPaths.js';

// Embeddings via Voyage (Claude doesn't generate them). Without VOYAGE_API_KEY
// (local dev) the KB falls back to keyword search.
const voyageApiKey = defineSecret('VOYAGE_API_KEY');

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;
const TOP_K = 4;

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
  const prev = await ref.collection('chunks').select().get();
  for (let i = 0; i < prev.docs.length; i += 400) {
    const batchDel = db.batch();
    prev.docs.slice(i, i + 400).forEach((d) => batchDel.delete(d.ref));
    await batchDel.commit();
  }

  const apiKey = process.env.VOYAGE_API_KEY;
  let embeddings: number[][] | null = null;
  if (apiKey) {
    embeddings = [];
    for (let i = 0; i < chunks.length; i += 96) {
      embeddings.push(...(await embed(apiKey, KB_EMBEDDINGS, chunks.slice(i, i + 96), 'document')));
    }
  }

  for (let start = 0; start < chunks.length; start += 400) {
    const batch = db.batch();
    chunks.slice(start, start + 400).forEach((texto, offset) => {
      const i = start + offset;
      const data: Record<string, unknown> = { texto, orden: i, fuente: nombre };
      if (embeddings) data.embedding = AdminFieldValue.vector(embeddings[i]);
      batch.set(ref.collection('chunks').doc(`c${String(i).padStart(4, '0')}`), data);
    });
    await batch.commit();
  }
  return chunks.length;
}

/**
 * Finds relevant KB fragments for a site (docs with sitio == 'TODOS' or the siteId).
 * A doc whose chunks have no embedding yet (indexed before Voyage was enabled) is
 * searched by keyword, so turning vectors on doesn't hide it until it's reindexed.
 */
export async function searchKbSources(siteId: string, query: string): Promise<EvidenceSource[]> {
  const docsSnap = await db.collection('kb').where('estado', '==', 'indexado').get();
  const docIds = docsSnap.docs
    .filter((d) => {
      const kd = d.data() as KbDoc;
      return kd.sitio === 'TODOS' || kd.sitio === siteId;
    })
    .map((d) => d.id);
  if (docIds.length === 0) return [];

  const apiKey = process.env.VOYAGE_API_KEY;
  const queryVec = apiKey ? (await embed(apiKey, KB_EMBEDDINGS, [query], 'query'))[0] : null;
  const terms = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 3);
  const resultados: (EvidenceSource & { score: number })[] = [];

  const push = (docId: string, chunkId: string, data: FirebaseFirestore.DocumentData, score: number) => {
    const fuente = (data.fuente as string) ?? 'KB';
    resultados.push({
      id: `kb:${docId}/${chunkId}`,
      kind: 'kb',
      title: fuente,
      text: (data.texto as string) ?? '',
      ref: fuente,
      score,
    });
  };

  for (const docId of docIds) {
    const chunks = db.collection(`kb/${docId}/chunks`);
    if (queryVec) {
      const snap = await chunks
        .findNearest({
          vectorField: 'embedding',
          queryVector: queryVec,
          limit: TOP_K,
          distanceMeasure: 'COSINE',
          distanceResultField: 'distancia',
        })
        .get();
      if (!snap.empty) {
        snap.docs.forEach((d) => push(docId, d.id, d.data(), 1 - ((d.data().distancia as number) ?? 1)));
        continue;
      }
    }
    const snap = await chunks.limit(200).get();
    snap.docs.forEach((d) => {
      const lower = ((d.data().texto as string) ?? '').toLowerCase();
      const hits = terms.reduce((acc, t) => acc + (lower.includes(t) ? 1 : 0), 0);
      // Normalized to 0-1 so keyword hits rank alongside vector similarity.
      if (hits > 0) push(docId, d.id, d.data(), hits / Math.max(terms.length, 1));
    });
  }

  return resultados
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K)
    .map(({ score: _score, ...source }) => source);
}

/** Plain-text form for callers that don't cite (`aiAssist`). */
export async function searchKb(siteId: string, query: string): Promise<string> {
  const sources = await searchKbSources(siteId, query);
  return sources.map((s) => `[${s.title}] ${s.text}`).join('\n---\n');
}

/**
 * Storage trigger: indexa archivos subidos a kb/ — PDF (pdf-parse) y texto
 * plano (.txt/.md). Mantiene el nombre exportado kbIngestPdf para no renombrar
 * la function desplegada.
 */
export const kbIngestPdf = onObjectFinalized(
  { region: 'us-central1', memory: '1GiB', timeoutSeconds: 300, secrets: [voyageApiKey] },
  async (event) => {
    const filePath = event.data.name;
    const match = filePath?.match(/^kb\/(.+)\.(pdf|txt|md)$/i);
    if (!match) return;
    await ingestStoredFile(match[1], filePath!, match[2].toLowerCase(), event.data.bucket);
  },
);

/** Indexes a file already in Storage; the kb/{docId} doc must exist (the console creates it on upload). */
async function ingestStoredFile(docId: string, filePath: string, ext: string, bucket?: string): Promise<void> {
  const ref = db.doc(`kb/${docId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    logger.warn('Archivo sin doc kb correspondiente', { filePath });
    return;
  }
  await ref.update({ estado: 'sincronizando', updatedAt: AdminFieldValue.serverTimestamp() });
  try {
    const target = bucket ? storage.bucket(bucket) : storage.bucket();
    const [buffer] = await target.file(filePath).download();
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
    await finishIndexing(ref, { estado: 'indexado', chunks, ...(paginas !== undefined ? { paginas } : {}) });
  } catch (err) {
    logger.error('kbIngestPdf falló', { filePath, message: (err as Error).message });
    await finishIndexing(ref, { estado: 'error' });
  }
}

/**
 * Records how an indexing run ended. A doc deleted while it was being indexed gets
 * nothing recorded, and the chunks that run wrote go with it.
 */
async function finishIndexing(ref: DocumentReference, fields: Record<string, unknown>): Promise<void> {
  if ((await ref.get()).exists) {
    await ref.update({ ...fields, updatedAt: AdminFieldValue.serverTimestamp() });
  } else {
    await db.recursiveDelete(ref);
  }
}

/** Re-indexa las URLs (centro de ayuda) a diario. */
export const kbSyncHelpCenter = onSchedule(
  {
    schedule: 'every day 03:00',
    timeZone: 'America/Costa_Rica',
    region: 'us-central1',
    memory: '1GiB',
    timeoutSeconds: 540,
    secrets: [voyageApiKey],
  },
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
  { region: 'us-central1', memory: '1GiB', timeoutSeconds: 300, secrets: [voyageApiKey] },
  async (req) => {
    if (req.auth?.token.kind !== 'agent' || req.auth.token.rol !== 'admin') {
      throw new HttpsError('permission-denied', 'Solo admins.');
    }
    const { docId } = req.data as { docId: string };
    const snap = await db.doc(`kb/${docId}`).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Documento no encontrado.');
    await reindexDoc(docId, snap.data() as KbDoc);
    return { ok: true };
  },
);

/**
 * Reindexes every KB doc, needed once after enabling Voyage: chunks stored before
 * that have no embedding. Each doc is isolated, so one failure doesn't stop the rest.
 */
export const kbReindexAll = onCall(
  { region: 'us-central1', memory: '1GiB', timeoutSeconds: 540, secrets: [voyageApiKey] },
  async (req) => {
    if (req.auth?.token.kind !== 'agent' || req.auth.token.rol !== 'admin') {
      throw new HttpsError('permission-denied', 'Solo admins.');
    }
    const snap = await db.collection('kb').get();
    let failed = 0;
    for (const d of snap.docs) {
      await reindexDoc(d.id, d.data() as KbDoc).catch((err) => {
        failed += 1;
        logger.error('kbReindexAll doc falló', { docId: d.id, message: (err as Error).message });
      });
    }
    return { total: snap.size, failed };
  },
);

/**
 * Deletes a KB document with its chunks and its file, so the bot stops answering from it.
 * The doc goes last: if a step fails it is still listed, and the delete can be repeated.
 */
export const kbDeleteDoc = onCall({ region: 'us-central1', timeoutSeconds: 300 }, async (req) => {
  await requireActiveAdmin(req.auth);
  const docId = (req.data as { docId?: unknown } | null)?.docId;
  if (!isKbDocId(docId)) throw new HttpsError('invalid-argument', 'Documento inválido.');
  const ref = db.doc(`kb/${docId}`);
  const file = ownKbFile(docId, (await ref.get()).data()?.storagePath);
  if (file) await storage.bucket().file(file).delete({ ignoreNotFound: true });
  await db.recursiveDelete(ref);
  logger.info('KB document deleted', { docId, by: req.auth?.uid });
  return { ok: true };
});

async function reindexDoc(docId: string, doc: KbDoc): Promise<void> {
  if (doc.tipo === 'url') return syncUrlDoc(docId, doc);
  if (!doc.storagePath) return;
  const ext = doc.storagePath.split('.').pop()?.toLowerCase() ?? '';
  await ingestStoredFile(docId, doc.storagePath, ext);
}

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
    await finishIndexing(ref, { estado: 'indexado', chunks });
  } catch (err) {
    await finishIndexing(ref, { estado: 'error' });
    throw err;
  }
}
