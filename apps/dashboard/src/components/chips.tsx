'use client';

// Chips pill reutilizables del módulo Tickets (diseño 1g / 1n).

import type { Idioma, SlaEstado, TicketPriority, TicketSla, TicketStatus } from '@aditum-chat/shared';
import { slaEstadoLabels, ticketPriorityLabels, ticketStatusLabels } from '@aditum-chat/shared';
import { tagChipStyle } from '@/lib/data-tags';

/** Etiqueta de contacto con color hex libre. `onRemove` muestra la × para quitarla. */
export function TagChip({
  nombre,
  color,
  onRemove,
}: {
  nombre: string;
  color: string;
  onRemove?: () => void;
}) {
  const s = tagChipStyle(color);
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap"
      style={{ backgroundColor: s.backgroundColor, color: s.color, borderColor: s.borderColor }}
    >
      {nombre}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="msr text-[13px] -mr-0.5 leading-none opacity-70 hover:opacity-100"
          aria-label="Quitar etiqueta"
        >
          close
        </button>
      )}
    </span>
  );
}

const base =
  'inline-flex items-center gap-1 text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap';

const ESTADO_STYLES: Record<TicketStatus, string> = {
  abierto: 'bg-gold-bg text-warn-dark',
  en_progreso: 'bg-tag-blue-bg text-navy',
  en_desarrollo: 'bg-ai-bg text-ai',
  resuelto: 'bg-ok-bg text-ok-dark',
  pendiente: 'bg-warn-bg text-warn-dark',
};

export function TicketEstadoChip({ estado, idioma }: { estado: TicketStatus; idioma: Idioma }) {
  return <span className={`${base} ${ESTADO_STYLES[estado]}`}>{ticketStatusLabels[idioma][estado]}</span>;
}

const PRIORIDAD_STYLES: Record<TicketPriority, string> = {
  alta: 'bg-danger-bg text-danger',
  media: 'bg-warn-bg text-warn-dark',
  baja: 'bg-cream-2 text-warm-gray',
};

export function PrioridadChip({ prioridad, idioma }: { prioridad: TicketPriority; idioma: Idioma }) {
  return (
    <span className={`${base} ${PRIORIDAD_STYLES[prioridad]}`}>
      {ticketPriorityLabels[idioma][prioridad]}
    </span>
  );
}

export function SitioChip({ nombre }: { nombre: string }) {
  return (
    <span className="inline-flex text-[8.5px] font-bold tracking-wider bg-tag-blue-bg text-navy px-1.5 py-0.5 rounded whitespace-nowrap">
      {nombre.toUpperCase()}
    </span>
  );
}

const SLA_STYLES: Record<SlaEstado, string> = {
  en_sla: 'bg-ok-bg text-ok-dark',
  por_vencer: 'bg-warn-bg text-warn-dark',
  vencido: 'bg-danger-bg text-danger',
  cumplido: 'bg-ok-bg text-ok-dark',
  pausado: 'bg-cream-2 text-warm-gray',
};

const SLA_ICONS: Partial<Record<SlaEstado, string>> = {
  por_vencer: 'schedule',
  cumplido: 'check_circle',
};

export function SlaChip({ sla, idioma }: { sla?: TicketSla | null; idioma: Idioma }) {
  if (!sla) return <span className="text-[11px] text-warm-gray-3">—</span>;
  const icon = SLA_ICONS[sla.estado];
  return (
    <span className={`${base} ${SLA_STYLES[sla.estado]}`}>
      {icon && <span className="msr text-[12px]">{icon}</span>}
      {slaEstadoLabels[idioma][sla.estado]}
    </span>
  );
}
