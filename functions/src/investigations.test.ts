import { describe, expect, it } from 'vitest';
import {
  archivedTurn,
  boundedHistory,
  cleanCondominiums,
  contentHash,
  dbSettingsProblem,
  filesProblem,
  followUpProblem,
  investigationSource,
  isCurrentRound,
  isOwnChatAttachment,
  piSettingsProblem,
  roundTimes,
  sameTarget,
  validateUploads,
  withAddedFiles,
  secretMatches,
  threadKeyOf,
  validateRequest,
  type JobTurn,
} from './investigations.js';
import { loginIsRecent, RECENT_LOGIN_MS } from './lib/guards.js';

const ref = { conversationId: 'c', messageId: 'm' };

describe('validateRequest', () => {
  it('accepts a real question with messages', () => {
    expect(validateRequest('¿Por qué le aparece mora?', [ref])).toBeNull();
  });
  it('requires a question with substance', () => {
    expect(validateRequest('corto', [ref])).toMatch(/entre/);
    expect(validateRequest(undefined, [ref])).toMatch(/pregunta/);
    expect(validateRequest('x'.repeat(1001), [ref])).toMatch(/entre/);
  });
  it('requires between 1 and 100 well-formed messages', () => {
    expect(validateRequest('¿Por qué le aparece mora?', [])).toMatch(/al menos/);
    expect(validateRequest('¿Por qué le aparece mora?', Array(101).fill(ref))).toMatch(/hasta/);
    expect(validateRequest('¿Por qué le aparece mora?', [{ conversationId: 'c' }])).toMatch(/no es válida/);
  });
});

describe('follow-ups', () => {
  const investigation = {
    question: 'original',
    requestedBy: { uid: 'a', nombre: 'Ana' },
    status: 'done',
    createdAt: 'created',
  } as never;

  it('accepts a short question, since it builds on the conversation', () => {
    expect(followUpProblem('¿y?')).toBeNull();
    expect(followUpProblem('  a ')).toMatch(/entre/);
    expect(followUpProblem('x'.repeat(1001))).toMatch(/entre/);
    expect(followUpProblem(5)).toMatch(/pregunta/);
  });

  it('archives the first round with the original question', () => {
    expect(archivedTurn(investigation)).toMatchObject({ n: 1, question: 'original', by: { nombre: 'Ana' }, askedAt: 'created', report: null });
  });

  it('archives a later round with its own question and who asked it', () => {
    const later = { ...(investigation as object), turn: 3, followUp: { question: 'otra', by: { uid: 'b', nombre: 'Beto' } }, queuedAt: 'queued' } as never;
    expect(archivedTurn(later)).toMatchObject({ n: 3, question: 'otra', by: { nombre: 'Beto' }, askedAt: 'queued' });
  });

  it('keeps how long the round took', () => {
    expect(archivedTurn({ ...(investigation as object), durationMs: 92_000, queueMs: 5_000 } as never)).toMatchObject({ durationMs: 92_000, queueMs: 5_000 });
    expect(archivedTurn(investigation)).toMatchObject({ durationMs: null, queueMs: null });
  });

  it('never leaves undefined behind, which Firestore rejects', () => {
    expect(Object.values(archivedTurn(investigation))).not.toContain(undefined);
  });

  it('tells the Pi to stop once the round is over or another one started', () => {
    expect(isCurrentRound({ status: 'running', turn: 2 }, 2)).toBe(true);
    expect(isCurrentRound({ status: 'running' }, 1)).toBe(true);
    expect(isCurrentRound({ status: 'cancelled', turn: 2 }, 2)).toBe(false);
    expect(isCurrentRound({ status: 'queued', turn: 3 }, 2)).toBe(false);
    expect(isCurrentRound({ status: 'running', turn: 3 }, 2)).toBe(false);
    expect(isCurrentRound(undefined, 1)).toBe(false);
  });

  it('accepts a Pi that does not report rounds yet', () => {
    expect(isCurrentRound({ status: 'running', turn: 2 }, undefined)).toBe(true);
  });

  const turn = (n: number, summary = 'x'): JobTurn => ({ n, question: 'q', status: 'done', conclusion: 'confirmed', summary, cause: '', recommendation: '', missing: [], queries: [], backlogDraft: null, proposal: null });

  it('keeps the latest rounds when the history is too long, in order', () => {
    const { history, omittedTurns } = boundedHistory([turn(1, 'a'.repeat(300)), turn(2, 'b'.repeat(300)), turn(3)], 750);
    expect(history.map((t) => t.n)).toEqual([2, 3]);
    expect(omittedTurns).toBe(1);
  });

  it('does not skip a round to fit an older one', () => {
    const { history, omittedTurns } = boundedHistory([turn(1), turn(2, 'b'.repeat(2000)), turn(3)], 600);
    expect(history.map((t) => t.n)).toEqual([3]);
    expect(omittedTurns).toBe(2);
  });
});

