import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearClaudeDir, loadSession, prepareClaudeDir, pruneSessions, restoreSession, saveSession, SESSION_RETENTION_MS, type AsClaude, type SavedSession } from './session.js';

const asClaude: AsClaude = (command, args) => [command, args];
const session: SavedSession = { sessionId: 's1', sha: 'abc', turn: 1, costSoFar: 0.5, queries: [{ queryId: 'i1-1', rows: [{ a: 1 }] }] as unknown as SavedSession['queries'] };

describe('sessions', () => {
  let root: string;
  let store: string;
  let claudeDir: string;

  const writeTranscript = () => {
    mkdirSync(join(claudeDir, 'projects', 'cwd'), { recursive: true });
    writeFileSync(join(claudeDir, 'projects', 'cwd', 's1.jsonl'), 'lo que Claude leyó');
    writeFileSync(join(claudeDir, '.claude.json'), '{"not":"part of the transcript"}');
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sessions-'));
    store = join(root, 'sessions');
    claudeDir = join(root, 'job', 'claude');
    prepareClaudeDir(claudeDir);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('brings back the transcript and the rows of an earlier round', () => {
    writeTranscript();
    saveSession(store, 'i1', session, claudeDir, asClaude);
    clearClaudeDir(claudeDir, asClaude);
    expect(readdirSync(claudeDir)).toEqual([]);

    const loaded = loadSession(store, 'i1', 'abc');
    expect(loaded).toEqual(session);
    restoreSession(store, 'i1', claudeDir, asClaude);
    expect(readFileSync(join(claudeDir, 'projects', 'cwd', 's1.jsonl'), 'utf8')).toBe('lo que Claude leyó');
  });

  it('keeps only the transcript, not the rest of the config dir', () => {
    writeTranscript();
    saveSession(store, 'i1', session, claudeDir, asClaude);
    clearClaudeDir(claudeDir, asClaude);
    restoreSession(store, 'i1', claudeDir, asClaude);
    expect(existsSync(join(claudeDir, '.claude.json'))).toBe(false);
  });

  it('keeps sessions where only the runner can enter', () => {
    writeTranscript();
    saveSession(store, 'i1', session, claudeDir, asClaude);
    expect(statSync(store).mode & 0o777).toBe(0o700);
    expect(statSync(join(store, 'i1')).mode & 0o777).toBe(0o700);
    expect(statSync(join(store, 'i1', 'session.json')).mode & 0o777).toBe(0o600);
  });

  it('does not continue over a different commit, another investigation or a broken file', () => {
    writeTranscript();
    saveSession(store, 'i1', session, claudeDir, asClaude);
    expect(loadSession(store, 'i1', 'other-sha')).toBeNull();
    expect(loadSession(store, 'i2', 'abc')).toBeNull();
    writeFileSync(join(store, 'i1', 'session.json'), 'not json');
    expect(loadSession(store, 'i1', 'abc')).toBeNull();
  });

  it('fails without saving when Claude wrote no transcript', () => {
    expect(() => saveSession(store, 'i1', session, claudeDir, asClaude)).toThrow();
    expect(loadSession(store, 'i1', 'abc')).toBeNull();
  });

  it('forgets a session after the retention, not before', () => {
    writeTranscript();
    saveSession(store, 'old', session, claudeDir, asClaude);
    saveSession(store, 'new', session, claudeDir, asClaude);
    const longAgo = new Date(Date.now() - SESSION_RETENTION_MS - 60_000);
    utimesSync(join(store, 'old'), longAgo, longAgo);
    pruneSessions(store);
    expect(readdirSync(store)).toEqual(['new']);
  });
});
