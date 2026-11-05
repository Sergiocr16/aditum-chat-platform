'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { InvestigationReport, InvestigatorWritesSwitch, WriteProposal, WriteReversal, WriteRowResult, WriteValue } from '@aditum-chat/shared';
import { writeConfirmationPhrase, writeOperationSql } from '@aditum-chat/shared';
import { isWrongPassword, useAuth } from '@/lib/auth';
import { fmtFecha, useDoc, type Row } from '@/lib/data';
import { requestFollowUp } from '@/lib/data-investigations';
import {
  cancelWriteApproval,
  confirmWriteStep,
  createReverseProposal,
  rehearseWriteProposal,
  runApprovedWrite,
  useWriteProposals,
} from '@/lib/data-writes';
import { useT } from '@/lib/i18n';

const SILENT_AFTER_MS = 5 * 60_000;
const APPROVAL_WINDOW_MS = 10 * 60_000;
const MAX_ERROR_IN_QUESTION = 700;

const millis = (value: unknown) => (value as { toMillis?: () => number } | null | undefined)?.toMillis?.() ?? 0;
const shown = (value: WriteValue | undefined) => (value === null || value === undefined ? 'NULL' : String(value));

const STATUS_TONE: Record<WriteProposal['status'], string> = {
  proposed: 'text-ink-2',
  superseded: 'text-warm-gray',
  rehearsing: 'text-ink-2',
  rehearsed: 'text-ok-dark',
  rehearsal_failed: 'text-warn-dark',
  executing: 'text-ink-2',
  executed: 'text-ok-dark',
  aborted: 'text-warn-dark',
  unknown: 'text-danger',
};

function useFailure() {
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = useT();
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setFailed(null);
    try {
      await action();
    } catch (e) {
      const { code, message } = e as { code?: string; message?: string };
      if (isWrongPassword(e)) setFailed(t('wp.contrasenaMala'));
      else setFailed(code?.startsWith('functions/') && message ? message : t('wp.error'));
    } finally {
      setBusy(false);
    }
  }
  return { failed, busy, run };
}

const primary = 'h-[34px] rounded-lg bg-navy px-3.5 text-[13.5px] font-semibold text-white hover:bg-navy-light disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy';
const secondary = 'h-[34px] rounded-lg border border-warm-border px-3.5 text-[13.5px] font-semibold text-ink hover:bg-cream-1 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy';

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[12px] font-semibold text-warm-gray">{label}</p>
      <div className="mt-0.5 max-w-[70ch] whitespace-pre-wrap break-words text-[13.5px] leading-snug text-ink">{children}</div>
    </div>
  );
}

function SqlBlock({ proposal }: { proposal: WriteProposal }) {
  return (
    <pre className="max-h-[260px] overflow-auto rounded-lg bg-cream-1 p-2.5 font-mono text-[11.5px] leading-relaxed text-ink">
      {proposal.operations.map(writeOperationSql).join('\n\n')}
    </pre>
  );
}

