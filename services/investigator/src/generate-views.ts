import { readFileSync, writeFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { generateViews, parsePiiMap, type SchemaColumn } from './piiMap.js';

/**
 * Turns the reviewed map into SQL for a person to run. It connects only to read the
 * schema and executes nothing.
 *
 *   ADMIN_DB_USER=… ADMIN_DB_PASSWORD=… tsx src/generate-views.ts deploy/pii-map.yml deploy/views.generated.sql
 */
const [mapFile, outFile] = process.argv.slice(2);
if (!mapFile || !outFile) throw new Error('Uso: generate-views <pii-map.yml> <salida.sql>');

const conn = await mysql.createConnection({
  host: process.env.ADMIN_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.ADMIN_DB_PORT ?? 3306),
  user: process.env.ADMIN_DB_USER,
  password: process.env.ADMIN_DB_PASSWORD,
});
const source = process.env.SOURCE_DB ?? 'aditum';
const [rows] = await conn.query(
  "SELECT table_name AS `table`, column_name AS `column`, data_type AS dataType FROM information_schema.columns c JOIN information_schema.tables t USING (table_schema, table_name) WHERE table_schema = ? AND t.table_type = 'BASE TABLE' ORDER BY table_name, ordinal_position",
  [source],
);
await conn.end();

const result = generateViews(parsePiiMap(readFileSync(mapFile, 'utf8')), rows as SchemaColumn[], source);
writeFileSync(outFile, result.sql, { mode: 0o600 });
console.log(`${result.views} vistas en ${outFile}`);
if (result.unclassified.length) console.log(`Sin clasificar, quedan invisibles: ${result.unclassified.join(', ')}`);
if (result.stale.length) console.log(`En el mapa pero ya no en la base: ${result.stale.join(', ')}`);
