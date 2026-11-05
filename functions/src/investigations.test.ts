import { describe, expect, it } from 'vitest';
import { contentHash, dbSettingsProblem, filesProblem, isOwnChatAttachment, validateUploads, secretMatches, threadKeyOf, validateRequest } from './investigations.js';

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

describe('threadKeyOf', () => {
  it('ties direct segments to the contact and group ones to the group', () => {
    expect(threadKeyOf({ tipo: 'directa', contactId: 'a' } as never)).toBe('contact:a');
    expect(threadKeyOf({ tipo: 'grupo', groupId: 'g' } as never)).toBe('group:g');
  });
  it('gives no key when the owner is missing', () => {
    expect(threadKeyOf({ tipo: 'directa' } as never)).toBeNull();
  });
});

describe('contentHash', () => {
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
