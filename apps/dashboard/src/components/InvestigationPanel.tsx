'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type {
  Group,
  InvestigationCondominium,
  InvestigationSentMessages,
  Conversation,
  Investigation,
  InvestigationBacklogDraft,
  InvestigationFile,
  InvestigationConclusion,
  InvestigationMessageRef,
  InvestigationReport,
  InvestigationStatus,
  InvestigationTurn,
  InvestigatorBacklogConfig,
  Message,
} from '@aditum-chat/shared';
import {
  INVESTIGATION_FILE_ACCEPT,
  INVESTIGATION_MAX_FILE_BYTES,
  INVESTIGATION_MAX_FILES,
  investigationFileKind,
} from '@aditum-chat/shared';
import { useAuth } from '@/lib/auth';
import { fmtFecha, useContact, useContactThread, useDoc, useGroupThread, useMessages, type Row, type ThreadRow } from '@/lib/data';
import {
  addInvestigationToBacklog,
  cancelInvestigation,
  investigationFileUrl,
  requestFollowUp,
  requestInvestigation,
  uploadInvestigationFile,
  useInvestigationList,
  useInvestigationPhase,
  useInvestigationQueries,
  useInvestigationTurns,
  useRunnerOnline,
} from '@/lib/data-investigations';
import { useT } from '@/lib/i18n';
import { ClaudeLogo, InvestigatorMascot } from './InvestigatorMascot';
import { WriteProposals } from './WriteProposal';

const MAX_MESSAGES = 100;
const MIN_QUESTION_CHARS = 10;
const MIN_FOLLOW_UP_CHARS = 3;
export const TOKEN_WARNING_DAYS = 30;

/** "Investigate this message": opens the form with only that message marked. */
/** Asks an open panel to show something. No `ref` or `id` means the form, as the agent left it. */
export interface InvestigationRequest {
  nonce: number;
  /** Starts the form over with only this message marked. */
  ref?: InvestigationMessageRef;
  /** Shows this investigation. */
  id?: string;
  /** Shows the chat's list. */
  list?: boolean;
}

/** What the form starts from. A new `nonce` resets it. */
interface FormStart {
  nonce: number;
  question?: string;
  refs?: InvestigationMessageRef[];
  uploads?: { storagePath: string; name: string; size: number }[];
  condominiums?: InvestigationCondominium[];
}

/** A file the agent added. `problem` is an i18n key: the file stays listed so they see why it won't go. */
interface Upload {
  key: string;
  name: string;
  size: number;
  storagePath: string | null;
  problem: 'inv.archivoTipo' | 'inv.archivoGrande' | 'inv.archivoError' | null;
}

/** One view at a time: the list, the form, or one investigation. */
export type InvestigationPane = null | 'new' | { id: string };
type Pane = InvestigationPane;

/** What a chat's panel was showing. Opening a chat remounts everything, so this outlives it. */
interface PanelMemory {
  open: boolean;
  pane: Pane;
  form: FormStart | null;
}
const panelMemory = new Map<string, PanelMemory>();

export const recallInvestigationPanel = (chatKey: string): PanelMemory | null => panelMemory.get(chatKey) ?? null;

export function rememberInvestigationPanel(chatKey: string, patch: Partial<PanelMemory>) {
  panelMemory.set(chatKey, { open: false, pane: null, form: null, ...panelMemory.get(chatKey), ...patch });
}

/** Starting points for the question: picking one fills the text, which stays editable. */
const QUESTION_TEMPLATES = ['error', 'consulta', 'funciona', 'datos'] as const;

const keyOf = (r: InvestigationMessageRef) => `${r.conversationId}/${r.messageId}`;

const STATUS_TONE: Record<InvestigationStatus, string> = {
  queued: 'text-warm-gray',
  running: 'text-claude-dark',
  done: 'text-ok-dark',
  failed: 'text-danger',
  rate_limited: 'text-warn-dark',
  cancelled: 'text-warm-gray',
};

const CONCLUSION_TONE: Record<InvestigationConclusion, string> = {
  confirmed: 'text-ok-dark',
  hypothesis: 'text-warn-dark',
  undetermined: 'text-warm-gray',
};

const CONCLUSION_STYLE: Record<InvestigationConclusion, string> = {
  confirmed: 'bg-ok-bg text-ok-dark',
  hypothesis: 'bg-warn-bg text-warn-dark',
  undetermined: 'bg-cream-2 text-ink-2',
};

/** The rough steps shown while it runs. Whether it reaches the database varies, so that's in the title instead. */
const PROGRESS_STEPS = ['queued', 'preparing', 'analyzing', 'done'] as const;

/** How each outcome looks at a glance in the panel's list. */
const OUTCOME_BADGE: Record<InvestigationConclusion | Exclude<InvestigationStatus, 'done' | 'running'>, { icon: string; style: string }> = {
  confirmed: { icon: 'check', style: 'bg-ok-bg text-ok-dark' },
  hypothesis: { icon: 'lightbulb', style: 'bg-warn-bg text-warn-dark' },
  undetermined: { icon: 'help', style: 'bg-cream-2 text-ink-2' },
  failed: { icon: 'error', style: 'bg-danger-bg text-danger' },
  rate_limited: { icon: 'hourglass_top', style: 'bg-warn-bg text-warn-dark' },
  cancelled: { icon: 'block', style: 'bg-cream-2 text-warm-gray' },
  queued: { icon: 'schedule', style: 'bg-cream-2 text-ink-2' },
};

