import { createHash } from 'node:crypto';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import type { CodeAudience, CodeChunk, CodeFileEntry, CodeIndexState } from '@aditum-chat/shared';
import { db, FieldValue } from '../lib/admin.js';
import { CODE_EMBEDDINGS, embed, rerank } from '../embeddings.js';
import type { EvidenceSource } from '../evidence.js';
import { CODE_REPO } from './allowlist.js';
import {
  audienceFollowsStates,
  audiencesOf,
  buildAudienceMap,
  isStateFile,
  type AudienceMap,
} from './audience.js';
import { chunkSource, languageOf } from './chunker.js';
import { fetchBlobText, fetchBranchHead, listIndexableFiles, type RepoFile } from './github.js';
import { findSecrets } from './secretScan.js';

/**
 * Private index of the production repository for the widget bot. Written and read
 * only through the Admin SDK: `firestore.rules` denies these collections to clients.
 *
 * `code_files` holds one entry per indexed path with its blob SHA, so a sync is
 * "diff the repository tree against this manifest and process what differs". That
 * makes it resumable: the first run has ~4k files to do and won't fit in one
 * execution, so each run does what its time budget allows and the next continues.
 */

const githubCodeToken = defineSecret('GITHUB_CODE_TOKEN');
const voyageApiKey = defineSecret('VOYAGE_API_KEY');

const STATE_DOC = 'code_index/state';
const CHUNKS = 'code_chunks';
const FILES = 'code_files';
const FILE_BATCH = 20;
const EMBED_BATCH = 64;
const WRITE_BATCH = 400;
const RUN_BUDGET_MS = 7.5 * 60 * 1000;
const LOCK_MS = 9 * 60 * 1000;

const TOP_K = 6;
const SEARCHED_LANGUAGES = ['json', 'html', 'js', 'java'] as const;
const CANDIDATES_PER_LANGUAGE = 15;
/** Reranker score below which a chunk is noise rather than evidence. Tune with the evals. */
const MIN_RELEVANCE = 0.5;

const pathKey = (path: string) => createHash('sha1').update(path).digest('hex');

async function deleteChunksOf(path: string): Promise<void> {
  const chunks = await db.collection(CHUNKS).where('path', '==', path).select().get();
  for (let i = 0; i < chunks.docs.length; i += WRITE_BATCH) {
    const batch = db.batch();
    chunks.docs.slice(i, i + WRITE_BATCH).forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

interface PreparedFile {
  file: RepoFile;
  skipReasons: string[];
  audiences: CodeAudience[];
  chunks: ReturnType<typeof chunkSource>;
}

async function prepareFile(token: string, file: RepoFile, audienceMap: AudienceMap): Promise<PreparedFile> {
  const text = await fetchBlobText(token, file.blobSha);
  const audiences = audiencesOf(file.path, text, audienceMap);
  // A file nobody in the chat can reach has no reason to leave for Voyage.
  if (audiences.length === 0) return { file, skipReasons: [], audiences, chunks: [] };
  // The scan must stay ahead of embed(): a positive never leaves for Voyage.
  const secrets = findSecrets(text);
  if (secrets.length > 0) return { file, skipReasons: secrets, audiences, chunks: [] };
  return { file, skipReasons: [], audiences, chunks: chunkSource(file.path, text) };
}

async function storeFile(prepared: PreparedFile, commitSha: string, vectors: number[][]): Promise<void> {
  const { file, chunks, skipReasons, audiences } = prepared;
  await deleteChunksOf(file.path);

  const key = pathKey(file.path);
  const language = languageOf(file.path);
  for (let i = 0; i < chunks.length; i += WRITE_BATCH) {
    const batch = db.batch();
    chunks.slice(i, i + WRITE_BATCH).forEach((chunk, offset) => {
      const index = i + offset;
      batch.set(db.doc(`${CHUNKS}/${key}_${index}`), {
        path: file.path,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        symbol: chunk.symbol,
        language,
        text: chunk.text,
        commitSha,
        forManager: audiences.includes('manager'),
        forAccountant: audiences.includes('accountant'),
        embedding: FieldValue.vector(vectors[index]),
      });
    });
    await batch.commit();
  }

  const entry: CodeFileEntry = {
    path: file.path,
    blobSha: file.blobSha,
    chunks: chunks.length,
    audiences,
    skipReasons,
  };
  await db.doc(`${FILES}/${key}`).set(entry);
}

/** Embeds with the path on top, so a query can match on where the code lives, not only on its body. */
function embeddingInput(path: string, text: string): string {
  return `${path}\n${text}`;
}

async function processBatch(
  token: string,
  voyageKey: string,
  files: RepoFile[],
  commitSha: string,
  audienceMap: AudienceMap,
): Promise<{ failed: number }> {
  const results = await Promise.allSettled(files.map((file) => prepareFile(token, file, audienceMap)));
  const prepared: PreparedFile[] = [];
  let failed = 0;
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      prepared.push(result.value);
    } else {
      failed += 1;
      logger.error('codeSync: could not read file', {
        path: files[index].path,
        message: (result.reason as Error).message,
      });
    }
  });

  const inputs = prepared.flatMap((p) => p.chunks.map((chunk) => embeddingInput(p.file.path, chunk.text)));
  const vectors: number[][] = [];
  for (let i = 0; i < inputs.length; i += EMBED_BATCH) {
    vectors.push(...(await embed(voyageKey, CODE_EMBEDDINGS, inputs.slice(i, i + EMBED_BATCH), 'document')));
  }

  let cursor = 0;
  for (const item of prepared) {
    const own = vectors.slice(cursor, cursor + item.chunks.length);
    cursor += item.chunks.length;
    await storeFile(item, commitSha, own);
  }
  return { failed };
}

