import { describe, expect, it } from 'vitest';
import type { WriteOperation, WriteRowResult } from '@aditum-chat/shared';
import { CommitUncertain, execute, operationProblem, parseWriteGrants, privilegesOn, recover, reversalFrom, rowHash, type Db } from './writer-core.js';

const TO = "TO `aditum_writer`@`1.2.3.4`";
const info = {
  columns: new Set(['id', 'tenant', 'amount', 'updated_at']),
  primaryKey: ['id', 'tenant'],
  onUpdate: new Set(['updated_at']),
  generatedOnInsert: new Set<string>(),
  generated: new Set<string>(),
};

describe('parseWriteGrants', () => {
  it('accepts per-table SELECT, INSERT and UPDATE only', () => {
    const grants = parseWriteGrants([`GRANT USAGE ON *.* ${TO}`, `GRANT SELECT, UPDATE ON \`app\`.\`charge\` ${TO}`, `GRANT SELECT, INSERT, UPDATE ON \`app\`.\`note\` ${TO}`], 'app');
    expect(grants.problem).toBeNull();
    expect(grants.tables).toEqual({ charge: ['SELECT', 'UPDATE'], note: ['SELECT', 'INSERT', 'UPDATE'] });
  });
  it.each([
    ['global privileges', `GRANT SELECT ON *.* ${TO}`],
    ['DELETE on all of a database', `GRANT SELECT, UPDATE, DELETE ON \`app\`.* ${TO}`],
    ['ALL on all of a database', `GRANT ALL PRIVILEGES ON \`app\`.* ${TO}`],
    ['all of another database', `GRANT SELECT, UPDATE ON \`other\`.* ${TO}`],
    ['databases by pattern', `GRANT SELECT, UPDATE ON \`ap%\`.* ${TO}`],
    ['DELETE', `GRANT SELECT, DELETE ON \`app\`.\`charge\` ${TO}`],
    ['ALL', `GRANT ALL PRIVILEGES ON \`app\`.\`charge\` ${TO}`],
    ['grant option', `GRANT SELECT ON \`app\`.\`charge\` ${TO} WITH GRANT OPTION`],
    ['another database', `GRANT SELECT ON \`other\`.\`charge\` ${TO}`],
    ['column-level', `GRANT SELECT (id), UPDATE (amount) ON \`app\`.\`charge\` ${TO}`],
    ['a role', `GRANT \`writer_role\`@\`%\` ${TO}`],
    ['a dynamic privilege', `GRANT BACKUP_ADMIN ON *.* ${TO}`],
    ['a partial revoke', `REVOKE SELECT ON \`app\`.\`charge\` FROM \`aditum_writer\`@\`1.2.3.4\``],
  ])('refuses %s', (_name, grant) => {
    const grants = parseWriteGrants([`GRANT USAGE ON *.* ${TO}`, `GRANT SELECT, UPDATE ON \`app\`.\`ok\` ${TO}`, grant], 'app');
    expect(grants.problem).toMatch(/más permisos/);
    expect(grants.tables).toEqual({});
  });
  it('accepts SELECT, INSERT and UPDATE on the whole database, so new tables need no grant', () => {
    const grants = parseWriteGrants([`GRANT USAGE ON *.* ${TO}`, `GRANT SELECT, INSERT, UPDATE ON \`app\`.* ${TO}`], 'app');
    expect(grants).toEqual({ tables: {}, database: ['SELECT', 'INSERT', 'UPDATE'], problem: null });
    expect(privilegesOn(grants, 'a_table_added_later')).toEqual(['SELECT', 'INSERT', 'UPDATE']);
  });
  it('reads a database name MySQL shows escaped', () => {
    const grants = parseWriteGrants([`GRANT SELECT, UPDATE ON \`primary\\_app\\_db\`.* ${TO}`], 'primary_app_db');
    expect(grants.database).toEqual(['SELECT', 'UPDATE']);
  });
  it('adds what a table has to what the whole database has', () => {
    const grants = parseWriteGrants([`GRANT SELECT, UPDATE ON \`app\`.* ${TO}`, `GRANT INSERT ON \`app\`.\`note\` ${TO}`], 'app');
    expect(privilegesOn(grants, 'note')).toEqual(['SELECT', 'UPDATE', 'INSERT']);
    expect(privilegesOn(grants, 'charge')).toEqual(['SELECT', 'UPDATE']);
  });
  it('gives nothing on a table that was not granted, whatever its name', () => {
    const grants = parseWriteGrants([`GRANT SELECT, UPDATE ON \`app\`.\`charge\` ${TO}`], 'app');
    expect(privilegesOn(grants, 'note')).toBeUndefined();
    expect(privilegesOn(grants, 'constructor')).toBeUndefined();
  });
  it('refuses a user with nothing to work on', () => {
    expect(parseWriteGrants([`GRANT USAGE ON *.* ${TO}`], 'app').problem).toMatch(/ninguna tabla/);
  });
});

