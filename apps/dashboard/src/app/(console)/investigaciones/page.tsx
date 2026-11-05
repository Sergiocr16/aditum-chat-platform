'use client';

// Every investigation across chats. They're requested from a chat, so this page only reads them.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Conversation, Investigation } from '@aditum-chat/shared';
import {
  InvestigationDetail,
  InvestigationFilters,
  InvestigationRow,
  matchesInvestigationFilters,
  sourceLabel,
  TOKEN_WARNING_DAYS,
  type InvestigationFilter as Filter,
} from '@/components/InvestigationPanel';
import { useSiteFilter } from '@/components/Shell';
import { fmtFecha, useDoc, type Row } from '@/lib/data';
import { useInvestigationList, useInvestigationStats, useRunnerOnline, type InvestigationStats } from '@/lib/data-investigations';
import { useT } from '@/lib/i18n';

const PAGE_SIZE = 50;

/** Who the chat is with. Older investigations didn't save it, so theirs comes from the conversation. */
function useChatLabel(investigation: Investigation): string {
  const saved = sourceLabel(investigation);
  const conv = useDoc<Conversation>(saved ? null : `conversations/${investigation.conversationId}`);
  if (saved) return saved;
  return conv ? [conv.data.contactNombre, conv.data.clientNombre].filter(Boolean).join(' · ') : '';
}

function ListRow({ row, selected, onOpen }: { row: Row<Investigation>; selected: boolean; onOpen(): void }) {
  return <InvestigationRow row={row} chat={useChatLabel(row.data)} selected={selected} onOpen={onOpen} />;
}

function Origin({ row }: { row: Row<Investigation> }) {
  const t = useT();
  const router = useRouter();
  // The detail already shows the saved one.
  const chat = useChatLabel(row.data);
  const shown = sourceLabel(row.data) ? '' : chat;
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-2">
      {shown}
      <button
        onClick={() => router.push(`/inbox?c=${encodeURIComponent(row.data.conversationId)}&inv=${encodeURIComponent(row.id)}`)}
        className="inline-flex items-center gap-0.5 font-semibold text-navy hover:underline touch:min-h-10"
      >
        {t('inv.irAlChat')}
        <span className="msr text-[15px]">arrow_forward</span>
      </button>
    </p>
  );
}

const OUTCOMES = [
  { filter: 'confirmadas', stat: 'confirmed', swatch: 'bg-ok' },
  { filter: 'hipotesis', stat: 'hypothesis', swatch: 'bg-warn' },
  { filter: 'sinDeterminar', stat: 'undetermined', swatch: 'bg-warm-gray-4' },
] as const;

