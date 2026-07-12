'use client';

import { useMemo, useState } from 'react';
import type { Conversation, Idioma, Ticket } from '@aditum-chat/shared';
import { categoryLabel, formatTicketNumber } from '@aditum-chat/shared';
import { fmtFecha, type Row } from '@/lib/data';
import { PrioridadChip, TicketEstadoChip } from './chips';

/**
 * Lista del panel de contexto con: filtro por tipo (chips), scroll con
 * max-height y paginación "ver más". Se usa para conversaciones anteriores y
 * tickets previos, en el panel de residente y el de equipo.
 */
export function PanelLista<T>({
  items,
  keyDe,
  render,
  filtroDe,
  etiquetaFiltro,
  filtroSelect,
  idioma,
  pageSize = 6,
  maxH = 'max-h-[260px]',
  gap = 'gap-0.5',
}: {
  items: T[];
  keyDe(item: T): string;
  render(item: T): React.ReactNode;
  /** Clave de filtro por ítem (categoría, estado…). Omitir = sin filtro. */
  filtroDe?(item: T): string | undefined;
  /** Etiqueta legible de una clave de filtro. */
  etiquetaFiltro?(key: string): string;
  /** Filtro como dropdown (select) en vez de chips (útil con muchas opciones). */
  filtroSelect?: boolean;
  idioma: Idioma;
  pageSize?: number;
  maxH?: string;
  /** Separación entre ítems (más aire para cards). */
  gap?: string;
}) {
  const [filtro, setFiltro] = useState<string | null>(null);
  const [visibles, setVisibles] = useState(pageSize);

  const claves = useMemo(() => {
    if (!filtroDe) return [];
    const s = new Set<string>();
    for (const it of items) {
      const k = filtroDe(it);
      if (k) s.add(k);
    }
    return [...s];
  }, [items, filtroDe]);

  const filtrados = useMemo(
    () => (filtro && filtroDe ? items.filter((i) => filtroDe(i) === filtro) : items),
    [items, filtro, filtroDe],
  );
  const mostrados = filtrados.slice(0, visibles);

  const reset = (k: string | null) => {
    setFiltro(k);
    setVisibles(pageSize);
  };

  return (
    <div className="flex flex-col gap-2">
      {claves.length > 1 &&
        (filtroSelect ? (
          <select
            value={filtro ?? ''}
            onChange={(e) => reset(e.target.value || null)}
            className="w-full border border-warm-border rounded-lg px-2 py-1.5 text-[11.5px] text-ink bg-white outline-none focus:border-navy"
          >
            <option value="">{idioma === 'es' ? 'Todas las categorías' : 'All categories'}</option>
            {claves.map((k) => (
              <option key={k} value={k}>
                {etiquetaFiltro ? etiquetaFiltro(k) : k}
              </option>
            ))}
          </select>
        ) : (
          <div className="flex flex-wrap gap-1">
            <Chip active={!filtro} onClick={() => reset(null)}>
              {idioma === 'es' ? 'Todas' : 'All'}
            </Chip>
            {claves.map((k) => (
              <Chip key={k} active={filtro === k} onClick={() => reset(k)}>
                {etiquetaFiltro ? etiquetaFiltro(k) : k}
              </Chip>
            ))}
          </div>
        ))}
      <div className={`${maxH} overflow-y-auto flex flex-col ${gap} -mx-1 px-1`}>
        {mostrados.map((it) => (
          <div key={keyDe(it)}>{render(it)}</div>
        ))}
      </div>
      {filtrados.length > visibles && (
        <button
          onClick={() => setVisibles((v) => v + pageSize)}
          className="self-start text-[11px] font-semibold text-navy hover:underline px-1"
        >
          {idioma === 'es' ? 'Ver más' : 'Show more'} ({filtrados.length - visibles})
        </button>
      )}
    </div>
  );
}

/**
 * Fila del historial de conversaciones resueltas: categoría, CSAT, fecha, y un
 * menú (3 puntos) con "Crear ticket" + los tickets ya asociados (puede haber
 * varios). El menú se expande inline para no cortarse con el scroll del panel.
 */
