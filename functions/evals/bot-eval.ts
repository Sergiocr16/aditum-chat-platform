/**
 * Runs the widget bot against a question set in the emulators, using real code from
 * the local production checkout, and reports how it behaved.
 *
 *   npx firebase emulators:exec --project demo-aditum-chat \
 *     --only auth,firestore,functions,storage,database \
 *     "pnpm --filter @aditum-chat/functions eval:bot"
 *
 * Calls Claude with the key in functions/.secret.local: each run costs real money
 * (cents) and sends the retrieved code fragments to the API. Without VOYAGE_API_KEY,
 * retrieval is the keyword stand-in in `searchCode`.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { CODE_REPO, isIndexablePath, MAX_FILE_BYTES } from '../src/code/allowlist';
import { audienceForContactRole, audiencesOf, buildAudienceMap, isStateFile, type CodeAudience } from '../src/code/audience';
import { chunkSource, languageOf } from '../src/code/chunker';
import { findSecrets } from '../src/code/secretScan';
import { embed, KB_EMBEDDINGS } from '../src/embeddings';
import { fallbackReply, leaksCode } from '../src/evidence';

// Everything below writes freely to Firestore, so it must only ever reach the emulator.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('bot-eval only runs against the emulators (FIRESTORE_EMULATOR_HOST is not set).');
}

const PROJECT_ID = 'demo-aditum-chat';
const REPO_PATH = process.env.ADITUM_JH_PATH ?? join(homedir(), 'Documents/GitHub/aditum-jh');
const REF = `origin/${CODE_REPO.branch}`;
const OUT = process.env.EVAL_OUT ?? join(__dirname, 'bot-eval-results.json');
const CONCURRENCY = 3;
const REPLY_TIMEOUT_MS = 150_000;

initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();
const now = () => FieldValue.serverTimestamp();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Question {
  id: string;
  group: string;
  q: string;
  site?: string;
  /** Host role label; the chat is open to `Administrador` (default) and `Contador` only. */
  role?: string;
  /** Text this role must never receive. */
  /** Env var holding text the reply must not contain. Not inline: this repo is public. */
  forbidEnv?: string;
}

/** Test content, not real policy: it only needs facts specific enough to check the bot against. */
const KB_FIXTURE = [
  'Las reservas de áreas comunes se cancelan desde Mis reservas, hasta 24 horas antes de la fecha de la reserva.',
  'La piscina admite un máximo de 15 personas al mismo tiempo. El gimnasio abre de 5:00 a 21:00 todos los días.',
  'Reservar el rancho requiere un depósito de 20 000 colones, que se devuelve si el rancho se entrega limpio y sin daños.',
];

const readBlob = (blob: string) =>
  spawnSync('git', ['cat-file', 'blob', blob], { cwd: REPO_PATH, maxBuffer: 1 << 28 }).stdout.toString('utf8');

async function loadCodeIndex(): Promise<{ commit: string; symbols: Set<string>; audienceByPath: Map<string, CodeAudience[]> }> {
  const commit = execFileSync('git', ['rev-parse', REF], { cwd: REPO_PATH }).toString().trim();
  const listing = execFileSync('git', ['ls-tree', '-r', '-l', REF, '--', 'src/main'], {
    cwd: REPO_PATH,
    maxBuffer: 1 << 30,
  }).toString();
  const files = listing
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [meta, path] = line.split('\t');
      const [, , blob, size] = meta.trim().split(/\s+/);
      return { path, blob, size: Number(size) };
    })
    .filter((file) => isIndexablePath(file.path) && file.size <= MAX_FILE_BYTES);

  const audienceMap = buildAudienceMap(
    files.filter((file) => isStateFile(file.path)).map((file) => ({ path: file.path, text: readBlob(file.blob) })),
  );
  const audienceByPath = new Map<string, CodeAudience[]>();
  const symbols = new Set<string>();
  let chunks = 0;
  let skipped = 0;
  let hidden = 0;
  let batch = db.batch();
  let pending = 0;
  for (const [fileIndex, file] of files.entries()) {
    const text = readBlob(file.blob);
    const audiences = audiencesOf(file.path, text, audienceMap);
    audienceByPath.set(file.path, audiences);
    if (audiences.length === 0) {
      hidden += 1;
      continue;
    }
    if (findSecrets(text).length > 0) {
      skipped += 1;
      continue;
    }
    for (const [index, chunk] of chunkSource(file.path, text).entries()) {
      if (chunk.symbol) symbols.add(chunk.symbol);
      batch.set(db.doc(`code_chunks/f${fileIndex}_${index}`), {
        path: file.path,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        symbol: chunk.symbol,
        language: languageOf(file.path),
        text: chunk.text,
        commitSha: commit,
        forManager: audiences.includes('manager'),
        forAccountant: audiences.includes('accountant'),
      });
      chunks += 1;
      pending += 1;
      if (pending === 400) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
  }
  await batch.commit();
  console.log(`Index: ${files.length} files, ${chunks} chunks, ${hidden} hidden from the chat's roles, ${skipped} skipped for secrets, commit ${commit.slice(0, 10)}`);
  return { commit, symbols, audienceByPath };
}

