import { describe, expect, it } from 'vitest';
import { isKbDocId, ownKbFile } from './kbPaths.js';

describe('isKbDocId', () => {
  it('accepts Firestore ids', () => {
    expect(isKbDocId('Qm3xT9aB_c-1')).toBe(true);
  });

  it('refuses anything that could name another path', () => {
    for (const value of ['', 'a/b', '../kb', 'a.b', 'a b', 'x'.repeat(129), 7, null, undefined]) {
      expect(isKbDocId(value)).toBe(false);
    }
  });
});

describe('ownKbFile', () => {
  it('returns the file uploaded for that doc', () => {
    expect(ownKbFile('abc', 'kb/abc.pdf')).toBe('kb/abc.pdf');
    expect(ownKbFile('abc', 'kb/abc.md')).toBe('kb/abc.md');
  });

  it('never returns a file of another doc or folder', () => {
    expect(ownKbFile('abc', 'kb/other.pdf')).toBeNull();
    expect(ownKbFile('abc', 'adjuntos/c1/abc.pdf')).toBeNull();
    expect(ownKbFile('abc', 'kb/abc.pdf/../../perfiles/x.png')).toBeNull();
    expect(ownKbFile('abc', 'kb/abcd.pdf')).toBeNull();
    expect(ownKbFile('abc', 'kb/abc.exe')).toBeNull();
  });

  it('has nothing to delete for a URL doc', () => {
    expect(ownKbFile('abc', undefined)).toBeNull();
  });
});
