'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
  Conversation,
  Investigation,
  InvestigationConclusion,
  InvestigationMessageRef,
  InvestigationStatus,
  Message,
} from '@aditum-chat/shared';
import { fmtFecha, useContactThread, useGroupThread, useMessages, type Row, type ThreadRow } from '@/lib/data';
import {
  cancelInvestigation,
  requestInvestigation,
  useInvestigationEvents,
  useInvestigationQueries,
  useRunnerOnline,
  useThreadInvestigations,
} from '@/lib/data-investigations';
import { useT } from '@/lib/i18n';

const MAX_MESSAGES = 100;
const MIN_QUESTION_CHARS = 10;
const TOKEN_WARNING_DAYS = 30;

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

const millis = (ts: unknown) => (ts as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;

const isSystem = (m: Message) => m.sender.tipo === 'sistema' || m.tipoContenido === 'sistema';

/** Lo más común es analizar la conversación actual, así que arranca marcada. */
function defaultSelection(rows: ThreadRow[], conversationId: string): Set<string> {
  const keys = rows
    .filter((r) => r.convId === conversationId && !isSystem(r.msg.data) && !r.msg.data.interno && !r.msg.data.bienvenida)
    .map((r) => keyOf({ conversationId: r.convId, messageId: r.msg.id }));
  return new Set(keys.slice(-MAX_MESSAGES));
}

export function InvestigationPanel({
  conv,
  seed,
  onClose,
  onUseReply,
}: {
  conv: Row<Conversation>;
  seed?: InvestigationMessageRef;
  onClose(): void;
  onUseReply(texto: string): void;
}) {
  const t = useT();
  const grupo = conv.data.tipo === 'grupo';
  const threadKey = grupo
    ? conv.data.groupId ? `group:${conv.data.groupId}` : null
    : conv.data.contactId ? `contact:${conv.data.contactId}` : null;
  const investigations = useThreadInvestigations(threadKey);
  const [view, setView] = useState<'list' | 'new'>(seed ? 'new' : 'list');
  const [detailId, setDetailId] = useState<string | null>(null);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const runner = useRunnerOnline(now);
  const detail = investigations.find((row) => row.id === detailId) ?? null;

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/30" onClick={onClose} aria-hidden />
      <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col bg-white shadow-2xl">
        <div className="flex-none bg-navy-deep h-[env(safe-area-inset-top)] lg:hidden" />
        <header className="flex flex-none items-center gap-2 border-b border-cream-3 px-4 py-3">
          {(detail || view === 'new') && (
            <button
              onClick={() => {
                setDetailId(null);
                setView('list');
              }}
              title={t('inv.volver')}
              aria-label={t('inv.volver')}
              className="text-warm-gray hover:text-ink"
            >
              <span className="msr text-[20px]">arrow_back</span>
            </button>
          )}
          <span className="msr text-[19px] text-ai">troubleshoot</span>
          <h2 className="flex-1 truncate text-[14px] font-bold">{t('inv.titulo')}</h2>
          <button onClick={onClose} title="Cerrar" aria-label="Cerrar" className="text-warm-gray hover:text-ink">
            <span className="msr text-[20px]">close</span>
          </button>
        </header>

        {!runner.online && (
          <p className="flex-none bg-warn-bg px-4 py-2 text-[12px] text-warn-dark">{t('inv.desconectado')}</p>
        )}
        {runner.online && runner.tokenDaysLeft !== null && runner.tokenDaysLeft < TOKEN_WARNING_DAYS && (
          <p className="flex-none bg-warn-bg px-4 py-2 text-[12px] text-warn-dark">
            {t('inv.tokenVence', { n: runner.tokenDaysLeft })}
          </p>
        )}

        {detail ? (
          <Detail row={detail} onUseReply={onUseReply} />
        ) : view === 'new' ? (
          <NewInvestigation
            conv={conv}
            seed={seed}
            onCreated={(id) => {
              setDetailId(id);
              setView('list');
            }}
          />
        ) : (
          <List rows={investigations} onOpen={setDetailId} onNew={() => setView('new')} />
        )}
      </aside>
    </>
  );
}

function StatusChip({ status }: { status: InvestigationStatus }) {
  const t = useT();
  return (
    <span className={`flex-none rounded px-1.5 py-0.5 text-[10.5px] font-bold ${STATUS_STYLE[status]}`}>
      {t(`inv.estado.${status}`)}
    </span>
  );
}

