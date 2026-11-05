import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, chownSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { InvestigationStatus } from '@aditum-chat/shared';
import { checkoutProduction, type CheckoutConfig } from './checkout.js';
import { REPORT_SCHEMA, verifyReport, type LoggedQuery, type RawReport } from './evidence.js';
import { MAX_FILE_BYTES, prepareFiles } from './files.js';
import { buildPrompt, SYSTEM_PROMPT, type InvestigationJob, type PreparedFile } from './prompt.js';
import { describeLine, isRateLimited, resultFrom, type ClaudeResult, type ProgressEvent } from './stream.js';

const POLL_MS = 10_000;
const HEARTBEAT_MS = 60_000;
const FLUSH_MS = 3_000;
const JOB_TIMEOUT_MS = 20 * 60_000;
const TOKEN_LIFETIME_DAYS = 365;
const MAX_TURNS = '60';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name}`);
  return value;
}

export function loadConfig() {
  // In print mode an API key would take over from the subscription without saying so.
  if (process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY no debe estar definida: el análisis usa la suscripción.');
  const stateDir = required('INVESTIGATOR_STATE_DIR');
  const checkout: CheckoutConfig = {
    repoUrl: process.env.REPO_URL ?? 'https://github.com/Sergiocr16/aditum-jh.git',
    branch: process.env.REPO_BRANCH ?? 'production',
    token: process.env.GITHUB_CODE_TOKEN ?? null,
    mirrorDir: join(stateDir, 'mirror'),
    workspaceDir: join(stateDir, 'checkouts'),
  };
  return {
    functionUrl: required('RUNNER_FUNCTION_URL'),
    secret: required('RUNNER_SHARED_SECRET'),
    gatewayUrl: process.env.GATEWAY_URL ?? 'http://127.0.0.1:7801',
    gatewayAdminToken: required('GATEWAY_ADMIN_TOKEN'),
    configDir: join(stateDir, 'jobs'),
    checkout,
    claudeBin: process.env.CLAUDE_BIN ?? 'claude',
    model: process.env.INVESTIGATOR_MODEL ?? 'claude-opus-5-5',
    tokenIssuedAt: process.env.CLAUDE_TOKEN_ISSUED_AT ?? null,
    // When set, Claude runs as this user, which can't read the runner's state or secrets.
    claudeUid: process.env.CLAUDE_UID ? Number(process.env.CLAUDE_UID) : undefined,
    claudeGid: process.env.CLAUDE_GID ? Number(process.env.CLAUDE_GID) : undefined,
  };
}

type Config = ReturnType<typeof loadConfig>;

/** Only these reach Claude's process: not the runner's secret, the gateway's token or the GitHub token. */
const CLAUDE_ENV = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'TMPDIR', 'CLAUDE_CODE_OAUTH_TOKEN', 'DISABLE_AUTOUPDATER', 'NO_OBSIDIAN_CAPTURE', 'NO_OBSIDIAN_CONTEXT'];

export function claudeEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(CLAUDE_ENV.filter((key) => env[key] !== undefined).map((key) => [key, env[key]]));
}

/** Per-run rather than machine-wide: managed settings would also apply to any other agent on this Pi. */
export const RUN_SETTINGS = {
  permissions: {
    deny: ['Bash', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent', 'Task'],
  },
  disableAllHooks: true,
};

export function claudeArgs(model: string, mcpConfigFile: string, settingsFile: string, filesDir?: string): string[] {
  return [
    // `--allowedTools Read` isn't confined to the checkout: what limits it is Claude's OS user.
    ...(filesDir ? ['--add-dir', filesDir] : []),
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', model,
    '--max-turns', MAX_TURNS,
    '--tools', 'Read,Grep,Glob',
    '--allowedTools', 'Read,Grep,Glob,mcp__prod_ro__*',
    '--permission-mode', 'dontAsk',
    '--strict-mcp-config',
    '--mcp-config', mcpConfigFile,
    '--setting-sources', '',
    '--settings', settingsFile,
    '--no-session-persistence',
    '--append-system-prompt', SYSTEM_PROMPT,
    '--json-schema', JSON.stringify(REPORT_SCHEMA),
  ];
}

/**
 * `setpriv` rather than spawn's `uid` option: changing between non-root users keeps ambient
 * capabilities, and Claude has no reason to inherit the runner's. `--no-new-privs` keeps it from
 * regaining any through a setuid binary, and unlike dropping the bounding set needs no capability.
 */
export function claudeCommand(bin: string, args: string[], uid?: number, gid?: number): [string, string[]] {
  if (uid === undefined || gid === undefined) return [bin, args];
  return [
    'setpriv',
    [`--reuid=${uid}`, `--regid=${gid}`, '--clear-groups', '--inh-caps=-all', '--ambient-caps=-all', '--no-new-privs', '--', bin, ...args],
  ];
}

async function callFunction<T>(config: Config, action: string, body: object = {}): Promise<T> {
  const response = await fetch(config.functionUrl, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.secret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${action}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

/** Raw bytes rather than JSON, with more time: a file can take a while to reach the Pi. */
async function downloadFile(config: Config, id: string, fileId: string): Promise<Buffer> {
  const response = await fetch(config.functionUrl, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.secret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'attachment', id, fileId }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`attachment ${fileId}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_FILE_BYTES) throw new Error(`attachment ${fileId}: too large`);
  return bytes;
}

