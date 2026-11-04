import { describe, expect, it } from 'vitest';
import { contentHash, dbSettingsProblem, secretMatches, threadKeyOf, validateRequest } from './investigations.js';

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
  const ok = { host: '203.0.113.10', port: 3306, user: 'aditum_investigator_ro', database: 'aditum_ro', password: 'x' };
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
