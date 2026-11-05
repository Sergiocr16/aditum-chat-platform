import { describe, expect, it } from 'vitest';
import type { InvestigationBacklogDraft } from '@aditum-chat/shared';
import { activeRowFrom, backlogRefusal, boardProblems, databaseIdFrom, draftProblems, pageBlocks, pageProperties, type BoardSchema } from './backlog.js';

const options = (...names: string[]) => ({ options: names.map((name) => ({ name })) });
const schema: BoardSchema = {
  properties: {
    'Nombre de tarea': { type: 'title' },
    Descripción: { type: 'rich_text' },
    Tipo: { type: 'select', select: options('Bug', 'Missing Feature') },
    Prioridad: { type: 'select', select: options('Urgente', 'Alta', 'Media', 'Baja') },
    Módulo: { type: 'multi_select', multi_select: options('Cobros', 'General') },
    'Rol afectado': { type: 'multi_select', multi_select: options('Administrador', 'Contador') },
    'Cliente Afectado': { type: 'rich_text' },
    Estado: { type: 'status', status: options('Sin empezar', 'Finalizada') },
  },
};
const draft: InvestigationBacklogDraft = {
  name: 'La mora no se recalcula',
  description: 'Corto',
  priority: 'Alta',
  modules: ['Cobros'],
  roles: ['Administrador'],
  problem: 'Pasa esto',
  expected: 'Debería pasar aquello',
  steps: ['Entrar', 'Ver'],
  screenName: 'Cuotas',
  howToReach: 'Cobros → Cuotas',
  acceptance: ['Ya no ocurre'],
  notes: '',
  duplicateOf: null,
  duplicateChecked: true,
};

describe('boardProblems', () => {
  it('accepts a board with the skill\'s columns', () => {
    expect(boardProblems(schema)).toEqual([]);
  });
  it('names a missing column, a wrong type and a missing state', () => {
    const { Módulo: _gone, ...properties } = schema.properties;
    const broken = { properties: { ...properties, Prioridad: { type: 'rich_text' }, Estado: { type: 'status', status: options('Otro') } } };
    const problems = boardProblems(broken).join(' ');
    expect(problems).toContain('Falta la columna "Módulo"');
    expect(problems).toContain('"Prioridad" debería ser');
    expect(problems).toContain('Sin empezar');
  });
});

describe('draftProblems', () => {
  it('accepts what the board has', () => {
    expect(draftProblems(draft, schema)).toEqual([]);
  });
  it('rejects an option the board does not have, which Notion would create in silence', () => {
    expect(draftProblems({ ...draft, modules: ['Cobros', 'Inventado'] }, schema)).toEqual(['"Inventado" no existe en la columna "Módulo" del tablero.']);
    expect(draftProblems({ ...draft, priority: 'Crítica' as never }, schema)[0]).toContain('Crítica');
  });
});

describe('pageProperties', () => {
  it('always files it as a new bug, whatever the draft says', () => {
    const properties = pageProperties({ ...draft, tipo: 'Missing Feature', estado: 'Finalizada' } as never, 'Torres');
    expect(properties.Tipo).toEqual({ select: { name: 'Bug' } });
    expect(properties.Estado).toEqual({ status: { name: 'Sin empezar' } });
  });
  it('takes the client from the investigation, and leaves it out when there is none', () => {
    expect(pageProperties(draft, 'Torres')['Cliente Afectado']?.rich_text[0].text.content).toBe('Torres');
    expect(pageProperties(draft, null)).not.toHaveProperty('Cliente Afectado');
  });
  it('fits Notion\'s limit on a text', () => {
    expect(pageProperties({ ...draft, description: 'x'.repeat(5000) }, null).Descripción.rich_text[0].text.content).toHaveLength(2000);
  });
});

