import { describe, expect, it } from 'vitest';
import type { InvestigationReport, WriteProposal } from '@aditum-chat/shared';
import { writeConfirmationPhrase, writeOperationSql, writeProposalProblems } from '@aditum-chat/shared';
import { APPROVAL_WINDOW_MS, caProblem, canRehearse, jobExpired, operationsHash, productionWriteMark, proposalFrom, RECENT_LOGIN_MS, rehearsalHash, reportWithProposal, resultCounts, stepProblem } from './writes.js';

const update = { op: 'update' as const, table: 'charge', key: { id: 7 }, set: { amount: 100 } };
const citation = { path: 'a.java', startLine: 1, endLine: 1, quote: 'x' };
const draft = {
  reason: 'El monto quedó mal.',
  operations: [update],
  consequence: 'Lo lee el estado de cuenta.',
  consequenceEvidence: [citation],
  riskLevel: 'low' as const,
  risk: 'Podría cambiar un saldo.',
  cache: 'No usa caché.',
};
const report = (over: Partial<InvestigationReport> = {}) =>
  ({ conclusion: 'confirmed', codeEvidence: [citation], writeProposal: draft, ...over }) as unknown as InvestigationReport;

describe('writeProposalProblems', () => {
  const problemsFor = (over: object, reportOver: object = {}) => writeProposalProblems({ ...draft, ...over } as never, report(reportOver));
  it('lets a complete proposal through', () => {
    expect(problemsFor({})).toEqual([]);
  });
  it('needs a confirmed conclusion and code evidence', () => {
    expect(problemsFor({}, { conclusion: 'hypothesis' }).join()).toMatch(/confirmada/);
    expect(problemsFor({}, { codeEvidence: [] }).join()).toMatch(/evidencia/);
  });
  it('needs the consequence, its evidence, the risk and the cache', () => {
    expect(problemsFor({ consequence: ' ' }).join()).toMatch(/quién usa/);
    expect(problemsFor({ consequenceEvidence: [] }).join()).toMatch(/quién usa/);
    expect(problemsFor({ risk: '' }).join()).toMatch(/riesgo/);
    expect(problemsFor({ riskLevel: 'none' }).join()).toMatch(/riesgo/);
    expect(problemsFor({ cache: '' }).join()).toMatch(/caché/);
  });
  it.each([
    ['free SQL', { sql: 'DELETE FROM charge' }],
    ['delete', { op: 'delete', table: 'charge', key: { id: 1 } }],
    ['an injected table', { ...update, table: 'charge; DROP TABLE x' }],
    ['an injected column', { ...update, set: { 'amount = 1 --': 1 } }],
    ['an empty key', { ...update, key: {} }],
    ['a key that is also changed', { ...update, set: { id: 9 } }],
    ['an object as a value', { ...update, set: { amount: { toSqlString: 'x' } } }],
  ])('refuses %s', (_name, operation) => {
    expect(problemsFor({ operations: [operation] })).not.toEqual([]);
  });
  it('refuses one too big to keep', () => {
    const big = Array.from({ length: 30 }, (_, i) => ({ ...update, key: { id: i }, set: { amount: 'á'.repeat(5_000) } }));
    expect(problemsFor({ operations: big }).join()).toMatch(/demasiado grande/);
  });
  it('refuses too many rows, none, or the same row twice', () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ ...update, key: { id: i } }));
    expect(problemsFor({ operations: many }).join()).toMatch(/50/);
    expect(problemsFor({ operations: [] }).join()).toMatch(/operaciones/);
    expect(problemsFor({ operations: [update, { ...update, set: { amount: 5 } }] }).join()).toMatch(/misma fila/);
  });
});

describe('writeOperationSql', () => {
  it('shows updates and inserts, escaping values', () => {
    expect(writeOperationSql({ ...update, set: { name: "O'Neil" } })).toBe("UPDATE `charge`\nSET `name` = 'O''Neil'\nWHERE `id` = 7;");
    expect(writeOperationSql({ op: 'insert', table: 'note', values: { a: 1, b: null } })).toBe('INSERT INTO `note` (`a`, `b`)\nVALUES (1, NULL);');
  });
});

