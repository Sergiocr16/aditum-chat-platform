import { readFileSync, writeFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { stringify } from 'yaml';
import { classifyColumn, parsePiiMap, type PiiMap, type Policy } from './piiMap.js';

/**
 * Writes a first draft of the map, for a person to review. It reads column names only,
 * never rows. Decisions already in the file are kept, so it can be rerun as the schema grows.
 *
 *   ADMIN_DB_USER=… ADMIN_DB_PASSWORD=… tsx src/classify-schema.ts deploy/pii-map.yml
 */
const [file] = process.argv.slice(2);
if (!file) throw new Error('Uso: classify-schema <pii-map.yml>');

const conn = await mysql.createConnection({
  host: process.env.ADMIN_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.ADMIN_DB_PORT ?? 3306),
  user: process.env.ADMIN_DB_USER,
  password: process.env.ADMIN_DB_PASSWORD,
});
const source = process.env.SOURCE_DB ?? 'aditum';
const [rows] = await conn.query(
  'SELECT table_name AS t, column_name AS c, data_type AS d FROM information_schema.columns WHERE table_schema = ? ORDER BY table_name, ordinal_position',
  [source],
);
await conn.end();

let existing: PiiMap = {};
try {
  existing = parsePiiMap(readFileSync(file, 'utf8'));
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
}

const map: PiiMap = {};
const counts: Partial<Record<Policy, number>> = {};
for (const { t, c, d } of rows as { t: string; c: string; d: string }[]) {
  const policy = existing[t]?.[c] ?? classifyColumn(t, c, d);
  (map[t] ??= {})[c] = policy;
  counts[policy] = (counts[policy] ?? 0) + 1;
}
writeFileSync(file, stringify(map, { sortMapEntries: false }), { mode: 0o600 });
console.log(counts);
