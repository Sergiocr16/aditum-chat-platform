'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type {
  InvestigationSentMessages,
  Conversation,
  Investigation,
  InvestigationFile,
  InvestigationConclusion,
  InvestigationMessageRef,
  InvestigationStatus,
  Message,
} from '@aditum-chat/shared';
import {
  INVESTIGATION_FILE_ACCEPT,
  INVESTIGATION_MAX_FILE_BYTES,
  INVESTIGATION_MAX_FILES,
  investigationFileKind,
} from '@aditum-chat/shared';
import { useAuth } from '@/lib/auth';
import { fmtFecha, fmtHora, useContactThread, useDoc, useGroupThread, useMessages, type Row, type ThreadRow } from '@/lib/data';
import {
  cancelInvestigation,
  investigationFileUrl,
  requestInvestigation,
  uploadInvestigationFile,
  useInvestigationList,
  useInvestigationPhase,
  useInvestigationQueries,
  useRunnerOnline,
} from '@/lib/data-investigations';
import { useT } from '@/lib/i18n';
import { ClaudeLogo, InvestigatorMascot } from './InvestigatorMascot';

const MAX_MESSAGES = 100;
const MIN_QUESTION_CHARS = 10;
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

export function InvestigationStatusChip({ row }: { row: Row<Investigation> }) {
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

function SavedRow({ row, onOpen }: { row: Row<Investigation>; onOpen(): void }) {
  const t = useT();
  const { status, report, question, createdAt, requestedBy } = row.data;
  const conclusion = status === 'done' ? report?.conclusion : undefined;
  const badge = status === 'running' ? null : OUTCOME_BADGE[conclusion ?? (status === 'done' ? 'undetermined' : status)];
  return (
    <button
      onClick={onOpen}
      className="group flex w-full items-center gap-3 rounded-xl border border-cream-3 bg-white p-2.5 text-left shadow-card transition-colors duration-150 hover:border-warm-gray-4 hover:bg-cream-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy"
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
        <span className="mt-0.5 block truncate text-[12px] text-warm-gray">
          <span className={`font-semibold ${conclusion ? CONCLUSION_TONE[conclusion] : STATUS_TONE[status]}`}>
            {conclusion ? t(`inv.conclusion.${conclusion}`) : t(`inv.estado.${status}`)}
          </span>
          {' · '}
          {fmtHora(createdAt)} · {requestedBy.nombre}
        </span>
      </span>
      <span aria-hidden className="msr flex-none text-[18px] text-warm-gray-3 transition-colors duration-150 group-hover:text-ink">
        chevron_right
      </span>
    </button>
  );
}

function SavedList({
  list,
  onOpen,
  onNew,
}: {
  list: ReturnType<typeof useInvestigationList>;
  onOpen(id: string): void;
  onNew(): void;
}) {
  const t = useT();
  const today = fmtFecha({ toDate: () => new Date() });
  const days = useMemo(() => {
    const byDay = new Map<string, Row<Investigation>[]>();
    for (const row of list.rows) {
      const day = fmtFecha(row.data.createdAt);
      byDay.set(day, [...(byDay.get(day) ?? []), row]);
    }
    return [...byDay];
  }, [list.rows]);
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.error ? (
          <p className="py-4 text-[13px] text-warn-dark">{t('inv.errorLista')}</p>
        ) : list.loading ? null : list.rows.length === 0 ? (
          <div className="py-6 text-[13px] text-warm-gray">
            <p className="font-semibold text-ink-2">{t('inv.vacio')}</p>
            <p className="mt-1 leading-relaxed">{t('inv.vacioAyuda')}</p>
          </div>
        ) : (
          <div className="space-y-3 pb-2">
            {days.map(([day, rows]) => (
              <section key={day}>
                {day && (
                  <h3 className="mb-1.5 px-0.5 text-[11.5px] font-semibold uppercase tracking-[.06em] text-warm-gray">
                    {day === today ? t('inv.hoy') : day}
                  </h3>
                )}
                <ul className="space-y-1.5">
                  {rows.map((row) => (
                    <li key={row.id}>
                      <SavedRow row={row} onOpen={() => onOpen(row.id)} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
        {list.hasMore && (
          <button
            onClick={list.loadMore}
            className="my-2 w-full rounded-lg py-1.5 text-[13px] font-semibold text-navy hover:bg-cream-1"
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
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDraft is rebuilt on every render of the panel.
  }, [question, selected, uploads, start.nonce, start.refs]);

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
  const canSend = typed >= MIN_QUESTION_CHARS && marked.size > 0 && !sending && !uploading && !tooManyFiles;

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
      <div className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1 py-3">
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
      <div className="mt-1.5 max-w-[70ch] text-[14px] leading-[1.55] text-ink">{children}</div>
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
      <div className="max-w-[70ch] pb-3.5 text-[14px] leading-[1.55] text-ink">{children}</div>
    </details>
  );
}

/** Who it's about, in the investigation's own words: it doesn't change if the chat does. */
export function sourceLabel({ source }: Investigation): string {
  return [source?.contactNombre, source?.clientNombre].filter(Boolean).join(' · ');
}

function SentMessages({ id, count }: { id: string; count: number }) {
  const t = useT();
  const sent = useDoc<InvestigationSentMessages>(`investigations/${id}/sent/messages`);
  // Investigations from before these were saved only have the count, at the end of the report.
  if (!sent) return null;
  return (
    <Collapsible title={t('inv.mensajesEnviados')} count={count}>
      <ol className="space-y-3">
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
  const phase = useInvestigationPhase(running ? row.id : null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const since = millis(row.data.startedAt) || millis(row.data.createdAt);
  const title = running ? t(`inv.fase.${phase}`) : t('inv.enCola');
  const detail = running ? t(`inv.fase.${phase}Ayuda`) : t('inv.enColaAyuda');
  const currentStep = !running ? 0 : phase === 'starting' || phase === 'preparing' ? 1 : 2;

  return (
    <div className="mt-5 flex flex-1 flex-col gap-5">
      <div className="rounded-xl bg-cream-1 p-4">
        <div className="flex items-center gap-3.5">
          <InvestigatorMascot pose={running ? phase : 'queued'} label={title} className="h-[88px] @lg:h-28" />
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
  const { status, report, question, error, usedDatabase, messageCount, sha, requestedBy, createdAt, files, unreadableFiles } = row.data;
  const queries = useInvestigationQueries(row.id);
  const unfinished = status === 'failed' || status === 'rate_limited' || status === 'cancelled';

  return (
    <div className="@container min-h-0 flex-1 overflow-y-auto pr-1 pt-4">
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

        {isActive(status) && <Working row={row} actions={actions} />}

        {unfinished && (
          <div className="mt-4 rounded-[10px] bg-warn-bg p-3.5 text-[13.5px] leading-snug text-warn-dark">
            <p className="font-semibold">
              {status === 'rate_limited' ? t('inv.limite') : status === 'cancelled' ? t('inv.canceladaAyuda') : t('inv.falloAyuda')}
            </p>
            {status === 'failed' && error && <p className="mt-1 break-words">{error}</p>}
            {actions && (
              <button
                onClick={actions.onRetry}
                className="mt-2.5 h-[34px] rounded-lg bg-navy px-3.5 text-[13.5px] font-semibold text-white hover:bg-navy-light"
              >
                {t('inv.reintentar')}
              </button>
            )}
          </div>
        )}

        {report && (
          <div className="mt-4 space-y-[18px]">
            {(report.downgradedFrom || report.rejectedEvidence.length > 0) && (
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
            )}

            <div className="rounded-[10px] bg-cream-1 px-4 py-3.5">
              <Section title={t('inv.respuesta')}>
                {report.suggestedReply ? (
                  <>
                    <p className="whitespace-pre-wrap">{report.suggestedReply}</p>
                    {actions && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <button
                          onClick={() => actions.onUseReply(report.suggestedReply!)}
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
        )}

        {(unreadableFiles?.length ?? 0) > 0 && (
          <p className="mt-3 text-[12.5px] text-warn-dark">{t('inv.archivosNoLeidos', { names: unreadableFiles!.join(', ') })}</p>
        )}

        {!isActive(status) && (
          <div className="mt-[18px] border-t border-cream-3">
            {report && (
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
            )}

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
                      <div className="text-[12.5px]">{q.data.purpose}</div>
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
      </div>
    </div>
  );
}
