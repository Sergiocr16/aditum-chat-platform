import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { codeEvidenceProblem, dataEvidenceProblem, REPORT_SCHEMA, verifyReport, type LoggedQuery, type RawReport, backlogDraftFrom, type RawBacklogItem } from './evidence.js';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'evidence-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/Mora.java'), 'class Mora {\n  int dias =   30;\n  int otra = 5;\n}\n');
  writeFileSync(join(dir, '..', 'outside-evidence.txt'), 'secret text here');
  symlinkSync(join(dir, '..', 'outside-evidence.txt'), join(dir, 'src/link.txt'));
});

const ok = { path: 'src/Mora.java', startLine: 2, endLine: 2, quote: 'int dias = 30;' };

describe('codeEvidenceProblem', () => {
  it('accepts a quote in those lines, whitespace aside', () => {
    expect(codeEvidenceProblem(ok, dir)).toBeNull();
  });
  it('rejects a quote from other lines', () => {
    expect(codeEvidenceProblem({ ...ok, startLine: 3, endLine: 3 }, dir)).toMatch(/no aparece/);
  });
  it('rejects text that is not in the file', () => {
    expect(codeEvidenceProblem({ ...ok, quote: 'int dias = 60;' }, dir)).toMatch(/no aparece/);
  });
  it('rejects leaving the repo', () => {
    expect(codeEvidenceProblem({ ...ok, path: '../outside-evidence.txt', startLine: 1, endLine: 1, quote: 'secret' }, dir)).toMatch(/fuera/);
    expect(codeEvidenceProblem({ ...ok, path: 'src/link.txt', startLine: 1, endLine: 1, quote: 'secret' }, dir)).toMatch(/fuera/);
    expect(codeEvidenceProblem({ ...ok, path: '/etc/hosts' }, dir)).toMatch(/relativa/);
  });
  it('rejects lines past the end and missing files', () => {
    expect(codeEvidenceProblem({ ...ok, endLine: 99 }, dir)).toMatch(/líneas/);
    expect(codeEvidenceProblem({ ...ok, path: 'src/Nope.java' }, dir)).toMatch(/no existe/);
  });
  it('rejects a folder instead of throwing', () => {
    expect(codeEvidenceProblem({ ...ok, path: 'src' }, dir)).toMatch(/no es un archivo/);
    expect(codeEvidenceProblem({ ...ok, path: '' }, dir)).toMatch(/no es un archivo/);
  });
});

const query = (over: Partial<LoggedQuery> = {}): LoggedQuery => ({
  queryId: 'j-1',
  questionId: 'q1',
  dataQuestion: 'x',
  purpose: 'x',
  sql: 'select 1',
  rows: [{ id: '42', ammount: '1200.00', state: null }],
  truncated: false,
  ms: 1,
  error: null,
  ...over,
});

describe('dataEvidenceProblem', () => {
  it('accepts values the query returned, numbers by value', () => {
    expect(dataEvidenceProblem({ queryId: 'j-1', values: ['42', '1200'] }, [query()])).toBeNull();
  });
  it('rejects an invented value or query', () => {
    expect(dataEvidenceProblem({ queryId: 'j-1', values: ['999'] }, [query()])).toMatch(/no devolvió/);
    expect(dataEvidenceProblem({ queryId: 'j-9', values: ['42'] }, [query()])).toMatch(/no existe/);
  });
  it('rejects a failed query and an empty claim', () => {
    expect(dataEvidenceProblem({ queryId: 'j-1', values: ['42'] }, [query({ error: 'boom' })])).toMatch(/falló/);
    expect(dataEvidenceProblem({ queryId: 'j-1', values: [] }, [query()])).toMatch(/valores/);
  });
});

const raw = (over: Partial<RawReport> = {}): RawReport => ({
  classification: 'unknown',
  backlog_item: null,
  conclusion: 'confirmed',
  summary: 's',
  cause: 'c',
  recommendation: 'r',
  suggested_reply: 'Hola',
  missing: [],
  code_evidence: [{ path: 'src/Mora.java', start_line: 2, end_line: 2, quote: 'int dias = 30;' }],
  data_evidence: [],
  ...over,
});