export function ConvHistorialRow({
  cv,
  idioma,
  tickets,
  abierto,
  onMenu,
  onAbrir,
  onCrearTicket,
  onVerTicket,
  verCompleta,
}: {
  cv: Row<Conversation>;
  idioma: Idioma;
  tickets: Row<Ticket>[];
  abierto: boolean;
  onMenu(): void;
  onAbrir(): void;
  onCrearTicket(): void;
  onVerTicket(tk: Row<Ticket>): void;
  verCompleta: string;
}) {
  return (
    <div className="rounded-lg transition-colors hover:bg-cream-1">
      <div className="group flex items-center">
        <button
          onClick={onAbrir}
          title={verCompleta}
          className="flex-1 min-w-0 text-left px-2 py-2 outline-none"
        >
          <div className="flex items-center gap-1.5">
            {/* Las conversaciones del canal bot se diferencian de las de agente. */}
            {cv.data.subcanal === 'bot' ? (
              <>
                <span className="msr text-[15px] text-ai flex-none">smart_toy</span>
                <span className="text-[9px] font-bold tracking-wide bg-ai-bg text-ai px-1.5 py-0.5 rounded-full flex-none">
                  BOT
                </span>
              </>
            ) : (
              <>
                <span className="msr text-[15px] text-warm-gray-3 group-hover:text-navy flex-none">
                  forum
                </span>
                <span className="text-[9px] font-bold tracking-wide bg-cream-2 text-warm-gray px-1.5 py-0.5 rounded-full truncate">
                  {categoryLabel(cv.data.categoria, idioma).toUpperCase() || '—'}
                </span>
              </>
            )}
            <EstrellasCsat rating={cv.data.csatRating} />
            {tickets.length > 0 && (
              <span
                className="msr text-[13px] text-navy flex-none"
                title={`${tickets.length} ticket(s)`}
              >
                confirmation_number
              </span>
            )}
            <span className="text-[10px] text-warm-gray-2 ml-auto flex-none">
              {fmtFecha(cv.data.resueltaAt ?? cv.data.updatedAt)}
            </span>
          </div>
        </button>
        <button
          onClick={onMenu}
          aria-label={idioma === 'es' ? 'Opciones' : 'Options'}
          className={`flex-none p-1.5 mr-1 rounded-md hover:bg-cream-2 ${
            abierto ? 'text-navy' : 'text-warm-gray-3 hover:text-navy'
          }`}
        >
          <span className="msr text-[16px]">more_vert</span>
        </button>
      </div>
      {abierto && (
        <div className="px-2 pb-2 pt-0.5 flex flex-col gap-0.5">
          <button
            onClick={onCrearTicket}
            className="flex items-center gap-1.5 text-left text-[12px] px-2 py-1.5 rounded-md hover:bg-cream-2"
          >
            <span className="msr text-[15px] text-navy">add</span>
            {idioma === 'es' ? 'Crear ticket para la conversación' : 'Create ticket for this conversation'}
          </button>
          {tickets.map((tk) => (
            <button
              key={tk.id}
              onClick={() => onVerTicket(tk)}
              className="flex items-center gap-1.5 text-left text-[12px] px-2 py-1.5 rounded-md hover:bg-cream-2"
            >
              <span className="msr text-[15px] text-warm-gray-3 flex-none">confirmation_number</span>
              <span className="font-mono font-semibold text-warm-gray-2 flex-none">
                {formatTicketNumber(tk.data.numero)}
              </span>
              <span className="truncate text-ink">{tk.data.asunto}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Ticket como card: número + estado, asunto, prioridad · asignado · fecha. */
export function TicketCard({
  tk,
  idioma,
  onClick,
}: {
  tk: Row<Ticket>;
  idioma: Idioma;
  onClick(): void;
}) {
  return (
    <button
      onClick={onClick}
      className="group w-full text-left rounded-lg border border-warm-border bg-white px-2.5 py-1.5 shadow-card hover:border-navy/60 hover:shadow-raised transition-all outline-none focus-visible:border-navy"
    >
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[10.5px] font-bold text-navy flex-none">
          {formatTicketNumber(tk.data.numero)}
        </span>
        <span className="text-[12px] font-semibold text-ink truncate flex-1">{tk.data.asunto}</span>
        <TicketEstadoChip estado={tk.data.estado} idioma={idioma} />
      </div>
      <div className="flex items-center gap-1.5 mt-1 text-[10px] text-warm-gray-2">
        <PrioridadChip prioridad={tk.data.prioridad} idioma={idioma} />
        {tk.data.asignadoNombre && <span className="truncate">{tk.data.asignadoNombre}</span>}
        <span className="ml-auto flex-none">{fmtFecha(tk.data.updatedAt)}</span>
      </div>
    </button>
  );
}

/** Calificación CSAT compacta, formato "4 ★" (número + una estrella). */
export function EstrellasCsat({ rating }: { rating?: number }) {
  if (!rating) return null;
  const n = Number.isInteger(rating) ? rating : Number(rating.toFixed(1));
  return (
    <span
      className="inline-flex items-center gap-0.5 flex-none text-[10.5px] font-bold"
      style={{ color: '#E3A93C' }}
      title={`CSAT ${n}/5`}
      aria-label={`CSAT ${n}/5`}
    >
      {n}
      <span className="msr text-[12px] leading-none" style={{ fontVariationSettings: "'FILL' 1" }}>
        star
      </span>
    </span>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[9.5px] font-bold tracking-wide px-2 py-0.5 rounded-full transition-colors ${
        active ? 'bg-navy text-white' : 'bg-cream-2 text-warm-gray hover:bg-cream-3'
      }`}
    >
      {children}
    </button>
  );
}
