import { chmodSync, chownSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JobFile, PreparedFile } from './prompt.js';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Names come from whoever uploaded the file, and this one ends up in a path and in the prompt.
 * Keeps enough to recognize it. The index makes it unique, and a leading dot impossible.
 */
export function safeFileName(index: number, name: string, extension?: string): string {
  const base = name.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\w.-]+/g, '_').replace(/_{2,}/g, '_').replace(/\.{2,}/g, '.').slice(-80);
  return `${index + 1}-${base}${extension ?? ''}`;
}

interface PrepareOptions {
  /** Keeps the job alive and notices a cancellation between files. */
  beforeEach(): Promise<unknown>;
  download(fileId: string): Promise<Buffer>;
  convert(path: string, kind: 'spreadsheet' | 'document'): string;
  /** Claude's group: it runs as another user, and reads these files through it. */
  shareWith?: number;
}

/** A file that can't be opened doesn't sink the investigation: the report says which one it was. */
export async function prepareFiles(
  files: JobFile[],
  dir: string,
  { beforeEach, download, convert, shareWith }: PrepareOptions,
): Promise<{ ready: PreparedFile[]; unreadable: string[] }> {
  const share = (path: string, mode: number) => {
    if (shareWith === undefined) return;
    chownSync(path, process.getuid!(), shareWith);
    chmodSync(path, mode);
  };
  const write = (path: string, content: Buffer | string) => {
    writeFileSync(path, content, { mode: 0o600 });
    share(path, 0o640);
  };

  mkdirSync(dir, { recursive: true, mode: 0o700 });
  share(dir, 0o750);
  const ready: PreparedFile[] = [];
  const unreadable: string[] = [];

  for (const [index, file] of files.entries()) {
    try {
      await beforeEach();
      const bytes = await download(file.id);
      const original = join(dir, safeFileName(index, file.name));
      write(original, bytes);
      const converted = file.kind === 'spreadsheet' || file.kind === 'document';
      let path = original;
      if (converted) {
        const text = convert(original, file.kind as 'spreadsheet' | 'document');
        if (!text.trim()) throw new Error('empty after converting');
        path = join(dir, safeFileName(index, file.name, '.txt'));
        write(path, text);
      }
      ready.push({ id: file.id, source: file.source, name: file.name, path, converted });
    } catch (e) {
      console.error(`file ${file.id}`, (e as Error).message);
      unreadable.push(file.name);
    }
  }
  return { ready, unreadable };
}