function List({ rows, onOpen, onNew }: { rows: Row<Investigation>[]; onOpen(id: string): void; onNew(): void }) {
  const t = useT();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <button
        onClick={onNew}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-navy px-3 py-2 text-[13px] font-semibold text-white hover:brightness-110"
      >
        <span className="msr text-[17px]">add</span>
        {t('inv.nueva')}
      </button>
      {rows.length === 0 ? (
        <p className="mt-6 text-center text-[12.5px] text-warm-gray">{t('inv.vacio')}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                onClick={() => onOpen(row.id)}
                className="w-full rounded-lg border border-cream-3 p-3 text-left hover:border-warm-border"
              >
                <div className="flex items-start gap-2">
                  <span className="line-clamp-2 flex-1 text-[12.5px] font-semibold">{row.data.question}</span>
                  <StatusChip status={row.data.status} />
                </div>
                <div className="mt-1 text-[11px] text-warm-gray">
                  {row.data.requestedBy.nombre} · {fmtFecha(row.data.createdAt, true)}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewInvestigation({
  conv,
  seed,
  onCreated,
}: {
  conv: Row<Conversation>;
  seed?: InvestigationMessageRef;
  onCreated(id: string): void;
}) {
  const t = useT();
  const grupo = conv.data.tipo === 'grupo';
  const contactThread = useContactThread(grupo ? null : (conv.data.contactId ?? null));
  const groupThread = useGroupThread(grupo ? (conv.data.groupId ?? null) : null);
  const thread = grupo ? groupThread : contactThread;
  // El hilo arranca por el segmento más reciente, y esta conversación puede ser una anterior.
  const current = useMessages(conv.id);
  const rows = useMemo(() => {
    const merged = new Map<string, ThreadRow>();
    for (const row of thread.filas) merged.set(`${row.convId}/${row.msg.id}`, row);
    for (const msg of current) merged.set(`${conv.id}/${msg.id}`, { convId: conv.id, msg });
    return [...merged.values()]
      .filter((r) => r.msg.data.tipoContenido !== 'csat')
      .sort((a, b) => millis(a.msg.data.createdAt) - millis(b.msg.data.createdAt));
  }, [thread.filas, current, conv.id]);

  const [question, setQuestion] = useState('');
  const [selected, setSelected] = useState<Set<string> | null>(seed ? new Set([keyOf(seed)]) : null);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  // Espera a que lleguen los mensajes de la conversación para no marcar una lista vacía.
  useEffect(() => {
    if (current.length > 0 && selected === null) setSelected(defaultSelection(rows, conv.id));
  }, [current.length, rows, selected, conv.id]);

  const marked = selected ?? new Set<string>();
  const full = marked.size >= MAX_MESSAGES;
  const canSend = question.trim().length >= MIN_QUESTION_CHARS && marked.size > 0 && !sending;

  function toggle(key: string) {
    const next = new Set(marked);
    if (next.has(key)) next.delete(key);
    else if (!full) next.add(key);
    setSelected(next);
  }

  async function send() {
    setSending(true);
    setFailed(false);
    try {
      const messages = [...marked].map((key) => {
        const [conversationId, messageId] = key.split('/');
        return { conversationId, messageId };
      });
      onCreated(await requestInvestigation({ conversationId: conv.id, messages, question: question.trim() }));
    } catch {
      setFailed(true);
      setSending(false);
    }
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <label htmlFor="inv-question" className="block text-[12.5px] font-bold">
          {t('inv.pregunta')}
        </label>
        <textarea
          id="inv-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t('inv.preguntaAyuda')}
          rows={3}
          maxLength={1000}
          autoFocus
          className="mt-1.5 w-full resize-y rounded-lg border border-warm-border p-2 text-[13px] outline-none focus:border-navy"
        />

        <div className="mt-4 flex items-baseline justify-between gap-2">
          <span className="text-[12.5px] font-bold">{t('inv.mensajes')}</span>
          <span className="text-[11px] text-warm-gray">
            {t('inv.seleccionados', { n: marked.size, max: MAX_MESSAGES })}
          </span>
        </div>

        {thread.hayMas && (
          <button
            onClick={() => void thread.loadOlder()}
            disabled={thread.cargando}
            className="mt-2 text-[12px] font-semibold text-navy hover:underline disabled:opacity-50"
          >
            {t('inv.cargarAnteriores')}
          </button>
        )}

        <ul className="mt-2 space-y-1">
          {rows.map((row) => {
            const m = row.msg.data;
            const key = keyOf({ conversationId: row.convId, messageId: row.msg.id });
            const checked = marked.has(key);
            return (
              <li key={key}>
                <label
                  className={`flex cursor-pointer gap-2 rounded-lg border p-2 ${
                    checked ? 'border-ai-light bg-ai-bg/40' : 'border-cream-3'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && full}
                    onChange={() => toggle(key)}
                    className="mt-0.5 flex-none accent-[var(--color-ai)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5 text-[11px] text-warm-gray">
                      <span className="truncate font-semibold text-ink-2">{m.sender.nombre}</span>
                      <span className="flex-none">{fmtFecha(m.createdAt, true)}</span>
                      {m.interno && <span className="flex-none font-semibold text-warn-dark">{t('inv.notaInterna')}</span>}
                      {isSystem(m) && <span className="flex-none">{t('inv.sistema')}</span>}
                    </span>
                    {m.texto && <span className="line-clamp-3 block whitespace-pre-wrap break-words text-[12.5px]">{m.texto}</span>}
                    {(m.adjuntos?.length ?? 0) > 0 && (
                      <span className="mt-0.5 block text-[11px] text-warm-gray">{t('inv.adjunto')}</span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
      <footer className="flex-none border-t border-cream-3 p-3">
        {failed && <p className="mb-2 text-[12px] text-warn-dark">{t('inv.errorEnviar')}</p>}
        <button
          onClick={() => void send()}
          disabled={!canSend}
          className="w-full rounded-lg bg-navy px-3 py-2 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-40"
        >
          {sending ? t('inv.enviando') : t('inv.enviar')}
        </button>
      </footer>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="text-[11px] font-bold uppercase tracking-wide text-warm-gray">{title}</h3>
      <div className="mt-1 text-[13px] leading-relaxed">{children}</div>
    </section>
  );
}

function Detail({ row, onUseReply }: { row: Row<Investigation>; onUseReply(texto: string): void }) {
  const t = useT();
  const { status, report, question, error, usedDatabase, messageCount, sha } = row.data;
  const active = status === 'queued' || status === 'running';
  const events = useInvestigationEvents(row.id);
  const queries = useInvestigationQueries(row.id);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="flex items-start gap-2">
        <p className="flex-1 whitespace-pre-wrap text-[13px] font-semibold">{question}</p>
        <StatusChip status={status} />
      </div>

      {status === 'rate_limited' && <p className="mt-3 rounded-lg bg-warn-bg p-2 text-[12px] text-warn-dark">{t('inv.limite')}</p>}
      {status === 'failed' && error && <p className="mt-3 rounded-lg bg-warn-bg p-2 text-[12px] text-warn-dark">{error}</p>}

      {report && (
        <>
          <div className="mt-3 flex items-center gap-2">
            <span className={`rounded px-2 py-1 text-[12px] font-bold ${CONCLUSION_STYLE[report.conclusion]}`}>
              {t(`inv.conclusion.${report.conclusion}`)}
            </span>
          </div>
          {report.downgradedFrom && <p className="mt-2 text-[12px] text-warn-dark">{t('inv.bajada')}</p>}
          {report.rejectedEvidence.length > 0 && (
            <div className="mt-1 text-[12px] text-warn-dark">
              <p>{t('inv.rechazadas', { n: report.rejectedEvidence.length })}</p>
              <ul className="mt-0.5 list-disc pl-4">
                {report.rejectedEvidence.map((problem) => <li key={problem} className="break-words">{problem}</li>)}
              </ul>
            </div>
          )}

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

          <Section title={t('inv.respuesta')}>
            {report.suggestedReply ? (
              <>
                <p className="whitespace-pre-wrap rounded-lg bg-cream-1 p-2">{report.suggestedReply}</p>
                <button
                  onClick={() => onUseReply(report.suggestedReply!)}
                  className="mt-2 rounded-lg bg-navy px-3 py-1.5 text-[12.5px] font-semibold text-white hover:brightness-110"
                >
                  {t('inv.usarRespuesta')}
                </button>
                <p className="mt-1 text-[11px] text-warm-gray">{t('inv.respuestaAviso')}</p>
              </>
            ) : (
              <p className="text-warm-gray">{t('inv.sinRespuesta')}</p>
            )}
          </Section>

          {report.codeEvidence.length > 0 && (
            <Section title={t('inv.evidenciaCodigo')}>
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
            </Section>
          )}

          {report.dataEvidence.length > 0 && (
            <Section title={t('inv.evidenciaDatos')}>
              <ul className="space-y-1">
                {report.dataEvidence.map((e) => (
                  <li key={e.queryId} className="font-mono text-[11px]">
                    <span className="text-warm-gray">{e.queryId}:</span> {e.values.join(', ')}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}

      {queries.length > 0 ? (
        <Section title={t('inv.consultas')}>
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
        </Section>
      ) : (
        status === 'done' && !usedDatabase && <p className="mt-4 text-[12px] text-ok-dark">{t('inv.sinBase')}</p>
      )}

      {events.length > 0 && (active || !report) && (
        <Section title={t('inv.actividad')}>
          <ul className="space-y-0.5 text-[12px] text-ink-2">
            {events.map((e) => <li key={e.id} className="break-words">{e.data.text}</li>)}
          </ul>
        </Section>
      )}

      <p className="mt-4 text-[11px] text-warm-gray">
        {t('inv.base', { n: messageCount, sha: sha ? sha.slice(0, 8) : '—' })}
      </p>

      {active && (
        <button
          onClick={() => void cancelInvestigation(row.id)}
          className="mt-3 text-[12px] font-semibold text-warn-dark hover:underline"
        >
          {t('inv.cancelar')}
        </button>
      )}
    </div>
  );
}
