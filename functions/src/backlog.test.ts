import { describe, expect, it } from 'vitest';
import type { InvestigationBacklogDraft } from '@aditum-chat/shared';
import {
  activeRowFrom,
  backlogRefusal,
  boardProblems,
  databaseIdFrom,
  draftProblems,
  pageBlocks,
  pageProperties,
  ticketClaim,
  ticketDescription,
  ticketParamsFrom,
  type BoardSchema,
} from './backlog.js';

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
const improvement: InvestigationBacklogDraft = {
  ...draft,
  type: 'Missing Feature',
  name: 'Consumo de agua en el teléfono',
  problem: 'Hace falta esto',
  expected: 'Se vería así',
  steps: [],
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
  it('rejects an improvement on a board that only takes bugs', () => {
    const onlyBugs = { properties: { ...schema.properties, Tipo: { type: 'select', select: options('Bug') } } };
    expect(draftProblems(improvement, schema)).toEqual([]);
    expect(draftProblems(improvement, onlyBugs)).toEqual(['"Missing Feature" no existe en la columna "Tipo" del tablero.']);
    expect(draftProblems(draft, onlyBugs)).toEqual([]);
  });
});

describe('pageProperties', () => {
  it('always files it as new, whatever the draft says', () => {
    const properties = pageProperties({ ...draft, estado: 'Finalizada' } as never, 'Torres');
    expect(properties.Estado).toEqual({ status: { name: 'Sin empezar' } });
  });
  it('files an improvement as a Missing Feature, and anything else as a bug', () => {
    expect(pageProperties(improvement, null).Tipo).toEqual({ select: { name: 'Missing Feature' } });
    expect(pageProperties(draft, null).Tipo).toEqual({ select: { name: 'Bug' } });
    expect(pageProperties({ ...draft, type: 'Epic' } as never, null).Tipo).toEqual({ select: { name: 'Bug' } });
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
  it('follows the skill\'s Missing Feature template for an improvement, without steps', () => {
    const page = JSON.stringify(pageBlocks({ ...improvement, steps: ['No va'] }, 'https://console/x'));
    const order = ['Descripción de la Tarea', 'Qué se necesita (objetivo):', 'Resultado esperado (cómo se ve/usa cuando esté listo):', 'Módulo / Pantalla afectada:', 'Criterios de aceptación:', 'Notas / contexto adicional:'];
    const positions = order.map((title) => page.indexOf(title));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(page).not.toContain('Pasos para reproducir');
    expect(page).not.toContain('numbered_list_item');
    expect(page).not.toContain('Qué pasa');
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
  it('takes an improvement on a hypothesis, since it claims nothing is broken, but not on nothing', () => {
    const on = (conclusion: string) => ({ status: 'done', report: { conclusion, backlogDraft: improvement } }) as never;
    expect(backlogRefusal(on('confirmed'), false, now)).toBeNull();
    expect(backlogRefusal(on('hypothesis'), false, now)).toBeNull();
    expect(backlogRefusal(on('undetermined'), false, now)).toBe('no-draft');
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

describe('ticketClaim', () => {
  const now = 10 * 60_000;
  const at = (ms: number) => ({ toMillis: () => ms });
  const item = (ticket?: object) => ({ status: 'created', url: 'u', by: { uid: 'a', nombre: 'Ana' }, at: at(0), ...(ticket && { ticket }) }) as never;

  it('opens one when the row has none', () => {
    expect(ticketClaim(item(), now)).toBe('create');
    expect(ticketClaim(undefined, now)).toBe('create');
  });
  it('never opens a second one', () => {
    expect(ticketClaim(item({ status: 'created', ticketId: 't', numero: 7, at: at(0) }), now)).toBe('done');
  });
  it('holds a second click while the first is in flight, and lets go of one that died', () => {
    expect(ticketClaim(item({ status: 'creating', ticketId: null, numero: null, at: at(now - 1000) }), now)).toBe('in-progress');
    expect(ticketClaim(item({ status: 'creating', ticketId: null, numero: null, at: at(now - 3 * 60_000) }), now)).toBe('create');
  });
});

describe('the client\'s ticket', () => {
  const by = { tipo: 'agent', id: 'a1', nombre: 'Ana' } as const;
  const direct = { tipo: 'directa', siteId: 's1', clientId: 'c1', clientNombre: 'Torres', contactId: 'k1', contactNombre: 'Luis' } as never;
  const group = { tipo: 'grupo', siteId: 's1', groupId: 'g1', groupName: 'Grupo Norte' } as never;

  it('belongs to whoever the chat is with, not to anything in the draft', () => {
    const params = ticketParamsFrom({ ...improvement, siteId: 'otro', contactId: 'otro' } as never, 'conv1', direct, by);
    expect(params).toMatchObject({ siteId: 's1', clientId: 'c1', clientNombre: 'Torres', contactId: 'k1', contactNombre: 'Luis', conversationId: 'conv1', creadoPor: by });
    expect(params).toMatchObject({ asunto: 'Consumo de agua en el teléfono', ambito: 'cliente', publico: false });
    expect(params).not.toHaveProperty('groupId');
  });
  it('is the group\'s when the chat is a group\'s', () => {
    expect(ticketParamsFrom(draft, 'conv2', group, by)).toMatchObject({ groupId: 'g1', groupName: 'Grupo Norte', ambito: 'grupo', publico: true });
    expect(ticketParamsFrom(draft, 'conv2', group, by)).not.toHaveProperty('contactId');
  });
  it('maps the board\'s priority to the ticket\'s', () => {
    const priority = (p: string) => ticketParamsFrom({ ...draft, priority: p } as never, 'c', direct, by).prioridad;
    expect([priority('Urgente'), priority('Alta'), priority('Media'), priority('Baja'), priority('Otra')]).toEqual(['alta', 'alta', 'media', 'baja', 'media']);
  });
  it('describes it with the words of its type, and no steps or internal links', () => {
    expect(ticketDescription(improvement)).toBe('Corto\n\nQué se necesita:\nHace falta esto\n\nResultado esperado:\nSe vería así\n\nPantalla: Cuotas (Cobros → Cuotas)');
    const bug = ticketDescription(draft);
    expect(bug).toContain('Qué pasa:\nPasa esto');
    expect(bug).toContain('Qué debería pasar:\nDebería pasar aquello');
    expect(bug).not.toContain('Entrar');
  });
  it('fits a long definition and skips what is empty', () => {
    expect(ticketDescription({ ...draft, problem: 'x'.repeat(9000) }).length).toBe(4000);
    expect(ticketDescription({ ...draft, description: '', expected: '', screenName: '', howToReach: '' })).toBe('Qué pasa:\nPasa esto');
  });
});
