import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';
import mysql from 'mysql2/promise';
import type { InvestigatorWriterCheck, WriteOperation, WriteRowResult } from '@aditum-chat/shared';
import type { DbConnection } from './dbCheck.js';
import { CommitUncertain, execute, parseWriteGrants, recover, rehearse, reversalFrom, WriteAbort, type Db, type ExpectedRow, type WriteGrants } from './writer-core.js';

/**
 * Own OS user, outbound calls only, no port open. The password isn't on this machine: it comes with
 * each job an admin asked for, and lasts as long as the job does.
 */

const POLL_MS = 10_000;
const HEARTBEAT_MS = 60_000;
const REPORT_ATTEMPTS = 40;
const REPORT_RETRY_MS = 15_000;
/** Longer than any lock wait, shorter than MySQL dropping an idle session. */
const QUERY_TIMEOUT_MS = 60_000;

interface WriterJob {
  id: string;
  kind: 'check' | 'rehearse' | 'execute' | 'recover';
  connection: DbConnection;
  /** The certificate saved in the console, which verifies the server. */
  ca?: string | null;
  operations?: WriteOperation[];
  expected?: ExpectedRow[];
  pending?: WriteRowResult[] | null;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name}`);
  return value;
}

const functionUrl = () => required('WRITER_FUNCTION_URL');

async function call<T>(action: string, body: object = {}): Promise<T> {
  const response = await fetch(functionUrl(), {
    method: 'POST',
    headers: { authorization: `Bearer ${required('WRITER_SHARED_SECRET')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${action}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

/** A result that doesn't arrive would leave a write looking unfinished, so this insists for a while. */
async function report(jobId: string, result: object) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await call('result', { jobId, ...result });
      return;
    } catch (e) {
      if (attempt === REPORT_ATTEMPTS) throw e;
      console.error('result', (e as Error).message);
      await new Promise((resolve) => setTimeout(resolve, REPORT_RETRY_MS));
    }
  }
}

/** A hung server or network can't hold up the writer. Dropping the connection also rolls back. */
function bounded<T>(conn: mysql.Connection, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      conn.destroy();
      reject(new Error('MySQL no respondió a tiempo.'));
    }, QUERY_TIMEOUT_MS);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Anything with values is a prepared statement, so they never become SQL text: the driver's escaping
 * isn't safe with every sql_mode. Transaction control can't be prepared, and has no values.
 */
function dbOver(conn: mysql.Connection): Db {
  return {
    rows: async (sql, params) =>
      (await bounded(conn, params?.length ? conn.execute<mysql.RowDataPacket[]>(sql, params as never[]) : conn.query<mysql.RowDataPacket[]>(sql)))[0] as Record<string, unknown>[],
    run: async (sql, params) => {
      const [result] = await bounded(conn, params?.length ? conn.execute<mysql.ResultSetHeader>(sql, params as never[]) : conn.query<mysql.ResultSetHeader>(sql));
      return { affectedRows: result.affectedRows, insertId: result.insertId };
    },
  };
}