/** Only what changed. A column the operation didn't ask for is the database's doing, so it's labelled. */
function RowChanges({ rows, requested }: { rows: WriteRowResult[]; requested: WriteProposal['operations'] }) {
  const t = useT();
  return (
    <ul className="max-h-[320px] space-y-2.5 overflow-auto">
      {rows.map((row, i) => {
        const op = requested[i];
        const asked = new Set(Object.keys(op?.op === 'update' ? op.set : (op?.values ?? {})));
        const columns = row.op === 'insert' ? Object.keys(row.after) : row.changed;
        return (
          <li key={`${row.table}-${JSON.stringify(row.key)}`} className="min-w-0">
            <p className="break-words font-mono text-[11.5px] font-semibold text-ink-2">
              {row.table} {JSON.stringify(row.key)}
            </p>
            <table className="mt-1 w-full table-fixed border-collapse text-left text-[12px]">
              <thead>
                <tr className="text-warm-gray">
                  <th className="w-[34%] py-0.5 pr-2 font-semibold">{t('wp.columna')}</th>
                  <th className="py-0.5 pr-2 font-semibold">{t('wp.antes')}</th>
                  <th className="py-0.5 font-semibold">{t('wp.despues')}</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((column) => (
                  <tr key={column} className="border-t border-cream-3 align-top">
                    <td className="break-words py-1 pr-2 font-mono">
                      {column}
                      {!asked.has(column) && row.op === 'update' && <span className="block font-sans text-[11px] text-warm-gray">{t('wp.loCambioLaBase')}</span>}
                    </td>
                    <td className="break-words py-1 pr-2 font-mono text-ink-2">{row.op === 'insert' ? '' : shown(row.before?.[column])}</td>
                    <td className="break-words py-1 font-mono font-semibold text-ink">{shown(row.after[column])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {row.notAsRequested.length > 0 && (
              <p className="mt-1 text-[12px] leading-snug text-warn-dark">{t('wp.noQuedoComoPidio', { columns: row.notAsRequested.join(', ') })}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ReversalNote({ reversal }: { reversal: WriteReversal }) {
  const t = useT();
  return (
    <Labeled label={t('wp.reversa')}>
      {reversal.operations.length > 0 && <p>{t(reversal.operations.length === 1 ? 'wp.reversaUna' : 'wp.reversaVarias', { n: reversal.operations.length })}</p>}
      {reversal.manual.map((line) => (
        <p key={line} className="text-warn-dark">{line}</p>
      ))}
      {reversal.operations.length === 0 && reversal.manual.length === 0 && t('wp.reversaNada')}
    </Labeled>
  );
}

function Step({ n, state, title, children }: { n: number; state: 'done' | 'current' | 'next'; title: string; children?: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span
        aria-hidden
        className={`mt-px flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full text-[12px] font-bold ${
          state === 'done' ? 'bg-ok-bg text-ok-dark' : state === 'current' ? 'bg-navy text-white' : 'bg-cream-2 text-warm-gray'
        }`}
      >
        {state === 'done' ? <span className="msr text-[15px]">check</span> : n}
      </span>
      <div className="min-w-0 flex-1 pb-3">
        <p className={`text-[13.5px] font-semibold leading-[22px] ${state === 'next' ? 'text-warm-gray' : 'text-ink'}`}>{title}</p>
        {state === 'current' && <div className="mt-1.5 space-y-2.5">{children}</div>}
      </div>
    </li>
  );
}

function ConfirmCheck({ label, busy, onConfirm }: { label: string; busy: boolean; onConfirm(): void }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-[13.5px] font-semibold text-ink">
      <input type="checkbox" checked={false} disabled={busy} onChange={onConfirm} className="mt-[3px] h-4 w-4 flex-none accent-[var(--color-navy)]" />
      <span>{label}</span>
    </label>
  );
}

/** Three steps in the page and in order. The server checks each one: this only shows where it stands. */
function Approval({ ids, proposal, email }: { ids: { investigationId: string; proposalId: string }; proposal: WriteProposal; email: string | undefined }) {
  const t = useT();
  const { agent } = useAuth();
  const { failed, busy, run } = useFailure();
  const [typed, setTyped] = useState('');
  const [password, setPassword] = useState('');
  const hash = proposal.rehearsal!.hash;
  const approval = proposal.approval;
  const live = approval && Date.now() - millis(approval.startedAt) < APPROVAL_WINDOW_MS && approval.hash === hash;
  const mine = live && approval.by.uid === agent?.uid;
  const phrase = writeConfirmationPhrase(proposal.operations);
  if (live && !mine) return <p className="text-[13.5px] text-ink-2">{t('wp.otroAprobando', { name: approval.by.nombre })}</p>;

  const current = mine ? approval.step + 1 : 1;
  const state = (n: number) => (n < current ? 'done' : n === current ? 'current' : 'next');
  return (
    <div className="border-t border-cream-3 pt-3">
      <ol>
        <Step n={1} state={state(1)} title={t('wp.paso1')}>
          <ConfirmCheck label={t('wp.paso1Confirmar')} busy={busy} onConfirm={() => void run(() => confirmWriteStep(ids, 1, hash))} />
        </Step>
        <Step n={2} state={state(2)} title={t('wp.paso2')}>
          <Labeled label={t('wp.consecuencia')}>{proposal.consequence}</Labeled>
          <ul className="space-y-0.5">
            {proposal.consequenceEvidence.map((e) => (
              <li key={`${e.path}:${e.startLine}`} className="break-all font-mono text-[11.5px] text-ink-2">
                {e.path}:{e.startLine}
              </li>
            ))}
          </ul>
          <ConfirmCheck label={t('wp.paso2Confirmar')} busy={busy} onConfirm={() => void run(() => confirmWriteStep(ids, 2, hash))} />
        </Step>
        <Step n={3} state={state(3)} title={t('wp.paso3')}>
          <Labeled label={t(`wp.riesgo.${proposal.riskLevel}`)}>{proposal.risk}</Labeled>
          <Labeled label={t('wp.cache')}>{proposal.cache}</Labeled>
          <ReversalNote reversal={proposal.rehearsal!.reversal} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => runApprovedWrite(ids, hash, typed.trim(), password));
            }}
            className="space-y-2"
            autoComplete="off"
          >
            <label className="block text-[12.5px] text-ink-2">
              {t('wp.escribi')} <span className="select-all font-mono font-semibold text-ink">{phrase}</span>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                className="mt-1 block w-full rounded-lg border border-warm-border px-2.5 py-2 font-mono text-[13px] text-ink outline-none focus:border-navy"
              />
            </label>
            <label className="block text-[12.5px] text-ink-2">
              {t('wp.tuContrasena', { email: email ?? '' })}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="mt-1 block w-full rounded-lg border border-warm-border px-2.5 py-2 text-[13px] text-ink outline-none focus:border-navy"
              />
            </label>
            <button
              type="submit"
              disabled={busy || typed.trim() !== phrase || !password}
              className="h-[36px] rounded-lg bg-danger px-3.5 text-[13.5px] font-semibold text-white hover:brightness-110 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
            >
              {busy ? t('wp.aplicando') : t('wp.correr')}
            </button>
          </form>
        </Step>
      </ol>
      {failed && <p className="mb-2 text-[12.5px] leading-snug text-warn-dark">{failed}</p>}
      {mine && (
        <button onClick={() => void run(() => cancelWriteApproval(ids))} disabled={busy} className="text-[12.5px] font-semibold text-warm-gray underline underline-offset-2 hover:text-ink touch:min-h-10">
          {t('wp.cancelarAprobacion')}
        </button>
      )}
    </div>
  );
}

function ProposalCard({ investigationId, row, canFollowUp }: { investigationId: string; row: Row<WriteProposal>; canFollowUp: boolean }) {
  const t = useT();
  const { agent } = useAuth();
  const isAdmin = agent?.perfil?.rol === 'admin';
  const proposal = row.data;
  const ids = { investigationId, proposalId: row.id };
  const { failed, busy, run } = useFailure();
  const { status, rehearsal, execution } = proposal;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (status !== 'executing' && status !== 'rehearsing') return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [status]);
  const writes = useWritesSwitch(isAdmin);
  const executingSilent = status === 'executing' && now - millis(execution?.requestedAt) > SILENT_AFTER_MS;
  const rehearseButton = (label: string) =>
    isAdmin && (
      <button onClick={() => void run(() => rehearseWriteProposal(ids))} disabled={busy || !writes} className={status === 'proposed' ? primary : secondary}>
        {label}
      </button>
    );

  return (
    <section aria-label={t('wp.titulo')} className="rounded-[10px] border border-warm-border px-3.5 py-3">
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h4 className="text-[14px] font-semibold text-ink">{proposal.reverseOf ? t('wp.tituloReversa') : t('wp.titulo')}</h4>
        <span className={`text-[12.5px] font-semibold ${STATUS_TONE[status]}`}>{t(`wp.estado.${status}`)}</span>
      </header>
      <div className="space-y-3">
        <p className="max-w-[70ch] whitespace-pre-wrap break-words text-[13.5px] leading-snug text-ink">{proposal.reason}</p>
        <SqlBlock proposal={proposal} />

        {status === 'proposed' && (
          <>
            <Labeled label={t(`wp.riesgo.${proposal.riskLevel}`)}>{proposal.risk}</Labeled>
            {isAdmin ? (
              writes ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {rehearseButton(t('wp.ensayar'))}
                  <p className="text-[12.5px] text-warm-gray">{t('wp.ensayarAyuda')}</p>
                </div>
              ) : (
                <p className="text-[13px] text-warm-gray">{t('wp.apagadas')}</p>
              )
            ) : (
              <p className="text-[13px] text-warm-gray">{t('wp.soloAdmins')}</p>
            )}
          </>
        )}

        {status === 'rehearsing' && <p className="text-[13.5px] text-ink-2">{t('wp.ensayando')}</p>}

        {status === 'rehearsal_failed' && (
          <>
            <p className="break-words rounded-lg bg-warn-bg px-3 py-2 text-[13px] leading-snug text-warn-dark">{proposal.error}</p>
            <div className="flex flex-wrap gap-2">
              {canFollowUp && (
                <button
                  onClick={() => void run(() => requestFollowUp(investigationId, t('wp.corregirPregunta', { error: (proposal.error ?? '').slice(0, MAX_ERROR_IN_QUESTION) })))}
                  disabled={busy}
                  className={primary}
                >
                  {t('wp.pedirCorreccion')}
                </button>
              )}
              {rehearseButton(t('wp.ensayarDeNuevo'))}
            </div>
          </>
        )}

        {status === 'rehearsed' && rehearsal && (
          <>
            <Labeled label={t('wp.resultadoEnsayo', { name: rehearsal.by?.nombre ?? '', when: fmtFecha(rehearsal.at, true) })}>
              <RowChanges rows={rehearsal.rows} requested={proposal.operations} />
            </Labeled>
            {isAdmin ? (
              <Approval ids={ids} proposal={proposal} email={agent?.user.email ?? undefined} />
            ) : (
              <p className="text-[13px] text-warm-gray">{t('wp.soloAdmins')}</p>
            )}
          </>
        )}

        {status === 'executing' && <p className={`text-[13.5px] ${executingSilent ? 'text-warn-dark' : 'text-ink-2'}`}>{executingSilent ? t('wp.sinNoticias') : t('wp.aplicando')}</p>}

        {status === 'executed' && execution && (
          <>
            <p className="flex flex-wrap items-center gap-x-1.5 rounded-lg bg-ok-bg px-3 py-2 text-[13.5px] font-semibold text-ok-dark">
              <span aria-hidden className="msr text-[17px]">check_circle</span>
              {t('wp.aplicado', { name: execution.by.nombre, when: fmtFecha(execution.finishedAt, true) })}
            </p>
            {execution.detail && <p className="text-[12.5px] text-ink-2">{execution.detail}</p>}
            {execution.rows && <RowChanges rows={execution.rows} requested={proposal.operations} />}
            <Labeled label={t('wp.cache')}>{proposal.cache}</Labeled>
            {execution.reversal && <ReversalNote reversal={execution.reversal} />}
            {isAdmin && !proposal.reverseOf && (execution.reversal?.operations.length ?? 0) > 0 && (
              <button onClick={() => void run(() => createReverseProposal(ids))} disabled={busy} className={secondary}>
                {t('wp.prepararReversa')}
              </button>
            )}
          </>
        )}

        {status === 'aborted' && (
          <>
            <p className="break-words rounded-lg bg-warn-bg px-3 py-2 text-[13px] leading-snug text-warn-dark">
              {t('wp.noSeAplico')} {execution?.detail}
            </p>
            {rehearseButton(t('wp.ensayarDeNuevo'))}
          </>
        )}

        {status === 'unknown' && (
          <>
            <p className="break-words rounded-lg bg-danger-bg px-3 py-2 text-[13px] font-semibold leading-snug text-danger">{execution?.detail ?? t('wp.desconocido')}</p>
            {execution?.rows && <RowChanges rows={execution.rows} requested={proposal.operations} />}
          </>
        )}

        {failed && <p className="text-[12.5px] leading-snug text-warn-dark">{failed}</p>}
      </div>
    </section>
  );
}

function useWritesSwitch(isAdmin: boolean): boolean {
  const doc = useDoc<InvestigatorWritesSwitch>(isAdmin ? 'investigator/writes' : null);
  return doc?.data.enabled === true;
}

/** What Claude proposed changing in production. The most recent one is the one in play. */
export function WriteProposals({ id, report, canFollowUp }: { id: string; report: InvestigationReport | null | undefined; canFollowUp: boolean }) {
  const t = useT();
  const rows = useWriteProposals(id);
  const replaced = rows.filter((row) => row.data.status === 'superseded');
  const inPlay = rows.filter((row) => row.data.status !== 'superseded');
  const problems = report?.proposalProblems ?? [];
  if (rows.length === 0 && problems.length === 0) return null;
  return (
    <div className="mt-4 space-y-3">
      {problems.length > 0 && (
        <div className="rounded-[10px] bg-warn-bg px-3.5 py-2.5 text-[13px] leading-snug text-warn-dark">
          <p className="font-semibold">{t('wp.noLlego')}</p>
          <ul className="mt-1 list-disc pl-4">
            {problems.map((problem) => <li key={problem} className="break-words">{problem}</li>)}
          </ul>
        </div>
      )}
      {inPlay.map((row) => (
        <ProposalCard key={row.id} investigationId={id} row={row} canFollowUp={canFollowUp} />
      ))}
      {replaced.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12.5px] font-semibold text-warm-gray hover:text-ink touch:min-h-10 [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="msr text-[16px] transition-transform duration-150 group-open:rotate-90">chevron_right</span>
            {t(replaced.length === 1 ? 'wp.reemplazadaUna' : 'wp.reemplazadas', { n: replaced.length })}
          </summary>
          <div className="mt-2 space-y-2.5 pl-1">
            {replaced.map((row) => (
              <div key={row.id}>
                <p className="mb-1 text-[12.5px] text-ink-2">{row.data.reason}</p>
                <SqlBlock proposal={row.data} />
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
