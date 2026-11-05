import { describe, expect, it } from 'vitest';
import { classifyColumn, generateViews, parsePiiMap, type SchemaColumn } from './piiMap.js';

const schema: SchemaColumn[] = [
  { table: 'person', column: 'id', dataType: 'bigint' },
  { table: 'person', column: 'email', dataType: 'varchar' },
  { table: 'person', column: 'secret_note', dataType: 'varchar' },
  { table: 'person', column: 'added_later', dataType: 'varchar' },
  { table: 'nothing_listed', column: 'id', dataType: 'bigint' },
];

describe('generateViews', () => {
  const map = parsePiiMap('person:\n  id: allow\n  email: mask_email\n  secret_note: exclude\n');
  const { sql, views, unclassified } = generateViews(map, schema);

  it('leaves out excluded and unclassified columns', () => {
    expect(sql).not.toContain('secret_note');
    expect(sql).not.toContain('added_later');
    expect(unclassified).toEqual(['nothing_listed.id', 'person.added_later']);
  });

  it('creates no view for a table nobody classified', () => {
    expect(views).toBe(1);
    expect(sql).not.toContain('nothing_listed');
  });

  it('never selects a masked column bare', () => {
    expect(sql).not.toMatch(/^\s*`email` AS `email`/m);
    expect(sql).toContain("LIKE '%@%'");
  });

  it('reports columns that left the database', () => {
    const gone = generateViews(parsePiiMap('person:\n  gone: allow\n'), schema);
    expect(gone.stale).toEqual(['person.gone']);
  });
});

describe('parsePiiMap', () => {
  it('rejects an unknown policy instead of guessing', () => {
    expect(() => parsePiiMap('t:\n  c: show_it\n')).toThrow(/Política desconocida/);
  });
});

describe('classifyColumn', () => {
  it.each([
    ['app_user', 'password_hash', 'varchar', 'exclude'],
    ['gate', 'hikvision_password', 'varchar', 'exclude'],
    ['bkp_client_invoice', 'id', 'bigint', 'exclude'],
    ['person', 'email', 'varchar', 'mask_email'],
    ['person', 'phone_number', 'varchar', 'mask_phone'],
    ['person', 'identification_number', 'varchar', 'mask_id'],
    ['person', 'name', 'varchar', 'mask_name'],
    ['invoice', 'description', 'longtext', 'mask_text'],
    ['invoice', 'id', 'bigint', 'allow'],
    ['invoice', 'ammount', 'varchar', 'allow'],
    ['invoice', 'state', 'int', 'allow'],
    ['person', 'birth_date', 'date', 'exclude'],
    ['anything', 'mystery_field', 'varchar', 'exclude'],
    ['anything', 'photo', 'longblob', 'exclude'],
    ['guest_invite', 'code', 'varchar', 'exclude'],
    ['login_request', 'access_code', 'int', 'exclude'],
    ['zz_old_backup', 'id', 'bigint', 'exclude'],
  ])('%s.%s (%s) → %s', (table, column, dataType, policy) => {
    expect(classifyColumn(table, column, dataType)).toBe(policy);
  });
});