/** Reads what a real sync left in the emulator, so the eval measures vector search. */
async function loadExistingIndex(): Promise<Awaited<ReturnType<typeof loadCodeIndex>>> {
  const state = await db.doc('code_index/state').get();
  const commit = state.get('indexedSha') as string | undefined;
  if (!commit) throw new Error('No finished sync in the emulator.');
  const files = await db.collection('code_files').get();
  const audienceByPath = new Map(files.docs.map((doc) => [doc.get('path') as string, doc.get('audiences') as CodeAudience[]]));
  const chunks = await db.collection('code_chunks').select('symbol').get();
  const symbols = new Set(chunks.docs.map((doc) => doc.get('symbol') as string | null).filter((symbol): symbol is string => Boolean(symbol)));
  console.log(`Index: existing sync at ${commit.slice(0, 10)}, ${files.size} files, ${chunks.size} chunks`);
  return { commit, symbols, audienceByPath };
}

async function seed(): Promise<void> {
  const bot = {
    activo: true,
    nombre: 'Adi',
    instrucciones: '',
    tono: 'vos',
    escalarTrasIntentos: 5,
    responderFueraDeHorario: true,
    crearTicketsAutomaticamente: false,
    saludo: 'Hola',
    codeRagEnabled: true,
  };
  await db.doc('settings/global').set({ botConfig: bot }, { merge: true });
  await db.doc('sites/main').set({ nombre: 'Eval', activo: true });
  await db.doc('sites/tickets').set({ nombre: 'Eval tickets', activo: true, botConfig: { crearTicketsAutomaticamente: true } });
  await db.doc('kb/fixture').set({ tipo: 'text', nombre: 'Guía de áreas comunes', sitio: 'TODOS', estado: 'indexado', createdAt: now(), updatedAt: now() });
  const voyageKey = process.env.VOYAGE_API_KEY;
  const vectors = voyageKey ? await embed(voyageKey, KB_EMBEDDINGS, KB_FIXTURE, 'document') : null;
  await Promise.all(
    KB_FIXTURE.map((texto, orden) =>
      db.doc(`kb/fixture/chunks/c000${orden}`).set({
        texto,
        orden,
        fuente: 'Guía de áreas comunes',
        ...(vectors ? { embedding: FieldValue.vector(vectors[orden]) } : {}),
      }),
    ),
  );
}

interface Result extends Question {
  reply: string | null;
  outcome: 'answered' | 'no_claim' | 'couldnt_confirm' | 'escalated' | 'ticket' | 'timeout';
  sources: { kind: string; ref: string }[];
  gate: string[];
  leak: boolean;
  /** Retrieved files the role may not see, or `forbidEnv` text found in the reply. */
  audienceViolations: string[];
  ms: number;
  debug?: FirebaseFirestore.DocumentData;
}

