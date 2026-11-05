'use client';

// Every investigation across chats. They're requested from a chat, so this page only reads them.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Conversation, Investigation } from '@aditum-chat/shared';
import { InvestigationDetail, InvestigationStatusChip } from '@/components/InvestigationPanel';
import { useSiteFilter } from '@/components/Shell';
import { fmtFecha, useDoc, type Row } from '@/lib/data';
import { useInvestigationList, useRunnerOnline } from '@/lib/data-investigations';
import { useT } from '@/lib/i18n';

const PAGE_SIZE = 50;

type Filter = 'todas' | 'enCurso' | 'confirmadas' | 'sinConfirmar' | 'sinResultado';
const FILTERS: Filter[] = ['todas', 'enCurso', 'confirmadas', 'sinConfirmar', 'sinResultado'];

function matchesFilter({ status, report }: Investigation, filter: Filter): boolean {
  switch (filter) {
    case 'todas':
      return true;
    case 'enCurso':
      return status === 'queued' || status === 'running';
    case 'confirmadas':
      return status === 'done' && report?.conclusion === 'confirmed';
    case 'sinConfirmar':
      return status === 'done' && report?.conclusion !== 'confirmed';
    case 'sinResultado':
      return status === 'failed' || status === 'rate_limited' || status === 'cancelled';
  }
}

/** Who the chat is with. Investigations don't store it, so it comes from their conversation. */
function useChatLabel(conversationId: string): string {
  const conv = useDoc<Conversation>(`conversations/${conversationId}`);
  if (!conv) return '';
  return [conv.data.contactNombre, conv.data.clientNombre].filter(Boolean).join(' · ');
}

function ListRow({ row, selected, onOpen }: { row: Row<Investigation>; selected: boolean; onOpen(): void }) {
  const chat = useChatLabel(row.data.conversationId);
  return (
    <button
      onClick={onOpen}
      aria-current={selected}
      className={`w-full border-b border-cream-3 px-4 py-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ai ${
        selected ? 'bg-ai-bg' : 'hover:bg-cream-1'
      }`}
    >
      <span className="line-clamp-2 text-[13px] font-semibold leading-snug text-ink">{row.data.question}</span>
      {chat && <span className="mt-0.5 block truncate text-[12px] text-ink-2">{chat}</span>}
      <span className="mt-1.5 flex items-center gap-1.5">
        <InvestigationStatusChip row={row} />
        <span className="truncate text-[11px] text-warm-gray">
          {fmtFecha(row.data.createdAt, true)} · {row.data.requestedBy.nombre}
        </span>
      </span>
    </button>
  );
}

function Origin({ row }: { row: Row<Investigation> }) {
  const t = useT();
  const router = useRouter();
  const chat = useChatLabel(row.data.conversationId);
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-2">
      {chat}
      <button
        onClick={() => router.push(`/inbox?c=${encodeURIComponent(row.data.conversationId)}&inv=${encodeURIComponent(row.id)}`)}
        className="inline-flex items-center gap-0.5 font-semibold text-navy hover:underline"
      >
        {t('inv.irAlChat')}
        <span className="msr text-[15px]">arrow_forward</span>
      </button>
    </p>
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

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return list.rows.filter(
      ({ data }) =>
        (!siteId || data.siteId === siteId) &&
        matchesFilter(data, filter) &&
        (!term || data.question.toLowerCase().includes(term) || data.requestedBy.nombre.toLowerCase().includes(term)),
    );
  }, [list.rows, siteId, filter, search]);

  const hasAny = list.rows.length > 0;

  return (
    <div className="flex h-full min-h-0">
      <div className={`min-h-0 w-full flex-none flex-col border-r border-warm-border bg-white md:flex md:w-[380px] ${selectedId ? 'hidden' : 'flex'}`}>
        <header className="flex-none border-b border-cream-3 px-4 pb-3 pt-4">
          <h1 className="text-[19px] font-bold text-ink">{t('inv.titulo')}</h1>
          <div className="relative mt-2.5">
            <span className="msr pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[17px] text-warm-gray">search</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('inv.buscar')}
              aria-label={t('inv.buscar')}
              className="w-full rounded-lg border border-warm-border bg-cream-0 py-1.5 pl-8 pr-2.5 text-[12.5px] outline-none focus:border-ai"
            />
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {FILTERS.map((value) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
                className={`rounded-full border px-2.5 py-1 text-[11.5px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy ${
                  filter === value ? 'border-navy bg-navy text-white' : 'border-warm-border text-ink-2 hover:border-navy'
                }`}
              >
                {t(`inv.filtro.${value}`)}
              </button>
            ))}
          </div>
        </header>

        {!runner.online && (
          <p className="flex-none bg-warn-bg px-4 py-2 text-[12px] text-warn-dark">{t('inv.desconectado')}</p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
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
            className="mb-2 flex flex-none items-center gap-1 self-start text-[12.5px] font-semibold text-warm-gray hover:text-ink md:hidden"
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
  );
}