describe('threadKeyOf', () => {
  it('ties direct segments to the contact and group ones to the group', () => {
    expect(threadKeyOf({ tipo: 'directa', contactId: 'a' } as never)).toBe('contact:a');
    expect(threadKeyOf({ tipo: 'grupo', groupId: 'g' } as never)).toBe('group:g');
  });
  it('gives no key when the owner is missing', () => {
    expect(threadKeyOf({ tipo: 'directa' } as never)).toBeNull();
  });
});

describe('roundTimes', () => {
  const at = (seconds: number) => new Date(1_000_000 + seconds * 1000);

  it('counts from when the agent asked, and says how much was in line', () => {
    expect(roundTimes(at(0), at(5), at(92))).toEqual({ durationMs: 92_000, queueMs: 5_000 });
  });

  it('leaves out what it does not know', () => {
    expect(roundTimes(null, at(5), at(92))).toEqual({ durationMs: null, queueMs: null });
    expect(roundTimes(at(0), null, at(92))).toEqual({ durationMs: 92_000, queueMs: null });
  });

  it('never goes negative when clocks disagree', () => {
    expect(roundTimes(at(10), at(5), at(5))).toEqual({ durationMs: 0, queueMs: 0 });
  });
});

describe('cleanCondominiums', () => {
  it('accepts one or several, with or without an id', () => {
    const list = [{ id: '160', name: 'San Ignacio' }, { id: null, name: 'Mar Arena' }];
    expect(cleanCondominiums(list)).toEqual(list);
  });

  it('treats a console that sends none as none', () => {
    expect(cleanCondominiums(undefined)).toEqual([]);
    expect(cleanCondominiums([])).toEqual([]);
  });

  it('keeps a typed name on one line, and drops anything else sent along', () => {
    expect(cleanCondominiums([{ name: '  San\n\nIgnacio ', extra: 'x' }])).toEqual([{ id: null, name: 'San Ignacio' }]);
  });

  it('refuses a wrong shape', () => {
    for (const bad of ['San Ignacio', [{}], [{ id: '1' }], [{ id: 5, name: 'a' }], [{ id: '', name: 'a' }], [{ name: 'x'.repeat(151) }], [null]]) {
      expect(cleanCondominiums(bad)).toBeNull();
    }
    expect(cleanCondominiums(Array.from({ length: 301 }, () => ({ name: 'a' })))).toBeNull();
  });
});

describe('contentHash', () => {
  it('counts the condominiums as part of what was asked', () => {
    expect(contentHash('q', [], [], [{ id: '1', name: 'a' }])).not.toBe(contentHash('q', []));
    expect(contentHash('q', [], [], [])).toBe(contentHash('q', []));
  });

  it('changes with the content', () => {
    const message = { at: null, senderType: 'user', senderName: 'A', internalNote: false, text: 'hola', attachments: [] };
    expect(contentHash('q', [message])).not.toBe(contentHash('q', [{ ...message, text: 'chao' }]));
  });
});

describe('secretMatches', () => {
  it('compares exactly and refuses an unset secret', () => {
    expect(secretMatches('abc', 'abc')).toBe(true);
    expect(secretMatches('abd', 'abc')).toBe(false);
    expect(secretMatches('', '')).toBe(false);
  });
});

describe('sameTarget', () => {
  const saved = { host: '203.0.113.10', port: 3306, user: 'aditum_investigator_ro' };
  it('keeps the saved password only for the connection it was saved for', () => {
    expect(sameTarget(saved, { ...saved })).toBe(true);
    expect(sameTarget(saved, { ...saved, host: '198.51.100.7' })).toBe(false);
    expect(sameTarget(saved, { ...saved, port: 3307 })).toBe(false);
    expect(sameTarget(saved, { ...saved, user: 'root' })).toBe(false);
  });
  it('has nothing to keep before a connection is saved', () => {
    expect(sameTarget(undefined, saved)).toBe(false);
  });
  it('asks for the password again when the target changes', () => {
    const moved = { ...saved, host: '198.51.100.7', database: 'aditum', password: '' };
    expect(dbSettingsProblem(moved, sameTarget(saved, moved))).toMatch(/contraseña/);
    expect(piSettingsProblem(moved, sameTarget(saved, moved))).toMatch(/contraseña/);
  });
});

describe('loginIsRecent', () => {
  const now = Date.UTC(2026, 10, 5, 12);
  it('accepts a password entered within the window', () => {
    expect(loginIsRecent(Math.floor(now / 1000), now)).toBe(true);
    expect(loginIsRecent(Math.floor((now - RECENT_LOGIN_MS + 1000) / 1000), now)).toBe(true);
  });
  it('rejects an old or missing login', () => {
    expect(loginIsRecent(Math.floor((now - RECENT_LOGIN_MS - 1000) / 1000), now)).toBe(false);
    expect(loginIsRecent(undefined, now)).toBe(false);
    expect(loginIsRecent('1762344000', now)).toBe(false);
  });
});