async function loadAudienceMap(token: string, files: RepoFile[]): Promise<AudienceMap> {
  const stateFiles = files.filter((file) => isStateFile(file.path));
  const loaded: { path: string; text: string }[] = [];
  for (let i = 0; i < stateFiles.length; i += FILE_BATCH) {
    loaded.push(
      ...(await Promise.all(
        stateFiles
          .slice(i, i + FILE_BATCH)
          .map(async (file) => ({ path: file.path, text: await fetchBlobText(token, file.blobSha) })),
      )),
    );
  }
  return buildAudienceMap(loaded);
}

const sameAudiences = (a: CodeAudience[] | undefined, b: CodeAudience[]) =>
  (a ?? []).length === b.length && b.every((aud) => a?.includes(aud));

async function acquireLock(): Promise<boolean> {
  const ref = db.doc(STATE_DOC);
  return db.runTransaction(async (tx) => {
    const lockUntil = ((await tx.get(ref)).data() as CodeIndexState | undefined)?.lockUntil ?? 0;
    if (lockUntil > Date.now()) return false;
    tx.set(ref, { lockUntil: Date.now() + LOCK_MS }, { merge: true });
    return true;
  });
}

export async function runCodeSync(token: string, voyageKey: string): Promise<CodeIndexState> {
  const stateRef = db.doc(STATE_DOC);
  if (!(await acquireLock())) {
    logger.info('codeSync: another run is in progress');
    return (await stateRef.get()).data() as CodeIndexState;
  }

  const startedAt = Date.now();
  try {
    const previous = ((await stateRef.get()).data() ?? {}) as Partial<CodeIndexState>;
    const headSha = await fetchBranchHead(token);
    if (previous.indexedSha === headSha) {
      await stateRef.set({ lastCheckAt: Date.now() }, { merge: true });
      return (await stateRef.get()).data() as CodeIndexState;
    }

    const files = await listIndexableFiles(token, headSha);
    const manifest = await db.collection(FILES).get();
    const indexed = new Map(manifest.docs.map((doc) => [doc.get('path') as string, doc.data() as CodeFileEntry]));
    const audienceMap = await loadAudienceMap(token, files);
    const present = new Set(files.map((file) => file.path));

    for (const path of indexed.keys()) {
      if (present.has(path)) continue;
      await deleteChunksOf(path);
      await db.doc(`${FILES}/${pathKey(path)}`).delete();
    }

    // A permissions change in a state file changes who sees files whose own blob didn't move.
    const pending = files.filter((file) => {
      const entry = indexed.get(file.path);
      if (entry?.blobSha !== file.blobSha) return true;
      return audienceFollowsStates(file.path) && !sameAudiences(entry.audiences, audiencesOf(file.path, '', audienceMap));
    });
    let done = 0;
    let failed = 0;
    while (done < pending.length && Date.now() - startedAt < RUN_BUDGET_MS) {
      const batch = pending.slice(done, done + FILE_BATCH);
      failed += (await processBatch(token, voyageKey, batch, headSha, audienceMap)).failed;
      done += batch.length;
    }

    // Failed files keep their old manifest entry, so the next run retries them.
    const complete = done === pending.length && failed === 0;
    const update: Record<string, unknown> = {
      repo: `${CODE_REPO.owner}/${CODE_REPO.repo}@${CODE_REPO.branch}`,
      targetSha: headSha,
      pendingFiles: pending.length - done + failed,
      failedFiles: failed,
      lastCheckAt: Date.now(),
      lastError: FieldValue.delete(),
    };
    if (complete) {
      const after = await db.collection(FILES).get();
      update.indexedSha = headSha;
      update.indexedAt = Date.now();
      update.files = after.size;
      update.chunks = after.docs.reduce((sum, doc) => sum + ((doc.get('chunks') as number) ?? 0), 0);
      update.skippedForSecrets = after.docs
        .filter((doc) => ((doc.get('skipReasons') as string[] | undefined) ?? []).length > 0)
        .map((doc) => doc.get('path') as string);
    }
    await stateRef.set(update, { merge: true });
    return (await stateRef.get()).data() as CodeIndexState;
  } catch (err) {
    const message = (err as Error).message;
    logger.error('codeSync failed', { message });
    await stateRef.set({ lastError: message, lastCheckAt: Date.now() }, { merge: true });
    throw err;
  } finally {
    await stateRef.set({ lockUntil: 0 }, { merge: true });
  }
}