describe('pageBlocks', () => {
  const blocks = pageBlocks(draft, 'https://console/inbox?c=1&inv=2') as { type: string; [key: string]: unknown }[];
  const content = JSON.stringify(blocks);

  it('follows the skill\'s Bug template, in order', () => {
    const order = ['Descripción de la Tarea', 'Qué pasa (problema actual):', 'Qué debería pasar (esperado):', 'Pasos para reproducir:', 'Módulo / Pantalla afectada:', 'Criterios de aceptación:', 'Notas / contexto adicional:'];
    const positions = order.map((title) => content.indexOf(title));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
  it('uses real lists and checkboxes', () => {
    expect(blocks.filter((b) => b.type === 'numbered_list_item')).toHaveLength(2);
    expect(blocks.filter((b) => b.type === 'to_do')).toHaveLength(1);
  });
  it('links only to the investigation', () => {
    const withLink = pageBlocks({ ...draft, problem: 'Mirá https://evil.example' }, 'https://console/x');
    const links = JSON.stringify(withLink).match(/"link":\{"url":"[^"]+"/g);
    expect(links).toEqual(['"link":{"url":"https://console/x"']);
  });
  it('leaves a local address as text, since Notion refuses it as a link', () => {
    expect(JSON.stringify(pageBlocks(draft, 'http://localhost:3000/x'))).not.toContain('"link"');
  });
});

describe('databaseIdFrom', () => {
  const dashed = '11111111-2222-4333-8444-555555555555';
  it('reads a bare id, with or without dashes', () => {
    expect(databaseIdFrom(dashed)).toBe(dashed);
    expect(databaseIdFrom(dashed.replace(/-/g, ''))).toBe(dashed);
  });
  it('reads a Notion link', () => {
    expect(databaseIdFrom(`https://www.notion.so/team/Backlog-${dashed.replace(/-/g, '')}?v=abc123`)).toBe(dashed);
  });
  it('refuses anything else', () => {
    expect(databaseIdFrom('no es un tablero')).toBeNull();
    expect(databaseIdFrom(5)).toBeNull();
  });
});

describe('activeRowFrom', () => {
  it('keeps what the comparison needs, with a short description', () => {
    const row = activeRowFrom({
      id: 'p',
      url: 'u',
      properties: {
        'Nombre de tarea': { title: [{ plain_text: 'Mora ' }, { plain_text: 'mal' }] },
        Descripción: { rich_text: [{ plain_text: 'x'.repeat(500) }] },
        Módulo: { multi_select: [{ name: 'Cobros' }] },
      },
    });
    expect(row).toMatchObject({ id: 'p', url: 'u', title: 'Mora mal', modules: ['Cobros'] });
    expect(row.description).toHaveLength(200);
  });
  it('survives a row with empty cells', () => {
    expect(activeRowFrom({ id: 'p', url: 'u', properties: {} })).toMatchObject({ title: '', description: '', modules: [] });
  });
});

describe('backlogRefusal', () => {
  const ready = { status: 'done', report: { conclusion: 'confirmed', backlogDraft: draft } } as never;
  const at = (ms: number) => ({ toMillis: () => ms });
  const now = 1_000_000;

  it('lets a confirmed bug through', () => {
    expect(backlogRefusal(ready, false, now)).toBeNull();
  });
  it('needs a confirmed definition', () => {
    expect(backlogRefusal({ status: 'done', report: { conclusion: 'confirmed', backlogDraft: null } } as never, false, now)).toBe('no-draft');
    expect(backlogRefusal({ status: 'done', report: { conclusion: 'hypothesis', backlogDraft: draft } } as never, false, now)).toBe('no-draft');
    expect(backlogRefusal({ status: 'queued', report: null } as never, false, now)).toBe('no-draft');
  });
  it('stops at a duplicate unless the agent insists', () => {
    const duplicate = { status: 'done', report: { conclusion: 'confirmed', backlogDraft: { ...draft, duplicateOf: { id: 'p', title: 't', url: 'u' } } } } as never;
    expect(backlogRefusal(duplicate, false, now)).toBe('duplicate');
    expect(backlogRefusal(duplicate, true, now)).toBeNull();
  });
  it('never adds it twice', () => {
    const created = { ...(ready as object), backlogItem: { status: 'created', url: 'u', at: at(0) } } as never;
    expect(backlogRefusal(created, true, now)).toBe('done');
    const creating = { ...(ready as object), backlogItem: { status: 'creating', url: null, at: at(now - 1000) } } as never;
    expect(backlogRefusal(creating, true, now)).toBe('in-progress');
  });
  it('lets a click that died halfway be tried again', () => {
    const stuck = { ...(ready as object), backlogItem: { status: 'creating', url: null, at: at(now - 3 * 60_000) } } as never;
    expect(backlogRefusal(stuck, false, now)).toBeNull();
  });
});
