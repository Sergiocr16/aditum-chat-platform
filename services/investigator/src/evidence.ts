import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import type {
  InvestigationCodeEvidence,
  InvestigationConclusion,
  InvestigationDataEvidence,
  InvestigationReport,
} from '@aditum-chat/shared';

/**
 * Evidence is checked here, by code, not by the model. A report can claim anything;
 * it only reaches `confirmed` if what it cites is really in that code or in the
 * result of a query this same job ran.
 */

const MIN_QUOTE_CHARS = 4;

const collapse = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim();

export function codeEvidenceProblem(evidence: InvestigationCodeEvidence, checkoutDir: string): string | null {
  const { path, startLine, endLine, quote } = evidence;
  if (isAbsolute(path)) return 'la ruta debe ser relativa al repositorio';
  let file: string;
  try {
    const root = realpathSync(checkoutDir);
    file = realpathSync(join(root, path));
    if (relative(root, file).startsWith('..')) return 'la ruta está fuera del repositorio';
  } catch {
    return `no existe ${path}`;
  }
  const lines = readFileSync(file, 'utf8').split('\n');
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
    return 'el rango de líneas no es válido';
  }
  if (endLine > lines.length) return `${path} tiene ${lines.length} líneas`;
  const wanted = collapse(quote);
  if (wanted.length < MIN_QUOTE_CHARS) return 'la cita es demasiado corta';
  const excerpt = collapse(lines.slice(startLine - 1, endLine).join('\n'));
  return excerpt.includes(wanted) ? null : `la cita no aparece en ${path}:${startLine}-${endLine}`;
}

/** What the gateway keeps of each query this job ran. */
export interface LoggedQuery {
  queryId: string;
  questionId: string;
  dataQuestion: string;
  purpose: string;
  sql: string;
  rows: Record<string, unknown>[];
  truncated: boolean;
  ms: number;
  error: string | null;
}

const asNumber = (value: string) => (value !== '' && Number.isFinite(Number(value)) ? Number(value) : null);

function sameValue(wanted: string, cell: unknown): boolean {
  if (cell === null || cell === undefined) return wanted.trim().toLowerCase() === 'null';
  const a = wanted.trim();
  const b = String(cell).trim();
  if (a === b) return true;
  const [x, y] = [asNumber(a), asNumber(b)];
  return x !== null && x === y;
}

export function dataEvidenceProblem(evidence: InvestigationDataEvidence, queries: LoggedQuery[]): string | null {
  const query = queries.find((q) => q.queryId === evidence.queryId);
  if (!query) return `no existe la consulta ${evidence.queryId}`;
  if (query.error) return `la consulta ${evidence.queryId} falló`;
  if (evidence.values.length === 0) return 'no indica qué valores respaldan la afirmación';
  const cells = query.rows.flatMap((row) => Object.values(row));
  const missing = evidence.values.find((value) => !cells.some((cell) => sameValue(value, cell)));
  return missing === undefined ? null : `${evidence.queryId} no devolvió "${missing}"`;
}

/** The model's output, as `--json-schema` asks for it. */
export interface RawReport {
  conclusion: InvestigationConclusion;
  summary: string;
  cause: string;
  recommendation: string;
  suggested_reply: string;
  missing: string[];
  code_evidence: { path: string; start_line: number; end_line: number; quote: string }[];
  data_evidence: { query_id: string; values: string[] }[];
}

export const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    conclusion: { type: 'string', enum: ['confirmed', 'hypothesis', 'undetermined'] },
    summary: { type: 'string' },
    cause: { type: 'string' },
    recommendation: { type: 'string' },
    suggested_reply: { type: 'string' },
    missing: { type: 'array', items: { type: 'string' } },
    code_evidence: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          start_line: { type: 'integer' },
          end_line: { type: 'integer' },
          quote: { type: 'string' },
        },
        required: ['path', 'start_line', 'end_line', 'quote'],
        additionalProperties: false,
      },
    },
    data_evidence: {
      type: 'array',
      items: {
        type: 'object',
        properties: { query_id: { type: 'string' }, values: { type: 'array', items: { type: 'string' } } },
        required: ['query_id', 'values'],
        additionalProperties: false,
      },
    },
  },
  required: ['conclusion', 'summary', 'cause', 'recommendation', 'suggested_reply', 'missing', 'code_evidence', 'data_evidence'],
  additionalProperties: false,
} as const;

/**
 * Keeps only evidence that checks out. One invented item is enough to lose
 * `confirmed`: it means the rest of the reasoning can't be taken on trust either.
 */
export function verifyReport(raw: RawReport, checkoutDir: string, queries: LoggedQuery[]): InvestigationReport {
  const code: InvestigationCodeEvidence[] = raw.code_evidence.map((e) => ({
    path: e.path,
    startLine: e.start_line,
    endLine: e.end_line,
    quote: e.quote,
  }));
  const data: InvestigationDataEvidence[] = raw.data_evidence.map((e) => ({ queryId: e.query_id, values: e.values }));
  const validCode = code.filter((e) => codeEvidenceProblem(e, checkoutDir) === null);
  const validData = data.filter((e) => dataEvidenceProblem(e, queries) === null);
  const rejected = [
    ...code.map((e) => codeEvidenceProblem(e, checkoutDir)),
    ...data.map((e) => dataEvidenceProblem(e, queries)),
  ].filter((problem): problem is string => problem !== null);
  const hasEvidence = validCode.length + validData.length > 0;

  let conclusion = raw.conclusion;
  if (conclusion === 'confirmed' && (rejected.length > 0 || !hasEvidence)) conclusion = hasEvidence ? 'hypothesis' : 'undetermined';
  if (conclusion === 'hypothesis' && !hasEvidence) conclusion = 'undetermined';

  return {
    conclusion,
    downgradedFrom: conclusion === raw.conclusion ? null : raw.conclusion,
    summary: raw.summary.trim(),
    cause: raw.cause.trim(),
    recommendation: raw.recommendation.trim(),
    suggestedReply: conclusion === 'confirmed' && raw.suggested_reply.trim() ? raw.suggested_reply.trim() : null,
    missing: raw.missing.map((item) => item.trim()).filter(Boolean),
    codeEvidence: validCode,
    dataEvidence: validData,
    rejectedEvidence: rejected,
  };
}
