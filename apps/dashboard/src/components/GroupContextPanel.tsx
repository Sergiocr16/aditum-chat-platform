'use client';

import { useState } from 'react';
import type { Client, Conversation, Ticket } from '@aditum-chat/shared';
import { formatTicketNumber } from '@aditum-chat/shared';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { iniciales, useClientTickets, useDoc, type Row } from '@/lib/data';
import { toggleClientTag, useTags } from '@/lib/data-tags';
import { TicketEstadoChip } from './chips';
import { EtiquetasBlock } from './TagAssign';
import { TicketDetailModal } from './TicketDetailModal';

/**
 * Panel de contexto para conversaciones de EQUIPO (grupo). En vez de un residente
 * muestra el condominio: participantes, etiquetas del cliente y sus tickets.
 */
export function GroupContextPanel({ conv, width }: { conv: Row<Conversation>; width?: number }) {
  const { agent } = useAuth();
  const t = useT();
  const c = conv.data;
  const client = useDoc<Client>(c.clientId ? `clients/${c.clientId}` : null);
  const siteTags = useTags(c.siteId);
  const tickets = useClientTickets(c.clientId ?? null);
  const idioma = agent?.idioma ?? 'es';
  const [ticketSel, setTicketSel] = useState<Row<Ticket> | null>(null);

  const asignadas = new Set(client?.data.tags ?? []);
  const participantes = Object.entries(c.participantesInfo ?? {});
  const clienteMeta = client
    ? [
        client.data.ubicacion,
        client.data.filiales ? `${client.data.filiales} filiales` : null,
        client.data.plan ? `Plan ${client.data.plan}` : null,
        client.data.clienteDesde ? `cliente desde ${client.data.clienteDesde}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <aside
      className="hidden lg:flex flex-col w-[280px] flex-none bg-white overflow-y-auto"
      style={width ? { width } : undefined}
    >
      {/* Identidad del equipo */}
      <div className="p-4 flex items-start gap-3 border-b border-cream-3">
        <div className="h-10 w-10 rounded-full flex-none flex items-center justify-center bg-navy-deep text-white">
          <span className="msr text-[20px]">groups</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-bold leading-tight truncate">
            {c.clientNombre ?? t('ctx.equipo')}
          </div>
          <div className="text-[11.5px] text-warm-gray truncate mt-0.5">{t('ctx.equipo')}</div>
          <div className="flex gap-1.5 mt-2 flex-wrap">
            <span className="text-[9px] font-bold tracking-wide bg-tag-blue-bg text-navy px-1.5 py-0.5 rounded">
              {c.siteId.replace(/-/g, ' ').toUpperCase()}
            </span>
          </div>
        </div>
      </div>

      {/* Cliente / condominio */}
      {client && clienteMeta && (
        <Section title={t('ctx.cliente')}>
          <div className="flex items-center gap-2">
            <span className="msr text-[17px] text-warm-gray-2 flex-none">apartment</span>
            <span className="text-[12.5px] font-semibold truncate">{client.data.nombre}</span>
          </div>
          <div className="text-[11px] text-warm-gray mt-1.5 leading-relaxed">{clienteMeta}</div>
        </Section>
      )}

      {/* Etiquetas del condominio */}
      <Section title={t('ctx.etiquetas')} count={asignadas.size || undefined}>
        <EtiquetasBlock
          siteTags={siteTags}
          asignados={asignadas}
          onToggle={(id, add) => {
            if (c.clientId) toggleClientTag(c.clientId, id, add);
          }}
          addLabel={t('ctx.agregarEtiqueta')}
          emptyLabel={t('ctx.sinEtiquetasSitio')}
        />
      </Section>

      {/* Participantes del equipo */}
      {participantes.length > 0 && (
        <Section title={t('ctx.participantes')} count={participantes.length}>
          <div className="flex flex-col gap-2">
            {participantes.map(([id, p]) => (
              <div key={id} className="flex items-center gap-2.5">
                <div
                  className={`h-7 w-7 rounded-full flex-none flex items-center justify-center text-[10px] font-bold ${
                    p.tipo === 'agent' ? 'bg-navy text-white' : 'bg-cream-3 text-ink-2'
                  }`}
                >
                  {iniciales(p.nombre)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-semibold truncate">{p.nombre}</div>
                  <div className="text-[10.5px] text-warm-gray-2 truncate">
                    {p.tipo === 'agent' ? 'Soporte' : (p.rol ?? '—')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Tickets del condominio — clic abre el detalle */}
      {tickets.length > 0 && (
        <Section title={t('ctx.ticketsCliente')} count={tickets.length} last>
          <div className="flex flex-col">
            {tickets.slice(0, 6).map((tk) => (
              <button
                key={tk.id}
                onClick={() => setTicketSel(tk)}
                className="group flex items-center gap-2 w-full text-left rounded-lg px-2 -mx-2 py-1.5 outline-none transition-colors hover:bg-cream-1 focus-visible:bg-cream-1"
              >
                <span className="font-mono text-[11px] font-semibold text-warm-gray-2 flex-none">
                  {formatTicketNumber(tk.data.numero)}
                </span>
                <span className="text-[12px] text-ink truncate flex-1">{tk.data.asunto}</span>
                <TicketEstadoChip estado={tk.data.estado} idioma={idioma} />
                <span className="msr text-[16px] text-warm-gray-3 group-hover:text-navy flex-none">
                  chevron_right
                </span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {ticketSel && <TicketDetailModal ticket={ticketSel} onClose={() => setTicketSel(null)} />}
    </aside>
  );
}

function Section({
  title,
  count,
  last,
  children,
}: {
  title: string;
  count?: number;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`px-4 py-3.5 ${last ? '' : 'border-b border-cream-3'}`}>
      <div className="flex items-center gap-1.5 mb-2.5">
        <span className="text-[9.5px] font-bold tracking-wider text-warm-gray-2">{title}</span>
        {count != null && (
          <span className="text-[9px] font-bold text-warm-gray-2 bg-cream-2 rounded-full min-w-[16px] h-4 px-1 inline-flex items-center justify-center">
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