describe('backlogDraftFrom', () => {
  const item: RawBacklogItem = {
    name: ' Mora mal ',
    description: 'd',
    priority: 'Alta',
    modules: ['Cobros'],
    roles: ['Administrador'],
    problem: 'p',
    expected: 'e',
    steps: ['uno', ' '],
    screen_name: 's',
    how_to_reach: 'h',
    acceptance: ['a'],
    notes: '',
    duplicate_of: null,
  };
  const rows = [{ id: 'row-1', url: 'https://notion/row-1', title: 'Mora', description: '', modules: ['Cobros'] }];
  const bug = raw({ classification: 'bug', backlog_item: item });

  it('defines a ticket only for a confirmed bug', () => {
    expect(backlogDraftFrom(bug, 'confirmed', rows)).toMatchObject({ name: 'Mora mal', steps: ['uno'], screenName: 's', duplicateChecked: true });
    expect(backlogDraftFrom(bug, 'hypothesis', rows)).toBeNull();
    expect(backlogDraftFrom(raw({ classification: 'data_error', backlog_item: item }), 'confirmed', rows)).toBeNull();
    expect(backlogDraftFrom(raw({ classification: 'bug' }), 'confirmed', rows)).toBeNull();
  });

  it('loses the ticket when the check lowers the conclusion', () => {
    const invented = raw({ ...bug, code_evidence: [{ path: 'src/Mora.java', start_line: 2, end_line: 2, quote: 'esto no está en el archivo' }] });
    const report = verifyReport(invented, dir, [], rows);
    expect(report.conclusion).toBe('undetermined');
    expect(report.backlogDraft).toBeNull();
  });

  it('takes a duplicate only from the rows it was shown, with their real link', () => {
    const duplicate = raw({ classification: 'bug', backlog_item: { ...item, duplicate_of: 'row-1' } });
    expect(backlogDraftFrom(duplicate, 'confirmed', rows)?.duplicateOf).toEqual({ id: 'row-1', title: 'Mora', url: 'https://notion/row-1' });
    const invented = raw({ classification: 'bug', backlog_item: { ...item, duplicate_of: 'no-existe' } });
    expect(backlogDraftFrom(invented, 'confirmed', rows)?.duplicateOf).toBeNull();
  });

  it('says so when the board could not be read', () => {
    expect(backlogDraftFrom(bug, 'confirmed', null)?.duplicateChecked).toBe(false);
    expect(backlogDraftFrom(bug, 'confirmed', [])?.duplicateChecked).toBe(true);
  });
});

describe('verifyReport', () => {
  it('keeps confirmed when everything checks out', () => {
    const report = verifyReport(raw(), dir, []);
    expect(report.conclusion).toBe('confirmed');
    expect(report.suggestedReply).toBe('Hola');
    expect(report.downgradedFrom).toBeNull();
  });

  it('lowers confirmed to hypothesis when one item is invented, and drops the reply', () => {
    const report = verifyReport(
      raw({ code_evidence: [...raw().code_evidence, { path: 'src/Mora.java', start_line: 3, end_line: 3, quote: 'inventado aquí' }] }),
      dir,
      [],
    );
    expect(report.conclusion).toBe('hypothesis');
    expect(report.downgradedFrom).toBe('confirmed');
    expect(report.suggestedReply).toBeNull();
    expect(report.rejectedEvidence).toEqual([expect.stringMatching(/no aparece/)]);
    expect(report.codeEvidence).toHaveLength(1);
  });

  it('lowers to undetermined with no valid evidence at all', () => {
    expect(verifyReport(raw({ code_evidence: [] }), dir, []).conclusion).toBe('undetermined');
    expect(verifyReport(raw({ conclusion: 'hypothesis', code_evidence: [] }), dir, []).conclusion).toBe('undetermined');
  });

  it('gives no reply unless confirmed, even if the model wrote one', () => {
    expect(verifyReport(raw({ conclusion: 'hypothesis' }), dir, []).suggestedReply).toBeNull();
  });

  it('accepts data evidence from this job only', () => {
    const data = { query_id: 'j-1', values: ['42'] };
    expect(verifyReport(raw({ data_evidence: [data] }), dir, [query()]).conclusion).toBe('confirmed');
    expect(verifyReport(raw({ data_evidence: [data] }), dir, []).conclusion).toBe('hypothesis');
  });
});

describe('REPORT_SCHEMA', () => {
  it('sticks to what the CLI accepts in strict mode, which it only enforces on the parts the model fills in', () => {
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (typeof node !== 'object' || node === null) return;
      const schema = node as Record<string, unknown>;
      // Only "this or null" may be written as a list.
      if (Array.isArray(schema.type)) expect(schema.type.filter((type) => type !== 'null')).toHaveLength(1);
      Object.values(schema).forEach(walk);
    };
    walk(REPORT_SCHEMA);
  });
});
