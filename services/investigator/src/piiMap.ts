import { parse } from 'yaml';

/**
 * Masking lives in MySQL, as views, because masking in the app is easy to get around:
 * `CONCAT(cedula, '')` would slip past any filter on column names. The read-only
 * user can only see these views, so an unmasked value isn't reachable from SQL at all.
 */

export const POLICIES = ['allow', 'exclude', 'mask_email', 'mask_phone', 'mask_id', 'mask_name', 'mask_text'] as const;
export type Policy = (typeof POLICIES)[number];

/** table → column → policy. A table or column that isn't listed has no view. */
export type PiiMap = Record<string, Record<string, Policy>>;

export interface SchemaColumn {
  table: string;
  column: string;
  dataType: string;
}

export function parsePiiMap(text: string): PiiMap {
  const map = (parse(text) ?? {}) as PiiMap;
  for (const [table, columns] of Object.entries(map)) {
    for (const [column, policy] of Object.entries(columns ?? {})) {
      if (!POLICIES.includes(policy)) throw new Error(`Política desconocida "${policy}" en ${table}.${column}`);
    }
  }
  return map;
}

const id = (name: string) => {
  if (!/^[A-Za-z0-9_$]+$/.test(name)) throw new Error(`Identificador no permitido: ${name}`);
  return `\`${name}\``;
};

/** Every mask keeps what helps a diagnosis (is it set, what domain, last digits) and no more. */
function expression(policy: Policy, name: string): string | null {
  const c = id(name);
  switch (policy) {
    case 'allow':
      return c;
    case 'exclude':
      return null;
    case 'mask_email':
      // Without an @ the domain part would be the whole value.
      return `IF(${c} IS NULL, NULL, IF(${c} LIKE '%@%', CONCAT(LEFT(${c}, 1), '***@', SUBSTRING_INDEX(${c}, '@', -1)), '***'))`;
    case 'mask_phone':
    case 'mask_id':
      // A short value would show up whole in its last digits.
      return `IF(${c} IS NULL, NULL, IF(CHAR_LENGTH(${c}) <= 6, '***', CONCAT('***', RIGHT(${c}, 3))))`;
    case 'mask_name':
      return `IF(${c} IS NULL, NULL, CONCAT(LEFT(${c}, 1), '***'))`;
    case 'mask_text':
      return `IF(${c} IS NULL, NULL, CONCAT('[texto oculto: ', CHAR_LENGTH(${c}), ' caracteres]'))`;
  }
}

export interface ViewsResult {
  sql: string;
  views: number;
  /** Columns in the database with no decision yet. They stay invisible until classified. */
  unclassified: string[];
  /** Listed in the map but gone from the database. */
  stale: string[];
}

export function generateViews(
  map: PiiMap,
  schema: SchemaColumn[],
  source = 'aditum',
  target = 'read_only_user',
): ViewsResult {
  const byTable = new Map<string, SchemaColumn[]>();
  for (const col of schema) byTable.set(col.table, [...(byTable.get(col.table) ?? []), col]);

  const statements = [`DROP DATABASE IF EXISTS ${id(target)};`, `CREATE DATABASE ${id(target)};`];
  const unclassified: string[] = [];
  let views = 0;

  for (const [table, columns] of [...byTable].sort(([a], [b]) => a.localeCompare(b))) {
    const policies = map[table] ?? {};
    const select: string[] = [];
    for (const { column } of columns) {
      const policy = policies[column];
      if (!policy) {
        unclassified.push(`${table}.${column}`);
        continue;
      }
      const expr = expression(policy, column);
      if (expr) select.push(`  ${expr} AS ${id(column)}`);
    }
    if (select.length === 0) continue;
    views += 1;
    statements.push(
      `CREATE SQL SECURITY DEFINER VIEW ${id(target)}.${id(table)} AS SELECT\n${select.join(',\n')}\nFROM ${id(source)}.${id(table)};`,
    );
  }

  const stale = Object.entries(map).flatMap(([table, columns]) =>
    Object.keys(columns ?? {})
      .filter((column) => !byTable.get(table)?.some((c) => c.column === column))
      .map((column) => `${table}.${column}`),
  );
  return { sql: statements.join('\n\n') + '\n', views, unclassified, stale };
}

const PERSONAL = /salar|income|birth|nacimiento|gender|genero|latitude|longitude|^lat$|^lng$|^lon$/i;
const SECRET = /pass|pwd|secret|token|hash|salt|credential|api_?key|private|signature|otp|_key$|^key$|cert|authorization|cookie|session|(^|_)(pin|code|codigo)$|(access|login|verification|invitation)_?code/i;
const BINARY = /blob|binary/i;
const EMAIL = /e?mail/i;
const PHONE = /phone|telefono|tel[eé]fono|mobile|celular|whatsapp|^tel$/i;
const NATIONAL_ID = /identification|identificacion|cedula|c[eé]dula|passport|pasaporte|dni|legal_?id|tax_?id|iban|account_?number|cuenta|card|tarjeta|plate|placa|license|licencia/i;
const NAME = /(^|_)(name|first_?name|last_?name|second_?last_?name|nombre|apellido|full_?name|owner|contact|responsable|login|user_?name)($|_)/i;
const FREE_TEXT = /comment|description|descripcion|detail|detalle|note|nota|message|mensaje|observation|observacion|address|direccion|reason|motivo|text|body|content|subject|asunto|url|path|file|photo|image|logo|json|payload|request|response|ip$/i;
const SAFE_STRING = /(^|_)(state|status|estado|type|tipo|category|categoria|currency|moneda|ammount|amount|total|subtotal|balance|saldo|monto|interest|interes|percentage|porcentaje|rate|tax|iva|consecutive|consecutivo|number|numero|month|year|mes|ano|period|periodo|enabled|active|activo|deleted)($|_)/i;
const SAFE_TYPE = /^(tinyint|smallint|mediumint|int|bigint|decimal|float|double|bit|bool|boolean|date|datetime|timestamp|time|year|enum)$/i;
/** Copies of real tables: duplicates of everything, with no use in a diagnosis. */
const SKIPPED_TABLE = /^(bkp_|backup_|tmp_|temp_|zz_)|^(databasechangelog|databasechangeloglock)$|^jhi_persistent_audit|api_client|email_config/i;

/**
 * First pass at the map, for a person to review. When a name says nothing, the
 * answer is `exclude`: a column that wrongly stays hidden costs a question, and one
 * that wrongly shows costs someone's data.
 */
export function classifyColumn(table: string, column: string, dataType: string): Policy {
  if (SKIPPED_TABLE.test(table)) return 'exclude';
  if (BINARY.test(dataType)) return 'exclude';
  if (SECRET.test(column) || PERSONAL.test(column)) return 'exclude';
  if (EMAIL.test(column)) return 'mask_email';
  if (PHONE.test(column)) return 'mask_phone';
  if (NATIONAL_ID.test(column)) return 'mask_id';
  if (NAME.test(column)) return 'mask_name';
  if (FREE_TEXT.test(column)) return /text|longtext|mediumtext/i.test(dataType) || /char/i.test(dataType) ? 'mask_text' : 'exclude';
  if (SAFE_TYPE.test(dataType)) return 'allow';
  if (/char/i.test(dataType) && SAFE_STRING.test(column)) return 'allow';
  return 'exclude';
}
