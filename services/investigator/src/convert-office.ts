/**
 * Turns an Excel or Word file into text Claude's Read tool can open, printed to stdout. Its
 * own process, because the input is untrusted: the runner starts it as Claude's user, with no
 * secrets, a memory cap and a timeout.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import mammoth from 'mammoth';
import readXlsxFile from 'read-excel-file/node';

/** Plenty for an analysis, and a limit on what a file can make Claude read. */
const MAX_CHARS = 2_000_000;

const cell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function sheetsToText(sheets: { sheet: string; data: unknown[][] }[]): string {
  return sheets
    .map(({ sheet, data }) => {
      const rows = data.filter((row) => row.some((value) => value !== null && value !== undefined && value !== ''));
      return `### Hoja: ${sheet}\n${rows.map((row) => row.map(cell).join(',')).join('\n')}`;
    })
    .join('\n\n');
}

export function capped(text: string): string {
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n\n[Archivo truncado: se dejaron los primeros ${MAX_CHARS} caracteres.]` : text;
}

async function main() {
  const [path, kind] = process.argv.slice(2);
  if (!path || (kind !== 'spreadsheet' && kind !== 'document')) throw new Error('usage: convert-office <path> <spreadsheet|document>');
  const text =
    kind === 'spreadsheet'
      ? sheetsToText((await readXlsxFile(readFileSync(path))) as { sheet: string; data: unknown[][] }[])
      : (await mammoth.extractRawText({ path })).value;
  process.stdout.write(capped(text));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
}