describe('operationProblem', () => {
  const update = { op: 'update' as const, table: 't', key: { id: 1, tenant: 2 }, set: { amount: 5 } };
  const privileges = ['SELECT', 'INSERT', 'UPDATE'];
  it('accepts an update by the full primary key', () => {
    expect(operationProblem(update, info, privileges)).toBeNull();
  });
  it('requires the whole primary key and nothing but it', () => {
    expect(operationProblem({ ...update, key: { id: 1 } }, info, privileges)).toMatch(/llave primaria/);
    expect(operationProblem({ ...update, key: { id: 1, tenant: 2, amount: 3 } }, info, ['SELECT', 'UPDATE'])).toMatch(/llave primaria/);
  });
  it('refuses unknown columns, changing the key and missing privileges', () => {
    expect(operationProblem({ ...update, set: { nope: 1 } }, info, privileges)).toMatch(/no tiene la columna/);
    expect(operationProblem({ ...update, set: { tenant: 1 } }, info, privileges)).toMatch(/llave primaria/);
    expect(operationProblem(update, info, undefined)).toMatch(/permisos/);
    expect(operationProblem(update, info, ['SELECT'])).toMatch(/no puede actualizar/);
    expect(operationProblem({ op: 'insert', table: 't', values: { amount: 1 } }, info, ['SELECT', 'UPDATE'])).toMatch(/no puede insertar/);
  });
});

describe('rowHash', () => {
  it('is the same whatever the column order, and can leave out columns the database fills in', () => {
    expect(rowHash({ a: 1, b: 2 })).toBe(rowHash({ b: 2, a: 1 }));
    expect(rowHash({ a: 1, b: 2 })).not.toBe(rowHash({ a: 1, b: 3 }));
    expect(rowHash({ a: 1, at: 'x' }, new Set(['at']))).toBe(rowHash({ a: 1, at: 'y' }, new Set(['at'])));
  });
  it('tells binary values apart', () => {
    expect(rowHash({ a: Buffer.from('x') })).not.toBe(rowHash({ a: Buffer.from('y') }));
  });
});

describe('reversalFrom', () => {
  const row = (over: Partial<WriteRowResult>): WriteRowResult => ({
    op: 'update',
    table: 't',
    key: { id: 1 },
    before: { id: 1, amount: 5, updated_at: 'old' },
    after: { id: 1, amount: 9, updated_at: 'new' },
    beforeHash: 'b',
    afterHash: 'a',
    afterFullHash: 'af',
    changed: ['amount', 'updated_at'],
    notAsRequested: [],
    generated: [],
    affected: 1,
    ...over,
  });
  it('sets back everything that changed, including what the database changed on its own', () => {
    expect(reversalFrom([row({})])).toEqual({
      operations: [{ op: 'update', table: 't', key: { id: 1 }, set: { amount: 5, updated_at: 'old' } }],
      manual: [],
    });
  });
  it("doesn't try to set a column MySQL computes", () => {
    expect(reversalFrom([row({ changed: ['amount', 'updated_at'], generated: ['updated_at'] })]).operations[0]).toMatchObject({ set: { amount: 5 } });
    expect(reversalFrom([row({ changed: ['amount'], generated: ['amount'] })]).operations).toEqual([]);
  });
  it('leaves what it has no permission or data to undo for a person, in reverse order', () => {
    const reversal = reversalFrom([
      row({ key: { id: 1 } }),
      row({ op: 'insert', key: { id: 2 }, before: null, beforeHash: null }),
      row({ key: { id: 3 }, before: { amount: '[binario]' }, changed: ['amount'] }),
    ]);
    expect(reversal.operations).toHaveLength(1);
    expect(reversal.manual[0]).toMatch(/binaria/);
    expect(reversal.manual[1]).toMatch(/Borrar a mano/);
  });
});