export const codeSync = onSchedule(
  {
    schedule: 'every 30 minutes',
    timeZone: 'America/Costa_Rica',
    region: 'us-central1',
    memory: '1GiB',
    timeoutSeconds: 540,
    secrets: [githubCodeToken, voyageApiKey],
  },
  async () => {
    await runCodeSync(githubCodeToken.value(), voyageApiKey.value());
  },
);

export const codeSyncNow = onCall(
  {
    region: 'us-central1',
    memory: '1GiB',
    timeoutSeconds: 540,
    secrets: [githubCodeToken, voyageApiKey],
  },
  async (req) => {
    if (req.auth?.token.kind !== 'agent' || req.auth.token.rol !== 'admin') {
      throw new HttpsError('permission-denied', 'Solo admins.');
    }
    const state = await runCodeSync(githubCodeToken.value(), voyageApiKey.value()).catch((err: Error) => {
      throw new HttpsError('internal', err.message);
    });
    return { pendingFiles: state.pendingFiles ?? 0, indexedSha: state.indexedSha ?? null };
  },
);

const toSource = (id: string, chunk: CodeChunk): EvidenceSource => ({
  id: `code:${id}`,
  kind: 'code',
  title: 'Comportamiento del sistema',
  text: chunk.text,
  uiText: chunk.language === 'json' || chunk.language === 'html',
  ref: `${chunk.path}:${chunk.startLine}-${chunk.endLine}@${chunk.commitSha.slice(0, 12)}`,
});

type AudienceField = 'forManager' | 'forAccountant';

const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

let emulatorChunks: { id: string; chunk: CodeChunk; haystack: string }[] | null = null;

/**
 * Stand-in for vector search in the emulators, so the bot can be exercised against
 * real code before code is sent to Voyage. Reads the whole collection, so it must
 * never run in production. Weighs rare terms higher (IDF); it finds less than
 * embeddings would, so local results understate how much the bot can answer.
 */
async function searchCodeByKeyword(query: string, audienceField: AudienceField): Promise<EvidenceSource[]> {
  if (!emulatorChunks) {
    const snap = await db.collection(CHUNKS).get();
    emulatorChunks = snap.docs.map((doc) => {
      const chunk = doc.data() as CodeChunk;
      return { id: doc.id, chunk, haystack: normalize(chunk.text) };
    });
  }
  const chunks = emulatorChunks.filter((c) => c.chunk[audienceField] === true);
  const terms = [...new Set(normalize(query).split(/[^a-z0-9]+/).filter((term) => term.length > 3))];
  const weights = new Map(
    terms.map((term) => {
      const df = chunks.reduce((count, c) => count + (c.haystack.includes(term) ? 1 : 0), 0);
      return [term, Math.log((chunks.length + 1) / (df + 1))] as const;
    }),
  );
  const minHits = Math.min(2, terms.length);
  return chunks
    .map((c) => {
      const present = terms.filter((term) => c.haystack.includes(term));
      return { c, hits: present.length, score: present.reduce((sum, term) => sum + (weights.get(term) ?? 0), 0) };
    })
    .filter((row) => row.hits >= minHits && row.hits > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K)
    .map((row) => toSource(row.c.id, row.c.chunk));
}

/** Retrieves code evidence this audience may see. Requires VOYAGE_API_KEY to be declared by the calling function. */
export async function searchCode(query: string, audience: CodeAudience): Promise<EvidenceSource[]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!query.trim()) return [];
  const audienceField: AudienceField = audience === 'manager' ? 'forManager' : 'forAccountant';
  if (!apiKey) return process.env.FUNCTIONS_EMULATOR === 'true' ? searchCodeByKeyword(query, audienceField) : [];
  const [vector] = await embed(apiKey, CODE_EMBEDDINGS, [query], 'query');
  // Searched per file type: a Spanish question sits far closer to Java than to the
  // screens and labels that answer it, so one ranking returns almost only backend code.
  const candidates = (
    await Promise.all(
      SEARCHED_LANGUAGES.map((language) =>
        db
          .collection(CHUNKS)
          .where(audienceField, '==', true)
          .where('language', '==', language)
          .findNearest({
            vectorField: 'embedding',
            queryVector: vector,
            limit: CANDIDATES_PER_LANGUAGE,
            distanceMeasure: 'COSINE',
          })
          .get(),
      ),
    )
  ).flatMap((snap) => snap.docs);
  if (candidates.length === 0) return [];

  const ranked = await rerank(
    apiKey,
    query,
    candidates.map((doc) => embeddingInput(doc.get('path') as string, doc.get('text') as string)),
    TOP_K,
  );
  return ranked
    .filter((row) => row.score >= MIN_RELEVANCE)
    .map((row) => toSource(candidates[row.index].id, candidates[row.index].data() as CodeChunk));
}
