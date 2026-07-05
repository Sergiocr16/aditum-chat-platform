'use client';

import { useState } from 'react';
import type { Client, Ticket } from '@aditum-chat/shared';
import { categoryLabel, formatTicketNumber } from '@aditum-chat/shared';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import {
  fmtFecha,
  fmtRelativo,
  iniciales,
  useContact,
  useContactTickets,
  useDoc,
  useResolvedConversations,
  type Row,
} from '@/lib/data';
import { toggleContactTag, useTags } from '@/lib/data-tags';
import { TicketEstadoChip } from './chips';
import { EtiquetasBlock } from './TagAssign';
import { TicketDetailModal } from './TicketDetailModal';

export function ContextPanel({
  contactId,
  onScrollToConversation,
  width,
}: {
  contactId: string;
  /** Sube el hilo continuo a una conversación anterior (sin reabrirla). */
  onScrollToConversation?(convId: string): void;
  /** Ancho controlado (columna redimensionable del inbox). */
  width?: number;
}) {
  const { agent } = useAuth();
  const t = useT();
  const contact = useContact(contactId);
  const tickets = useContactTickets(contactId);
  const anteriores = useResolvedConversations(contactId);
  const client = useDoc<Client>(contact?.data.clientId ? `clients/${contact.data.clientId}` : null);
  const siteTags = useTags(contact?.data.siteId ?? null);
  const idioma = agent?.idioma ?? 'es';
  const [ticketSel, setTicketSel] = useState<Row<Ticket> | null>(null);

  if (!contact) return null;
  const c = contact.data;
  const asignadas = new Set(c.tags ?? []);
  const tagsAsignados = siteTags.filter((tg) => asignadas.has(tg.id));

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
      {/* Identidad del residente */}
      <div className="p-4 flex items-start gap-3 border-b border-cream-3">
        <div className="h-10 w-10 rounded-full flex-none flex items-center justify-center text-[13px] font-bold bg-navy text-white">
          {iniciales(c.nombre)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-bold leading-tight truncate">{c.nombre}</div>
          {c.email && <div className="text-[11.5px] text-warm-gray truncate mt-0.5">{c.email}</div>}
          <div className="flex gap-1.5 mt-2 flex-wrap">
            {c.rol && (
              <span className="text-[9px] font-bold tracking-wide bg-cream-2 text-ink-2 px-1.5 py-0.5 rounded">
                {c.rol.toUpperCase()}
              </span>
            )}
            <span className="text-[9px] font-bold tracking-wide bg-tag-blue-bg text-navy px-1.5 py-0.5 rounded">
              {c.siteId.replace(/-/g, ' ').toUpperCase()}
            </span>
          </div>
        </div>
      </div>

      {/* Cliente / condominio */}
      {client && (
        <Section title={t('ctx.cliente')}>
          <div className="flex items-center gap-2">
            <span className="msr text-[17px] text-warm-gray-2 flex-none">apartment</span>
            <span className="text-[12.5px] font-semibold truncate">{client.data.nombre}</span>
          </div>
          {clienteMeta && (
            <div className="text-[11px] text-warm-gray mt-1.5 leading-relaxed">{clienteMeta}</div>
          )}
        </Section>
      )}

      {/* Tickets previos — clic abre el detalle del ticket */}
      {tickets.length > 0 && (
        <Section title={t('ctx.ticketsPrevios')} count={tickets.length}>
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

      {/* Conversaciones anteriores — clic abre la conversación completa */}
      {anteriores.length > 0 && (
        <Section title={t('inbox.convAnteriores')} count={anteriores.length}>
          <div className="flex flex-col gap-0.5">
            {anteriores.map((cv) => (
              <button
                key={cv.id}
                onClick={() => onScrollToConversation?.(cv.id)}
                title={t('inbox.verCompleta')}
                className="group w-full text-left rounded-lg px-2 -mx-2 py-2 outline-none transition-colors hover:bg-cream-1 focus-visible:bg-cream-1"
              >
                <div className="flex items-center gap-1.5">
                  <span className="msr text-[15px] text-warm-gray-3 group-hover:text-navy flex-none">
                    forum
                  </span>
                  <span className="text-[9px] font-bold tracking-wide bg-cream-2 text-warm-gray px-1.5 py-0.5 rounded-full">
                    {categoryLabel(cv.data.categoria, idioma).toUpperCase() || '—'}
                  </span>
                  <span className="text-[10px] text-warm-gray-2 ml-auto flex-none">
                    {fmtFecha(cv.data.resueltaAt ?? cv.data.updatedAt)}
                  </span>
                </div>
                {cv.data.lastMessage?.texto && (
                  <div className="text-[11px] text-warm-gray truncate mt-1 pl-[21px]">
                    {cv.data.lastMessage.texto}
                  </div>
                )}
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* Etiquetas del residente (catálogo por sitio) */}
      <Section title={t('ctx.etiquetas')} count={tagsAsignados.length || undefined}>
        <EtiquetasBlock
          siteTags={siteTags}
          asignados={asignadas}
          onToggle={(id, add) => toggleContactTag(contact.id, id, add)}
          addLabel={t('ctx.agregarEtiqueta')}
          emptyLabel={t('ctx.sinEtiquetasSitio')}
        />
      </Section>

      {/* Atributos rápidos */}
      <Section title={t('ctx.atributos')} last>
        <dl className="text-[11.5px] flex flex-col gap-2">
          <Atributo label={t('ctx.ultimaSesion')} value={fmtRelativo(c.lastActivity)} />
          {c.csatPromedio && (
            <Atributo label={t('ctx.csatPromedio')} value={`${c.csatPromedio} ★`} />
          )}
        </dl>
      </Section>

      {ticketSel && <TicketDetailModal ticket={ticketSel} onClose={() => setTicketSel(null)} />}
    </aside>
  );
}

/** Encabezado de sección consistente: micro-label + contador opcional. */
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

function Atributo({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-warm-gray flex-none">{label}</dt>
      <dd className="font-medium text-right text-ink-2 min-w-0 truncate">{value}</dd>
    </div>
  );
}
