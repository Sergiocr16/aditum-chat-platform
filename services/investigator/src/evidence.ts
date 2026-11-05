import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import type {
  InvestigationBacklogDraft,
  InvestigationBacklogRow,
  InvestigationClassification,
  InvestigationCodeEvidence,
  InvestigationConclusion,
  InvestigationDataEvidence,
  InvestigationReport,
  WriteOperation,
  WriteProposalDraft,
  WriteRiskLevel,
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
  let lines: string[];
  try {
    lines = readFileSync(file, 'utf8').split('\n');
  } catch {
    // A folder, say. It's a bad citation like any other, not a reason to lose the whole report.
    return `${path || 'la ruta'} no es un archivo`;
  }
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

/** The backlog's options, from the `aditum-backlog-definer` skill. Functions checks them against the real board. */
const BACKLOG_PRIORITIES = ['Urgente', 'Alta', 'Media', 'Baja'] as const;
const BACKLOG_MODULES = [
  'Contabilidad',
  'General',
  'Residentes',
  'Visitantes',
  'App residentes',
  'Cobros',
  'Seguridad',
  'Áreas comunes',
  'Ingreso por QR',
  'app diosaditum',
  'app administración',
  'Asambleas',
] as const;
const BACKLOG_ROLES = ['Administrador', 'Residente', 'Aditum', 'Oficiales de seguridad', 'Contador'] as const;

export interface RawBacklogItem {
  name: string;
  description: string;
  priority: InvestigationBacklogDraft['priority'];
  modules: string[];
  roles: string[];
  problem: string;
  expected: string;
  steps: string[];
  screen_name: string;
  how_to_reach: string;
  acceptance: string[];
  notes: string;
  duplicate_of: string | null;
}

export interface RawWriteProposal {
  reason: string;
  operations: WriteOperation[];
  consequence: string;
  consequence_evidence: { path: string; start_line: number; end_line: number; quote: string }[];
  risk_level: WriteRiskLevel;
  risk: string;
  cache: string;
}

/** The model's output, as `--json-schema` asks for it. */
export interface RawReport {
  classification: InvestigationClassification;
  write_proposal?: RawWriteProposal | null;
  backlog_item: RawBacklogItem | null;
  conclusion: InvestigationConclusion;
  summary: string;
  cause: string;
  recommendation: string;
  suggested_reply: string;
  missing: string[];
  code_evidence: { path: string; start_line: number; end_line: number; quote: string }[];
  data_evidence: { query_id: string; values: string[] }[];
}

const CODE_CITATION = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    start_line: { type: 'integer' },
    end_line: { type: 'integer' },
    quote: { type: 'string' },
  },
  required: ['path', 'start_line', 'end_line', 'quote'],
  additionalProperties: false,
} as const;

// anyOf and not a list of types: the CLI validates in strict mode, and only fails once this part is filled in.
const COLUMNS = {
  type: 'object',
  additionalProperties: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }] },
} as const;

export const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    write_proposal: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          properties: {
            reason: { type: 'string' },
            operations: {
              type: 'array',
              items: {
                anyOf: [
                  {
                    type: 'object',
                    properties: { op: { type: 'string', enum: ['update'] }, table: { type: 'string' }, key: COLUMNS, set: COLUMNS },
                    required: ['op', 'table', 'key', 'set'],
                    additionalProperties: false,
                  },
                  {
                    type: 'object',
                    properties: { op: { type: 'string', enum: ['insert'] }, table: { type: 'string' }, values: COLUMNS },
                    required: ['op', 'table', 'values'],
                    additionalProperties: false,
                  },
                ],
              },
            },
            consequence: { type: 'string' },
            consequence_evidence: { type: 'array', items: CODE_CITATION },
            risk_level: { type: 'string', enum: ['low', 'medium', 'high', 'undetermined'] },
            risk: { type: 'string' },
            cache: { type: 'string' },
          },
          required: ['reason', 'operations', 'consequence', 'consequence_evidence', 'risk_level', 'risk', 'cache'],
          additionalProperties: false,
        },
      ],
    },
    classification: { type: 'string', enum: ['bug', 'data_error', 'missing_feature', 'expected_behavior', 'question', 'unknown'] },
    backlog_item: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            priority: { type: 'string', enum: BACKLOG_PRIORITIES },
            modules: { type: 'array', items: { type: 'string', enum: BACKLOG_MODULES } },
            roles: { type: 'array', items: { type: 'string', enum: BACKLOG_ROLES } },
            problem: { type: 'string' },
            expected: { type: 'string' },
            steps: { type: 'array', items: { type: 'string' } },
            screen_name: { type: 'string' },
            how_to_reach: { type: 'string' },
            acceptance: { type: 'array', items: { type: 'string' } },
            notes: { type: 'string' },
            duplicate_of: { type: ['string', 'null'] },
          },
          required: ['name', 'description', 'priority', 'modules', 'roles', 'problem', 'expected', 'steps', 'screen_name', 'how_to_reach', 'acceptance', 'notes', 'duplicate_of'],
          additionalProperties: false,
        },
      ],
    },
    conclusion: { type: 'string', enum: ['confirmed', 'hypothesis', 'undetermined'] },
    summary: { type: 'string' },
    cause: { type: 'string' },
    recommendation: { type: 'string' },
    suggested_reply: { type: 'string' },
    missing: { type: 'array', items: { type: 'string' } },
    code_evidence: { type: 'array', items: CODE_CITATION },
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
  required: ['classification', 'backlog_item', 'write_proposal', 'conclusion', 'summary', 'cause', 'recommendation', 'suggested_reply', 'missing', 'code_evidence', 'data_evidence'],
  additionalProperties: false,
} as const;

