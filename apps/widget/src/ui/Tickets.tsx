import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Ticket, TicketEvent, WidgetSessionResponse } from '@aditum-chat/shared';
import {
  formatTicketNumber,
  makeT,
  ticketPriorityLabels,
  ticketStatusLabels,
  widgetMessages,
} from '@aditum-chat/shared';
import {
  subscribeMyTickets,
  subscribeSystemTickets,
  subscribeTicketHistory,
  timeAgo,
  toDate,
  type Doc,
} from '../data.js';
import type { WidgetFirebase } from '../firebase.js';

type Tab = 'mis' | 'sistema';
type SubFiltro = 'todos' | 'abiertos' | 'resueltos';

interface Props {
  fb: WidgetFirebase;
  session: WidgetSessionResponse;
  ticketId?: string | null;
  onSelect(ticketId: string | null): void;
}

export function Tickets({ fb, session, ticketId, onSelect }: Props) {
  const t = makeT(widgetMessages, session.idioma);
  const [tab, setTab] = useState<Tab>('mis');
  const [filtro, setFiltro] = useState<SubFiltro>('todos');
  const [mios, setMios] = useState<Doc<Ticket>[]>([]);
  const [sistema, setSistema] = useState<Doc<Ticket>[]>([]);

  useEffect(() => subscribeMyTickets(fb, session, setMios), [fb, session]);
  useEffect(() => subscribeSystemTickets(fb, setSistema), [fb]);

  const lista = useMemo(() => {
    const base = tab === 'mis' ? mios : sistema;
    return base.filter((tk) =>
      filtro === 'todos'
        ? true
        : filtro === 'resueltos'
          ? tk.data.estado === 'resuelto'
          : tk.data.estado !== 'resuelto',
    );
  }, [tab, filtro, mios, sistema]);

  const seleccionado = [...mios, ...sistema].find((tk) => tk.id === ticketId);
  if (seleccionado) {
    return (
      <TicketDetail
        fb={fb}
        session={session}
        ticket={seleccionado}
        onBack={() => onSelect(null)}
      />
    );
  }

  return (
    <div class="ac-tickets">
      <div class="ac-tk-tabs">
        {(
          [
            ['mis', t('tickets.mis')],
            ['sistema', t('tickets.delSistema')],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} class={`ac-tk-tab ${tab === k ? 'ac-tk-tab-on' : ''}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      <div class="ac-tk-filtros">
        {(
          [
            ['todos', t('tickets.todos')],
            ['abiertos', t('tickets.abiertos')],
            ['resueltos', t('tickets.resueltos')],
          ] as [SubFiltro, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            class={`ac-pill ${filtro === k ? 'ac-pill-on' : ''}`}
            onClick={() => setFiltro(k)}
          >
            {label}
          </button>
        ))}
      </div>

      <div class="ac-tk-lista">
        {lista.map((tk) => (
          <button key={tk.id} class="ac-tk-card" onClick={() => onSelect(tk.id)}>
            <div class="ac-tk-card-top">
              <span class="ac-mono">{formatTicketNumber(tk.data.numero)}</span>
              {tk.data.ambito === 'sistema' && <span class="ac-icon ac-tk-public">public</span>}
              <span class={`ac-chip ac-chip-prio-${tk.data.prioridad}`}>
                {ticketPriorityLabels[session.idioma][tk.data.prioridad]}
              </span>
              <span class={`ac-chip ac-chip-${tk.data.estado}`}>
                {ticketStatusLabels[session.idioma][tk.data.estado]}
              </span>
            </div>
            <div class="ac-tk-card-asunto">{tk.data.asunto}</div>
            <div class="ac-tk-card-meta">
              {tk.data.ambito === 'sistema'
                ? t('tickets.afectaVarios')
                : tk.data.estado === 'resuelto'
                  ? t('tickets.resueltoPor', {
                      nombre: tk.data.asignadoNombre ?? '—',
                      fecha: fecha(tk.data.resueltoAt ?? tk.data.updatedAt, session.idioma),
                    })
                  : tk.data.asignadoNombre
                    ? t('tickets.asignadoA', {
                        nombre: tk.data.asignadoNombre,
                        hace: timeAgo(tk.data.updatedAt, session.idioma),
                      })
                    : timeAgo(tk.data.updatedAt, session.idioma)}
            </div>
          </button>
        ))}
        {lista.length === 0 && <div class="ac-vacio">—</div>}
      </div>
    </div>
  );
}

function TicketDetail({
  fb,
  session,
  ticket,
  onBack,
}: {
  fb: WidgetFirebase;
  session: WidgetSessionResponse;
  ticket: Doc<Ticket>;
  onBack(): void;
}) {
  const t = makeT(widgetMessages, session.idioma);
  const [eventos, setEventos] = useState<Doc<TicketEvent>[]>([]);
  useEffect(() => subscribeTicketHistory(fb, ticket.id, setEventos), [fb, ticket.id]);

  return (
    <div class="ac-tk-detalle">
      <button class="ac-tk-volver" onClick={onBack}>
        <span class="ac-icon">arrow_back</span>
        {formatTicketNumber(ticket.data.numero)}
      </button>
      <div class="ac-tk-d-head">
        <span class={`ac-chip ac-chip-prio-${ticket.data.prioridad}`}>
          {ticketPriorityLabels[session.idioma][ticket.data.prioridad]}
        </span>
        <span class={`ac-chip ac-chip-${ticket.data.estado}`}>
          {ticketStatusLabels[session.idioma][ticket.data.estado]}
        </span>
      </div>
      <div class="ac-tk-d-asunto">{ticket.data.asunto}</div>

      <div class="ac-tk-d-datos">
        <div>
          <div class="ac-label">{t('tickets.detalle.asignadoA')}</div>
          <div>{ticket.data.asignadoNombre ?? '—'}</div>
        </div>
        <div>
          <div class="ac-label">{t('tickets.detalle.creado')}</div>
          <div>{fecha(ticket.data.createdAt, session.idioma, true)}</div>
        </div>
        <div>
          <div class="ac-label">{t('tickets.detalle.origen')}</div>
          <div>{ticket.data.conversationId ? t('tickets.detalle.origenChat') : '—'}</div>
        </div>
      </div>

      <div class="ac-tk-d-timeline">
        {eventos.map((e) => (
          <div key={e.id} class="ac-tl-item">
            <span class="ac-tl-dot" />
            <div>
              <div class="ac-tl-desc">{e.data.descripcion}</div>
              <div class="ac-tl-meta">{fecha(e.data.createdAt, session.idioma, true)}</div>
            </div>
          </div>
        ))}
      </div>

      {ticket.data.resolucion && (
        <div class="ac-tk-d-resolucion">
          <span class="ac-icon">task_alt</span>
          {ticket.data.resolucion.texto}
        </div>
      )}

      <div class="ac-tk-d-aviso">
        <span class="ac-icon">visibility</span>
        {t('tickets.detalle.soloLectura')}
      </div>
    </div>
  );
}

function fecha(ts: unknown, idioma: 'es' | 'en', conHora = false): string {
  const d = toDate(ts);
  if (!d) return '';
  const loc = idioma === 'es' ? 'es-CR' : 'en-US';
  const f = d.toLocaleDateString(loc, { day: 'numeric', month: 'short' });
  return conHora
    ? `${f}, ${d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', hour12: false })}`
    : f;
}