/**
 * Runs as Claude's user, with no secrets and a memory cap: parsing a file someone uploaded
 * shouldn't happen in the process holding the runner's credentials.
 */
function convertOffice(config: Config, path: string, kind: 'spreadsheet' | 'document'): string {
  const script = join(dirname(fileURLToPath(import.meta.url)), 'convert-office.js');
  const [command, args] = claudeCommand(process.execPath, ['--max-old-space-size=512', script, path, kind], config.claudeUid, config.claudeGid);
  return execFileSync(command, args, {
    env: { PATH: process.env.PATH },
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

async function callGateway<T>(config: Config, method: string, path: string, body?: object): Promise<T> {
  const response = await fetch(`${config.gatewayUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${config.gatewayAdminToken}` },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`gateway ${path}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

function tokenDaysLeft(config: Config): number | null {
  if (!config.tokenIssuedAt) return null;
  const issued = Date.parse(config.tokenIssuedAt);
  if (Number.isNaN(issued)) return null;
  return TOKEN_LIFETIME_DAYS - Math.floor((Date.now() - issued) / 86_400_000);
}

interface JobOutcome {
  status: InvestigationStatus;
  sha: string | null;
  error: string | null;
  usedDatabase: boolean;
  costUsd: number | null;
  report: ReturnType<typeof verifyReport> | null;
  unreadableFiles: string[];
}

async function runJob(config: Config, job: InvestigationJob): Promise<JobOutcome | null> {
  const outcome: JobOutcome = { status: 'failed', sha: null, error: null, usedDatabase: false, costUsd: null, report: null, unreadableFiles: [] };
  const pendingEvents: ProgressEvent[] = [];
  let sentQueries = 0;
  let cancelled = false;
  let child: ChildProcess | null = null;
  const jobConfigDir = join(config.configDir, job.id);

  const flush = async (checkoutDir: string | null) => {
    const events = pendingEvents.splice(0);
    let queries: LoggedQuery[] = [];
    if (checkoutDir) {
      const log = await callGateway<{ queries: LoggedQuery[] }>(config, 'GET', `/jobs/${job.id}`);
      queries = log.queries.slice(sentQueries);
      sentQueries = log.queries.length;
    }
    const { cancel } = await callFunction<{ cancel: boolean }>(config, 'progress', {
      id: job.id,
      events,
      // Rows stay here. Firestore only learns what was asked and how much came back.
      queries: queries.map(({ rows, ...query }) => ({ ...query, rowCount: rows.length })),
    });
    if (cancel) {
      cancelled = true;
      child?.kill('SIGTERM');
    }
  };

  let checkoutDir: string | null = null;
  let timer: NodeJS.Timeout | null = null;
  try {
    pendingEvents.push({ kind: 'status', text: 'Bajando el código de producción' });
    await flush(null);
    const checkout = await checkoutProduction(config.checkout);
    outcome.sha = checkout.sha;
    const { token } = await callGateway<{ token: string }>(config, 'POST', '/jobs', { id: job.id, checkoutDir: checkout.dir });
    checkoutDir = checkout.dir;

    // Claude runs as another user, so it reaches these files through its group and nothing else does.
    const shared = config.claudeGid !== undefined;
    mkdirSync(jobConfigDir, { recursive: true, mode: shared ? 0o750 : 0o700 });
    const mcpConfigFile = join(jobConfigDir, 'mcp.json');
    const settingsFile = join(jobConfigDir, 'settings.json');
    writeFileSync(mcpConfigFile, JSON.stringify({ mcpServers: { prod_ro: { type: 'http', url: `${config.gatewayUrl}/mcp`, headers: { Authorization: `Bearer ${token}` } } } }), { mode: 0o600 });
    writeFileSync(settingsFile, JSON.stringify(RUN_SETTINGS), { mode: 0o600 });
    if (shared) {
      for (const path of [jobConfigDir, mcpConfigFile, settingsFile]) chownSync(path, process.getuid!(), config.claudeGid!);
      for (const file of [mcpConfigFile, settingsFile]) chmodSync(file, 0o640);
    }

    let files: PreparedFile[] = [];
    const filesDir = join(jobConfigDir, 'files');
    if (job.files?.length) {
      pendingEvents.push({ kind: 'status', text: 'Bajando los archivos' });
      const prepared = await prepareFiles(job.files, filesDir, {
        beforeEach: () => flush(null),
        download: (fileId) => downloadFile(config, job.id, fileId),
        convert: (path, kind) => convertOffice(config, path, kind),
        shareWith: config.claudeGid,
      });
      files = prepared.ready;
      outcome.unreadableFiles = prepared.unreadable;
      if (cancelled) return null;
    }

    const [command, args] = claudeCommand(
      config.claudeBin,
      claudeArgs(config.model, mcpConfigFile, settingsFile, files.length ? filesDir : undefined),
      config.claudeUid,
      config.claudeGid,
    );
    child = spawn(command, args, {
      cwd: checkout.dir,
      env: claudeEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin!.end(buildPrompt(job, files));

    let stderr = '';
    child.stderr!.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });

    let result: ClaudeResult | null = null;
    const lines = createInterface({ input: child.stdout! });
    lines.on('line', (line) => {
      pendingEvents.push(...describeLine(line, checkout.dir, filesDir));
      result = resultFrom(line) ?? result;
    });

    const dir = checkout.dir;
    timer = setInterval(() => flush(dir).catch((e) => console.error('progress', e.message)), FLUSH_MS);
    const timeout = setTimeout(() => child?.kill('SIGTERM'), JOB_TIMEOUT_MS);
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child!.on('error', reject);
      child!.on('close', resolve);
    });
    clearTimeout(timeout);
    clearInterval(timer);
    timer = null;

    if (cancelled) return null;
    await flush(dir);
    const log = await callGateway<{ queries: LoggedQuery[] }>(config, 'GET', `/jobs/${job.id}`);
    outcome.usedDatabase = log.queries.length > 0;
    const final = result as ClaudeResult | null;
    outcome.costUsd = final?.total_cost_usd ?? null;

    if (isRateLimited(final, stderr)) {
      outcome.status = 'rate_limited';
      outcome.error = 'Se alcanzó el límite de uso de la suscripción.';
    } else if (final?.structured_output && !final.is_error) {
      outcome.report = verifyReport(final.structured_output as RawReport, dir, log.queries);
      outcome.status = 'done';
    } else {
      const reason = stderr.trim().split('\n').at(-1)?.slice(0, 200);
      outcome.error = `El análisis terminó sin reporte (código ${exitCode}, ${final?.subtype ?? 'sin resultado'})${reason ? `: ${reason}` : ''}.`;
      console.error(outcome.error, stderr);
    }
  } catch (e) {
    outcome.error = (e as Error).message;
    console.error('job failed', e);
  } finally {
    if (timer) clearInterval(timer);
    child?.kill('SIGTERM');
    rmSync(jobConfigDir, { recursive: true, force: true });
    if (checkoutDir) await callGateway(config, 'DELETE', `/jobs/${job.id}`).catch(() => {});
  }
  return outcome;
}

/** Fails at startup, as the same user and with the same limits as a real job, so an install can't look fine and fail later. */
function checkClaudeRuns(config: Config) {
  const [command, args] = claudeCommand(config.claudeBin, ['--version'], config.claudeUid, config.claudeGid);
  execFileSync(command, args, { env: claudeEnv(), timeout: 30_000, stdio: ['ignore', 'ignore', 'inherit'] });
}

async function main() {
  const config = loadConfig();
  const days = tokenDaysLeft(config);
  if (days !== null && days < 30) console.warn(`El token de Claude Code vence en ${days} días.`);
  checkClaudeRuns(config);
  console.log(`runner listo, modelo ${config.model}`);

  let lastHeartbeat = 0;
  for (;;) {
    try {
      const heartbeat = Date.now() - lastHeartbeat >= HEARTBEAT_MS;
      if (heartbeat) lastHeartbeat = Date.now();
      const { job } = await callFunction<{ job: InvestigationJob | null }>(config, 'claim', {
        heartbeat,
        tokenDaysLeft: tokenDaysLeft(config),
      });
      if (job) {
        console.log(`investigación ${job.id}`);
        const outcome = await runJob(config, job);
        if (outcome) await callFunction(config, 'complete', { id: job.id, ...outcome });
        continue;
      }
    } catch (e) {
      console.error('poll', (e as Error).message);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