const millis = (ts: unknown) => (ts as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;

const isSystem = (m: Message) => m.sender.tipo === 'sistema' || m.tipoContenido === 'sistema';

const isActive = (status: InvestigationStatus) => status === 'queued' || status === 'running';

/** The current conversation is what usually gets analyzed, so it starts marked. */
function defaultSelection(rows: ThreadRow[], conversationId: string): Set<string> {
  const keys = rows
    .filter((r) => r.convId === conversationId && !isSystem(r.msg.data) && !r.msg.data.interno && !r.msg.data.bienvenida)
    .map((r) => keyOf({ conversationId: r.convId, messageId: r.msg.id }));
  return new Set(keys.slice(-MAX_MESSAGES));
}

export function InvestigationPanel({
  conv,
  threadKey,
  chatKey,
  request,
  onPaneChange,
  onUseReply,
  onNotifyClient,
}: {
  conv: Row<Conversation>;
  threadKey: string | null;
  /** Where this chat's panel is remembered. */
  chatKey: string;
  request: InvestigationRequest | null;
  onPaneChange(pane: Pane): void;
  onUseReply(texto: string): void;
  /** Sends a text to the chat, as if the agent had written it. */
  onNotifyClient(texto: string): Promise<void>;
}) {
  const t = useT();
  // The hook lists every chat's for a null key, and this panel only ever shows its own chat's.
  const list = useInvestigationList(threadKey ?? 'none');
  const [pane, setPane] = useState<Pane>(() =>
    request?.id ? { id: request.id } : request?.list ? null : request ? 'new' : (recallInvestigationPanel(chatKey)?.pane ?? null),
  );
  const [form, setForm] = useState<FormStart>(
    () => (request?.ref ? { nonce: request.nonce, refs: [request.ref] } : recallInvestigationPanel(chatKey)?.form) ?? { nonce: 0 },
  );
  const questionRef = useRef<HTMLTextAreaElement>(null);
  // Investigations the client was already told about, so one click can't become two messages.
  const [notified, setNotified] = useState<ReadonlySet<string>>(() => new Set());
  // Up here, so opening a report and coming back doesn't lose them.
  const [listFilter, setListFilter] = useState<InvestigationFilter>('todas');
  const [listSearch, setListSearch] = useState('');

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const runner = useRunnerOnline(now);

  function openForm(start?: FormStart) {
    if (start) setForm(start);
    setPane('new');
    requestAnimationFrame(() => questionRef.current?.focus());
  }

  useEffect(() => {
    if (!request) return;
    if (request.id) setPane({ id: request.id });
    else if (request.list) setPane(null);
    else openForm(request.ref ? { nonce: request.nonce, refs: [request.ref] } : undefined);
  }, [request]);

  useEffect(() => {
    rememberInvestigationPanel(chatKey, { pane });
    onPaneChange(pane);
  }, [chatKey, pane, onPaneChange]);

  const selectedId = pane && pane !== 'new' ? pane.id : null;
  const selected = useDoc<Investigation>(selectedId ? `investigations/${selectedId}` : null);

  return (
    <div className="flex h-full min-h-0 max-w-3xl flex-col">
      {pane !== null && (
        <button
          onClick={() => setPane(null)}
          className="-ml-0.5 mb-2.5 flex flex-none items-center gap-1 self-start rounded text-[12.5px] font-semibold text-warm-gray hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
        >
          <span aria-hidden className="msr text-[17px]">arrow_back</span>
          {t('inv.titulo')}
        </button>
      )}
      {!runner.online && (
        <p className="mb-2 flex-none rounded-lg bg-warn-bg px-3 py-1.5 text-[12px] text-warn-dark">{t('inv.desconectado')}</p>
      )}
      {runner.online && runner.tokenDaysLeft !== null && runner.tokenDaysLeft < TOKEN_WARNING_DAYS && (
        <p className="mb-2 flex-none rounded-lg bg-warn-bg px-3 py-1.5 text-[12px] text-warn-dark">
          {t('inv.tokenVence', { n: runner.tokenDaysLeft })}
        </p>
      )}

      {pane === null && (
        <SavedList
          list={list}
          filter={listFilter}
          search={listSearch}
          onFilter={setListFilter}
          onSearch={setListSearch}
          onOpen={(id) => setPane({ id })}
          onNew={() => openForm()}
        />
      )}

      {/* Stays mounted while a report or the list is showing, so a half-written question isn't lost. */}
      <div className={pane === 'new' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        <NewInvestigation
          key={form.nonce}
          conv={conv}
          start={form}
          questionRef={questionRef}
          onDraft={(draft) => rememberInvestigationPanel(chatKey, { form: draft })}
          onCreated={(id) => {
            setForm({ nonce: Date.now() });
            setPane({ id });
          }}
        />
      </div>

      {selectedId && selected?.id === selectedId && (
        <InvestigationDetail
          key={selectedId}
          row={selected}
          actions={
            selected.data.threadKey === threadKey
              ? {
                  onUseReply,
                  notified: notified.has(selectedId),
                  onNotifyClient: async (texto) => {
                    await onNotifyClient(texto);
                    setNotified((current) => new Set(current).add(selectedId));
                  },
                  onRetry: () =>
                    openForm({
                      nonce: Date.now(),
                      question: selected.data.question,
                      refs: selected.data.messageRefs,
                      condominiums: selected.data.condominiums,
                      uploads: (selected.data.files ?? [])
                        .filter((file) => file.source === 'agent')
                        .map(({ storagePath, name, size }) => ({ storagePath, name, size })),
                    }),
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

function InvestigationStatusChip({ row }: { row: Row<Investigation> }) {
  const t = useT();
  const { status, report } = row.data;
  const concluded = status === 'done' && report;
  return (
    <span
      className={`flex flex-none items-center gap-1.5 text-[12px] font-semibold ${concluded ? CONCLUSION_TONE[report.conclusion] : STATUS_TONE[status]}`}
    >
      <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-current" />
      {concluded ? t(`inv.conclusion.${report.conclusion}`) : t(`inv.estado.${status}`)}
    </span>
  );
}

export type InvestigationFilter = 'todas' | 'enCurso' | 'confirmadas' | 'hipotesis' | 'sinDeterminar' | 'sinResultado';
const INVESTIGATION_FILTERS: InvestigationFilter[] = ['todas', 'enCurso', 'confirmadas', 'hipotesis', 'sinDeterminar', 'sinResultado'];

function matchesFilter({ status, report }: Investigation, filter: InvestigationFilter): boolean {
  switch (filter) {
    case 'todas':
      return true;
    case 'enCurso':
      return status === 'queued' || status === 'running';
    case 'confirmadas':
      return status === 'done' && report?.conclusion === 'confirmed';
    case 'hipotesis':
      return status === 'done' && report?.conclusion === 'hypothesis';
    case 'sinDeterminar':
      return status === 'done' && report?.conclusion === 'undetermined';
    case 'sinResultado':
      return status === 'failed' || status === 'rate_limited' || status === 'cancelled';
  }
}

export function matchesInvestigationFilters(investigation: Investigation, filter: InvestigationFilter, search: string): boolean {
  const term = search.trim().toLowerCase();
  return (
    matchesFilter(investigation, filter) &&
    (!term || [investigation.question, investigation.requestedBy.nombre, sourceLabel(investigation)].some((text) => text.toLowerCase().includes(term)))
  );
}

/** The search and the outcome filters over a list of investigations. */
export function InvestigationFilters({
  search,
  onSearch,
  filter,
  onFilter,
}: {
  search: string;
  onSearch(search: string): void;
  filter: InvestigationFilter;
  onFilter(filter: InvestigationFilter): void;
}) {
  const t = useT();
  return (
    <>
    <div className="relative mt-2.5">
      <span className="msr pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[17px] text-warm-gray">search</span>
      <input
        type="search"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder={t('inv.buscar')}
        aria-label={t('inv.buscar')}
        className="w-full rounded-lg border border-warm-border bg-cream-0 py-1.5 pl-8 pr-2.5 text-[12.5px] outline-none focus:border-ai"
      />
    </div>
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      {INVESTIGATION_FILTERS.map((value) => (
        <button
          key={value}
          onClick={() => onFilter(value)}
          aria-pressed={filter === value}
          className={`rounded-full border px-2.5 py-1 text-[11.5px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy ${
            filter === value ? 'border-navy bg-navy text-white' : 'border-warm-border text-ink-2 hover:border-navy'
          }`}
        >
          {t(`inv.filtro.${value}`)}
        </button>
      ))}
    </div>
    </>
  );
}

function Mark({ icon, label, title, style }: { icon: string; label: string; title: string; style: string }) {
  return (
    <span title={title} className={`inline-flex h-[22px] items-center gap-1 rounded-md px-1.5 text-[11.5px] font-semibold ${style}`}>
      <span aria-hidden className="msr text-[14px]">{icon}</span>
      {label}
    </span>
  );
}

/** What came out of an investigation besides its report. The full detail is inside it. */
function InvestigationMarks({ data, className = '' }: { data: Investigation; className?: string }) {
  const t = useT();
  const item = data.backlogItem?.status === 'created' ? data.backlogItem : null;
  const write = data.productionWrite;
  if (!item && !write) return null;
  const byLine = ({ by, at }: { by: { nombre: string }; at: unknown }) => t('inv.marca.por', { por: by.nombre, fecha: fmtFecha(at, true) });
  return (
    <span className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {write && (
        <Mark
          icon={write.status === 'unknown' ? 'warning' : write.reversal ? 'undo' : 'database'}
          label={t(write.status === 'unknown' ? 'inv.marca.revisar' : write.reversal ? 'inv.marca.revertido' : 'inv.marca.corregido')}
          title={byLine(write)}
          style={write.status === 'unknown' ? 'bg-warn-bg text-warn-dark' : write.reversal ? 'bg-cream-2 text-ink-2' : 'bg-ok-bg text-ok-dark'}
        />
      )}
      {item && <Mark icon="bug_report" label={t('inv.marca.backlog')} title={byLine(item)} style="bg-cream-2 text-ink-2" />}
    </span>
  );
}

/** One investigation in a list, in the chat's panel and on the page alike. */
export function InvestigationRow({
  row,
  chat,
  selected = false,
  onOpen,
}: {
  row: Row<Investigation>;
  /** Who it was with, when the list mixes chats. */
  chat?: string;
  selected?: boolean;
  onOpen(): void;
}) {
  const t = useT();
  const { status, report, question, createdAt, requestedBy, turn } = row.data;
  const conclusion = status === 'done' ? report?.conclusion : undefined;
  const badge = status === 'running' ? null : OUTCOME_BADGE[conclusion ?? (status === 'done' ? 'undetermined' : status)];
  return (
    <button
      onClick={onOpen}
      aria-current={selected}
      className={`relative flex w-full gap-3 px-4 py-3.5 text-left transition-colors duration-150 after:absolute after:bottom-0 after:left-16 after:right-0 after:h-px after:bg-cream-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy ${
        selected ? 'bg-info-bg' : 'hover:bg-cream-0'
      }`}
    >
      {badge ? (
        <span aria-hidden className={`flex h-9 w-9 flex-none items-center justify-center rounded-[10px] ${badge.style}`}>
          <span className="msr text-[19px]">{badge.icon}</span>
        </span>
      ) : (
        <span aria-hidden className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-claude-bg">
          <ClaudeLogo className="h-3.5 motion-safe:animate-pulse" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-ink">{question}</span>
        {chat && <span className="mt-0.5 block truncate text-[12.5px] text-ink-2">{chat}</span>}
        <span className="mt-1.5 flex items-baseline gap-2">
          <span className={`flex-none text-[12px] font-semibold ${conclusion ? CONCLUSION_TONE[conclusion] : STATUS_TONE[status]}`}>
            {conclusion ? t(`inv.conclusion.${conclusion}`) : t(`inv.estado.${status}`)}
          </span>
          <span className="min-w-0 truncate text-[11.5px] text-warm-gray">
            {fmtFecha(createdAt, true)} · {requestedBy.nombre}
            {(turn ?? 1) > 1 && <> · {t('inv.nPreguntas', { n: turn! })}</>}
          </span>
        </span>
        <InvestigationMarks data={row.data} className="mt-2" />
      </span>
    </button>
  );
}

function SavedList({
  list,
  filter,
  search,
  onFilter,
  onSearch,
  onOpen,
  onNew,
}: {
  list: ReturnType<typeof useInvestigationList>;
  filter: InvestigationFilter;
  search: string;
  onFilter(filter: InvestigationFilter): void;
  onSearch(search: string): void;
  onOpen(id: string): void;
  onNew(): void;
}) {
  const t = useT();
  const rows = list.rows.filter(({ data }) => matchesInvestigationFilters(data, filter, search));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center justify-between gap-3 pb-3 pt-1">
        <p className="text-[13px] text-warm-gray">
          {list.rows.length > 0 && t('inv.enEsteChat', { n: `${list.rows.length}${list.hasMore ? '+' : ''}` })}
        </p>
        <button
          onClick={onNew}
          aria-label={t('inv.nueva')}
          className="flex h-[34px] flex-none items-center gap-1.5 rounded-lg bg-navy px-3.5 text-[13.5px] font-semibold text-white hover:bg-navy-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
        >
          <span className="msr text-[17px]">add</span>
          {t('inv.nuevaCorta')}
        </button>
      </div>

      {list.rows.length > 0 && (
        <div className="flex-none pb-3">
          <InvestigationFilters search={search} onSearch={onSearch} filter={filter} onFilter={onFilter} />
        </div>
      )}

      <div className="-mx-4 min-h-0 flex-1 overflow-y-auto border-t border-cream-3">
        {list.error ? (
          <p className="p-4 text-[13px] text-warn-dark">{t('inv.errorLista')}</p>
        ) : list.loading ? null : list.rows.length === 0 ? (
          <div className="p-4 text-[13px] text-warm-gray">
            <p className="font-semibold text-ink-2">{t('inv.vacio')}</p>
            <p className="mt-1 leading-relaxed">{t('inv.vacioAyuda')}</p>
          </div>
        ) : rows.length === 0 ? (
          <p className="p-4 text-[12.5px] text-warm-gray">{t('inv.sinCoincidencias')}</p>
        ) : (
          <ul>
            {rows.map((row) => (
              <li key={row.id}>
                <InvestigationRow row={row} onOpen={() => onOpen(row.id)} />
              </li>
            ))}
          </ul>
        )}
        {list.hasMore && (
          <button
            onClick={list.loadMore}
            className="w-full py-3 text-[12.5px] font-semibold text-navy hover:bg-cream-1"
          >
            {t('inv.cargarMas')}
          </button>
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function UploadChip({ upload, onRemove }: { upload: Upload; onRemove(): void }) {
  const t = useT();
  const uploading = !upload.storagePath && !upload.problem;
  const extension = upload.name.includes('.') ? upload.name.split('.').pop()!.slice(0, 4).toUpperCase() : '?';
  return (
    <li
      title={upload.problem ? t(upload.problem) : upload.name}
      className={`flex max-w-full items-center gap-2 rounded-lg border py-1 pl-2 pr-1 ${
        upload.problem ? 'border-warn-bg bg-warn-bg text-warn-dark' : 'border-cream-3 bg-cream-1 text-ink'
      }`}
    >
      {upload.problem ? (
        <span className="msr flex-none text-[15px]">error</span>
      ) : uploading ? (
        <span className="msr flex-none text-[15px] text-ai motion-safe:animate-spin">progress_activity</span>
      ) : (
        <span className="flex-none rounded bg-ai-bg px-1.5 py-0.5 font-mono text-[10px] font-medium text-navy">{extension}</span>
      )}
      <span className="min-w-0 max-w-[150px] truncate text-[12.5px] font-medium">{upload.name}</span>
      <span className={`min-w-0 text-[11.5px] ${upload.problem ? 'font-semibold' : 'flex-none text-warm-gray'}`}>
        {upload.problem ? t(upload.problem) : uploading ? t('inv.archivoSubiendo') : formatBytes(upload.size)}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('inv.archivoQuitar', { name: upload.name })}
        title={t('inv.archivoQuitar', { name: upload.name })}
        className="flex flex-none rounded p-0.5 hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-ai"
      >
        <span className="msr text-[14px]">close</span>
      </button>
    </li>
  );
}

/** The chat's condominium and its group's, once each and in the order of a list to search. */
export function chatCondominiums(
  clientId: string | null | undefined,
  clientNombre: string | null | undefined,
  groupClients: { id: string; name: string }[] | undefined,
): InvestigationCondominium[] {
  const byId = new Map<string, InvestigationCondominium>();
  for (const { id, name } of groupClients ?? []) byId.set(id, { id, name });
  if (clientId && !byId.has(clientId)) byId.set(clientId, { id: clientId, name: clientNombre || clientId });
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/** Where the chat is, or the only one there is. With several and no chat of its own, the agent has to say. */
export function defaultCondominiums(clientId: string | null | undefined, options: InvestigationCondominium[]): InvestigationCondominium[] {
  const own = options.filter((option) => option.id === clientId);
  if (own.length > 0) return own;
  return options.length === 1 ? options : [];
}

const searchable = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const sameCondominium = (a: InvestigationCondominium, b: InvestigationCondominium) =>
  a.id !== null || b.id !== null ? a.id === b.id : a.name === b.name;
/** With more than this the list scrolls, so what's chosen also shows above it. */
const CONDOMINIUMS_WITHOUT_SCROLL = 5;

/** One or several, from the chat's list. A name that isn't there can be typed, since the list is only what the host sent. */
function CondominiumPicker({
  options,
  selected,
  onChange,
}: {
  options: InvestigationCondominium[];
  selected: InvestigationCondominium[];
  onChange(next: InvestigationCondominium[]): void;
}) {
  const t = useT();
  const [search, setSearch] = useState('');
  const term = searchable(search.trim());
  const isSelected = (item: InvestigationCondominium) => selected.some((other) => sameCondominium(item, other));
  const all = [...options, ...selected.filter((item) => !options.some((option) => sameCondominium(item, option)))];
  const shown = all.filter((item) => !term || searchable(item.name).includes(term));
  const canType = search.trim().length >= 2 && !all.some((item) => searchable(item.name) === term);
  const scrolls = all.length > CONDOMINIUMS_WITHOUT_SCROLL;

  const toggle = (item: InvestigationCondominium) =>
    onChange(isSelected(item) ? selected.filter((other) => !sameCondominium(item, other)) : [...selected, item]);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="text-[15px] font-semibold text-ink">{t('inv.condominios')}</span>
        {selected.length > 0 && <span className="text-[12.5px] text-warm-gray">{t('inv.condominiosElegidos', { n: selected.length })}</span>}
      </div>

      {scrolls && selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((item) => (
            <button
              key={item.id ?? item.name}
              type="button"
              onClick={() => toggle(item)}
              aria-label={t('inv.condominioQuitar', { nombre: item.name })}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-info-bg px-2.5 py-1 text-[12.5px] font-medium text-ink hover:bg-cream-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ai"
            >
              <span className="min-w-0 truncate">{item.name}</span>
              <span aria-hidden className="msr flex-none text-[14px] text-warm-gray">close</span>
            </button>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-[10px] border border-cream-3">
        <label className="flex items-center gap-2 border-b border-cream-3 px-3 py-2">
          <span aria-hidden className="msr flex-none text-[17px] text-warm-gray">search</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('inv.condominiosBuscar')}
            aria-label={t('inv.condominiosBuscar')}
            maxLength={150}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-warm-gray"
          />
        </label>
        <ul className="max-h-[190px] overflow-y-auto">
          {shown.map((item) => (
            <li key={item.id ?? item.name} className="border-b border-cream-2 last:border-b-0">
              <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-cream-1">
                <input type="checkbox" checked={isSelected(item)} onChange={() => toggle(item)} className="h-4 w-4 flex-none accent-[var(--color-ai)]" />
                <span className="min-w-0 truncate text-[13.5px] text-ink">{item.name}</span>
                {item.id === null && <span className="flex-none text-[12px] text-warm-gray">{t('inv.condominioEscrito')}</span>}
              </label>
            </li>
          ))}
          {canType && (
            <li>
              <button
                type="button"
                onClick={() => {
                  onChange([...selected, { id: null, name: search.trim().replace(/\s+/g, ' ') }]);
                  setSearch('');
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] font-medium text-navy hover:bg-cream-1 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ai"
              >
                <span aria-hidden className="msr flex-none text-[16px]">add</span>
                <span className="min-w-0 truncate">{t('inv.condominioUsar', { nombre: search.trim() })}</span>
              </button>
            </li>
          )}
          {shown.length === 0 && !canType && <li className="px-3 py-2 text-[13px] text-warm-gray">{t('inv.condominiosVacio')}</li>}
        </ul>
      </div>

      {selected.length === 0 && options.length > 0 && <p className="text-[12.5px] text-warn-dark">{t('inv.condominioFalta')}</p>}
    </div>
  );
}

function NewInvestigation({
  conv,
  start,
  questionRef,
  onDraft,
  onCreated,
}: {
  conv: Row<Conversation>;
  start: FormStart;
  questionRef: RefObject<HTMLTextAreaElement | null>;
  /** Called as it changes, so the form can come back the same after leaving the chat. */
  onDraft(draft: FormStart): void;
  onCreated(id: string): void;
}) {
  const t = useT();
  const grupo = conv.data.tipo === 'grupo';
  const contactThread = useContactThread(grupo ? null : (conv.data.contactId ?? null));
  const groupThread = useGroupThread(grupo ? (conv.data.groupId ?? null) : null);
  const thread = grupo ? groupThread : contactThread;
  // The thread starts at the latest segment, and this conversation may be an older one.
  const current = useMessages(conv.id);
  const rows = useMemo(() => {
    const merged = new Map<string, ThreadRow>();
    for (const row of thread.filas) merged.set(`${row.convId}/${row.msg.id}`, row);
    for (const msg of current) merged.set(`${conv.id}/${msg.id}`, { convId: conv.id, msg });
    return [...merged.values()]
      .filter((r) => r.msg.data.tipoContenido !== 'csat')
      .sort((a, b) => millis(a.msg.data.createdAt) - millis(b.msg.data.createdAt));
  }, [thread.filas, current, conv.id]);

  const [question, setQuestion] = useState(start.question ?? '');
  const [selected, setSelected] = useState<Set<string> | null>(start.refs ? new Set(start.refs.map(keyOf)) : null);
  // Null until the agent touches it: the chat's own condominium, which arrives with the chat.
  const [pickedCondominiums, setPickedCondominiums] = useState<InvestigationCondominium[] | null>(start.condominiums ?? null);
  const contact = useContact(conv.data.contactId ?? null);
  const groupId = conv.data.groupId ?? contact?.data.groupId ?? null;
  const group = useDoc<Group>(groupId ? `groups/${groupId}` : null);
  const condominiumOptions = useMemo(
    () => chatCondominiums(conv.data.clientId, conv.data.clientNombre, group?.data.clients),
    [conv.data.clientId, conv.data.clientNombre, group?.data.clients],
  );
  const condominiums = pickedCondominiums ?? defaultCondominiums(conv.data.clientId, condominiumOptions);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const { agent } = useAuth();
  const [uploads, setUploads] = useState<Upload[]>(() =>
    (start.uploads ?? []).map(({ storagePath, name, size }) => ({ key: storagePath, name, size, storagePath, problem: null })),
  );
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Waits for the conversation's messages, so it doesn't mark an empty list.
  useEffect(() => {
    if (current.length > 0 && selected === null) setSelected(defaultSelection(rows, conv.id));
  }, [current.length, rows, selected, conv.id]);

  // Untouched, it isn't saved: coming back later should mark the messages written since.
  useEffect(() => {
    const started = question.trim() !== '' || uploads.length > 0 || start.refs !== undefined;
    onDraft({
      nonce: start.nonce,
      question,
      refs:
        started && selected
          ? [...selected].map((key) => {
              const [conversationId, messageId] = key.split('/');
              return { conversationId, messageId };
            })
          : undefined,
      uploads: uploads.flatMap(({ storagePath, name, size, problem }) =>
        storagePath && !problem ? [{ storagePath, name, size }] : [],
      ),
      condominiums: pickedCondominiums ?? undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDraft is rebuilt on every render of the panel.
  }, [question, selected, uploads, pickedCondominiums, start.nonce, start.refs]);

  const marked = selected ?? new Set<string>();
  const full = marked.size >= MAX_MESSAGES;
  const typed = question.trim().length;
  const chatFiles = rows
    .filter((r) => marked.has(keyOf({ conversationId: r.convId, messageId: r.msg.id })))
    .flatMap((r) => r.msg.data.adjuntos ?? [])
    .filter((a) => investigationFileKind(a.mimeType, a.nombre));
  const readyUploads = uploads.filter((u) => u.storagePath && !u.problem);
  const fileCount = chatFiles.length + readyUploads.length;
  const tooManyFiles = fileCount > INVESTIGATION_MAX_FILES;
  const uploading = uploads.some((u) => !u.storagePath && !u.problem);
  const problem = failed ?? (typed > 0 && typed < MIN_QUESTION_CHARS ? t('inv.preguntaCorta') : null);
  // A chat with no known condominium can still ask something general.
  const missingCondominium = condominiums.length === 0 && condominiumOptions.length > 0;
  const canSend = typed >= MIN_QUESTION_CHARS && marked.size > 0 && !sending && !uploading && !tooManyFiles && !missingCondominium;

  function addFiles(list: FileList | File[]) {
    for (const file of Array.from(list)) {
      const key = `${file.name}_${Date.now()}_${Math.random()}`;
      const problem = !investigationFileKind(file.type, file.name)
        ? 'inv.archivoTipo'
        : file.size > INVESTIGATION_MAX_FILE_BYTES
          ? 'inv.archivoGrande'
          : null;
      setUploads((current) => [...current, { key, name: file.name, size: file.size, storagePath: null, problem }]);
      if (problem || !agent) continue;
      const update = (patch: Partial<Upload>) =>
        setUploads((current) => current.map((u) => (u.key === key ? { ...u, ...patch } : u)));
      uploadInvestigationFile(agent.uid, file)
        .then((storagePath) => update({ storagePath }))
        .catch(() => update({ problem: 'inv.archivoError' }));
    }
  }

  const templates = QUESTION_TEMPLATES.map((id) => ({
    id,
    label: t(`inv.plantilla.${id}`),
    text: t(`inv.plantilla.${id}Texto`),
  }));

  /** Swaps one template for another, but never overwrites what the agent wrote. */
  function applyTemplate(text: string) {
    const typedText = question.trim();
    const onlyTemplate = templates.some((template) => template.text === typedText);
    setQuestion((typedText && !onlyTemplate ? `${typedText}\n${text}` : text).slice(0, 1000));
    requestAnimationFrame(() => {
      const input = questionRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }

  function toggle(key: string) {
    const next = new Set(marked);
    if (next.has(key)) next.delete(key);
    else if (!full) next.add(key);
    setSelected(next);
  }

  async function send() {
    setSending(true);
    setFailed(null);
    try {
      const messages = [...marked].map((key) => {
        const [conversationId, messageId] = key.split('/');
        return { conversationId, messageId };
      });
      onCreated(
        await requestInvestigation({
          conversationId: conv.id,
          messages,
          question: question.trim(),
          uploads: readyUploads.map((u) => ({ storagePath: u.storagePath!, name: u.name })),
          condominiums,
        }),
      );
    } catch (e) {
      // The server explains these in the agent's terms: too many files, a daily limit.
      const { code, message } = e as { code?: string; message?: string };
      const explained = code === 'functions/invalid-argument' || code === 'functions/resource-exhausted';
      setFailed(explained && message ? message : t('inv.errorEnviar'));
      setSending(false);
    }
  }

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragEnter={(e) => {
        if ([...e.dataTransfer.types].includes('Files')) setDragging(true);
      }}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      {dragging && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-ai bg-ai-bg/90 text-[13px] font-semibold text-ai"
          onDragLeave={() => setDragging(false)}
        >
          {t('inv.soltar')}
        </div>
      )}
      <div className="-mx-4 min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        <div className="space-y-2">
          <label htmlFor={`inv-question-${conv.id}`} className="block text-[15px] font-semibold text-ink">
            {t('inv.pregunta')}
          </label>
          <div className="overflow-hidden rounded-[10px] border-[1.5px] border-warm-border bg-white focus-within:border-ai-light focus-within:ring-[3px] focus-within:ring-ai-bg">
            <textarea
              id={`inv-question-${conv.id}`}
              ref={questionRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onPaste={(e) => {
                if (e.clipboardData.files.length > 0) {
                  e.preventDefault();
                  addFiles(e.clipboardData.files);
                }
              }}
              placeholder={t('inv.preguntaAyuda')}
              rows={3}
              maxLength={1000}
              className="block w-full resize-none bg-transparent px-3.5 pb-1.5 pt-3 text-[14.5px] leading-snug text-ink outline-none placeholder:text-warm-gray-2"
            />
            {uploads.length > 0 && (
              <ul className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto px-2.5 pb-2">
                {uploads.map((upload) => (
                  <UploadChip
                    key={upload.key}
                    upload={upload}
                    onRemove={() => setUploads((current) => current.filter((u) => u.key !== upload.key))}
                  />
                ))}
              </ul>
            )}
            <div className="flex items-center justify-between gap-3 border-t border-cream-2 px-2 py-1.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-[30px] flex-none items-center gap-1.5 rounded-md px-2 text-[13px] font-semibold text-navy hover:bg-ai-bg focus-visible:outline-2 focus-visible:outline-ai"
              >
                <span className="msr text-[17px]">add</span>
                {t('inv.adjuntar')}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={INVESTIGATION_FILE_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <span
                title={t('inv.archivosAyuda')}
                className={`min-w-0 text-right text-[11.5px] ${tooManyFiles ? 'font-semibold text-warn-dark' : 'text-warm-gray'}`}
              >
                {fileCount > 0
                  ? t('inv.archivosCuenta', { n: fileCount, max: INVESTIGATION_MAX_FILES })
                  : t('inv.archivosPista')}
              </span>
            </div>
          </div>
          {tooManyFiles && (
            <p className="text-[12.5px] text-warn-dark">{t('inv.archivosDemasiados', { max: INVESTIGATION_MAX_FILES })}</p>
          )}
          <div role="group" aria-label={t('inv.plantillas')} className="flex flex-wrap gap-1.5">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => applyTemplate(template.text)}
                aria-pressed={question.trim() === template.text}
                title={template.text}
                className={`rounded-full border px-[11px] py-1.5 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ai ${
                  question.trim() === template.text
                    ? 'border-ai bg-ai-bg text-ai'
                    : 'border-warm-border text-ink hover:bg-cream-1'
                }`}
              >
                {template.label}
              </button>
            ))}
          </div>
        </div>

        <CondominiumPicker options={condominiumOptions} selected={condominiums} onChange={setPickedCondominiums} />

        <div className="space-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-semibold text-ink">{t('inv.mensajes')}</span>
            <span className="text-[12.5px] text-warm-gray">{t('inv.seleccionados', { n: marked.size, max: MAX_MESSAGES })}</span>
            {thread.hayMas && (
              <button
                onClick={() => void thread.loadOlder()}
                disabled={thread.cargando}
                className="ml-auto flex-none text-[13px] font-semibold text-navy hover:underline disabled:opacity-50"
              >
                {t('inv.cargarAnteriores')}
              </button>
            )}
          </div>

          <ul className="overflow-hidden rounded-[10px] border border-cream-3">
            {rows.map((row) => {
              const m = row.msg.data;
              const key = keyOf({ conversationId: row.convId, messageId: row.msg.id });
              const checked = marked.has(key);
              return (
                <li key={key} className="border-b border-cream-2 last:border-0">
                  <label className={`flex cursor-pointer gap-2.5 px-3 py-2.5 ${checked ? 'bg-ai-bg/50' : 'hover:bg-cream-1'}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && full}
                      onChange={() => toggle(key)}
                      className="mt-0.5 h-4 w-4 flex-none self-start accent-[var(--color-ai)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2 text-[12.5px] text-warm-gray">
                        <span className="truncate font-semibold text-ink">{m.sender.nombre}</span>
                        <span className="flex-none">{fmtFecha(m.createdAt, true)}</span>
                        {m.interno && <span className="flex-none font-semibold text-warn-dark">{t('inv.notaInterna')}</span>}
                        {isSystem(m) && <span className="flex-none">{t('inv.sistema')}</span>}
                      </span>
                      {m.texto && (
                        <span className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-[13.5px] leading-snug text-ink">{m.texto}</span>
                      )}
                      {(m.adjuntos ?? []).map((a) => {
                        const readable = !!investigationFileKind(a.mimeType, a.nombre);
                        return (
                          <span key={a.storagePath} className={`mt-0.5 flex items-center gap-1 text-[12px] ${readable ? 'text-ink-2' : 'text-warm-gray'}`}>
                            <span className="msr flex-none text-[14px]">{readable ? 'attach_file' : 'block'}</span>
                            <span className="min-w-0 truncate">{a.nombre ?? a.tipo}</span>
                            {!readable && <span className="flex-none">· {t('inv.archivoSinLeer')}</span>}
                          </span>
                        );
                      })}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="flex flex-none items-center justify-between gap-3 border-t border-cream-3 pt-2.5">
        <p className={`min-w-0 text-[13px] ${problem ? 'text-warn-dark' : 'text-warm-gray'}`}>
          {problem ?? t(marked.size === 1 ? 'inv.unMensaje' : 'inv.variosMensajes', { n: marked.size })}
        </p>
        <button
          onClick={() => void send()}
          disabled={!canSend}
          className="flex h-[38px] flex-none items-center rounded-lg bg-navy px-[18px] text-[14px] font-semibold text-white hover:bg-navy-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-40"
        >
          {sending ? t('inv.enviando') : t('inv.enviar')}
        </button>
      </div>
    </div>
  );
}

function Section({ title, warning, children }: { title: string; warning?: boolean; children: ReactNode }) {
  return (
    <section>
      <h4 className={`text-[11.5px] font-semibold uppercase tracking-[0.06em] ${warning ? 'text-warn-dark' : 'text-warm-gray'}`}>{title}</h4>
      <div className="mt-1.5 max-w-[70ch] break-words text-[14px] leading-[1.55] text-ink">{children}</div>
    </section>
  );
}

function Collapsible({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group border-b border-cream-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-3 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-warm-gray hover:text-ink focus-visible:outline-2 focus-visible:outline-ai [&::-webkit-details-marker]:hidden">
        <span>
          {title}
          {count !== undefined && <span className="ml-1 font-normal">({count})</span>}
        </span>
        {/* Wrapped because `.msr` sets its own display, which beats `hidden`. */}
        <span aria-hidden className="flex group-open:hidden"><span className="msr text-[16px]">add</span></span>
        <span aria-hidden className="hidden group-open:flex"><span className="msr text-[16px]">remove</span></span>
      </summary>
      <div className="max-w-[70ch] break-words pb-3.5 text-[14px] leading-[1.55] text-ink">{children}</div>
    </details>
  );
}

/** Who it's about, in the investigation's own words: it doesn't change if the chat does. */
export function sourceLabel({ source, condominiums }: Investigation): string {
  const where = condominiums?.length ? condominiums.map((item) => item.name).join(', ') : source?.clientNombre;
  return [source?.contactNombre, where].filter(Boolean).join(' · ');
}

function SentMessages({ id, count, running = false, defaultOpen = false }: { id: string; count: number; running?: boolean; defaultOpen?: boolean }) {
  const t = useT();
  const sent = useDoc<InvestigationSentMessages>(`investigations/${id}/sent/messages`);
  // Investigations from before these were saved only have the count, at the end of the report.
  if (!sent) return null;
  return (
    <Collapsible title={t('inv.mensajesEnviados')} count={count} defaultOpen={defaultOpen}>
      {/* Capped while it runs, so a long chat doesn't push the progress out of view. */}
      <ol className={`space-y-3 ${running ? 'max-h-52 overflow-y-auto pr-2' : ''}`}>
        {sent.data.messages.map((message, i) => (
          <li key={i} className="text-[13px] leading-snug">
            <p className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
              <span className="font-semibold text-ink">{message.senderName}</span>
              {message.at && <span className="text-warm-gray">{fmtFecha({ toDate: () => new Date(message.at!) }, true)}</span>}
              {message.internalNote && <span className="font-semibold text-warn-dark">{t('inv.notaInterna')}</span>}
            </p>
            {message.text && <p className="mt-0.5 whitespace-pre-wrap break-words text-ink-2">{message.text}</p>}
            {message.attachments.map((attachment, j) => (
              <p key={j} className="mt-0.5 flex items-center gap-1 text-[12px] text-warm-gray">
                <span aria-hidden className="msr text-[14px]">attach_file</span>
                <span className="min-w-0 break-words">{attachment.name ?? attachment.type}</span>
              </p>
            ))}
          </li>
        ))}
      </ol>
    </Collapsible>
  );
}

function FileRow({ file }: { file: InvestigationFile }) {
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    investigationFileUrl(file.storagePath)
      .then((value) => {
        if (alive) setUrl(value);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [file.storagePath]);
  return (
    <li className="flex items-center gap-1.5 text-[12px]">
      <span className="msr flex-none text-[15px] text-warm-gray">description</span>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="min-w-0 truncate font-semibold text-navy hover:underline">
          {file.name}
        </a>
      ) : (
        <span className="min-w-0 truncate font-semibold text-ink-2">{file.name}</span>
      )}
      <span className="flex-none text-[11px] text-warm-gray">{t(file.source === 'chat' ? 'inv.archivoChat' : 'inv.archivoAgente')}</span>
    </li>
  );
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Only a rough idea of where it is: the individual steps it takes aren't shown. */
function Working({ row, actions }: { row: Row<Investigation>; actions?: InvestigationChatActions }) {
  const t = useT();
  const running = row.data.status === 'running';
  const queuedAt = millis(row.data.queuedAt);
  const phase = useInvestigationPhase(running ? row.id : null, queuedAt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const since = millis(row.data.startedAt) || queuedAt || millis(row.data.createdAt);
  // A later round doesn't start over: before Claude's first step it's only checking whether the code changed.
  const resuming = (row.data.turn ?? 1) > 1 && (phase === 'starting' || phase === 'preparing');
  const stage = resuming ? ('resuming' as const) : phase;
  const title = running ? t(`inv.fase.${stage}`) : t('inv.enCola');
  const detail = running ? t(`inv.fase.${stage}Ayuda`) : t('inv.enColaAyuda');
  const currentStep = !running ? 0 : phase === 'starting' || phase === 'preparing' ? 1 : 2;

  return (
    <div className="mt-5 flex flex-1 flex-col gap-5">
      <div className="rounded-xl bg-cream-1 p-4">
        <div className="flex items-center gap-3.5">
          <InvestigatorMascot pose={running ? stage : 'queued'} label={title} className="h-[88px] @lg:h-28" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <h3 role="status" className="text-[16px] font-bold leading-snug text-ink">{title}</h3>
              {since > 0 && (
                <span aria-label={t('inv.transcurrido', { t: formatElapsed(now - since) })} className="flex-none font-mono text-[12.5px] tabular-nums text-warm-gray">
                  {formatElapsed(now - since)}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[13.5px] leading-snug text-ink-2">{detail}</p>
          </div>
        </div>
        <ol aria-label={t('inv.avance')} className="mt-4 grid grid-cols-4 gap-1.5">
          {PROGRESS_STEPS.map((step, i) => (
            <li key={step} aria-current={i === currentStep ? 'step' : undefined}>
              <div className={`h-1 rounded-full ${i < currentStep ? 'bg-claude' : i === currentStep ? 'bg-claude/50' : 'bg-warm-border'}`} />
              <div className={`mt-1.5 text-[11.5px] font-semibold ${i <= currentStep ? 'text-ink' : 'text-warm-gray'}`}>
                {t(`inv.paso.${step}`)}
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-[12.5px] leading-snug text-warm-gray">{t('inv.seguirAtendiendo')}</p>
      </div>
      {actions && <NotifyClient notified={actions.notified} onNotifyClient={actions.onNotifyClient} />}
      <button
        onClick={() => void cancelInvestigation(row.id)}
        className="mt-auto self-center rounded-lg px-3 py-1.5 text-[13px] font-semibold text-warm-gray hover:text-danger focus-visible:outline-2 focus-visible:outline-danger"
      >
        {t('inv.cancelar')}
      </button>
    </div>
  );
}

/** Lets the client know it's being looked at. Only ever sent by this click. */
function NotifyClient({ notified, onNotifyClient }: { notified: boolean; onNotifyClient(texto: string): Promise<void> }) {
  const t = useT();
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const texto = t('inv.avisoTexto');

  async function send() {
    setSending(true);
    setFailed(false);
    try {
      await onNotifyClient(texto);
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-xl border border-cream-3 p-4">
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-warm-gray">{t('inv.avisoTitulo')}</p>
      <p className="mt-2 text-[14px] leading-snug text-ink">{texto}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        {notified ? (
          <span className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ok-dark">
            <span className="msr text-[17px]">check_circle</span>
            {t('inv.avisoEnviado')}
          </span>
        ) : (
          <button
            onClick={() => void send()}
            disabled={sending}
            className="flex h-[34px] items-center rounded-lg bg-navy px-3.5 text-[13.5px] font-semibold text-white hover:bg-navy-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50"
          >
            {sending ? t('inv.enviando') : t('inv.avisoEnviar')}
          </button>
        )}
        {failed && <span className="text-[12.5px] text-warn-dark">{t('inv.avisoError')}</span>}
      </div>
    </div>
  );
}

/** What only makes sense from inside the investigation's own chat. */
export interface InvestigationChatActions {
  onUseReply(texto: string): void;
  notified: boolean;
  onNotifyClient(texto: string): Promise<void>;
  onRetry(): void;
}

function ReportWarnings({ report }: { report: InvestigationReport }) {
  const t = useT();
  if (!report.downgradedFrom && report.rejectedEvidence.length === 0) return null;
  return (
    <div className="space-y-1.5 text-[12.5px] text-warn-dark">
      {report.downgradedFrom && <p>{t('inv.bajada')}</p>}
      {report.rejectedEvidence.length > 0 && (
        <div>
          <p>{t('inv.rechazadas', { n: report.rejectedEvidence.length })}</p>
          <ul className="mt-0.5 list-disc pl-4">
            {report.rejectedEvidence.map((problem) => <li key={problem} className="break-words">{problem}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

/** What the agent acts on: the reply, the recommendation, and what's left to find out. */
function ReportAnswer({ report, onUseReply, followUp }: { report: InvestigationReport; onUseReply?(texto: string): void; followUp?: ReactNode }) {
  const t = useT();
  return (
    <div className="space-y-[18px]">
      <ReportWarnings report={report} />
      <div className="rounded-[10px] bg-cream-1 px-4 py-3.5">
        <Section title={t('inv.respuesta')}>
          {report.suggestedReply ? (
            <>
              <p className="whitespace-pre-wrap">{report.suggestedReply}</p>
              {onUseReply && (
                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <button
                    onClick={() => onUseReply(report.suggestedReply!)}
                    className="h-[34px] rounded-lg bg-navy px-3.5 text-[13.5px] font-semibold text-white hover:bg-navy-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                  >
                    {t('inv.usarRespuesta')}
                  </button>
                  <p className="text-[12px] text-warm-gray">{t('inv.respuestaAviso')}</p>
                </div>
              )}
            </>
          ) : (
            <p className="text-[13.5px] leading-snug text-warm-gray">{t('inv.sinRespuesta')}</p>
          )}
        </Section>
      </div>

      {followUp}

      <Section title={t('inv.recomendacion')}><p className="whitespace-pre-wrap">{report.recommendation}</p></Section>

      {report.missing.length > 0 && (
        <Section title={t('inv.falta')} warning>
          <ul className="space-y-1.5">
            {report.missing.map((item) => (
              <li key={item} className="grid grid-cols-[14px_minmax(0,1fr)] gap-x-2">
                <span aria-hidden className="text-warn-dark">–</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

/** Why it says what it says. */
function ReportEvidence({ report }: { report: InvestigationReport }) {
  const t = useT();
  return (
    <>
      <Collapsible title={t('inv.resumen')} defaultOpen><p className="whitespace-pre-wrap">{report.summary}</p></Collapsible>
      <Collapsible title={t('inv.causa')}><p className="whitespace-pre-wrap">{report.cause}</p></Collapsible>
      {report.codeEvidence.length > 0 && (
        <Collapsible title={t('inv.evidenciaCodigo')} count={report.codeEvidence.length}>
          <ul className="space-y-2">
            {report.codeEvidence.map((e) => (
              <li key={`${e.path}:${e.startLine}:${e.quote}`}>
                <div className="break-all font-mono text-[11px] text-warm-gray">
                  {e.path}:{e.startLine}-{e.endLine}
                </div>
                <pre className="mt-0.5 overflow-x-auto rounded bg-cream-1 p-2 font-mono text-[11px]">{e.quote}</pre>
              </li>
            ))}
          </ul>
        </Collapsible>
      )}
      {report.dataEvidence.length > 0 && (
        <Collapsible title={t('inv.evidenciaDatos')} count={report.dataEvidence.length}>
          <ul className="space-y-1">
            {report.dataEvidence.map((e) => (
              <li key={e.queryId} className="font-mono text-[11px]">
                <span className="text-warm-gray">{e.queryId}:</span> {e.values.join(', ')}
              </li>
            ))}
          </ul>
        </Collapsible>
      )}
    </>
  );
}

function BacklogDefinition({ draft }: { draft: InvestigationBacklogDraft }) {
  const t = useT();
  const line = (title: string, value: string) =>
    value && (
      <div>
        <dt className="text-[12px] font-semibold text-warm-gray">{title}</dt>
        <dd className="mt-0.5 whitespace-pre-wrap break-words">{value}</dd>
      </div>
    );
  const items = (title: string, values: string[], marker: string) =>
    values.length > 0 && (
      <div>
        <dt className="text-[12px] font-semibold text-warm-gray">{title}</dt>
        <dd className="mt-0.5">
          <ul className="space-y-0.5">
            {values.map((value, i) => (
              <li key={i} className="grid grid-cols-[18px_minmax(0,1fr)] gap-x-1">
                <span aria-hidden className="text-warm-gray">{marker === '#' ? `${i + 1}.` : marker}</span>
                <span className="break-words">{value}</span>
              </li>
            ))}
          </ul>
        </dd>
      </div>
    );
  return (
    <details className="group mt-2.5">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[12.5px] font-semibold text-navy hover:underline focus-visible:outline-2 focus-visible:outline-ai [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="flex transition-transform duration-150 group-open:rotate-90"><span className="msr text-[16px]">chevron_right</span></span>
        {t('inv.backlogDefinicion')}
      </summary>
      <dl className="mt-2 space-y-2.5 text-[13px] leading-snug text-ink">
        {line(t('inv.backlogNombre'), draft.name)}
        {line(t('inv.backlogDetalle'), [draft.priority, ...draft.modules, ...draft.roles].join(' · '))}
        {line(t('inv.backlogQuePasa'), draft.problem)}
        {line(t('inv.backlogEsperado'), draft.expected)}
        {items(t('inv.backlogPasos'), draft.steps, '#')}
        {line(t('inv.backlogPantalla'), [draft.screenName, draft.howToReach].filter(Boolean).join(': '))}
        {items(t('inv.backlogCriterios'), draft.acceptance, '–')}
        {line(t('inv.backlogNotas'), draft.notes)}
      </dl>
    </details>
  );
}

/** A confirmed bug can go to the product backlog as it is: one click, without confirming the definition. */
function BacklogOffer({ row }: { row: Row<Investigation> }) {
  const t = useT();
  const board = useDoc<InvestigatorBacklogConfig>('investigator/backlog');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const item = row.data.backlogItem;
  const draft = row.data.report?.backlogDraft;

  if (item?.status === 'created' && item.url) {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[10px] bg-ok-bg px-3.5 py-2.5 text-[13.5px] font-semibold text-ok-dark">
        <span aria-hidden className="msr text-[18px]">check_circle</span>
        {t('inv.backlogListo')}
        <a href={item.url} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">
          {t('inv.backlogVer')}
        </a>
        <span className="font-normal text-ink-2">· {item.by.nombre}</span>
      </p>
    );
  }
  if (!draft) return null;

  const creating = busy || item?.status === 'creating';
  async function add(force: boolean) {
    setBusy(true);
    setFailed(null);
    try {
      await addInvestigationToBacklog(row.id, force);
    } catch (e) {
      const { code, message } = e as { code?: string; message?: string };
      setFailed(code === 'functions/failed-precondition' || code === 'functions/unavailable' ? (message ?? t('inv.backlogError')) : t('inv.backlogError'));
    } finally {
      setBusy(false);
    }
  }

  const connected = board?.data.test.status === 'ok';
  return (
    <div className="rounded-[10px] border border-warm-border px-3.5 py-3">
      {draft.duplicateOf ? (
        <p className="text-[14px] leading-snug text-ink">
          {t('inv.backlogDuplicado')}{' '}
          <a href={draft.duplicateOf.url} target="_blank" rel="noreferrer" className="font-semibold text-navy underline underline-offset-2">
            {draft.duplicateOf.title || t('inv.backlogVer')}
          </a>
        </p>
      ) : (
        <p className="text-[14px] font-semibold leading-snug text-ink">{t('inv.backlogPregunta')}</p>
      )}
      {connected ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <button
            onClick={() => void add(!!draft.duplicateOf)}
            disabled={creating}
            className={`h-[34px] rounded-lg px-3.5 text-[13.5px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50 ${
              draft.duplicateOf ? 'border border-warm-border text-ink hover:bg-cream-1' : 'bg-navy text-white hover:bg-navy-light'
            }`}
          >
            {creating ? t('inv.backlogAgregando') : t(draft.duplicateOf ? 'inv.backlogCrearIgual' : 'inv.backlogAgregar')}
          </button>
          {!draft.duplicateChecked && <p className="text-[12px] text-warm-gray">{t('inv.backlogSinRevisar')}</p>}
        </div>
      ) : (
        <p className="mt-1.5 text-[12.5px] text-warm-gray">{t('inv.backlogSinConectar')}</p>
      )}
      {failed && <p className="mt-2 break-words text-[12.5px] text-warn-dark">{failed}</p>}
      <BacklogDefinition draft={draft} />
    </div>
  );
}

/** The agent's words in the thread, set apart from Claude's answers. */
function AskedBubble({ question, by, at }: { question: string; by: string; at?: unknown }) {
  return (
    <div className="ml-auto w-fit max-w-[90%] rounded-[10px] bg-claude-bg px-3 py-2">
      <p className="whitespace-pre-wrap break-words text-[14px] leading-snug text-ink">{question}</p>
      <p className="mt-1 text-[11.5px] text-warm-gray">
        {by}
        {!!at && <> · {fmtFecha(at, true)}</>}
      </p>
    </div>
  );
}

/** Rounds from before the time was saved still have when they were asked and when they ended. */
function answerTime(durationMs: number | null | undefined, askedAt: unknown, finishedAt: unknown): string | null {
  const ms = durationMs ?? (millis(askedAt) && millis(finishedAt) ? millis(finishedAt) - millis(askedAt) : null);
  if (ms === null || ms < 0) return null;
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

function outcomeLabel(t: ReturnType<typeof useT>, turn: Pick<InvestigationTurn, 'status' | 'report'>) {
  return turn.report ? t(`inv.conclusion.${turn.report.conclusion}`) : t(`inv.estado.${turn.status}`);
}

/** A round that's over. The last one starts open when nothing newer has an answer yet. */
function PastTurn({ turn, defaultOpen }: { turn: InvestigationTurn; defaultOpen: boolean }) {
  const t = useT();
  const { report, status } = turn;
  const tone = report ? CONCLUSION_TONE[report.conclusion] : STATUS_TONE[status];
  const took = answerTime(turn.durationMs, turn.askedAt, turn.finishedAt);
  return (
    <details open={defaultOpen} className="group border-b border-cream-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 py-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-ai [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="flex flex-none text-warm-gray transition-transform duration-150 group-open:rotate-90">
          <span className="msr text-[17px]">chevron_right</span>
        </span>
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">
          {turn.n === 1 ? t('inv.primeraRespuesta') : turn.question}
        </span>
        {took && <span className="flex-none text-[12px] text-warm-gray">{took}</span>}
        <span className={`flex-none text-[12px] font-semibold ${tone}`}>{outcomeLabel(t, turn)}</span>
      </summary>
      <div className="space-y-3 pb-4">
        {turn.n > 1 && <AskedBubble question={turn.question} by={turn.by.nombre} at={turn.askedAt} />}
        {report ? (
          <>
            <ReportAnswer report={report} />
            <div className="border-t border-cream-3"><ReportEvidence report={report} /></div>
          </>
        ) : (
          <p className="text-[13.5px] text-warm-gray">{turn.error ?? t('inv.turnoSinRespuesta')}</p>
        )}
      </div>
    </details>
  );
}

/** Under the answer it continues, or under the error when a round failed. */
function FollowUpComposer({ id }: { id: string }) {
  const t = useT();
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const typed = question.trim().length;

  async function send() {
    if (typed < MIN_FOLLOW_UP_CHARS || sending) return;
    setSending(true);
    setFailed(null);
    try {
      await requestFollowUp(id, question.trim());
      setQuestion('');
    } catch (e) {
      const { code, message } = e as { code?: string; message?: string };
      const explained = code === 'functions/failed-precondition' || code === 'functions/resource-exhausted' || code === 'functions/invalid-argument';
      setFailed(explained && message ? message : t('inv.errorEnviar'));
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      {failed && <p className="mb-1.5 text-[12.5px] text-warn-dark">{failed}</p>}
      <div className="flex items-end gap-2 rounded-[10px] border-[1.5px] border-warm-border bg-white py-1.5 pl-3 pr-1.5 focus-within:border-ai-light focus-within:ring-[3px] focus-within:ring-ai-bg">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            // On touch, Enter stays a newline, as in the chat's composer.
            if (e.key === 'Enter' && !e.shiftKey && !window.matchMedia('(hover: none)').matches) {
              e.preventDefault();
              void send();
            }
          }}
          aria-label={t('inv.seguirPreguntando')}
          placeholder={t('inv.seguirPreguntando')}
          rows={1}
          maxLength={1000}
          className="max-h-32 min-h-[30px] min-w-0 flex-1 resize-none bg-transparent py-1 text-[14px] leading-snug text-ink outline-none [field-sizing:content] placeholder:text-warm-gray-2"
        />
        <button
          onClick={() => void send()}
          disabled={typed < MIN_FOLLOW_UP_CHARS || sending}
          aria-label={t('inv.enviar')}
          title={t('inv.enviar')}
          className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-md bg-navy text-white hover:bg-navy-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-40"
        >
          <span aria-hidden className="msr text-[18px]">arrow_upward</span>
        </button>
      </div>
    </div>
  );
}

export function InvestigationDetail({
  row,
  actions,
  origin,
}: {
  row: Row<Investigation>;
  actions?: InvestigationChatActions;
  /** Where it came from, under the question, when that isn't the chat being viewed. */
  origin?: ReactNode;
}) {
  const t = useT();
  const { status, report, question, error, usedDatabase, messageCount, sha, requestedBy, createdAt, files, unreadableFiles, followUp, queuedAt } = row.data;
  const turn = row.data.turn ?? 1;
  const queries = useInvestigationQueries(row.id);
  const pastTurns = useInvestigationTurns(turn > 1 ? row.id : null);
  const unfinished = status === 'failed' || status === 'rate_limited' || status === 'cancelled';
  const tookNow = answerTime(row.data.durationMs, queuedAt ?? createdAt, row.data.finishedAt);
  const endRef = useRef<HTMLDivElement>(null);

  // A new round goes at the bottom, past whatever the agent was reading.
  const previousTurn = useRef(turn);
  useEffect(() => {
    if (previousTurn.current === turn) return;
    previousTurn.current = turn;
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [turn]);

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div className="-mr-4 min-h-0 flex-1 overflow-y-auto pr-4 pt-4">
        <div className="flex min-h-full flex-col">
          <header className="flex-none">
            <div className="mb-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
              {report ? (
                <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] font-bold ${CONCLUSION_STYLE[report.conclusion]}`}>
                  <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-current" />
                  {t(`inv.conclusion.${report.conclusion}`)} · {t(`inv.conclusionDetalle.${report.conclusion}`)}
                </span>
              ) : (
                !isActive(status) && <InvestigationStatusChip row={row} />
              )}
              <span className="text-[12px] text-warm-gray">
                {fmtFecha(createdAt, true)} · {requestedBy.nombre}
              </span>
              <InvestigationMarks data={row.data} />
            </div>
            <h3 className="max-w-[70ch] whitespace-pre-wrap text-[17px] font-semibold leading-[1.35] text-ink">{question}</h3>
            {sourceLabel(row.data) && (
              <p className="mt-1.5 flex items-center gap-1 text-[12.5px] text-ink-2">
                <span aria-hidden className="msr text-[15px] text-warm-gray">person</span>
                <span className="min-w-0 truncate">{sourceLabel(row.data)}</span>
              </p>
            )}
            {origin}
          </header>

          {/* While it runs they're what there is to read. Then they go with the rest of the details, under the answer. */}
          {isActive(status) && (
            <div className="mt-4 border-t border-cream-3">
              <SentMessages id={row.id} count={messageCount} running defaultOpen={turn === 1} />
            </div>
          )}

          {pastTurns.length > 0 && (
            <div className={isActive(status) ? '' : 'mt-4 border-t border-cream-3'}>
              {/* Folded while a new round runs. Only a round that failed leaves the last answer as the one to read. */}
              {pastTurns.map((past, i) => (
                <PastTurn key={past.id} turn={past.data} defaultOpen={i === pastTurns.length - 1 && unfinished} />
              ))}
            </div>
          )}

          {followUp && (
            <div className="mt-4">
              <AskedBubble question={followUp.question} by={followUp.by.nombre} at={queuedAt} />
            </div>
          )}

          {isActive(status) && <Working row={row} actions={actions} />}

          {unfinished && (
            <div className="mt-4 rounded-[10px] bg-warn-bg p-3.5 text-[13.5px] leading-snug text-warn-dark">
              <p className="font-semibold">
                {status === 'rate_limited'
                  ? t('inv.limite')
                  : status === 'cancelled'
                    ? t('inv.canceladaAyuda')
                    : turn > 1
                      ? t('inv.falloSeguimiento')
                      : t('inv.falloAyuda')}
              </p>
              {status === 'failed' && error && <p className="mt-1 break-words">{error}</p>}
              {/* From the second round on, the composer below is how to try again. */}
              {actions && turn === 1 && (
                <button
                  onClick={actions.onRetry}
                  className="mt-2.5 h-[34px] rounded-lg bg-navy px-3.5 text-[13.5px] font-semibold text-white hover:bg-navy-light"
                >
                  {t('inv.reintentar')}
                </button>
              )}
            </div>
          )}

          {/* A round that failed has no report to sit under, and this is how to try it again. */}
          {!report && unfinished && turn > 1 && (
            <div className="mt-4">
              <FollowUpComposer id={row.id} />
            </div>
          )}

          {report && (
            <div className="mt-4">
              {tookNow && <p className="mb-2 text-[12px] text-warm-gray">{t('inv.duro', { tiempo: tookNow })}</p>}
              <ReportAnswer report={report} onUseReply={actions?.onUseReply} followUp={!isActive(status) && <FollowUpComposer id={row.id} />} />
            </div>
          )}

          {(report?.backlogDraft || row.data.backlogItem) && (
            <div className="mt-4">
              <BacklogOffer row={row} />
            </div>
          )}

          <WriteProposals id={row.id} report={report} canFollowUp={!isActive(status)} />

          {(unreadableFiles?.length ?? 0) > 0 && (
            <p className="mt-3 text-[12.5px] text-warn-dark">{t('inv.archivosNoLeidos', { names: unreadableFiles!.join(', ') })}</p>
          )}

          {!isActive(status) && (
            <div className="mt-[18px] border-t border-cream-3">
              {report && <ReportEvidence report={report} />}

              <SentMessages id={row.id} count={messageCount} />

              {(files?.length ?? 0) > 0 && (
                <Collapsible title={t('inv.archivos')} count={files!.length}>
                  <ul className="space-y-1">
                    {files!.map((file) => <FileRow key={file.id} file={file} />)}
                  </ul>
                </Collapsible>
              )}

              {queries.length > 0 && (
                <Collapsible title={t('inv.consultas')} count={queries.length}>
                  <ul className="space-y-2">
                    {queries.map((q) => (
                      <li key={q.id}>
                        <div className="text-[12.5px]">
                          {turn > 1 && <span className="font-semibold text-warm-gray">{t('inv.preguntaNumero', { n: q.data.turn ?? 1 })} · </span>}
                          {q.data.purpose}
                        </div>
                        <pre className="mt-0.5 overflow-x-auto rounded bg-cream-1 p-2 font-mono text-[11px]">{q.data.sql}</pre>
                        <div className="mt-0.5 text-[11px] text-warm-gray">
                          {q.data.error ?? t(q.data.truncated ? 'inv.filasMas' : 'inv.filas', { n: q.data.rowCount })} · {q.data.ms} ms
                        </div>
                      </li>
                    ))}
                  </ul>
                </Collapsible>
              )}

              <p className="py-3 text-[12px] text-warm-gray">
                {status === 'done' && !usedDatabase && queries.length === 0 && <>{t('inv.sinBase')} </>}
                {t(messageCount === 1 ? 'inv.baseUno' : 'inv.base', { n: messageCount, sha: sha ? sha.slice(0, 8) : '-' })}
              </p>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>
    </div>
  );
}
