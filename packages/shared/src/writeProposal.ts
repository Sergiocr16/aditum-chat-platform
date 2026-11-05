import type { InvestigationReport, WriteOperation, WriteProposalDraft, WriteValue } from './types';

/**
 * A proposal comes from a model that read what third parties wrote, so nothing in it is trusted.
 * This decides whether it can even reach an admin. There's no SQL text to check: operations are
 * structured, each on one row by its primary key, so a broad condition can't be expressed.
 */

/** Each operation touches one row, so this is also the limit on rows. */
export const MAX_WRITE_OPERATIONS = 50;
const MAX_VALUE_CHARS = 10_000;
/** With its rehearsal and execution, a proposal has to fit in one Firestore document. */
const MAX_PROPOSAL_BYTES = 200_000;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

const isValue = (value: unknown): value is WriteValue =>
  value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= MAX_VALUE_CHARS);

function columnsProblem(columns: unknown, what: string): string | null {
  if (typeof columns !== 'object' || columns === null || Array.isArray(columns)) return `${what} no es válido.`;
  const entries = Object.entries(columns);
  if (entries.length === 0) return `${what} está vacío.`;
  const bad = entries.find(([name, value]) => !IDENTIFIER.test(name) || !isValue(value));
  return bad ? `${what}: la columna "${String(bad[0]).slice(0, 64)}" o su valor no son válidos.` : null;
}

export function writeOperationProblem(operation: WriteOperation): string | null {
  const op = operation as unknown as Record<string, unknown>;
  if (typeof op?.table !== 'string' || !IDENTIFIER.test(op.table)) return 'Una operación no tiene una tabla válida.';
  if (op.op === 'update') {
    const problem = columnsProblem(op.key, 'La llave') ?? columnsProblem(op.set, 'El cambio');
    if (problem) return problem;
    const key = op.key as object;
    const overlap = Object.keys(op.set as object).find((column) => column in key);
    return overlap ? `No se puede cambiar la llave "${overlap}".` : null;
  }
  if (op.op === 'insert') return columnsProblem(op.values, 'Los valores');
  return 'Solo se puede proponer actualizar o insertar.';
}

const rowIdentity = (operation: WriteOperation) =>
  operation.op === 'update'
    ? `${operation.table}:${JSON.stringify(Object.entries(operation.key).sort(([a], [b]) => a.localeCompare(b)))}`
    : null;

/**
 * Why this proposal can't go on to an admin. Empty means it can.
 *
 * A cause that is still a hypothesis doesn't stop it: the admin is told, and decides on the
 * rehearsal. What does stop it is having no checked evidence at all, or a citation of its own
 * (who reads these data) that isn't in the code.
 */
export function writeProposalProblems(draft: WriteProposalDraft, report: Pick<InvestigationReport, 'conclusion' | 'codeEvidence'>): string[] {
  const problems: string[] = [];
  if (report.conclusion === 'undetermined') problems.push('Ninguna evidencia de la investigación se pudo comprobar.');
  if (report.codeEvidence.length === 0) problems.push('No hay evidencia de código.');
  if (report.conclusion !== 'confirmed') {
    // A confirmed conclusion already means no citation was rejected. Otherwise the Pi has to say so itself.
    if (!Array.isArray(draft.consequenceRejected)) problems.push('La Pi no revisó las citas de esta propuesta. Actualizala desde Configuración, Investigador.');
    else if (draft.consequenceRejected.length > 0) problems.push(`Una cita sobre quién usa estos datos no se pudo comprobar: ${draft.consequenceRejected.join('; ')}.`);
  }
  if (!draft.reason?.trim()) problems.push('Falta explicar por qué este cambio corrige el problema.');
  if (!draft.consequence?.trim() || !draft.consequenceEvidence?.length) problems.push('Falta quién usa estos datos, con evidencia del código.');
  if (!['low', 'medium', 'high', 'undetermined'].includes(draft.riskLevel) || !draft.risk?.trim()) problems.push('Falta el riesgo.');
  if (!draft.cache?.trim()) problems.push('Falta qué queda desactualizado en caché.');
  if (!Array.isArray(draft.operations) || draft.operations.length === 0) {
    problems.push('No hay operaciones.');
    return problems;
  }
  if (draft.operations.length > MAX_WRITE_OPERATIONS) problems.push(`Se pueden proponer hasta ${MAX_WRITE_OPERATIONS} filas.`);
  if (new TextEncoder().encode(JSON.stringify(draft)).length > MAX_PROPOSAL_BYTES) problems.push('La propuesta es demasiado grande.');
  const seen = new Set<string>();
  for (const operation of draft.operations) {
    const problem = writeOperationProblem(operation);
    if (problem) {
      problems.push(problem);
      continue;
    }
    const identity = rowIdentity(operation);
    if (identity && seen.has(identity)) problems.push(`Hay dos cambios a la misma fila de ${operation.table}.`);
    if (identity) seen.add(identity);
  }
  return problems;
}

const literal = (value: WriteValue) => {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
};
const assignments = (columns: Record<string, WriteValue>, separator: string) =>
  Object.entries(columns)
    .map(([column, value]) => `\`${column}\` = ${literal(value)}`)
    .join(separator);

/** For reading only. What runs is parameterized by the writer, from the operation itself. */
export function writeOperationSql(operation: WriteOperation): string {
  if (operation.op === 'update') {
    return `UPDATE \`${operation.table}\`\nSET ${assignments(operation.set, ', ')}\nWHERE ${assignments(operation.key, ' AND ')};`;
  }
  const columns = Object.keys(operation.values);
  return `INSERT INTO \`${operation.table}\` (${columns.map((column) => `\`${column}\``).join(', ')})\nVALUES (${columns.map((column) => literal(operation.values[column])).join(', ')});`;
}

/** What the admin types at the last step, so the number of rows and the tables are read and not assumed. */
export function writeConfirmationPhrase(operations: WriteOperation[]): string {
  const tables = [...new Set(operations.map((operation) => operation.table))].sort();
  return `${operations.length} ${operations.length === 1 ? 'fila' : 'filas'} en ${tables.join(', ')}`;
}