describe('recover', () => {
  const pendingRow = (over: Partial<WriteRowResult> = {}): WriteRowResult => ({
    op: 'update',
    table: 't',
    key: { id: 1 },
    before: {},
    after: {},
    beforeHash: rowHash({ id: 1, at: 'old' }),
    afterHash: rowHash({ id: 1 }),
    afterFullHash: rowHash({ id: 1, at: 'new' }),
    changed: ['at'],
    notAsRequested: [],
    generated: [],
    affected: 1,
    ...over,
  });
  const dbWith = (found: Record<string, unknown>[], sqls: string[] = []): Db => ({
    rows: async (sql) => {
      sqls.push(sql);
      return found;
    },
    run: async (sql) => {
      sqls.push(sql);
      return { affectedRows: 0, insertId: 0 };
    },
  });
  it('never reached COMMIT without a record', async () => {
    expect(await recover(dbWith([]), null)).toBe('not_applied');
  });
  it('tells before from after, even when the only change is a column left out of the rehearsal comparison', async () => {
    expect(await recover(dbWith([{ id: 1, at: 'new' }]), [pendingRow()])).toBe('applied');
    expect(await recover(dbWith([{ id: 1, at: 'old' }]), [pendingRow()])).toBe('not_applied');
    expect(await recover(dbWith([{ id: 1, at: 'other' }]), [pendingRow()])).toBe('unknown');
  });
  it('reads with a lock, so a COMMIT in progress can\'t be missed', async () => {
    const sqls: string[] = [];
    await recover(dbWith([{ id: 1, at: 'new' }], sqls), [pendingRow()]);
    expect(sqls.some((sql) => sql.endsWith('FOR UPDATE'))).toBe(true);
    expect(sqls.at(-1)).toBe('ROLLBACK');
  });
  it('sends what it can\'t look up to a person', async () => {
    expect(await recover(dbWith([]), [pendingRow({ op: 'insert', key: { id: '[binario]' }, beforeHash: null })])).toBe('unknown');
    expect(await recover(dbWith([]), [pendingRow()])).toBe('unknown');
  });
  it('a missing insert was not applied', async () => {
    expect(await recover(dbWith([]), [pendingRow({ op: 'insert', beforeHash: null })])).toBe('not_applied');
  });
});

describe('execute', () => {
  const info = [{ engine: 'InnoDB', kind: 'BASE TABLE' }];
  const row = { id: 1, amount: '5.00' };
  const fakeDb = (onRun: (sql: string) => void): Db => {
    let current = row;
    return {
      rows: async (sql) => {
        if (sql.includes('information_schema.tables')) return info;
        if (sql.includes('information_schema.columns')) return [{ name: 'id', extra: '' }, { name: 'amount', extra: '' }];
        if (sql.includes('information_schema.statistics')) return [{ name: 'id' }];
        return [current];
      },
      run: async (sql) => {
        onRun(sql);
        if (sql.startsWith('UPDATE')) current = { id: 1, amount: '9.00' };
        return { affectedRows: 1, insertId: 0 };
      },
    };
  };
  const grants = { tables: { t: ['SELECT', 'UPDATE'] }, problem: null };
  const operation: WriteOperation = { op: 'update', table: 't', key: { id: 1 }, set: { amount: 9 } };
  const expected = () => [{ beforeHash: rowHash(row), afterHash: rowHash({ id: 1, amount: '9.00' }), affected: 1 }];

  it('commits after recording what it will commit', async () => {
    const log: string[] = [];
    await execute(fakeDb((sql) => log.push(sql)), 'app', [operation], grants, expected(), async () => void log.push('recorded'));
    expect(log.indexOf('recorded')).toBeLessThan(log.indexOf('COMMIT'));
    expect(log).not.toContain('ROLLBACK');
  });
  it('rolls back when recording fails', async () => {
    const log: string[] = [];
    await expect(execute(fakeDb((sql) => log.push(sql)), 'app', [operation], grants, expected(), async () => { throw new Error('off'); })).rejects.toThrow('off');
    expect(log).toContain('ROLLBACK');
    expect(log).not.toContain('COMMIT');
  });
  it("doesn't call a failed COMMIT a failure: it may have landed", async () => {
    const db = fakeDb((sql) => { if (sql === 'COMMIT') throw new Error('connection lost'); });
    await expect(execute(db, 'app', [operation], grants, expected(), async () => {})).rejects.toBeInstanceOf(CommitUncertain);
  });
  it('stops if a row changed since the rehearsal', async () => {
    const stale = [{ ...expected()[0], beforeHash: 'other' }];
    await expect(execute(fakeDb(() => {}), 'app', [operation], grants, stale, async () => {})).rejects.toThrow(/cambió después/);
  });
  it('refuses an object as a value, which the driver would expand into SQL', async () => {
    const injected = { ...operation, set: { amount: { evil: 1 } } } as unknown as WriteOperation;
    await expect(execute(fakeDb(() => {}), 'app', [injected], grants, expected(), async () => {})).rejects.toThrow(/no es válido/);
  });
});
