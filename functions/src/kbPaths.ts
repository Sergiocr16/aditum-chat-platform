// Kept apart from kb.ts so it can be tested without loading its triggers.

/** Firestore auto ids and anything else without a path separator. */
export const isKbDocId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

/** The file a KB doc owns in Storage. A stored path that names anything else is never deleted. */
export function ownKbFile(docId: string, storagePath: unknown): string | null {
  if (!isKbDocId(docId) || typeof storagePath !== 'string') return null;
  return new RegExp(`^kb/${docId}\\.(pdf|txt|md)$`).test(storagePath) ? storagePath : null;
}
