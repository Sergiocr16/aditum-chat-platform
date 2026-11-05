'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type {
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
import { fmtFecha, useContactThread, useDoc, useGroupThread, useMessages, type Row, type ThreadRow } from '@/lib/data';
import {
  cancelInvestigation,
  investigationFileUrl,
  requestInvestigation,
  uploadInvestigationFile,
  type InvestigationPhase,
  useInvestigationList,
  useInvestigationPhase,
  useInvestigationQueries,
  useRunnerOnline,
} from '@/lib/data-investigations';
import { useT } from '@/lib/i18n';

const MAX_MESSAGES = 100;
const MIN_QUESTION_CHARS = 10;
const TOKEN_WARNING_DAYS = 30;

/** "Investigate this message": opens the form with only that message marked. */
export interface InvestigationSeed {
  ref: InvestigationMessageRef;
  nonce: number;
}

/** What the form starts from. A new `nonce` resets it. */
interface FormStart {
  nonce: number;
  question?: string;
  refs?: InvestigationMessageRef[];
  uploads?: { storagePath: string; name: string }[];
}

/** A file the agent added. `problem` is an i18n key: the file stays listed so they see why it won't go. */
interface Upload {
  key: string;
  name: string;
  storagePath: string | null;
  problem: 'inv.archivoTipo' | 'inv.archivoGrande' | 'inv.archivoError' | null;
}

/** null: the list (on a wide panel, the list next to the form). */
type Pane = null | 'new' | { id: string };

/** Starting points for the question: picking one fills the text, which stays editable. */
const QUESTION_TEMPLATES = ['error', 'consulta', 'funciona', 'datos'] as const;

const keyOf = (r: InvestigationMessageRef) => `${r.conversationId}/${r.messageId}`;

const STATUS_STYLE: Record<InvestigationStatus, string> = {
  queued: 'bg-cream-2 text-ink-2',
  running: 'bg-ai-bg text-ai',
  done: 'bg-ok-bg text-ok-dark',
  failed: 'bg-warn-bg text-warn-dark',
  rate_limited: 'bg-warn-bg text-warn-dark',
  cancelled: 'bg-cream-2 text-warm-gray',
};

const CONCLUSION_STYLE: Record<InvestigationConclusion, string> = {
  confirmed: 'bg-ok-bg text-ok-dark',
  hypothesis: 'bg-warn-bg text-warn-dark',
  undetermined: 'bg-cream-2 text-ink-2',
};

