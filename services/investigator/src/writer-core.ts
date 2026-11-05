import { createHash } from 'node:crypto';
import type { WriteOperation, WriteReversal, WriteRowResult, WriteValue } from '@aditum-chat/shared';

/**
 * Applies a proposal to production, or rehearses it in a transaction that rolls back. Nothing here
 * trusts the proposal: what's allowed comes from the user's GRANTs and the database's own catalog,
 * and each row has to be the one that was reviewed. Kept apart from the network so it can be tested.
 */

const MAX_OPERATIONS = 50;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const LOCK_WAIT_SECONDS = 5;
/** Longer: a transaction cut off a moment ago may still be finishing, and only its locks show that. */
const RECOVERY_LOCK_WAIT_SECONDS = 30;
/** If the Pi loses power or the network mid-write, MySQL drops the session and releases the rows. */
const IDLE_SESSION_SECONDS = 120;

export interface Db {
  rows(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  run(sql: string, params?: unknown[]): Promise<{ affectedRows: number; insertId: number }>;
}

/** Stops the write. Whatever it was doing, the transaction rolls back and nothing changes. */
export class WriteAbort extends Error {}

/** COMMIT failed partway: it may or may not have landed, so only reading the rows can tell. */
export class CommitUncertain extends Error {
  constructor(readonly rows: WriteRowResult[]) {
    super('COMMIT did not confirm');
  }
}

export interface WriteGrants {
  /** Table name to its privileges. */
  tables: Record<string, string[]>;
  problem: string | null;
}

const ALLOWED_PRIVILEGES = new Set(['SELECT', 'INSERT', 'UPDATE']);

/**
 * Table by table, and only SELECT, INSERT and UPDATE. Anything broader is refused rather than used
 * carefully, since the connection is typed into the console and could be an admin.
 */
export function parseWriteGrants(grants: string[], database: string): WriteGrants {
  const tables: Record<string, string[]> = {};
  const refuse = (grant: string) => ({ tables: {}, problem: `El usuario tiene más permisos de los permitidos: ${grant.replace(/ TO .*/i, '')}` });
  for (const grant of grants) {
    if (/^GRANT USAGE ON \*\.\* TO /i.test(grant)) continue;
    const match = grant.match(/^GRANT (.+?) ON `([^`]+)`\.`([^`]+)` TO /i);
    if (!match || /WITH GRANT OPTION/i.test(grant) || match[2] !== database) return refuse(grant);
    const privileges = match[1].split(',').map((privilege) => privilege.trim().toUpperCase());
    if (!privileges.every((privilege) => ALLOWED_PRIVILEGES.has(privilege))) return refuse(grant);
    tables[match[3]] = privileges;
  }
  if (Object.keys(tables).length === 0) return { tables, problem: `El usuario no tiene permisos sobre ninguna tabla de ${database}.` };
  return { tables, problem: null };
}

const quote = (identifier: string) => {
  if (!IDENTIFIER.test(identifier)) throw new WriteAbort(`El nombre "${identifier.slice(0, 64)}" no es válido.`);
  return `\`${identifier}\``;
};

interface TableInfo {
  columns: Set<string>;
  primaryKey: string[];
  /** Columns the database fills in on its own, which legitimately differ between two runs. */
  onUpdate: Set<string>;
  generatedOnInsert: Set<string>;
  /** Computed by MySQL. */
  generated: Set<string>;
}

const lower = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase(), v]));

/** From the database's catalog, whatever the proposal claims about the table. */
export async function loadTableInfo(db: Db, database: string, table: string): Promise<TableInfo> {
  const [meta] = await db.rows('SELECT engine AS engine, table_type AS kind FROM information_schema.tables WHERE table_schema = ? AND table_name = ?', [database, table]);
  if (!meta) throw new WriteAbort(`No existe la tabla ${table}, o este usuario no tiene permisos sobre ella.`);
  const { engine, kind } = lower(meta);
  if (kind !== 'BASE TABLE') throw new WriteAbort(`${table} no es una tabla.`);
  // Rolling back is what makes a rehearsal safe, and other engines don't.
  if (String(engine).toLowerCase() !== 'innodb') throw new WriteAbort(`${table} no usa InnoDB, así que un ensayo no se podría deshacer.`);

  const columns = (await db.rows('SELECT column_name AS name, extra AS extra FROM information_schema.columns WHERE table_schema = ? AND table_name = ?', [database, table])).map(lower);
  const primary = (
    await db.rows("SELECT column_name AS name FROM information_schema.statistics WHERE table_schema = ? AND table_name = ? AND index_name = 'PRIMARY' ORDER BY seq_in_index", [database, table])
  ).map(lower);
  if (primary.length === 0) throw new WriteAbort(`${table} no tiene llave primaria.`);
  const withExtra = (pattern: RegExp) => new Set(columns.filter((column) => pattern.test(String(column.extra))).map((column) => String(column.name)));
  return {
    columns: new Set(columns.map((column) => String(column.name))),
    primaryKey: primary.map((column) => String(column.name)),
    onUpdate: withExtra(/on update/i),
    generatedOnInsert: withExtra(/auto_increment|default_generated/i),
    generated: withExtra(/(virtual|stored) generated/i),
  };
}

