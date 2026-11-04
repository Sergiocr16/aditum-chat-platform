/**
 * Line-based source chunker. Unlike the KB `chunkText`, it keeps whitespace and
 * line numbers, and prefers to cut where a method or function ends, so that each
 * chunk reads as a unit and can be cited as `path:startLine-endLine`.
 */

export interface SourceChunk {
  text: string;
  startLine: number; // 1-based, inclusive
  endLine: number; // 1-based, inclusive
  symbol: string | null;
}

const TARGET_CHARS = 1800;
const MAX_CHARS = 3000;
const MIN_CHUNK_CHARS = 40;
const MAX_LINE_CHARS = 2000;

export type SourceLanguage = 'java' | 'js' | 'html' | 'json';

export function languageOf(path: string): SourceLanguage | null {
  if (path.endsWith('.java')) return 'java';
  if (path.endsWith('.js')) return 'js';
  if (path.endsWith('.html')) return 'html';
  if (path.endsWith('.json')) return 'json';
  return null;
}

/** Marks the lines after which a cut is natural: a closing brace back at a shallow depth. */
function braceBoundaries(lines: string[], shallowDepth: number): Set<number> {
  const boundaries = new Set<number>();
  let depth = 0;
  let inBlockComment = false;
  lines.forEach((line, index) => {
    const before = depth;
    let i = 0;
    while (i < line.length) {
      if (inBlockComment) {
        const end = line.indexOf('*/', i);
        if (end === -1) break;
        inBlockComment = false;
        i = end + 2;
        continue;
      }
      const ch = line[i];
      const next = line[i + 1];
      if (ch === '/' && next === '/') break;
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        i += 2;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        i += 1;
        while (i < line.length && line[i] !== ch) i += line[i] === '\\' ? 2 : 1;
        i += 1;
        continue;
      }
      if (ch === '{') depth += 1;
      else if (ch === '}') depth = Math.max(0, depth - 1);
      i += 1;
    }
    if (before > depth && depth <= shallowDepth) boundaries.add(index);
  });
  return boundaries;
}

function blankLineBoundaries(lines: string[]): Set<number> {
  const boundaries = new Set<number>();
  lines.forEach((line, index) => {
    if (line.trim() === '') boundaries.add(index);
  });
  return boundaries;
}

function boundariesFor(language: SourceLanguage, lines: string[]): Set<number> {
  if (language === 'java') return braceBoundaries(lines, 1);
  if (language === 'js') return braceBoundaries(lines, 2);
  return blankLineBoundaries(lines);
}

const SYMBOL_PATTERNS: Record<SourceLanguage, RegExp[]> = {
  java: [
    /\b(?:public|protected|private)\s+(?:static\s+|final\s+|synchronized\s+)*[\w<>[\],\s]+?\s+(\w+)\s*\(/,
    /\b(?:class|interface|enum)\s+(\w+)/,
  ],
  js: [
    /\bfunction\s+(\w+)\s*\(/,
    /\b(?:vm|\$scope|this)\.(\w+)\s*=\s*function\b/,
    /\b(\w+)\s*[:=]\s*function\b/,
  ],
  html: [],
  json: [],
};

function detectSymbol(language: SourceLanguage, text: string): string | null {
  for (const pattern of SYMBOL_PATTERNS[language]) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Splits a file into chunks. Returns [] for files that aren't source a person
 * wrote (a line above MAX_LINE_CHARS means minified or embedded data).
 */
export function chunkSource(path: string, source: string): SourceChunk[] {
  const language = languageOf(path);
  if (!language) return [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  if (lines.some((line) => line.length > MAX_LINE_CHARS)) return [];

  const boundaries = boundariesFor(language, lines);
  const chunks: SourceChunk[] = [];
  let start = 0;
  let size = 0;

  const flush = (end: number) => {
    const text = lines.slice(start, end + 1).join('\n');
    if (text.trim().length >= MIN_CHUNK_CHARS) {
      chunks.push({
        text,
        startLine: start + 1,
        endLine: end + 1,
        symbol: detectSymbol(language, text),
      });
    }
    start = end + 1;
    size = 0;
  };

  lines.forEach((line, index) => {
    size += line.length + 1;
    const nextSize = size + (lines[index + 1]?.length ?? 0) + 1;
    if ((size >= TARGET_CHARS && boundaries.has(index)) || nextSize > MAX_CHARS) flush(index);
  });
  if (start < lines.length) flush(lines.length - 1);
  return chunks;
}
