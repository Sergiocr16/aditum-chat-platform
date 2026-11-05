import { execFileSync } from 'node:child_process';
import { chmodSync, chownSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LoggedQuery } from './evidence.js';

/** Long enough to come back to a case after a few days. After that a round starts over, from the history. */
export const SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TRANSCRIPT_BYTES = 256 * 1024 * 1024;
const TRANSCRIPT = 'transcript.tar';
const META = 'session.json';

/** How to run a command as the user Claude runs as. */
export type AsClaude = (command: string, args: string[]) => [string, string[]];

/** What a later round needs to continue where this one ended. */
export interface SavedSession {
  sessionId: string;
  /** Claude's earlier reads only hold for this commit. */
  sha: string;
  turn: number;
  /** Claude reports the session's total cost when it resumes, so a round's own is the difference. */
  costSoFar: number;
  /** With their rows: Claude can cite them again, so verifying the citation needs them. */
  queries: LoggedQuery[];
}

function asClaudeSync(asClaude: AsClaude, command: string, args: string[], input?: Buffer): Buffer {
  const [bin, binArgs] = asClaude(command, args);
  return execFileSync(bin, binArgs, {
    env: { PATH: process.env.PATH },
    timeout: 60_000,
    maxBuffer: MAX_TRANSCRIPT_BYTES,
    input,
    stdio: [input ? 'pipe' : 'ignore', 'pipe', 'inherit'],
  });
}

/** Claude's own config dir for one job: it's the only place its transcript can end up. */
export function prepareClaudeDir(dir: string, gid?: number) {
  mkdirSync(dir, { recursive: true });
  if (gid === undefined) {
    chmodSync(dir, 0o700);
    return;
  }
  chownSync(dir, process.getuid!(), gid);
  chmodSync(dir, 0o770);
}

/** What Claude wrote belongs to its user, so only that user can delete it. */
export function clearClaudeDir(dir: string, asClaude: AsClaude) {
  if (existsSync(dir)) asClaudeSync(asClaude, 'find', [dir, '-mindepth', '1', '-delete']);
}

/**
 * A transcript holds the rows and chats of one case, and Claude's `Read` isn't confined to the
 * checkout. So between rounds it lives here, in a folder Claude's user can't enter, and only goes
 * back for a round of the same investigation.
 */
export function saveSession(storeDir: string, id: string, session: SavedSession, claudeDir: string, asClaude: AsClaude) {
  const transcript = asClaudeSync(asClaude, 'tar', ['-C', claudeDir, '-cf', '-', 'projects']);
  mkdirSync(storeDir, { recursive: true, mode: 0o700 });
  chmodSync(storeDir, 0o700);
  const dir = join(storeDir, id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const [name, content] of [[TRANSCRIPT, transcript], [META, JSON.stringify(session)]] as const) {
    writeFileSync(join(dir, `${name}.tmp`), content, { mode: 0o600 });
    renameSync(join(dir, `${name}.tmp`), join(dir, name));
  }
}

/** Null when there's nothing to continue, or the code changed: then its reads no longer hold. */
export function loadSession(storeDir: string, id: string, sha: string): SavedSession | null {
  try {
    const session = JSON.parse(readFileSync(join(storeDir, id, META), 'utf8')) as SavedSession;
    return session.sha === sha && session.sessionId && Array.isArray(session.queries) ? session : null;
  } catch {
    return null;
  }
}

export function restoreSession(storeDir: string, id: string, claudeDir: string, asClaude: AsClaude) {
  asClaudeSync(asClaude, 'tar', ['-C', claudeDir, '-xf', '-'], readFileSync(join(storeDir, id, TRANSCRIPT)));
}

export function pruneSessions(storeDir: string, now = Date.now()) {
  if (!existsSync(storeDir)) return;
  for (const name of readdirSync(storeDir)) {
    const dir = join(storeDir, name);
    if (now - statSync(dir).mtimeMs > SESSION_RETENTION_MS) rmSync(dir, { recursive: true, force: true });
  }
}
