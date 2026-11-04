import { execFile, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Removed before Claude sees the code: instructions that aren't ours to follow, and config with credentials. */
const REMOVED = ['.claude', '.mcp.json', 'CLAUDE.md', 'AGENTS.md', '.env', '.github', 'src/main/resources/config', 'memory', 'tasks', 'scripts'];

const KEEP_CHECKOUTS = 3;

export interface CheckoutConfig {
  repoUrl: string;
  branch: string;
  token: string | null;
  mirrorDir: string;
  workspaceDir: string;
}

/** Passed by environment so the token isn't on a command line. */
function gitEnv(token: string | null): NodeJS.ProcessEnv {
  if (!token) return process.env;
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.extraHeader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
  };
}

function writable(dir: string, mode: number) {
  chmodSync(dir, mode);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) writable(join(dir, entry.name), mode);
  }
}

function prune(workspaceDir: string, current: string) {
  const old = readdirSync(workspaceDir)
    .filter((name) => name !== current)
    .map((name) => ({ name, at: statSync(join(workspaceDir, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at)
    .slice(KEEP_CHECKOUTS - 1);
  for (const { name } of old) {
    writable(join(workspaceDir, name), 0o755);
    rmSync(join(workspaceDir, name), { recursive: true, force: true });
  }
}

/**
 * An exported tree of one commit, with no `.git`: it holds no token and no history,
 * and directories are read-only. Reads are per SHA, so evidence points at exact code.
 */
export async function checkoutProduction(config: CheckoutConfig): Promise<{ sha: string; dir: string }> {
  const { repoUrl, branch, token, mirrorDir, workspaceDir } = config;
  mkdirSync(workspaceDir, { recursive: true });
  if (!existsSync(join(mirrorDir, 'HEAD'))) {
    mkdirSync(mirrorDir, { recursive: true, mode: 0o700 });
    await run('git', ['init', '--bare', '-q', mirrorDir]);
  }
  const env = gitEnv(token);
  await run('git', ['-C', mirrorDir, 'fetch', '-q', '--depth', '1', repoUrl, branch], { env, maxBuffer: 1 << 24, timeout: 300_000 });
  const { stdout } = await run('git', ['-C', mirrorDir, 'rev-parse', 'FETCH_HEAD']);
  const sha = stdout.trim();

  const dir = join(workspaceDir, sha);
  if (existsSync(join(dir, '.ready'))) return { sha, dir };
  if (existsSync(dir)) {
    writable(dir, 0o755);
    rmSync(dir, { recursive: true, force: true });
  }
  mkdirSync(dir, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const archive = spawn('git', ['-C', mirrorDir, 'archive', 'FETCH_HEAD'], { stdio: ['ignore', 'pipe', 'inherit'] });
    const tar = spawn('tar', ['-x', '-C', dir], { stdio: ['pipe', 'inherit', 'inherit'] });
    archive.stdout.pipe(tar.stdin);
    archive.on('error', reject);
    tar.on('error', reject);
    tar.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tar terminó con ${code}`))));
  });
  for (const path of REMOVED) rmSync(join(dir, path), { recursive: true, force: true });
  await run('find', [dir, '-name', '.env*', '-delete']);
  await run('touch', [join(dir, '.ready')]);
  writable(dir, 0o555);
  prune(workspaceDir, sha);
  return { sha, dir };
}