const CONCLUSION_ICON: Record<InvestigationConclusion, string> = {
  confirmed: 'verified',
  hypothesis: 'help',
  undetermined: 'remove',
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
  seed,
  onOpenConversation,
  onUseReply,
  onNotifyClient,
  openId,
}: {
  conv: Row<Conversation>;
  threadKey: string | null;
  seed: InvestigationSeed | null;
  /** Opens with this investigation showing, e.g. when arriving from the Investigaciones page. */
  openId?: string | null;
  onOpenConversation?(conversationId: string): void;
  onUseReply(texto: string): void;
  /** Sends a text to the chat, as if the agent had written it. */
  onNotifyClient(texto: string): Promise<void>;
}) {
  const t = useT();
  const [scope, setScope] = useState<'chat' | 'all'>('chat');
  const list = useInvestigationList(scope === 'chat' ? threadKey : null);
  const [pane, setPane] = useState<Pane>(openId ? { id: openId } : seed ? 'new' : null);
  const [form, setForm] = useState<FormStart>(() => (seed ? { nonce: seed.nonce, refs: [seed.ref] } : { nonce: 0 }));
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
    if (seed) openForm({ nonce: seed.nonce, refs: [seed.ref] });
  }, [seed]);

  const selectedId = pane && pane !== 'new' ? pane.id : null;
  const selected = useDoc<Investigation>(selectedId ? `investigations/${selectedId}` : null);

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      {!runner.online && (
        <p className="mb-2 flex-none rounded-lg bg-warn-bg px-3 py-1.5 text-[12px] text-warn-dark">{t('inv.desconectado')}</p>
      )}
      {runner.online && runner.tokenDaysLeft !== null && runner.tokenDaysLeft < TOKEN_WARNING_DAYS && (
        <p className="mb-2 flex-none rounded-lg bg-warn-bg px-3 py-1.5 text-[12px] text-warn-dark">
          {t('inv.tokenVence', { n: runner.tokenDaysLeft })}
        </p>
      )}

      <div className="flex min-h-0 flex-1 gap-4">
        <div className={`min-h-0 w-full flex-none flex-col @2xl:flex @2xl:w-64 @2xl:[&>button:first-child]:self-stretch ${pane === null ? 'flex' : 'hidden'}`}>
          <SavedList
            list={list}
            scope={scope}
            canFilter={threadKey !== null}
            selectedId={selectedId}
            onScope={setScope}
            onOpen={(id) => setPane({ id })}
            onNew={() => openForm()}
          />
        </div>

        <div
          className={`min-h-0 min-w-0 flex-1 flex-col @2xl:flex @2xl:border-l @2xl:border-cream-3 @2xl:pl-4 ${
            pane === null ? 'hidden' : 'flex'
          }`}
        >
          {pane !== null && (
            <button
              onClick={() => setPane(null)}
              className="mb-1.5 flex flex-none items-center gap-1 self-start text-[12px] font-semibold text-warm-gray hover:text-ink @2xl:hidden"
            >
              <span className="msr text-[16px]">arrow_back</span>
              {t('inv.volver')}
            </button>
          )}

          {/* Stays mounted while a report is open, so a half-written question isn't lost. */}
          <div className={selectedId ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}>
            <NewInvestigation
              key={form.nonce}
              conv={conv}
              start={form}
              questionRef={questionRef}
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
                            .map(({ storagePath, name }) => ({ storagePath, name })),
                        }),
                    }
                  : undefined
              }
              origin={
                selected.data.threadKey === threadKey ? undefined : (
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[12px] text-warm-gray">
                    {t('inv.otroChat')}
                    {onOpenConversation && (
                      <button
                        onClick={() => onOpenConversation(selected.data.conversationId)}
                        className="font-semibold text-navy hover:underline"
                      >
                        {t('inv.irAlChat')}
                      </button>
                    )}
                  </p>
                )
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

type RobotPose = 'queued' | InvestigationPhase;

/**
 * Original pixel-art robot in the console's AI color. Its look follows the phase: it waits
 * while queued, dances and thinks while starting, reads with a magnifier over the code, and
 * turns plum to work a database. The keyframes live in globals.css and stop under reduced motion.
 */
function InvestigatorRobot({ pose, label }: { pose: RobotPose; label: string }) {
  const onDatabase = pose === 'database';
  const onCode = pose === 'code' || pose === 'files';
  const dancing = pose === 'starting' || pose === 'preparing';
  const queued = pose === 'queued';
  const body = onDatabase ? 'var(--color-navy)' : queued ? 'var(--color-warm-gray-3)' : 'var(--color-ai)';
  const accent = onDatabase ? 'var(--color-navy)' : 'var(--color-ai)';
  const dark = 'var(--color-navy-deep)';
  const light = 'var(--color-ai-bg)';
  const soft = 'var(--color-ai-light)';
  const gold = 'var(--color-gold)';
  return (
    <svg key={pose} viewBox="0 0 50 44" className="robot-phase-in h-28 w-auto flex-none @2xl:h-36" role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x="9" y="42" width="18" height="1" fill="var(--color-cream-3)" />
      <g className={dancing ? 'robot-sway' : onDatabase ? 'robot-nod' : undefined}>
        <g className={dancing ? 'robot-foot-a' : undefined} fill={dark}>
          <rect x="12" y="35" width="3" height="5" />
          <rect x="10" y="40" width="6" height="2" />
        </g>
        <g className={dancing ? 'robot-foot-b' : undefined} fill={dark}>
          <rect x="21" y="35" width="3" height="5" />
          <rect x="20" y="40" width="6" height="2" />
        </g>
        <g className={dancing ? 'robot-arm-a' : undefined}>
          <rect x="6" y="24" width="4" height="7" fill={body} />
          <rect x="5" y="31" width="5" height="3" fill={dark} />
        </g>
        {dancing || queued ? (
          <g className={dancing ? 'robot-arm-b' : undefined}>
            <rect x="26" y="24" width="4" height="7" fill={body} />
            <rect x="26" y="31" width="5" height="3" fill={dark} />
          </g>
        ) : (
          <>
            {/* The working arm reaches out to the magnifier or the database. */}
            <rect x="26" y="25" width="7" height="4" fill={body} />
            <rect x="33" y="25" width="3" height="4" fill={dark} />
          </>
        )}
        <rect x="10" y="23" width="16" height="12" fill={body} />
        <rect x="13" y="26" width="10" height="6" fill={light} />
        <rect className={queued ? undefined : 'robot-light'} x="15" y="28" width="2" height="2" fill={queued ? soft : gold} />
        <rect x="19" y="28" width="2" height="2" fill={accent} />
        <g className={dancing ? 'robot-head' : undefined}>
          <rect x="17" y="6" width="2" height="4" fill={body} />
          <rect className={queued ? undefined : 'robot-light'} x="16" y="3" width="4" height="3" fill={queued ? soft : gold} />
          <rect x="8" y="10" width="20" height="13" fill={body} />
          <rect x="6" y="14" width="2" height="5" fill={dark} />
          <rect x="28" y="14" width="2" height="5" fill={dark} />
          <rect x="10" y="12" width="16" height="9" fill={dark} />
          {queued ? (
            <g fill={light}>
              <rect x="13" y="16" width="3" height="1" />
              <rect x="20" y="16" width="3" height="1" />
            </g>
          ) : onCode ? (
            <g className="robot-scan" fill={light}>
              <rect x="14" y="15" width="3" height="3" />
              <rect x="20" y="15" width="3" height="3" />
            </g>
          ) : onDatabase ? (
            <g fill={gold}>
              <rect x="15" y="14" width="3" height="4" />
              <rect x="22" y="14" width="3" height="4" />
            </g>
          ) : (
            <g className="robot-eyes" fill={light}>
              <rect x="13" y="14" width="3" height="4" />
              <rect x="20" y="14" width="3" height="4" />
            </g>
          )}
        </g>
      </g>

      {queued && (
        <g fill={soft}>
          <rect x="33" y="8" width="6" height="1" />
          <rect x="37" y="9" width="2" height="1" />
          <rect x="35" y="10" width="2" height="1" />
          <rect x="33" y="11" width="6" height="1" />
        </g>
      )}

      {dancing && (
        <g>
          <rect x="31" y="15" width="2" height="2" fill={soft} />
          <rect x="33" y="12" width="3" height="2" fill={soft} />
          <rect x="33" y="2" width="16" height="9" fill={light} />
          <rect x="32" y="3" width="18" height="7" fill={light} />
          <rect className="robot-think" x="36" y="5" width="2" height="3" fill={accent} />
          <rect className="robot-think robot-think-2" x="40" y="5" width="2" height="3" fill={accent} />
          <rect className="robot-think robot-think-3" x="44" y="5" width="2" height="3" fill={accent} />
        </g>
      )}

      {onCode && (
        <>
          {/* A page of code, lit line by line as it reads. */}
          <rect x="35" y="3" width="15" height="17" fill={light} />
          <rect className="robot-row" x="37" y="5" width="9" height="2" fill={accent} />
          <rect className="robot-row robot-row-2" x="39" y="9" width="9" height="2" fill={accent} />
          <rect className="robot-row robot-row-3" x="37" y="13" width="6" height="2" fill={accent} />
          <g className="robot-lens">
            <rect x="37" y="22" width="9" height="1" fill={dark} />
            <rect x="37" y="30" width="9" height="1" fill={dark} />
            <rect x="36" y="23" width="1" height="7" fill={dark} />
            <rect x="46" y="23" width="1" height="7" fill={dark} />
            <rect x="37" y="23" width="9" height="7" fill={soft} opacity="0.45" />
            <rect x="34" y="28" width="2" height="2" fill={dark} />
          </g>
        </>
      )}

      {onDatabase && (
        <g>
          {/* A database cylinder, its rows lighting up as the queries run. */}
          <rect x="37" y="4" width="11" height="1" fill={dark} />
          <rect x="36" y="5" width="13" height="30" fill={dark} />
          <rect x="37" y="35" width="11" height="1" fill={dark} />
          <rect x="36" y="14" width="13" height="1" fill="var(--color-navy)" />
          <rect x="36" y="24" width="13" height="1" fill="var(--color-navy)" />
          <rect className="robot-row" x="38" y="8" width="9" height="3" fill={gold} />
          <rect className="robot-row robot-row-2" x="38" y="18" width="9" height="3" fill={gold} />
          <rect className="robot-row robot-row-3" x="38" y="28" width="9" height="3" fill={gold} />
        </g>
      )}
    </svg>
  );
}

export function InvestigationStatusChip({ row }: { row: Row<Investigation> }) {
  const t = useT();
  const { status, report } = row.data;
  if (status === 'done' && report) {
    return (
      <span className={`flex-none rounded px-1.5 py-0.5 text-[10.5px] font-bold ${CONCLUSION_STYLE[report.conclusion]}`}>
        {t(`inv.conclusion.${report.conclusion}`)}
      </span>
    );
  }
  return (
    <span className={`flex-none rounded px-1.5 py-0.5 text-[10.5px] font-bold ${STATUS_STYLE[status]}`}>
      {t(`inv.estado.${status}`)}
    </span>
  );
}

function SavedList({
  list,
  scope,
  canFilter,
  selectedId,
  onScope,
  onOpen,
  onNew,
}: {
  list: ReturnType<typeof useInvestigationList>;
  scope: 'chat' | 'all';
  canFilter: boolean;
  selectedId: string | null;
  onScope(scope: 'chat' | 'all'): void;
  onOpen(id: string): void;
  onNew(): void;
}) {
  const t = useT();
  const scopes = [
    ['chat', t('inv.esteChat')],
    ['all', t('inv.todas')],
  ] as const;
  return (
    <>
      <button
        onClick={onNew}
        className="flex flex-none items-center justify-center gap-1.5 self-start rounded-lg bg-navy px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-navy-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
      >
        <span className="msr text-[17px]">add</span>
        {t('inv.nueva')}
      </button>

      <div className="mt-3 flex flex-none items-baseline justify-between gap-2">
        <h3 className="text-[12px] font-bold text-ink">{t('inv.titulo')}</h3>
        {canFilter && (
          <div className="flex gap-2">
            {scopes.map(([value, label]) => (
              <button
                key={value}
                onClick={() => onScope(value)}
                aria-pressed={scope === value}
                className={`text-[11px] font-semibold ${
                  scope === value ? 'text-ai underline underline-offset-2' : 'text-warm-gray hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-1.5 min-h-0 flex-1 overflow-y-auto">
        {list.error ? (
          <p className="py-4 text-[12px] text-warn-dark">{t('inv.errorLista')}</p>
        ) : list.loading ? null : list.rows.length === 0 ? (
          <div className="py-4 text-[12px] text-warm-gray">
            <p className="font-semibold text-ink-2">{t(scope === 'chat' && canFilter ? 'inv.vacio' : 'inv.vacioTodas')}</p>
            <p className="mt-1 leading-relaxed">{t('inv.vacioAyuda')}</p>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {list.rows.map((row) => (
              <li key={row.id}>
                <button
                  onClick={() => onOpen(row.id)}
                  aria-current={selectedId === row.id}
                  className={`w-full rounded-lg px-2 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-ai ${
                    selectedId === row.id ? 'bg-ai-bg' : 'hover:bg-cream-1'
                  }`}
                >
                  <span className="line-clamp-2 text-[12.5px] font-semibold leading-snug text-ink">{row.data.question}</span>
                  <span className="mt-1 flex items-center gap-1.5">
                    <InvestigationStatusChip row={row} />
                    <span className="truncate text-[10.5px] text-warm-gray">
                      {fmtFecha(row.data.createdAt, true)} · {row.data.requestedBy.nombre}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {list.hasMore && (
          <button
            onClick={list.loadMore}
            className="my-2 w-full rounded-lg py-1.5 text-[12px] font-semibold text-navy hover:bg-cream-1"
          >
            {t('inv.cargarMas')}
          </button>
        )}
      </div>
    </>
  );
}

function NewInvestigation({
  conv,
  start,
  questionRef,
  onCreated,
}: {
  conv: Row<Conversation>;
  start: FormStart;
  questionRef: RefObject<HTMLTextAreaElement | null>;
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
    (start.uploads ?? []).map(({ storagePath, name }) => ({ key: storagePath, name, storagePath, problem: null })),
  );
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Waits for the conversation's messages, so it doesn't mark an empty list.
  useEffect(() => {
    if (current.length > 0 && selected === null) setSelected(defaultSelection(rows, conv.id));
  }, [current.length, rows, selected, conv.id]);

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
  const canSend = typed >= MIN_QUESTION_CHARS && marked.size > 0 && !sending && !uploading && !tooManyFiles;

  function addFiles(list: FileList | File[]) {
    for (const file of Array.from(list)) {
      const key = `${file.name}_${Date.now()}_${Math.random()}`;
      const problem = !investigationFileKind(file.type, file.name)
        ? 'inv.archivoTipo'
        : file.size > INVESTIGATION_MAX_FILE_BYTES
          ? 'inv.archivoGrande'
          : null;
      setUploads((current) => [...current, { key, name: file.name, storagePath: null, problem }]);
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
      <label htmlFor={`inv-question-${conv.id}`} className="block flex-none text-[13px] font-bold text-ink">
        {t('inv.pregunta')}
      </label>
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
        className="mt-1.5 w-full flex-none resize-none rounded-lg border border-warm-border bg-cream-0 p-2.5 text-[13px] leading-relaxed outline-none focus:border-ai"
      />
      <div role="group" aria-label={t('inv.plantillas')} className="mt-1.5 flex flex-none gap-1.5 overflow-x-auto pb-0.5 @md:flex-wrap">
        {templates.map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={() => applyTemplate(template.text)}
            aria-pressed={question.trim() === template.text}
            title={template.text}
            className={`flex-none rounded-full border px-2.5 py-1 text-[11.5px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ai ${
              question.trim() === template.text
                ? 'border-ai bg-ai-bg text-ai'
                : 'border-warm-border text-ink-2 hover:border-ai hover:text-ai'
            }`}
          >
            {template.label}
          </button>
        ))}
      </div>

      <div className="mt-2.5 flex-none">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title={t('inv.archivosAyuda')}
            className="flex items-center gap-1 rounded-lg border border-warm-border px-2.5 py-1 text-[11.5px] font-semibold text-ink-2 hover:border-ai hover:text-ai focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ai"
          >
            <span className="msr text-[15px]">attach_file</span>
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
          <span className={`text-[11px] ${tooManyFiles ? 'font-semibold text-warn-dark' : 'text-warm-gray'}`}>
            {t('inv.archivos')}: {t('inv.archivosConteo', { n: fileCount, max: INVESTIGATION_MAX_FILES })}
          </span>
        </div>
        {tooManyFiles && (
          <p className="mt-1 text-[11.5px] text-warn-dark">{t('inv.archivosDemasiados', { max: INVESTIGATION_MAX_FILES })}</p>
        )}
        {uploads.length > 0 && (
          <ul className="mt-1.5 flex max-h-20 flex-wrap gap-1.5 overflow-y-auto">
            {uploads.map((upload) => (
              <li
                key={upload.key}
                title={upload.problem ? t(upload.problem) : upload.name}
                className={`flex max-w-full items-center gap-1 rounded-md py-0.5 pl-2 pr-1 text-[11.5px] ${
                  upload.problem ? 'bg-warn-bg text-warn-dark' : 'bg-cream-2 text-ink-2'
                }`}
              >
                <span className={`msr text-[14px] ${!upload.storagePath && !upload.problem ? 'motion-safe:animate-spin' : ''}`}>
                  {upload.problem ? 'error' : upload.storagePath ? 'description' : 'progress_activity'}
                </span>
                <span className="min-w-0 truncate">{upload.name}</span>
                {upload.problem && <span className="flex-none font-semibold">{t(upload.problem)}</span>}
                <button
                  type="button"
                  onClick={() => setUploads((current) => current.filter((u) => u.key !== upload.key))}
                  aria-label={t('inv.archivoQuitar', { name: upload.name })}
                  title={t('inv.archivoQuitar', { name: upload.name })}
                  className="flex flex-none rounded p-0.5 hover:bg-black/5"
                >
                  <span className="msr text-[13px]">close</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3 flex flex-none items-baseline gap-2">
        <span className="text-[12px] font-bold text-ink">{t('inv.mensajes')}</span>
        <span className="text-[11px] text-warm-gray">{t('inv.seleccionados', { n: marked.size, max: MAX_MESSAGES })}</span>
        {thread.hayMas && (
          <button
            onClick={() => void thread.loadOlder()}
            disabled={thread.cargando}
            className="ml-auto text-[11.5px] font-semibold text-navy hover:underline disabled:opacity-50"
          >
            {t('inv.cargarAnteriores')}
          </button>
        )}
      </div>

      <ul className="mt-1.5 min-h-0 flex-1 space-y-0.5 overflow-y-auto rounded-lg border border-cream-3 p-1">
        {rows.map((row) => {
          const m = row.msg.data;
          const key = keyOf({ conversationId: row.convId, messageId: row.msg.id });
          const checked = marked.has(key);
          return (
            <li key={key}>
              <label className={`flex cursor-pointer gap-2 rounded-md px-2 py-1.5 ${checked ? 'bg-ai-bg/50' : 'hover:bg-cream-1'}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && full}
                  onChange={() => toggle(key)}
                  className="mt-0.5 flex-none self-start accent-[var(--color-ai)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5 text-[11px] text-warm-gray">
                    <span className="truncate font-semibold text-ink-2">{m.sender.nombre}</span>
                    <span className="flex-none">{fmtFecha(m.createdAt, true)}</span>
                    {m.interno && <span className="flex-none font-semibold text-warn-dark">{t('inv.notaInterna')}</span>}
                    {isSystem(m) && <span className="flex-none">{t('inv.sistema')}</span>}
                  </span>
                  {m.texto && <span className="line-clamp-2 whitespace-pre-wrap break-words text-[12.5px] text-ink">{m.texto}</span>}
                  {(m.adjuntos ?? []).map((a) => {
                    const readable = !!investigationFileKind(a.mimeType, a.nombre);
                    return (
                      <span key={a.storagePath} className={`mt-0.5 flex items-center gap-1 text-[11px] ${readable ? 'text-ink-2' : 'text-warm-gray'}`}>
                        <span className="msr flex-none text-[13px]">{readable ? 'attach_file' : 'block'}</span>
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

      <div className="mt-2 flex flex-none items-center justify-end gap-3">
        <p className="min-w-0 flex-1 text-[11.5px] text-warn-dark">
          {failed ?? (typed > 0 && typed < MIN_QUESTION_CHARS ? t('inv.preguntaCorta') : '')}
        </p>
        <button
          onClick={() => void send()}
          disabled={!canSend}
          className="flex flex-none items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-navy-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-40"
        >
          <span className="msr text-[16px]">troubleshoot</span>
          {sending ? t('inv.enviando') : t('inv.enviar')}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h4 className="text-[11px] font-bold uppercase tracking-wide text-warm-gray">{title}</h4>
      <div className="mt-1 max-w-[70ch] text-[13px] leading-relaxed text-ink">{children}</div>
    </section>
  );
}

function Collapsible({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <details className="group border-t border-cream-3 py-2">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-[12px] font-semibold text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
        <span className="msr text-[16px] transition-transform group-open:rotate-90">chevron_right</span>
        {title}
        <span className="font-normal text-warm-gray">({count})</span>
      </summary>
      <div className="mt-2">{children}</div>
    </details>
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

  return (
    <div className="flex flex-1 flex-col items-center justify-center py-4 text-center" role="status">
      <InvestigatorRobot pose={running ? phase : 'queued'} label={title} />
      <h3 className="mt-3 text-[17px] font-bold text-ink">{title}</h3>
      <p className="mt-1 max-w-[46ch] text-[12.5px] leading-relaxed text-ink-2">{detail}</p>
      <p className="mt-1 max-w-[46ch] text-[12px] leading-relaxed text-warm-gray">{t('inv.seguirAtendiendo')}</p>
      {since > 0 && (
        <p className="mt-2 text-[12px] tabular-nums text-ink-2">{t('inv.transcurrido', { t: formatElapsed(now - since) })}</p>
      )}
      {actions && <NotifyClient notified={actions.notified} onNotifyClient={actions.onNotifyClient} />}
      <button
        onClick={() => void cancelInvestigation(row.id)}
        className="mt-2 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-warm-gray hover:bg-cream-1 hover:text-ink"
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
    <div className="mt-3 w-full max-w-[56ch] rounded-lg bg-cream-1 p-3 text-left">
      <p className="text-[11px] font-bold uppercase tracking-wide text-warm-gray">{t('inv.avisoTitulo')}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink">{texto}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {notified ? (
          <span className="flex items-center gap-1 text-[12.5px] font-semibold text-ok-dark">
            <span className="msr text-[16px]">check_circle</span>
            {t('inv.avisoEnviado')}
          </span>
        ) : (
          <button
            onClick={() => void send()}
            disabled={sending}
            className="flex items-center gap-1.5 rounded-lg bg-navy px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-navy-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50"
          >
            <span className="msr text-[15px]">send</span>
            {sending ? t('inv.enviando') : t('inv.avisoEnviar')}
          </button>
        )}
        {failed && <span className="text-[12px] text-warn-dark">{t('inv.avisoError')}</span>}
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
    <div className="@container min-h-0 flex-1 overflow-y-auto pr-1">
      <div className="flex min-h-full flex-col">
        <header className="flex-none">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {report ? (
              <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] font-bold ${CONCLUSION_STYLE[report.conclusion]}`}>
                <span className="msr text-[16px]">{CONCLUSION_ICON[report.conclusion]}</span>
                {t(`inv.conclusion.${report.conclusion}`)}
              </span>
            ) : (
              !isActive(status) && <InvestigationStatusChip row={row} />
            )}
            <span className="text-[11px] text-warm-gray">
              {fmtFecha(createdAt, true)} · {requestedBy.nombre}
            </span>
          </div>
          <h3 className="mt-1.5 max-w-[70ch] whitespace-pre-wrap text-[14px] font-bold leading-snug text-ink">{question}</h3>
          {origin}
        </header>

        {isActive(status) && <Working row={row} actions={actions} />}

        {unfinished && (
          <div className="mt-3 rounded-lg bg-warn-bg p-3 text-[12.5px] leading-relaxed text-warn-dark">
            <p className="font-semibold">
              {status === 'rate_limited' ? t('inv.limite') : status === 'cancelled' ? t('inv.canceladaAyuda') : t('inv.falloAyuda')}
            </p>
            {status === 'failed' && error && <p className="mt-1 break-words">{error}</p>}
            {actions && (
              <button
                onClick={actions.onRetry}
                className="mt-2 rounded-lg bg-navy px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-navy-light"
              >
                {t('inv.reintentar')}
              </button>
            )}
          </div>
        )}

        {report && (
          <div className="mt-3">
            {report.downgradedFrom && <p className="mb-2 text-[12px] text-warn-dark">{t('inv.bajada')}</p>}
            {report.rejectedEvidence.length > 0 && (
              <div className="mb-2 text-[12px] text-warn-dark">
                <p>{t('inv.rechazadas', { n: report.rejectedEvidence.length })}</p>
                <ul className="mt-0.5 list-disc pl-4">
                  {report.rejectedEvidence.map((problem) => <li key={problem} className="break-words">{problem}</li>)}
                </ul>
              </div>
            )}

            <div className="grid gap-4 @2xl:grid-cols-[minmax(0,1fr)_minmax(220px,320px)]">
              <div className="space-y-3">
                <Section title={t('inv.resumen')}><p className="whitespace-pre-wrap">{report.summary}</p></Section>
                <Section title={t('inv.causa')}><p className="whitespace-pre-wrap">{report.cause}</p></Section>
                <Section title={t('inv.recomendacion')}><p className="whitespace-pre-wrap">{report.recommendation}</p></Section>
                {report.missing.length > 0 && (
                  <Section title={t('inv.falta')}>
                    <ul className="list-disc space-y-0.5 pl-4">
                      {report.missing.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </Section>
                )}
              </div>

              <div>
                <Section title={t('inv.respuesta')}>
                  {report.suggestedReply ? (
                    <>
                      <p className="whitespace-pre-wrap rounded-lg bg-cream-1 p-3">{report.suggestedReply}</p>
                      {actions && (
                        <>
                          <button
                            onClick={() => actions.onUseReply(report.suggestedReply!)}
                            className="mt-2 rounded-lg bg-navy px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-navy-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                          >
                            {t('inv.usarRespuesta')}
                          </button>
                          <p className="mt-1 text-[11px] text-warm-gray">{t('inv.respuestaAviso')}</p>
                        </>
                      )}
                    </>
                  ) : (
                    <p className="text-[12.5px] text-warm-gray">{t('inv.sinRespuesta')}</p>
                  )}
                </Section>
              </div>
            </div>

            <div className="mt-4">
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
            </div>
          </div>
        )}

        {(unreadableFiles?.length ?? 0) > 0 && (
          <p className="mt-2 text-[12px] text-warn-dark">{t('inv.archivosNoLeidos', { names: unreadableFiles!.join(', ') })}</p>
        )}

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
                  <div className="text-[12px]">{q.data.purpose}</div>
                  <pre className="mt-0.5 overflow-x-auto rounded bg-cream-1 p-2 font-mono text-[11px]">{q.data.sql}</pre>
                  <div className="mt-0.5 text-[11px] text-warm-gray">
                    {q.data.error ?? t(q.data.truncated ? 'inv.filasMas' : 'inv.filas', { n: q.data.rowCount })} · {q.data.ms} ms
                  </div>
                </li>
              ))}
            </ul>
          </Collapsible>
        )}

        {!isActive(status) && (
          <p className="border-t border-cream-3 py-2 text-[11px] text-warm-gray">
            {status === 'done' && !usedDatabase && queries.length === 0 && <>{t('inv.sinBase')} </>}
            {t('inv.base', { n: messageCount, sha: sha ? sha.slice(0, 8) : '-' })}
          </p>
        )}
      </div>
    </div>
  );
}
