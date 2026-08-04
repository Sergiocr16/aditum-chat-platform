'use client';

import { useMemo, useState } from 'react';
import type { Client, Group, Ticket } from '@aditum-chat/shared';
import { categoryLabel, ticketStatusLabels } from '@aditum-chat/shared';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { ConvHistorialRow, PanelLista, TicketCard } from './PanelLista';
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
import type { Conversation } from '@aditum-chat/shared';
import { toggleContactTag, useTags } from '@/lib/data-tags';
import { ConvertTicketModal } from './ConvertTicketModal';
import { GroupClientsList } from './GroupClientsList';
import { EtiquetasBlock } from './TagAssign';
import { TicketDetailModal } from './TicketDetailModal';

export function ContextPanel({
  contactId,
  onScrollToConversation,
  onTicketCreado,
  width,
  abierto,
  onClose,
  colapsado,
}: {
  contactId: string;
  /** Sube el hilo continuo a una conversación anterior (sin reabrirla). */
  onScrollToConversation?(convId: string): void;
  /** Tras crear un ticket de una conversación: refresca su bloque y salta a ella. */
  onTicketCreado?(convId: string): void;
  /** Ancho controlado (columna redimensionable del inbox). */
  width?: number;
  /** Mobile drawer: open state + close callback (below lg; static panel at lg+). */
  abierto?: boolean;
  onClose?(): void;
  /** Escritorio: oculta el panel (el drawer móvil sigue funcionando). */
  colapsado?: boolean;
}) {
  const { agent } = useAuth();
  const t = useT();
  const contact = useContact(contactId);
  const tickets = useContactTickets(contactId);
  const anteriores = useResolvedConversations(contactId);
  const client = useDoc<Client>(contact?.data.clientId ? `clients/${contact.data.clientId}` : null);
  const group = useDoc<Group>(contact?.data.groupId ? `groups/${contact.data.groupId}` : null);
  const siteTags = useTags(contact?.data.siteId ?? null);
  const idioma = agent?.idioma ?? 'es';
  const [ticketSel, setTicketSel] = useState<Row<Ticket> | null>(null);
  const [convConvertir, setConvConvertir] = useState<Row<Conversation> | null>(null);
  const [menuConv, setMenuConv] = useState<string | null>(null);
  // Tickets ya creados desde cada conversación (pueden ser varios).
  const ticketsPorConv = useMemo(() => {
    const m = new Map<string, Row<Ticket>[]>();
    for (const tk of tickets) {
      const cid = tk.data.conversationId;
      if (cid) (m.get(cid) ?? m.set(cid, []).get(cid)!).push(tk);
    }
    return m;
  }, [tickets]);

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
      className={`${abierto ? 'flex' : 'hidden'} ${colapsado ? 'lg:hidden' : 'lg:flex'} fixed inset-y-0 right-0 z-40 w-full max-w-sm shadow-2xl lg:static lg:z-auto lg:w-[280px] lg:max-w-none lg:shadow-none flex-col flex-none bg-white overflow-y-auto`}
      style={width ? { width } : undefined}
    >
      {/* Franja plum tras el status bar del teléfono (texto iOS en blanco). */}
      <div className="lg:hidden flex-none bg-navy-deep h-[env(safe-area-inset-top)]" />
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

      {/* CLIENTE = el grupo (la organización que tiene todo). Muestra solo la
          cantidad de condominios que administra; la lista se despliega. */}
      {(c.groupId || group) && (
        <Section title={t('ctx.cliente')}>
          <div className="flex items-center gap-2">
            <span className="msr text-[17px] text-warm-gray-2 flex-none">groups</span>
            <span className="text-[12.5px] font-semibold truncate">
              {group?.data.name ?? c.groupName ?? c.groupId}
            </span>
          </div>
          <GroupClientsList
            clients={group?.data.clients ?? []}
            label={t('ctx.groupClientsCount', { n: group?.data.clients?.length ?? 0 })}
          />
        </Section>
      )}

      {/* Condominio del contacto (solo cuando no pertenece a un grupo). */}
      {client && !c.groupId && (
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

      {/* Tickets previos — clic abre el detalle del ticket */}
      {tickets.length > 0 && (
        <Section title={t('ctx.ticketsPrevios')} count={tickets.length}>
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

      {/* Conversaciones anteriores — clic abre la conversación completa */}
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