async function connect(connection: DbConnection, ca: string) {
  return mysql.createConnection({
    ...connection,
    // The certificate alone would accept any server it signed, so the name is checked too.
    ssl: { ca, rejectUnauthorized: true, verifyIdentity: true },
    multipleStatements: false,
    connectTimeout: 10_000,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
}

const closeQuietly = (conn: mysql.Connection) => bounded(conn, conn.end()).catch(() => conn.destroy());

/** What the user can do, read fresh for every job: grants can widen after the last check. */
async function checks(conn: mysql.Connection, connection: DbConnection) {
  const list: InvestigatorWriterCheck[] = [{ id: 'connect', ok: true, detail: `Conectó a ${connection.host}:${connection.port} como ${connection.user}.` }];
  const [cipher] = await bounded(conn, conn.query<mysql.RowDataPacket[]>("SHOW SESSION STATUS LIKE 'Ssl_cipher'"));
  const encrypted = Boolean(cipher[0]?.Value);
  list.push({
    id: 'tls',
    ok: encrypted,
    detail: encrypted ? 'Cifrada y con el servidor verificado.' : 'La conexión no está cifrada.',
  });
  const [grantRows] = await bounded(conn, conn.query<mysql.RowDataPacket[]>('SHOW GRANTS FOR CURRENT_USER()'));
  // Roles don't exist before MySQL 8, and there this function doesn't either.
  const [roles] = await bounded(conn, conn.query<mysql.RowDataPacket[]>('SELECT CURRENT_ROLE() AS role_name')).catch(() => [[{ role_name: 'NONE' }]] as unknown as [mysql.RowDataPacket[]]);
  let grants: WriteGrants = parseWriteGrants(grantRows.map((row) => String(Object.values(row)[0])), connection.database);
  if (roles[0]?.role_name !== 'NONE') grants = { tables: {}, problem: 'El usuario tiene un rol activo, y solo se aceptan permisos directos.' };
  list.push({
    id: 'grants',
    ok: grants.problem === null,
    detail:
      grants.problem ??
      (grants.database
        ? `Tiene ${grants.database.join(', ')} sobre toda la base ${connection.database}, y nada más.`
        : `Solo tiene SELECT, INSERT o UPDATE en ${Object.keys(grants.tables).length} tablas.`),
  });
  return { list, grants: encrypted ? grants : { tables: {}, problem: 'La conexión no está cifrada.' } };
}

const INTERRUPTED = 'El proceso se interrumpió. El resultado se comprobó leyendo las filas.';
const UNCLEAR = 'Las filas no coinciden ni con el antes ni con el después. Hay que revisarlas a mano.';
const UNCHECKED = 'No se pudo comprobar el resultado leyendo las filas. Hay que revisarlas a mano.';

/** The connection is gone or broken, so this reads the rows over a new one. */
async function resultFromRows(job: WriterJob, ca: string, rows: WriteRowResult[]) {
  const reversal = reversalFrom(rows);
  try {
    const conn = await connect(job.connection, ca);
    try {
      const outcome = await recover(dbOver(conn), rows);
      return { outcome, detail: outcome === 'unknown' ? UNCLEAR : INTERRUPTED, rows, reversal };
    } finally {
      await closeQuietly(conn);
    }
  } catch (e) {
    console.error('recover', (e as Error).message);
    return { outcome: 'unknown', detail: UNCHECKED, rows, reversal };
  }
}

/** Only a job that can't have changed anything may end as a plain failure. */
const failure = (job: WriterJob, detail: string, extra: object = {}) =>
  job.kind === 'recover'
    ? { outcome: 'unknown', detail: `${detail} ${UNCHECKED}`, rows: job.pending ?? [], reversal: reversalFrom(job.pending ?? []) }
    : { outcome: 'failed', detail, ...extra };

async function resultOf(job: WriterJob, fileCa: string | null, fileCaProblem: string | null): Promise<object> {
  const ca = job.ca ?? fileCa;
  if (!ca || isIP(job.connection.host)) {
    // With an IP the driver gives TLS no name to check, and it ends up comparing against "localhost".
    const detail = ca ? 'Hay que conectar por el nombre que aparece en el certificado, no por una IP.' : (fileCaProblem ?? 'Falta el certificado que verifica el servidor de MySQL.');
    return failure(job, detail, { checks: [{ id: 'tls', ok: false, detail }] });
  }

  let conn: mysql.Connection;
  try {
    conn = await connect(job.connection, ca);
  } catch (e) {
    const detail = `No se pudo conectar (${(e as NodeJS.ErrnoException).code ?? 'error desconocido'}).`;
    return failure(job, detail, { checks: [{ id: 'connect', ok: false, detail }] });
  }
  try {
    const db = dbOver(conn);
    if (job.kind === 'recover') {
      const rows = job.pending ?? [];
      const outcome = await recover(db, rows);
      return { outcome, detail: outcome === 'unknown' ? UNCLEAR : INTERRUPTED, rows, reversal: reversalFrom(rows) };
    }
    const { list, grants } = await checks(conn, job.connection);
    if (job.kind === 'check') {
      const tables = Object.entries(grants.tables).map(([name, privileges]) => ({ name, privileges })).sort((a, b) => a.name.localeCompare(b.name));
      return { outcome: list.every((check) => check.ok) ? 'ok' : 'failed', checks: list, tables };
    }
    if (job.kind === 'rehearse') return { outcome: 'ok', ...(await rehearse(db, job.connection.database, job.operations ?? [], grants)) };
    const result = await execute(db, job.connection.database, job.operations ?? [], grants, job.expected ?? [], (rows) => call('committing', { jobId: job.id, rows }));
    return { outcome: 'applied', ...result };
  } catch (e) {
    if (e instanceof CommitUncertain) return resultFromRows(job, ca, e.rows);
    const known = e instanceof WriteAbort || (e as { sqlMessage?: string }).sqlMessage;
    if (!known) console.error('job', (e as Error).message);
    return failure(job, known ? (e as Error).message : 'Se interrumpió por un error interno.');
  } finally {
    await closeQuietly(conn);
  }
}

async function main() {
  functionUrl();
  required('WRITER_SHARED_SECRET');
  let ca: string | null = null;
  let caProblem: string | null = null;
  try {
    ca = process.env.WRITE_DB_CA_FILE ? readFileSync(process.env.WRITE_DB_CA_FILE, 'utf8') : null;
  } catch {
    // Stays up so the console can say why, instead of restarting forever.
    caProblem = 'El writer no puede leer el certificado de MySQL (WRITE_DB_CA_FILE).';
  }
  console.log('writer listo');
  let lastHeartbeat = 0;
  // The first claim asks about anything left halfway by a previous run of this process.
  let startup = true;
  for (;;) {
    try {
      const heartbeat = Date.now() - lastHeartbeat >= HEARTBEAT_MS;
      if (heartbeat) lastHeartbeat = Date.now();
      const { job } = await call<{ job: WriterJob | null }>('claim', { heartbeat, startup });
      startup = false;
      if (job) {
        console.log(`trabajo ${job.kind} ${job.id}`);
        // A result that can't be delivered must not turn into another result: the job stays open, and
        // the next claim works out what happened by reading the rows.
        startup = true;
        await report(job.id, await resultOf(job, ca, caProblem));
        startup = false;
        continue;
      }
    } catch (e) {
      console.error('poll', (e as Error).message);
      // The server may have handed over a job whose response never got here.
      startup = true;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
