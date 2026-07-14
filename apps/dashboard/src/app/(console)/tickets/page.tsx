'use client';

// Módulo Tickets — diseño 1g. Tabla con filtros + modal de detalle (1n).

import { useMemo, useState } from 'react';
import type { Idioma, Ticket, TicketPriority, TicketStatus } from '@aditum-chat/shared';
import {
  formatTicketNumber,
  makeT,
  ticketPriorityLabels,
  ticketStatusLabels,
} from '@aditum-chat/shared';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { useSiteFilter } from '@/components/Shell';
import { iniciales, useSites, useTeam, useTickets, type Row } from '@/lib/data';
import { PrioridadChip, SitioChip, SlaChip, TicketEstadoChip } from '@/components/chips';
import { TicketDetailModal } from '@/components/TicketDetailModal';

const M = {
  es: {
    estado: 'Estado',
    prioridad: 'Prioridad',
    agente: 'Agente',
    todos: 'Todos',
    todas: 'Todas',
    buscar: 'Buscá por asunto o número…',
    sinAsignar: 'Sin asignar',
    vacio: 'No hay tickets que coincidan con los filtros',
  },
  en: {
    estado: 'Status',
    prioridad: 'Priority',
    agente: 'Agent',
    todos: 'All',
    todas: 'All',
    buscar: 'Search by subject or number…',
    sinAsignar: 'Unassigned',
    vacio: 'No tickets match the filters',
  },
} satisfies Record<Idioma, Record<string, string>>;

const ESTADOS: TicketStatus[] = ['abierto', 'en_progreso', 'en_desarrollo', 'resuelto', 'pendiente'];
const PRIORIDADES: TicketPriority[] = ['alta', 'media', 'baja'];
const POR_PAGINA = 10;