describe('dbSettingsProblem', () => {
  const ok = { host: '203.0.113.10', port: 3306, user: 'aditum_investigator_ro', database: 'aditum', password: 'x' };
  it('accepts a complete connection', () => {
    expect(dbSettingsProblem(ok, false)).toBeNull();
  });
  it('needs a password only until one is stored', () => {
    expect(dbSettingsProblem({ ...ok, password: '' }, false)).toMatch(/contraseña/);
    expect(dbSettingsProblem({ ...ok, password: '' }, true)).toBeNull();
  });
  it('rejects malformed values and system schemas', () => {
    expect(dbSettingsProblem({ ...ok, host: 'a b; rm' }, false)).toMatch(/host/);
    expect(dbSettingsProblem({ ...ok, port: 99999 }, false)).toMatch(/puerto/);
    expect(dbSettingsProblem({ ...ok, user: "x' OR 1" }, false)).toMatch(/usuario/);
    expect(dbSettingsProblem({ ...ok, database: 'mysql' }, false)).toMatch(/sistema/);
  });
});

describe('investigation files', () => {
  it('only takes a chat attachment from its own conversation', () => {
    expect(isOwnChatAttachment('adjuntos/c1/abc_recibo.pdf', 'c1')).toBe(true);
    expect(isOwnChatAttachment('adjuntos/c2/abc_recibo.pdf', 'c1')).toBe(false);
    expect(isOwnChatAttachment('kb/manual.pdf', 'c1')).toBe(false);
    expect(isOwnChatAttachment('adjuntos/c1/../c2/x.pdf', 'c1')).toBe(false);
    expect(isOwnChatAttachment(undefined, 'c1')).toBe(false);
  });

  it('only takes uploads the agent made', () => {
    const own = { storagePath: 'investigaciones/u1/abc_x.pdf', name: 'x.pdf' };
    expect(validateUploads(undefined, 'u1')).toBeNull();
    expect(validateUploads([own], 'u1')).toBeNull();
    expect(validateUploads([own], 'u2')).not.toBeNull();
    expect(validateUploads([own], 'u2', new Set([own.storagePath]))).toBeNull();
    expect(validateUploads([{ ...own, storagePath: 'investigaciones/u1/otro.pdf' }], 'u2', new Set([own.storagePath]))).not.toBeNull();
    expect(validateUploads([{ ...own, storagePath: 'adjuntos/c1/x.pdf' }], 'u1')).not.toBeNull();
    expect(validateUploads([{ ...own, storagePath: 'investigaciones/u1/../u2/x.pdf' }], 'u1')).not.toBeNull();
    expect(validateUploads('nope', 'u1')).not.toBeNull();
    expect(validateUploads(Array(11).fill(own), 'u1')).not.toBeNull();
  });

  it('limits by count, per file and in total', () => {
    const mb = 1024 * 1024;
    expect(filesProblem([{ size: mb }])).toBeNull();
    expect(filesProblem(Array(11).fill({ size: 1 }))).not.toBeNull();
    expect(filesProblem([{ size: 26 * mb }])).not.toBeNull();
    expect(filesProblem(Array(3).fill({ size: 21 * mb }))).not.toBeNull();
  });

  it('hashes what the files were, and stays the same without any', () => {
    const base = contentHash('q', []);
    expect(contentHash('q', [], [])).toBe(base);
    expect(contentHash('q', [], [{ id: 'f1', md5: 'a' }])).not.toBe(contentHash('q', [], [{ id: 'f1', md5: 'b' }]));
  });
});

describe('investigationSource', () => {
  it('keeps the contact and client of a direct chat', () => {
    expect(
      investigationSource({ contactId: 'c1', contactNombre: 'Ana', clientId: 'k1', clientNombre: 'Torres' }, undefined),
    ).toEqual({ contactId: 'c1', contactNombre: 'Ana', clientId: 'k1', clientNombre: 'Torres' });
  });

  it('falls back to the contact doc for the name', () => {
    expect(investigationSource({ contactId: 'c1' }, { nombre: 'Ana' }).contactNombre).toBe('Ana');
  });

  it('uses the group name for a group chat, with no contact', () => {
    expect(investigationSource({ groupName: 'Horizonte' }, undefined)).toEqual({
      contactId: null,
      contactNombre: null,
      clientId: null,
      clientNombre: 'Horizonte',
    });
  });
});

describe('withAddedFiles', () => {
  const file = (id: string, storagePath: string) => ({ id, storagePath, name: storagePath });
  it('numbers a follow-up\'s files after the last one and marks their round', () => {
    const files = withAddedFiles([file('f1', 'a'), file('f2', 'b')], [file('', 'c'), file('', 'd')], 3);
    expect(files.map(({ id, turn }) => [id, turn])).toEqual([['f1', undefined], ['f2', undefined], ['f3', 3], ['f4', 3]]);
  });
  it('starts at f1 for a case that had none', () => {
    expect(withAddedFiles([], [file('', 'a')], 2).map((f) => f.id)).toEqual(['f1']);
  });
  it('never reuses an id, and takes a file only once', () => {
    const files = withAddedFiles([file('f1', 'a'), file('f5', 'b')], [file('', 'a'), file('', 'c'), file('', 'c')], 2);
    expect(files.map((f) => f.id)).toEqual(['f1', 'f5', 'f6']);
  });
});
