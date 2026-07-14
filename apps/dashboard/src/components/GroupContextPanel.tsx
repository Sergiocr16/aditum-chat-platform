'use client';

import { useMemo, useState } from 'react';
import type { Client, Conversation, Group, Ticket } from '@aditum-chat/shared';
import { categoryLabel, ticketStatusLabels } from '@aditum-chat/shared';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { ConvHistorialRow, PanelLista, TicketCard } from './PanelLista';
import {
  fmtFecha,
  iniciales,
  useClientTickets,
  useDoc,
  useResolvedGroupConversations,
  type Row,
} from '@/lib/data';
import { toggleClientTag, toggleGroupTag, useTags } from '@/lib/data-tags';
import { ConvertTicketModal } from './ConvertTicketModal';
import { GroupClientsList } from './GroupClientsList';
import { EtiquetasBlock } from './TagAssign';
import { TicketDetailModal } from './TicketDetailModal';

/**
 * Panel de contexto para conversaciones de EQUIPO (grupo). En vez de un residente
 * muestra la organización: condominios que administra, participantes y tickets.
 */
export function GroupContextPanel({
  conv,
  width,
  onScrollToConversation,
  onTicketCreado,
  abierto,
  onClose,
}: {
  conv: Row<Conversation>;
  width?: number;
  onScrollToConversation?(convId: string): void;
  onTicketCreado?(convId: string): void;
  /** Mobile drawer: open state + close callback (below lg; static panel at lg+). */
  abierto?: boolean;
  onClose?(): void;
}) {
  const { agent } = useAuth();
  const t = useT();
  const c = conv.data;
  const group = useDoc<Group>(c.groupId ? `groups/${c.groupId}` : null);
  const client = useDoc<Client>(c.clientId ? `clients/${c.clientId}` : null);
  const siteTags = useTags(c.siteId);
  const tickets = useClientTickets(c.clientId ?? null);
  const anteriores = useResolvedGroupConversations(c.groupId ?? null);
  const idioma = agent?.idioma ?? 'es';
  const [ticketSel, setTicketSel] = useState<Row<Ticket> | null>(null);
  const [convConvertir, setConvConvertir] = useState<Row<Conversation> | null>(null);
  const [menuConv, setMenuConv] = useState<string | null>(null);
  const ticketsPorConv = useMemo(() => {
    const m = new Map<string, Row<Ticket>[]>();
    for (const tk of tickets) {
      const cid = tk.data.conversationId;
      if (cid) (m.get(cid) ?? m.set(cid, []).get(cid)!).push(tk);
    }
    return m;
  }, [tickets]);

  const asignadas = new Set(client?.data.tags ?? []);
  const groupTags = new Set(group?.data.tags ?? []);
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
      className={`${abierto ? 'flex' : 'hidden'} lg:flex fixed inset-y-0 right-0 z-40 w-full max-w-sm shadow-2xl lg:static lg:z-auto lg:w-[280px] lg:max-w-none lg:shadow-none flex-col flex-none bg-white overflow-y-auto`}
      style={width ? { width } : undefined}
    >
      {/* Franja plum tras el status bar del teléfono (texto iOS en blanco). */}
      <div className="lg:hidden flex-none bg-navy-deep h-[env(safe-area-inset-top)]" />
      {/* Identidad del equipo */}
      <div className="p-4 flex items-start gap-3 border-b border-cream-3">
        <div className="h-10 w-10 rounded-full flex-none flex items-center justify-center bg-navy-deep text-white">
          <span className="msr text-[20px]">groups</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-bold leading-tight truncate">
            {c.groupName ?? c.clientNombre ?? t('ctx.equipo')}
          </div>
          <div className="text-[11.5px] text-warm-gray truncate mt-0.5">{t('ctx.equipo')}</div>
          <div className="flex gap-1.5 mt-2 flex-wrap">
            <span className="text-[9px] font-bold tracking-wide bg-tag-blue-bg text-navy px-1.5 py-0.5 rounded">
              {c.siteId.replace(/-/g, ' ').toUpperCase()}
            </span>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            title="Cerrar"
            className="lg:hidden text-warm-gray-2 hover:text-ink flex-none"
          >
            <span className="msr text-[18px]">close</span>
          </button>
        )}
      </div>

      {/* Condominios que administra el grupo: conteo + lista desplegable. */}
      {(group?.data.clients?.length ?? 0) > 0 && (
        <Section title={t('ctx.groupClients')} count={group!.data.clients.length}>
          <GroupClientsList
            clients={group!.data.clients}
            label={t('ctx.groupClientsCount', { n: group!.data.clients.length })}
          />
        </Section>
      )}

      {/* Etiquetas del grupo */}
      {c.groupId && (
        <Section title={t('ctx.etiquetas')} count={groupTags.size || undefined}>
          <EtiquetasBlock
            siteTags={siteTags}
            asignados={groupTags}
            onToggle={(id, add) => {
              if (c.groupId) toggleGroupTag(c.groupId, id, add);
            }}
            addLabel={t('ctx.agregarEtiqueta')}
            emptyLabel={t('ctx.sinEtiquetasSitio')}
          />
        </Section>
      )}

      {/* Cliente / condominio (conversaciones legacy clavadas a un cliente) */}
      {client && clienteMeta && (
        <Section title={t('ctx.cliente')}>
          <div className="flex items-center gap-2">
            <span className="msr text-[17px] text-warm-gray-2 flex-none">apartment</span>
            <span className="text-[12.5px] font-semibold truncate">{client.data.nombre}</span>
          </div>
          <div className="text-[11px] text-warm-gray mt-1.5 leading-relaxed">{clienteMeta}</div>
        </Section>
      )}

      {/* Etiquetas del condominio (solo si la conversación tiene cliente) */}
      {c.clientId && (
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
      )}

      {/* Tickets del condominio — clic abre el detalle */}
      {tickets.length > 0 && (
        <Section title={t('ctx.ticketsCliente')} count={tickets.length}>
          <PanelLista
            items={tickets}
            idioma={idioma}
            gap="gap-1.5"
            keyDe={(tk) => tk.id}
            filtroDe={(tk) => tk.data.estado}
            etiquetaFiltro={(k) => ticketStatusLabels[idioma][k as Ticket['estado']]}
            render={(tk) => <TicketCard tk={tk} idioma={idioma} onClick={() => setTicketSel(tk)} />}
          />
        </Section>
      )}

      {/* Conversaciones anteriores del equipo — clic abre el segmento completo */}
      {anteriores.length > 0 && (
        <Section title={t('inbox.convAnteriores')} count={anteriores.length}>
          <PanelLista
            items={anteriores}
            idioma={idioma}
            keyDe={(cv) => cv.id}
            filtroDe={(cv) => cv.data.categoria || undefined}
            etiquetaFiltro={(k) => categoryLabel(k, idioma)}
            filtroSelect
            render={(cv) => (
              <ConvHistorialRow
                cv={cv}
                idioma={idioma}
                tickets={ticketsPorConv.get(cv.id) ?? []}
                abierto={menuConv === cv.id}
                onMenu={() => setMenuConv((p) => (p === cv.id ? null : cv.id))}
                onAbrir={() => onScrollToConversation?.(cv.id)}
                onCrearTicket={() => {
                  setConvConvertir(cv);
                  setMenuConv(null);
                }}
                onVerTicket={(tk) => {
                  setTicketSel(tk);
                  setMenuConv(null);
                }}
                verCompleta={t('inbox.verCompleta')}
              />
            )}
          />
        </Section>
      )}

      {/* Participantes del equipo */}
      {participantes.length > 0 && (
        <Section title={t('ctx.participantes')} count={participantes.length} last>
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

      {ticketSel && <TicketDetailModal ticket={ticketSel} onClose={() => setTicketSel(null)} />}
      {convConvertir && (
        <ConvertTicketModal
          conv={convConvertir}
          onClose={() => setConvConvertir(null)}
          onCreado={() => onTicketCreado?.(convConvertir.id)}
        />
      )}
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