function OutcomeFilter({
  label,
  count,
  swatch,
  active,
  onClick,
}: {
  label: string;
  count: number;
  swatch?: string;
  active: boolean;
  onClick(): void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[12px] text-ink-2 hover:bg-cream-1 focus-visible:outline-2 focus-visible:outline-navy touch:min-h-9 touch:px-2 ${
        active ? 'bg-cream-2 font-semibold text-ink' : ''
      }`}
    >
      {swatch && <span aria-hidden className={`h-2 w-2 flex-none rounded-[2px] ${swatch}`} />}
      {label}
      <span className="font-semibold tabular-nums text-ink">{count}</span>
    </button>
  );
}

/** Whether the analyzer is up, and how investigations have turned out. Picking an outcome filters the list. */
function StatsStrip({
  runner,
  stats,
  error,
  filter,
  onFilter,
  className,
}: {
  runner: ReturnType<typeof useRunnerOnline>;
  stats: InvestigationStats | null;
  error: boolean;
  filter: Filter;
  onFilter(filter: Filter): void;
  className: string;
}) {
  const t = useT();
  const finished = stats ? stats.confirmed + stats.hypothesis + stats.undetermined : 0;
  const toggle = (value: Filter) => onFilter(filter === value ? 'todas' : value);

  return (
    <section
      aria-label={t('inv.panel.region')}
      className={`flex-none flex-wrap items-center gap-x-8 gap-y-3 border-b border-warm-border bg-white px-4 py-3 ${className}`}
    >
      <div className="w-full sm:w-auto sm:max-w-[300px]">
        <p className="flex items-center gap-2 text-[13px] font-bold text-ink">
          <span aria-hidden className={`h-2 w-2 flex-none rounded-full ${runner.online ? 'bg-ok' : 'bg-warn'}`} />
          {t(runner.online ? 'inv.panel.conectado' : 'inv.panel.desconectado')}
        </p>
        <p className={`mt-0.5 pl-4 text-[12px] ${runner.online ? 'text-warm-gray' : 'text-warn-dark'}`}>
          {!runner.online
            ? runner.lastSeenAt
              ? t('inv.panel.ultimaSenal', { fecha: fmtFecha(runner.lastSeenAt, true) })
              : t('inv.panel.enCola')
            : stats && stats.active > 0
              ? t('inv.panel.enCurso', { n: stats.active })
              : t('inv.panel.listo')}
        </p>
        {runner.online && runner.tokenDaysLeft !== null && runner.tokenDaysLeft < TOKEN_WARNING_DAYS && (
          <p className="mt-0.5 pl-4 text-[12px] text-warn-dark">{t('inv.tokenVence', { n: runner.tokenDaysLeft })}</p>
        )}
      </div>

      {error ? (
        <p className="text-[12.5px] text-warn-dark">{t('inv.panel.error')}</p>
      ) : stats && finished === 0 && stats.noResult === 0 ? (
        <p className="text-[12.5px] text-warm-gray">{t('inv.panel.vacio')}</p>
      ) : (
        stats && (
          <div className="flex min-w-0 flex-1 basis-[420px] flex-wrap items-center gap-x-6 gap-y-2">
            {finished > 0 && (
              <p className="flex-none">
                <span className="block text-[15px] font-bold leading-tight text-ink">
                  {t('inv.panel.pctConfirmadas', { n: Math.round((stats.confirmed / finished) * 100) })}
                </span>
                <span className="text-[12px] text-warm-gray">{t('inv.panel.deTerminadas', { n: finished })}</span>
              </p>
            )}
            <div className="min-w-[240px] flex-1">
              {finished > 0 && (
                <div
                  role="img"
                  aria-label={t('inv.panel.barra', { a: stats.confirmed, b: stats.hypothesis, c: stats.undetermined })}
                  className="mb-1.5 flex h-2 gap-[2px] overflow-hidden rounded-full"
                >
                  {OUTCOMES.filter(({ stat }) => stats[stat] > 0).map(({ filter: value, stat, swatch }) => (
                    <span
                      key={stat}
                      title={`${t(`inv.filtro.${value}`)}: ${stats[stat]} (${Math.round((stats[stat] / finished) * 100)}%)`}
                      style={{ flexGrow: stats[stat] }}
                      className={`basis-0 ${swatch}`}
                    />
                  ))}
                </div>
              )}
              <div className="-mx-1.5 flex flex-wrap items-center gap-x-1 gap-y-0.5">
                {OUTCOMES.map(({ filter: value, stat, swatch }) => (
                  <OutcomeFilter
                    key={stat}
                    label={t(`inv.filtro.${value}`)}
                    count={stats[stat]}
                    swatch={swatch}
                    active={filter === value}
                    onClick={() => toggle(value)}
                  />
                ))}
                {stats.noResult > 0 && (
                  <OutcomeFilter
                    label={t('inv.panel.sinResultado')}
                    count={stats.noResult}
                    active={filter === 'sinResultado'}
                    onClick={() => toggle('sinResultado')}
                  />
                )}
              </div>
            </div>
          </div>
        )
      )}
    </section>
  );
}

export default function InvestigacionesPage() {
  const t = useT();
  const { siteId } = useSiteFilter();
  const list = useInvestigationList(null, PAGE_SIZE);
  const [filter, setFilter] = useState<Filter>('todas');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useDoc<Investigation>(selectedId ? `investigations/${selectedId}` : null);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const runner = useRunnerOnline(now);

  const rows = useMemo(
    () => list.rows.filter(({ data }) => (!siteId || data.siteId === siteId) && matchesInvestigationFilters(data, filter, search)),
    [list.rows, siteId, filter, search],
  );

  const hasAny = list.rows.length > 0;
  const refreshKey = useMemo(() => list.rows.map((r) => `${r.id}:${r.data.status}`).join(), [list.rows]);
  const { stats, error: statsError } = useInvestigationStats(siteId ?? null, refreshKey);

  return (
    // On a phone the list gets the whole page: the state, the title and the filters scroll away with it.
    <div className={`flex h-full min-h-0 flex-col ${selectedId ? '' : 'overflow-y-auto md:overflow-visible'}`}>
      <StatsStrip
        runner={runner}
        stats={stats}
        error={statsError}
        filter={filter}
        onFilter={setFilter}
        className={selectedId ? 'hidden md:flex' : 'flex'}
      />
      <div className={`flex md:min-h-0 md:flex-1 ${selectedId ? 'min-h-0 flex-1' : 'flex-none'}`}>
      <div className={`min-h-0 w-full flex-none flex-col border-r border-warm-border bg-white md:flex md:w-[380px] ${selectedId ? 'hidden' : 'flex'}`}>
        <header className="flex-none border-b border-cream-3 px-4 pb-3 pt-4">
          <h1 className="text-[19px] font-bold text-ink">{t('inv.titulo')}</h1>
          <InvestigationFilters search={search} onSearch={setSearch} filter={filter} onFilter={setFilter} />
        </header>

        <div className="md:min-h-0 md:flex-1 md:overflow-y-auto">
          {list.error ? (
            <p className="p-4 text-[12.5px] text-warn-dark">{t('inv.errorLista')}</p>
          ) : list.loading ? null : !hasAny ? (
            <div className="p-4 text-[12.5px] text-warm-gray">
              <p className="font-semibold text-ink-2">{t('inv.vacioTodas')}</p>
              <p className="mt-1 leading-relaxed">{t('inv.comoEmpezar')}</p>
            </div>
          ) : rows.length === 0 ? (
            <p className="p-4 text-[12.5px] text-warm-gray">{t('inv.sinCoincidencias')}</p>
          ) : (
            <ul>
              {rows.map((row) => (
                <li key={row.id}>
                  <ListRow row={row} selected={selectedId === row.id} onOpen={() => setSelectedId(row.id)} />
                </li>
              ))}
            </ul>
          )}
          {list.hasMore && (
            <button onClick={list.loadMore} className="w-full py-3 text-[12.5px] font-semibold text-navy hover:bg-cream-1">
              {t('inv.cargarMas')}
            </button>
          )}
        </div>
      </div>

      <div className={`min-h-0 min-w-0 flex-1 flex-col bg-white p-4 sm:p-6 md:flex ${selectedId ? 'flex' : 'hidden'}`}>
        {selectedId && (
          <button
            onClick={() => setSelectedId(null)}
            className="mb-2 flex flex-none items-center gap-1 self-start text-[12.5px] font-semibold text-warm-gray hover:text-ink md:hidden touch:-mt-2 touch:mb-0 touch:min-h-10 touch:pr-2"
          >
            <span className="msr text-[17px]">arrow_back</span>
            {t('inv.volver')}
          </button>
        )}
        {selected?.id === selectedId && selected ? (
          <InvestigationDetail key={selected.id} row={selected} origin={<Origin row={selected} />} />
        ) : (
          !selectedId && (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <span className="msr text-[34px] text-warm-gray-3">troubleshoot</span>
              <p className="mt-2 text-[14px] font-bold text-ink">{t('inv.elegi')}</p>
              <p className="mt-1 max-w-[42ch] text-[12.5px] leading-relaxed text-warm-gray">{t('inv.elegiAyuda')}</p>
            </div>
          )
        )}
      </div>
      </div>
    </div>
  );
}