async function ask(
  question: Question,
  symbols: Set<string>,
  audienceByPath: Map<string, CodeAudience[]>,
): Promise<Result> {
  const started = Date.now();
  const role = question.role ?? 'Administrador';
  const contactId = `eval-${role.toLowerCase()}`;
  await db.doc(`contacts/${contactId}`).set({ nombre: 'Ana Prueba', rol: role, siteId: question.site ?? 'main' });
  const ref = db.collection('conversations').doc();
  await ref.set({
    tipo: 'directa',
    subcanal: 'bot',
    estado: 'bot',
    siteId: question.site ?? 'main',
    clientId: 'eval',
    clientNombre: 'Condominio Demo',
    contactId,
    contactNombre: 'Ana Prueba',
    idioma: 'es',
    botIntentos: 0,
    createdAt: now(),
    updatedAt: now(),
  });
  // Lets the welcome trigger run first, as it would in a real conversation.
  await sleep(1500);
  await ref.collection('messages').add({
    sender: { tipo: 'user', id: contactId, nombre: 'Ana Prueba' },
    texto: question.q,
    tipoContenido: 'texto',
    createdAt: now(),
  });

  let reply: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let escalated = false;
  while (Date.now() - started < REPLY_TIMEOUT_MS) {
    await sleep(1500);
    const msgs = await ref.collection('messages').orderBy('createdAt').get();
    reply = msgs.docs.filter((doc) => doc.get('sender.tipo') === 'bot' && !doc.get('bienvenida')).pop() ?? null;
    escalated = Boolean((await ref.get()).get('escaladoA'));
    if (reply || escalated) break;
  }

  const text = (reply?.get('texto') as string | undefined) ?? null;
  const evidence = reply ? (await db.doc(`bot_evidence/${reply.id}`).get()).data() : undefined;
  const gateSnap = await db.collection('bot_gate_events').where('conversationId', '==', ref.id).get();
  const sources = (evidence?.sources ?? []) as Result['sources'];

  const fallbacks = [fallbackReply('es'), fallbackReply('en')];
  let outcome: Result['outcome'];
  if (!reply && !escalated) outcome = 'timeout';
  else if (reply?.get('ticketRef')) outcome = 'ticket';
  else if (escalated) outcome = 'escalated';
  else if (fallbacks.includes(text ?? '')) outcome = 'couldnt_confirm';
  else outcome = sources.length > 0 ? 'answered' : 'no_claim';

  // Independent from the bot's own guard: also looks for real identifiers from the repository.
  const words = (text ?? '').split(/[^A-Za-z0-9_]+/);
  const namesSymbol = words.some((word) => /[a-z][A-Z]|[A-Z][a-z]+[A-Z]/.test(word) && symbols.has(word));
  const leak = namesSymbol || leaksCode(text ?? '', [{ id: 'x', kind: 'code', title: '', text: '', ref: '' }]);

  // Checked apart from the query filter: what came back must be allowed for this role.
  const debugDoc = (await db.doc(`bot_debug/${ref.id}`).get()).data();
  const audience = audienceForContactRole(role);
  const retrievedPaths = ((debugDoc?.retrieved ?? []) as string[]).filter((r) => r.startsWith('src/')).map((r) => r.split(':')[0]);
  const audienceViolations = retrievedPaths.filter((path) => !audience || !audienceByPath.get(path)?.includes(audience));
  const forbidden = question.forbidEnv ? process.env[question.forbidEnv] : undefined;
  if (forbidden && (text ?? '').includes(forbidden)) audienceViolations.push(`reply contains ${question.forbidEnv}`);

  return {
    ...question,
    reply: text,
    outcome,
    sources,
    gate: gateSnap.docs.map((doc) => doc.get('reason') as string),
    leak,
    audienceViolations,
    ms: Date.now() - started,
    debug: debugDoc,
  };
}

async function main(): Promise<void> {
  // For trying the bot by hand: loads the real code index next to the demo data, and stops.
  if (process.env.EVAL_INDEX_ONLY === '1') {
    await loadCodeIndex();
    await db.doc('settings/global').set({ botConfig: { codeRagEnabled: true } }, { merge: true });
    console.log('Code index loaded; codeRagEnabled is on.');
    process.exit(0);
  }

  const questions = JSON.parse(readFileSync(join(process.cwd(), 'evals/questions.json'), 'utf8')) as Question[];
  await seed();
  const { commit, symbols, audienceByPath } =
    process.env.EVAL_USE_EXISTING_INDEX === '1' ? await loadExistingIndex() : await loadCodeIndex();

  const results: Result[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < questions.length) {
        const question = questions[next];
        next += 1;
        const result = await ask(question, symbols, audienceByPath);
        results.push(result);
        console.log(`${result.id} ${result.outcome}${result.leak ? ' LEAK' : ''}${result.audienceViolations.length ? ' AUDIENCE' : ''}${result.gate.length ? ` [${result.gate}]` : ''} ${result.ms}ms`);
      }
    }),
  );
  results.sort((a, b) => questions.findIndex((q) => q.id === a.id) - questions.findIndex((q) => q.id === b.id));

  const metrics = await db.collection('metrics_daily').get();
  const usage = metrics.docs.map((doc) => ({
    input: doc.get('botInputTokens'),
    output: doc.get('botOutputTokens'),
    cacheRead: doc.get('botCacheReadTokens'),
    cacheWrite: doc.get('botCacheWriteTokens'),
  }));
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ commit, usage, results }, null, 2));
  console.log(`Results: ${OUT}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