describe('proposalFrom', () => {
  it('turns a valid draft into a document, and the report only points at it', () => {
    const { proposal, problems } = proposalFrom(report(), 2);
    expect(problems).toEqual([]);
    expect(proposal).toMatchObject({ turn: 2, status: 'proposed', opsHash: operationsHash([update]) });
    const stored = reportWithProposal(report(), 't2', []);
    expect(stored.writeProposal).toBeUndefined();
    expect(stored.proposalId).toBe('t2');
  });
  it('keeps what was wrong with an invalid one, for the agent to see', () => {
    const invalid = report({ conclusion: 'hypothesis' });
    const { proposal, problems } = proposalFrom(invalid, 1);
    expect(proposal).toBeNull();
    expect(reportWithProposal(invalid, null, problems).proposalProblems).toEqual(problems);
  });
  it('does nothing when it proposed nothing', () => {
    expect(proposalFrom(report({ writeProposal: null }), 1)).toEqual({ proposal: null, problems: [] });
  });
});

describe('the hashes', () => {
  it('depend on the operations and not on the order of their keys', () => {
    expect(operationsHash([{ op: 'update', table: 't', key: { a: 1, b: 2 }, set: { c: 3 } }])).toBe(
      operationsHash([{ set: { c: 3 }, key: { b: 2, a: 1 }, table: 't', op: 'update' } as never]),
    );
    expect(operationsHash([update])).not.toBe(operationsHash([{ ...update, key: { id: 8 } }]));
  });
  it('change with the result of the rehearsal', () => {
    const rows = [{ afterHash: 'a' }] as never;
    expect(rehearsalHash('x', rows, { operations: [], manual: [] })).not.toBe(rehearsalHash('x', [{ afterHash: 'b' }] as never, { operations: [], manual: [] }));
  });
});

describe('stepProblem', () => {
  const now = Date.now();
  const at = (ms: number) => ({ toMillis: () => ms });
  const phrase = writeConfirmationPhrase([update]);
  const by = { uid: 'admin', nombre: 'Ana' };
  const rehearsed = (over: Partial<WriteProposal> = {}) =>
    ({ status: 'rehearsed', operations: [update], rehearsal: { hash: 'h' }, approval: null, ...over }) as unknown as WriteProposal;
  const approving = (step: 1 | 2, over: object = {}) => rehearsed({ approval: { by, startedAt: at(now - 1000), step, hash: 'h', ...over } as never });
  const input = (over: object = {}) => ({ uid: 'admin', step: 1, hash: 'h', typed: phrase, authTimeSeconds: Math.floor(now / 1000), now, ...over });

  it('walks the three steps', () => {
    expect(stepProblem(rehearsed(), true, input())).toBeNull();
    expect(stepProblem(approving(1), true, input({ step: 2 }))).toBeNull();
    expect(stepProblem(approving(2), true, input({ step: 3 }))).toBeNull();
  });
  it('stops with the switch off, or before a rehearsal, or after it ran', () => {
    expect(stepProblem(rehearsed(), false, input())).toMatch(/apagadas/);
    expect(stepProblem(undefined, true, input())).toMatch(/No existe/);
    for (const status of ['proposed', 'rehearsing', 'rehearsal_failed', 'superseded', 'executing', 'executed', 'aborted', 'unknown'] as const) {
      expect(stepProblem(rehearsed({ status }), true, input())).toMatch(/no está lista/);
    }
  });
  it('refuses steps out of order', () => {
    expect(stepProblem(rehearsed(), true, input({ step: 2 }))).toMatch(/Empezá de nuevo/);
    expect(stepProblem(rehearsed(), true, input({ step: 3 }))).toMatch(/Empezá de nuevo/);
    expect(stepProblem(approving(1), true, input({ step: 3 }))).toMatch(/en orden/);
    expect(stepProblem(approving(2), true, input({ step: 2 }))).toMatch(/en orden/);
    expect(stepProblem(rehearsed(), true, input({ step: 4 }))).toMatch(/paso/);
  });
  it('refuses a changed hash at any step', () => {
    expect(stepProblem(rehearsed(), true, input({ hash: 'other' }))).toMatch(/cambiaron/);
    expect(stepProblem(approving(1, { hash: 'old' }), true, input({ step: 2 }))).toMatch(/cambiaron/);
  });
  it('holds it for the admin who started, until the window ends', () => {
    expect(stepProblem(approving(1), true, input({ uid: 'other' }))).toMatch(/Ana/);
    expect(stepProblem(approving(1), true, input({ uid: 'other', step: 2 }))).toMatch(/Ana/);
    const expired = approving(1, { startedAt: at(now - APPROVAL_WINDOW_MS - 1) });
    expect(stepProblem(expired, true, input({ uid: 'other' }))).toBeNull();
    expect(stepProblem(expired, true, input({ step: 2 }))).toMatch(/venció/);
  });
  it('needs the typed phrase and a fresh login at the last step', () => {
    expect(stepProblem(approving(2), true, input({ step: 3, typed: 'dale' }))).toMatch(/texto/);
    expect(stepProblem(approving(2), true, input({ step: 3, authTimeSeconds: undefined }))).toMatch(/contraseña/);
    const old = Math.floor((now - RECENT_LOGIN_MS - 1000) / 1000);
    expect(stepProblem(approving(2), true, input({ step: 3, authTimeSeconds: old }))).toMatch(/contraseña/);
  });
});