/** Everything that can be known wrong before touching a row. */
export function operationProblem(operation: WriteOperation, info: TableInfo, privileges: string[] | undefined): string | null {
  const { table } = operation;
  if (!privileges) return `El usuario no tiene permisos sobre ${table}.`;
  const named = operation.op === 'update' ? [...Object.keys(operation.key), ...Object.keys(operation.set)] : Object.keys(operation.values);
  const unknown = named.find((column) => !info.columns.has(column));
  if (unknown) return `${table} no tiene la columna ${unknown.slice(0, 64)}.`;
  if (operation.op === 'update') {
    if (!privileges.includes('SELECT') || !privileges.includes('UPDATE')) return `El usuario no puede actualizar ${table}.`;
    const key = Object.keys(operation.key).sort();
    if (key.join() !== [...info.primaryKey].sort().join()) return `La llave de ${table} debe ser exactamente su llave primaria (${info.primaryKey.join(', ')}).`;
    if (Object.keys(operation.set).some((column) => info.primaryKey.includes(column))) return `No se puede cambiar la llave primaria de ${table}.`;
  } else if (!privileges.includes('SELECT') || !privileges.includes('INSERT')) {
    return `El usuario no puede insertar en ${table}.`;
  }
  return null;
}

function comparable(value: unknown): WriteValue | { $binary: string } {
  if (Buffer.isBuffer(value)) return { $binary: value.toString('base64') };
  if (value === undefined) return null;
  return value instanceof Date ? value.toISOString() : (value as WriteValue);
}