const cleanList = (items: string[]) => items.map((item) => item.trim()).filter(Boolean);

/**
 * Only a confirmed bug goes to the backlog, whatever the model filled in. A duplicate has to be a
 * row it was really shown: `rows` is null when the board couldn't be read.
 */
export function backlogDraftFrom(
  raw: RawReport,
  conclusion: InvestigationConclusion,
  rows: InvestigationBacklogRow[] | null | undefined,
): InvestigationBacklogDraft | null {
  const item = raw.backlog_item;
  if (!item || conclusion !== 'confirmed' || raw.classification !== 'bug') return null;
  const duplicate = rows?.find((row) => row.id === item.duplicate_of);
  return {
    name: item.name.trim(),
    description: item.description.trim(),
    priority: item.priority,
    modules: cleanList(item.modules),
    roles: cleanList(item.roles),
    problem: item.problem.trim(),
    expected: item.expected.trim(),
    steps: cleanList(item.steps),
    screenName: item.screen_name.trim(),
    howToReach: item.how_to_reach.trim(),
    acceptance: cleanList(item.acceptance),
    notes: item.notes.trim(),
    duplicateOf: duplicate ? { id: duplicate.id, title: duplicate.title, url: duplicate.url } : null,
    duplicateChecked: Array.isArray(rows),
  };
}

/**
 * Keeps only evidence that checks out. One invented item is enough to lose
 * `confirmed`: it means the rest of the reasoning can't be taken on trust either.
 */
export function verifyReport(
  raw: RawReport,
  checkoutDir: string,
  queries: LoggedQuery[],
  backlogRows?: InvestigationBacklogRow[] | null,
): InvestigationReport {
  const code: InvestigationCodeEvidence[] = raw.code_evidence.map((e) => ({
    path: e.path,
    startLine: e.start_line,
    endLine: e.end_line,
    quote: e.quote,
  }));
  const data: InvestigationDataEvidence[] = raw.data_evidence.map((e) => ({ queryId: e.query_id, values: e.values }));
  const proposal = raw.write_proposal ?? null;
  const consequenceEvidence: InvestigationCodeEvidence[] = (proposal?.consequence_evidence ?? []).map((e) => ({
    path: e.path,
    startLine: e.start_line,
    endLine: e.end_line,
    quote: e.quote,
  }));
  const validCode = code.filter((e) => codeEvidenceProblem(e, checkoutDir) === null);
  const validData = data.filter((e) => dataEvidenceProblem(e, queries) === null);
  const rejected = [
    ...code.map((e) => codeEvidenceProblem(e, checkoutDir)),
    // Claiming who reads the data with an invented citation is as bad as inventing the cause.
    ...consequenceEvidence.map((e) => codeEvidenceProblem(e, checkoutDir)),
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
    classification: raw.classification,
    backlogDraft: backlogDraftFrom(raw, conclusion, backlogRows),
    writeProposal: proposal && {
      reason: proposal.reason.trim(),
      operations: proposal.operations,
      consequence: proposal.consequence.trim(),
      consequenceEvidence,
      riskLevel: proposal.risk_level,
      risk: proposal.risk.trim(),
      cache: proposal.cache.trim(),
    } satisfies WriteProposalDraft,
  };
}