export default function TicketsPage() {
  const { agent } = useAuth();
  const t = useT();
  const { siteId } = useSiteFilter();
  const idioma: Idioma = agent?.idioma ?? 'es';
  const m = useMemo(() => makeT(M, idioma), [idioma]);

  const [estado, setEstado] = useState('');
  const [prioridad, setPrioridad] = useState('');
  const [agenteId, setAgenteId] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [pagina, setPagina] = useState(0);
  const [sel, setSel] = useState<Row<Ticket> | null>(null);

  const tickets = useTickets({
    estado: estado || undefined,
    prioridad: prioridad || undefined,
    asignadoA: agenteId || undefined,
    siteId: siteId ?? undefined,
  });
  const team = useTeam();
  const sites = useSites();
  const siteNombre = useMemo(
    () => Object.fromEntries(sites.map((s) => [s.id, s.data.nombre])),
    [sites],
  );

  // Búsqueda client-side por asunto o número (#TK-0042, TK-0042, 42…).
  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return tickets;
    return tickets.filter(
      (tk) =>
        tk.data.asunto.toLowerCase().includes(q) ||
        formatTicketNumber(tk.data.numero).toLowerCase().includes(q) ||
        String(tk.data.numero).includes(q.replace(/^#?tk-?0*/i, '')),
    );
  }, [tickets, busqueda]);

  // Paginación client-side (10 por página sobre los ≤100 cargados).
  const total = filtrados.length;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const paginaActual = Math.min(pagina, totalPaginas - 1);
  const desde = paginaActual * POR_PAGINA;
  const visibles = filtrados.slice(desde, desde + POR_PAGINA);

  function resetPagina<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPagina(0);
    };
  }

  const selectCls =
    'border border-warm-border rounded-lg bg-white px-2.5 py-1.5 text-[12px] font-medium text-ink-2 outline-none focus:border-navy cursor-pointer';

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <header className="flex items-center gap-2 flex-wrap">
        <h1 className="text-[19px] font-bold mr-2">{t('tickets.titulo')}</h1>

        <select
          value={estado}
          onChange={(e) => resetPagina(setEstado)(e.target.value)}
          title={m('estado')}
          className={selectCls}
        >
          <option value="">
            {m('estado')}: {m('todos')}
          </option>
          {ESTADOS.map((es) => (
            <option key={es} value={es}>
              {ticketStatusLabels[idioma][es]}
            </option>
          ))}
        </select>

        <select
          value={prioridad}
          onChange={(e) => resetPagina(setPrioridad)(e.target.value)}
          title={m('prioridad')}
          className={selectCls}
        >
          <option value="">
            {m('prioridad')}: {m('todas')}
          </option>
          {PRIORIDADES.map((p) => (
            <option key={p} value={p}>
              {ticketPriorityLabels[idioma][p]}
            </option>
          ))}
        </select>

        <select
          value={agenteId}
          onChange={(e) => resetPagina(setAgenteId)(e.target.value)}
          title={m('agente')}
          className={selectCls}
        >
          <option value="">
            {m('agente')}: {m('todos')}
          </option>
          {team
            .filter((x) => x.data.activo)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.data.nombre}
              </option>
            ))}
        </select>

        <div className="relative w-full sm:w-auto sm:ml-auto">
          <span className="msr text-[16px] text-warm-gray-2 absolute left-2.5 top-1/2 -translate-y-1/2">
            search
          </span>
          <input
            value={busqueda}
            onChange={(e) => resetPagina(setBusqueda)(e.target.value)}
            placeholder={m('buscar')}
            className="w-full sm:w-60 border border-warm-border rounded-lg bg-white pl-8 pr-3 py-1.5 text-[12px] outline-none focus:border-navy"
          />
        </div>
      </header>

      <div className="mt-4 bg-white rounded-lg border border-warm-border shadow-card overflow-hidden">
        {/* Mobile: card list (the 8-column table is unusable on a phone) */}
        <div className="md:hidden divide-y divide-cream-3">
          {visibles.map((tk) => (
            <button
              key={tk.id}
              onClick={() => setSel(tk)}
              className="w-full text-left px-4 py-3 hover:bg-cream-0 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[12px] font-semibold text-navy">
                  {formatTicketNumber(tk.data.numero)}
                </span>
                {tk.data.publico && (
                  <span className="msr text-[14px] text-warm-gray-2" title={t('ticket.publico')}>
                    public
                  </span>
                )}
                <span className="ml-auto flex-none">
                  <TicketEstadoChip estado={tk.data.estado} idioma={idioma} />
                </span>
              </div>
              <div className="text-[13px] font-semibold text-ink mt-1 line-clamp-2">
                {tk.data.asunto}
              </div>
              <div className="text-[11.5px] text-warm-gray mt-0.5 truncate">
                {tk.data.clientNombre ?? tk.data.groupName ?? '—'}
                {tk.data.asignadoNombre ? ` · ${tk.data.asignadoNombre}` : ''}
              </div>
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                <SitioChip nombre={siteNombre[tk.data.siteId] ?? tk.data.siteId} />
                <PrioridadChip prioridad={tk.data.prioridad} idioma={idioma} />
                <SlaChip sla={tk.data.sla} idioma={idioma} />
              </div>
            </button>
          ))}
          {visibles.length === 0 && (
            <div className="px-4 py-10 text-center text-[12.5px] text-warm-gray-2">
              {m('vacio')}
            </div>
          )}
        </div>

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-cream-3">
                <Th>{t('tickets.col.numero')}</Th>
                <Th>{t('tickets.col.asunto')}</Th>
                <Th>{t('tickets.col.cliente')}</Th>
                <Th>{t('tickets.col.estado')}</Th>
                <Th>{t('tickets.col.prioridad')}</Th>
                <Th>{t('tickets.col.agente')}</Th>
                <Th>{t('tickets.col.sla')}</Th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((tk) => (
                <tr
                  key={tk.id}
                  onClick={() => setSel(tk)}
                  className="border-b border-cream-3 last:border-0 cursor-pointer hover:bg-cream-0 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-[12px] font-semibold text-navy whitespace-nowrap">
                    {formatTicketNumber(tk.data.numero)}
                  </td>
                  <td className="px-4 py-3 text-[13px] font-semibold text-ink max-w-[260px]">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate">{tk.data.asunto}</span>
                      {tk.data.publico && (
                        <span
                          className="msr text-[14px] text-warm-gray-2 flex-none"
                          title={t('ticket.publico')}
                        >
                          public
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[12.5px] text-ink-2 whitespace-nowrap">
                    {tk.data.clientNombre ?? tk.data.groupName ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <TicketEstadoChip estado={tk.data.estado} idioma={idioma} />
                  </td>
                  <td className="px-4 py-3">
                    <PrioridadChip prioridad={tk.data.prioridad} idioma={idioma} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {tk.data.asignadoNombre ? (
                      <span className="flex items-center gap-2">
                        <span className="h-6 w-6 rounded-full bg-cream-3 text-ink-2 text-[9px] font-bold flex items-center justify-center flex-none">
                          {iniciales(tk.data.asignadoNombre)}
                        </span>
                        <span className="text-[12.5px] text-ink-2">{tk.data.asignadoNombre}</span>
                      </span>
                    ) : (
                      <span className="text-[12px] text-warm-gray-3">{m('sinAsignar')}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <SlaChip sla={tk.data.sla} idioma={idioma} />
                  </td>
                </tr>
              ))}
              {visibles.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-[12.5px] text-warm-gray-2">
                    {m('vacio')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer de paginación */}
        <div className="px-4 py-3 border-t border-cream-3 flex items-center justify-between">
          <span className="text-[11.5px] text-warm-gray">
            {t('tickets.mostrando', {
              desde: total === 0 ? 0 : desde + 1,
              hasta: Math.min(desde + POR_PAGINA, total),
              total,
            })}
          </span>
          <div className="flex items-center gap-1">
            <BotonPagina
              icon="chevron_left"
              disabled={paginaActual === 0}
              onClick={() => setPagina(paginaActual - 1)}
            />
            <BotonPagina
              icon="chevron_right"
              disabled={paginaActual >= totalPaginas - 1}
              onClick={() => setPagina(paginaActual + 1)}
            />
          </div>
        </div>
      </div>

      {sel && <TicketDetailModal ticket={sel} onClose={() => setSel(null)} />}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-[10px] font-bold tracking-wider text-warm-gray-2 whitespace-nowrap">
      {children}
    </th>
  );
}

function BotonPagina({
  icon,
  disabled,
  onClick,
}: {
  icon: string;
  disabled: boolean;
  onClick(): void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="h-7 w-7 rounded-lg border border-warm-border flex items-center justify-center text-warm-gray hover:border-navy hover:text-navy disabled:opacity-35 disabled:pointer-events-none"
    >
      <span className="msr text-[17px]">{icon}</span>
    </button>
  );
}
