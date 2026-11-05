import type { InvestigatorDbCheck } from '@aditum-chat/shared';
import mysql from 'mysql2/promise';

/**
 * The connection is typed into the console, so someone could paste an admin user there.
 * This user must only be able to read the one database, so anything broader
 * is refused rather than used carefully.
 */

export interface DbConnection {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/** With a CA file the server is verified. Without one the link is still encrypted, and the check says so. */
export const sslOptions = (ca: string | null) => (ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false });

/** Null when the user can only read that database. SHOW VIEW only reveals how its views are defined. */
export function grantsProblem(grants: string[], database: string): string | null {
  const selectOnDatabase = new RegExp(`^GRANT SELECT(, SHOW VIEW)? ON \`${database.replace(/[^\w$]/g, '')}\`\\.\\* TO `, 'i');
  const usage = /^GRANT USAGE ON \*\.\* TO /i;
  const extra = grants.filter((grant) => !usage.test(grant) && !selectOnDatabase.test(grant));
  if (extra.length > 0) return `El usuario tiene más permisos de los permitidos: ${extra[0].replace(/ TO .*/i, '')}`;
  return grants.some((grant) => selectOnDatabase.test(grant)) ? null : `El usuario no tiene SELECT sobre ${database}`;
}

function connectionProblem(e: NodeJS.ErrnoException, db: DbConnection): string {
  if (e.code === 'ER_ACCESS_DENIED_ERROR') return 'Usuario o contraseña incorrectos, o MySQL no acepta a este usuario desde esta IP.';
  if (e.code === 'ER_BAD_DB_ERROR' || e.code === 'ER_DBACCESS_DENIED_ERROR') return `El usuario no tiene acceso a la base ${db.database}.`;
  if (e.code === 'HANDSHAKE_NO_SSL_SUPPORT') return 'El servidor no acepta conexiones cifradas.';
  if (e.code === 'ETIMEDOUT' || e.code === 'ECONNREFUSED' || e.code === 'EHOSTUNREACH' || e.code === 'ENOTFOUND') {
    return `No se pudo llegar a ${db.host}:${db.port}. Revisá la IP, el puerto y que el firewall permita esta conexión.`;
  }
  return `No se pudo conectar (${e.code ?? 'error desconocido'}).`;
}

export async function checkConnection(db: DbConnection, ca: string | null): Promise<{ ok: boolean; checks: InvestigatorDbCheck[] }> {
  const checks: InvestigatorDbCheck[] = [];
  const done = () => ({ ok: checks.every((check) => check.ok), checks });
  let conn: mysql.Connection;
  try {
    conn = await mysql.createConnection({ ...db, multipleStatements: false, connectTimeout: 10_000, ssl: sslOptions(ca) });
  } catch (e) {
    checks.push({ id: 'connect', ok: false, detail: connectionProblem(e as NodeJS.ErrnoException, db) });
    return done();
  }
  try {
    checks.push({ id: 'connect', ok: true, detail: `Conectó a ${db.host}:${db.port} como ${db.user}.` });

    const [cipher] = await conn.query<mysql.RowDataPacket[]>("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
    const encrypted = Boolean(cipher[0]?.Value);
    checks.push({
      id: 'tls',
      ok: encrypted,
      detail: !encrypted
        ? 'La conexión no está cifrada.'
        : ca
          ? 'Cifrada y con el servidor verificado.'
          : 'Cifrada, pero sin verificar el certificado del servidor (falta RO_DB_CA_FILE en la Pi).',
    });

    const [grantRows] = await conn.query<mysql.RowDataPacket[]>('SHOW GRANTS FOR CURRENT_USER()');
    const grants = grantRows.map((row) => String(Object.values(row)[0]));
    const problem = grantsProblem(grants, db.database);
    checks.push({ id: 'grants', ok: problem === null, detail: problem ?? `Solo puede leer la base ${db.database}.` });
    if (problem) return done();

    const [tables] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name',
      [db.database],
    );
    checks.push({
      id: 'tables',
      ok: tables.length > 0,
      detail: tables.length > 0 ? `${tables.length} tablas disponibles.` : `La base ${db.database} no tiene tablas que este usuario pueda ver.`,
    });
    if (tables.length === 0) return done();

    await conn.query(`SELECT 1 FROM \`${String(tables[0].name).replace(/`/g, '')}\` LIMIT 1`);
    checks.push({ id: 'read', ok: true, detail: 'La lectura de prueba funcionó.' });
  } catch (e) {
    checks.push({ id: 'read', ok: false, detail: `La lectura de prueba falló: ${(e as Error).message.slice(0, 200)}` });
  } finally {
    await conn.end().catch(() => {});
  }
  return done();
}