describe('job timing', () => {
  it('drops a job nobody picked up in time', () => {
    expect(jobExpired(0, 2 * 60_000 + 1)).toBe(true);
    expect(jobExpired(0, 60_000)).toBe(false);
  });
  it('lets a stuck rehearsal be asked for again, and nothing that ran or may have', () => {
    expect(canRehearse('aborted', 0, 0)).toBe(true);
    expect(canRehearse('rehearsing', 0, 60_000)).toBe(false);
    expect(canRehearse('rehearsing', 0, 6 * 60_000)).toBe(true);
    for (const status of ['executing', 'executed', 'unknown', 'superseded'] as const) expect(canRehearse(status, 0, 1e12)).toBe(false);
  });
});

describe('resultCounts', () => {
  it('only takes the rehearsal asked for last', () => {
    expect(resultCounts({ status: 'rehearsing', rehearsalJobId: 'new' }, 'rehearse', 'new')).toBe(true);
    expect(resultCounts({ status: 'rehearsing', rehearsalJobId: 'new' }, 'rehearse', 'old')).toBe(false);
  });
  it('ignores a result once the proposal moved on', () => {
    expect(resultCounts({ status: 'superseded', rehearsalJobId: 'a' }, 'rehearse', 'a')).toBe(false);
    expect(resultCounts({ status: 'executed' }, 'execute', 'a')).toBe(false);
    expect(resultCounts({ status: 'executing' }, 'recover', 'a')).toBe(true);
    expect(resultCounts(undefined, 'execute', 'a')).toBe(false);
  });
});

describe('caProblem', () => {
  it('takes a PEM, or nothing to keep the saved one', () => {
    expect(caProblem('-----BEGIN CERTIFICATE-----\nabc')).toBeNull();
    expect(caProblem('')).toBeNull();
    expect(caProblem(undefined)).toBeNull();
    expect(caProblem('hola')).toMatch(/PEM/);
    expect(caProblem(`-----BEGIN CERTIFICATE-----${'x'.repeat(600_000)}`)).toMatch(/grande/);
  });
});

describe('productionWriteMark', () => {
  const by = { uid: 'u', nombre: 'Admin' };
  const proposal = { operations: [update, { ...update, key: { id: 8 } }], reverseOf: null } as never;
  it('keeps what a list needs to show a write', () => {
    expect(productionWriteMark('t1', proposal, 'executed', by, 'now')).toEqual({ proposalId: 't1', status: 'executed', reversal: false, rows: 2, by, at: 'now' });
  });
  it('marks a result nobody can confirm, since it may have changed production', () => {
    expect(productionWriteMark('t1', proposal, 'unknown', by, 'now')?.status).toBe('unknown');
  });
  it('tells a reversal apart', () => {
    expect(productionWriteMark('r-t1', { operations: [update], reverseOf: 't1' } as never, 'executed', by, 'now')?.reversal).toBe(true);
  });
  it('leaves no mark when nothing changed', () => {
    expect(productionWriteMark('t1', proposal, 'aborted', by, 'now')).toBeNull();
  });
});