export function rowHash(row: Record<string, unknown>, leaveOut: Set<string> = new Set()): string {
  const entries = Object.keys(row)
    .filter((column) => !leaveOut.has(column))
    .sort()
    .map((column) => [column, comparable(row[column])]);
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

const pick = (row: Record<string, unknown>, columns: Iterable<string>): Record<string, WriteValue> =>
  Object.fromEntries([...new Set(columns)].map((column) => {
    const value = comparable(row[column]);
    return [column, typeof value === 'object' && value !== null ? '[binario]' : value];
  }));

const whereKey = (key: Record<string, unknown>) => {
  const columns = Object.keys(key);
  return { sql: columns.map((column) => `${quote(column)} = ?`).join(' AND '), params: columns.map((column) => key[column]) };
};

async function lockRow(db: Db, table: string, key: Record<string, unknown>) {
  const where = whereKey(key);
  const rows = await db.rows(`SELECT * FROM ${quote(table)} WHERE ${where.sql} FOR UPDATE`, where.params);
  if (rows.length !== 1) throw new WriteAbort(`Se esperaba una fila en ${table} para ${JSON.stringify(key)} y hay ${rows.length}.`);
  return rows[0];
}

async function readRow(db: Db, table: string, key: Record<string, unknown>) {
  const where = whereKey(key);
  const rows = await db.rows(`SELECT * FROM ${quote(table)} WHERE ${where.sql}`, where.params);
  if (rows.length !== 1) throw new WriteAbort(`No se pudo leer la fila de ${table} para ${JSON.stringify(key)}.`);
  return rows[0];
}

export interface ExpectedRow {
  beforeHash: string | null;
  afterHash: string;
  affected: number;
}

/** The database may hand back 150.00 for 150, or 1 for true. */
function sameValue(stored: unknown, requested: unknown) {
  if (stored === requested) return true;
  if (stored === null || stored === undefined || requested === null) return false;
  const wanted = typeof requested === 'boolean' ? Number(requested) : requested;
  if (String(stored) === String(wanted)) return true;
  return String(wanted).trim() !== '' && Number(stored) === Number(wanted);
}

async function applyOperation(db: Db, operation: WriteOperation, info: TableInfo, expected?: ExpectedRow): Promise<WriteRowResult> {
  const { table } = operation;
  if (operation.op === 'update') {
    const before = await lockRow(db, table, operation.key);
    const beforeHash = rowHash(before);
    if (expected && expected.beforeHash !== beforeHash) throw new WriteAbort(`La fila de ${table} ${JSON.stringify(operation.key)} cambió después del ensayo. Hay que ensayar de nuevo.`);
    const columns = Object.keys(operation.set);
    const where = whereKey(operation.key);
    const { affectedRows } = await db.run(
      `UPDATE ${quote(table)} SET ${columns.map((column) => `${quote(column)} = ?`).join(', ')} WHERE ${where.sql}`,
      [...columns.map((column) => operation.set[column]), ...where.params],
    );
    const after = await readRow(db, table, operation.key);
    const changed = Object.keys(after).filter((column) => rowHash({ v: before[column] }) !== rowHash({ v: after[column] }));
    const shown = [...info.primaryKey, ...columns, ...changed];
    return {
      op: 'update',
      table,
      key: operation.key,
      before: pick(before, shown),
      after: pick(after, shown),
      beforeHash,
      afterHash: rowHash(after, info.onUpdate),
      afterFullHash: rowHash(after),
      changed,
      generated: changed.filter((column) => info.generated.has(column)),
      notAsRequested: columns.filter((column) => !sameValue(after[column], operation.set[column])),
      affected: affectedRows,
    };
  }

  const columns = Object.keys(operation.values);
  const { affectedRows, insertId } = await db.run(
    `INSERT INTO ${quote(table)} (${columns.map(quote).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    columns.map((column) => operation.values[column]),
  );
  // The key is what was given, plus the number the database assigned, if any.
  const key = Object.fromEntries(info.primaryKey.map((column) => [column, column in operation.values ? operation.values[column] : insertId]));
  const after = await readRow(db, table, key);
  return {
    op: 'insert',
    table,
    key: pick(after, info.primaryKey),
    before: null,
    after: pick(after, [...info.primaryKey, ...columns]),
    beforeHash: null,
    afterHash: rowHash(after, new Set([...info.onUpdate, ...info.generatedOnInsert])),
    afterFullHash: rowHash(after),
    changed: Object.keys(after),
    generated: [],
    notAsRequested: columns.filter((column) => !sameValue(after[column], operation.values[column])),
    affected: affectedRows,
  };
}

/** From what the database returned, down to columns a trigger changed, so it restores the row exactly. */
export function reversalFrom(rows: WriteRowResult[]): WriteReversal {
  const reversal: WriteReversal = { operations: [], manual: [] };
  for (const row of [...rows].reverse()) {
    if (row.op === 'insert') {
      reversal.manual.push(`Borrar a mano la fila insertada en ${row.table}: ${JSON.stringify(row.key)}.`);
      continue;
    }
    const generated = new Set(row.generated);
    const settable = row.changed.filter((column) => !generated.has(column));
    const set = pick(row.before ?? {}, settable);
    if (Object.values(set).includes('[binario]')) {
      reversal.manual.push(`Restaurar a mano la columna binaria de ${row.table}: ${JSON.stringify(row.key)}.`);
    } else if (settable.length > 0) {
      reversal.operations.push({ op: 'update', table: row.table, key: row.key, set });
    }
  }
  return reversal;
}

/** The driver expands an object into SQL, so a value that isn't a plain one must never reach it. */
function assertPlainValues(operation: WriteOperation) {
  const columns = operation.op === 'update' ? [operation.key, operation.set] : [operation.values];
  const plain = (value: unknown) => value === null || ['string', 'number', 'boolean'].includes(typeof value);
  if (!columns.every((group) => Object.values(group).every(plain))) throw new WriteAbort(`Un valor para ${operation.table} no es válido.`);
}

async function prepared(db: Db, database: string, operations: WriteOperation[], grants: WriteGrants) {
  if (grants.problem) throw new WriteAbort(grants.problem);
  if (operations.length === 0 || operations.length > MAX_OPERATIONS) throw new WriteAbort('La cantidad de operaciones no es válida.');
  const infos = new Map<string, TableInfo>();
  for (const operation of operations) {
    quote(operation.table);
    assertPlainValues(operation);
    if (!infos.has(operation.table)) {
      if (!grants.tables[operation.table]) throw new WriteAbort(`El usuario no tiene permisos sobre ${operation.table}.`);
      infos.set(operation.table, await loadTableInfo(db, database, operation.table));
    }
    const problem = operationProblem(operation, infos.get(operation.table)!, grants.tables[operation.table]);
    if (problem) throw new WriteAbort(problem);
  }
  return infos;
}

/** Losing a lock wait fails fast instead of holding production rows, and a bad value errors instead of being cut. */
async function startTransaction(db: Db) {
  await db.run(`SET SESSION innodb_lock_wait_timeout = ${LOCK_WAIT_SECONDS}`);
  await db.run(`SET SESSION wait_timeout = ${IDLE_SESSION_SECONDS}`);
  await db.run("SET SESSION sql_mode = CONCAT(@@SESSION.sql_mode, ',STRICT_ALL_TABLES')");
  await db.run('START TRANSACTION');
}

/** Runs it for real inside a transaction and undoes it: triggers and constraints do what they'd do. */
export async function rehearse(db: Db, database: string, operations: WriteOperation[], grants: WriteGrants) {
  const infos = await prepared(db, database, operations, grants);
  await startTransaction(db);
  try {
    const rows: WriteRowResult[] = [];
    for (const operation of operations) rows.push(await applyOperation(db, operation, infos.get(operation.table)!));
    const unexpected = rows.find((row) => row.affected !== 1);
    if (unexpected) throw new WriteAbort(`Una operación sobre ${unexpected.table} afectó ${unexpected.affected} filas.`);
    // A trigger can still touch the row, so what counts is whether any column it asked for would change.
    const noChange = rows.find((row, i) => {
      const operation = operations[i];
      return operation.op === 'update' && !row.changed.some((column) => column in operation.set);
    });
    if (noChange) throw new WriteAbort(`La fila de ${noChange.table} ${JSON.stringify(noChange.key)} ya tiene esos valores: el cambio no haría nada.`);
    return { rows, reversal: reversalFrom(rows) };
  } finally {
    await db.run('ROLLBACK');
  }
}

/**
 * Applies what was rehearsed, only if every row is still as it was and ends up as it did. `beforeCommit`
 * records the outcome first, so that dying right after COMMIT can still be told apart from not committing.
 */
export async function execute(
  db: Db,
  database: string,
  operations: WriteOperation[],
  grants: WriteGrants,
  expected: ExpectedRow[],
  beforeCommit: (rows: WriteRowResult[]) => Promise<void>,
) {
  const infos = await prepared(db, database, operations, grants);
  if (expected.length !== operations.length) throw new WriteAbort('El ensayo no corresponde a estas operaciones.');
  await startTransaction(db);
  let committed = false;
  try {
    const rows: WriteRowResult[] = [];
    for (const [i, operation] of operations.entries()) {
      const row = await applyOperation(db, operation, infos.get(operation.table)!, expected[i]);
      if (row.affected !== expected[i].affected) throw new WriteAbort(`Una operación sobre ${row.table} afectó ${row.affected} filas y en el ensayo fueron ${expected[i].affected}.`);
      if (row.afterHash !== expected[i].afterHash) throw new WriteAbort(`La fila de ${row.table} ${JSON.stringify(row.key)} no quedó igual que en el ensayo.`);
      rows.push(row);
    }
    await beforeCommit(rows);
    try {
      await db.run('COMMIT');
    } catch {
      throw new CommitUncertain(rows);
    }
    committed = true;
    return { rows, reversal: reversalFrom(rows) };
  } finally {
    if (!committed) await db.run('ROLLBACK').catch(() => {});
  }
}

export type RecoveredOutcome = 'applied' | 'not_applied' | 'unknown';

/**
 * After dying mid-write: the rows say what happened. Never tries again, and anything but a clear
 * answer goes to a human. Without `pending` it never reached COMMIT, and the transaction died with it.
 * It locks to read, because a plain read could see the rows just before a COMMIT in progress lands.
 * If the lock doesn't come, this throws, and that's an unknown too.
 */
export async function recover(db: Db, pending: WriteRowResult[] | null | undefined): Promise<RecoveredOutcome> {
  if (!pending?.length) return 'not_applied';
  // A binary key was kept only as a label, so the row can't be looked up.
  if (pending.some((row) => Object.values(row.key).includes('[binario]'))) return 'unknown';
  await db.run(`SET SESSION innodb_lock_wait_timeout = ${RECOVERY_LOCK_WAIT_SECONDS}`);
  await db.run('START TRANSACTION');
  try {
    const states: ('after' | 'before' | 'other')[] = [];
    for (const row of pending) {
      const where = whereKey(row.key);
      const [current] = await db.rows(`SELECT * FROM ${quote(row.table)} WHERE ${where.sql} FOR UPDATE`, where.params);
      if (!current) states.push(row.op === 'insert' ? 'before' : 'other');
      else if (rowHash(current) === row.afterFullHash) states.push('after');
      else if (row.beforeHash && rowHash(current) === row.beforeHash) states.push('before');
      else states.push('other');
    }
    if (states.every((state) => state === 'after')) return 'applied';
    if (states.every((state) => state === 'before')) return 'not_applied';
    return 'unknown';
  } finally {
    await db.run('ROLLBACK').catch(() => {});
  }
}
