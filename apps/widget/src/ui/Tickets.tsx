import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Ticket, TicketEvent, WidgetSessionResponse } from '@aditum-chat/shared';
import {
  formatTicketNumber,
  makeT,
  ticketStatusLabels,
  widgetMessages,
} from '@aditum-chat/shared';
import {
  subscribeGroupTickets,
  subscribeMyTickets,
  subscribeSystemTickets,
  subscribeTicketHistory,
  timeAgo,
  toDate,
  type Doc,
} from '../data.js';
import type { WidgetFirebase } from '../firebase.js';

type Tab = 'mis' | 'grupo' | 'sistema';
type SubFiltro = 'todos' | 'abiertos' | 'resueltos';

interface Props {
  fb: WidgetFirebase;
  session: WidgetSessionResponse;
  ticketId?: string | null;
  onSelect(ticketId: string | null): void;
  /** Cierra todo el panel del widget (X del header, igual que en el chat). */
  onClose?(): void;
  /** Mobile: back arrow on the left (→ list) + close on the right, same contract
      as the chat header. Desktop right pane passes false to keep the single `‹`. */
  mostrarVolver?: boolean;
}

export function Tickets({ fb, session, ticketId, onSelect, onClose, mostrarVolver = true }: Props) {
  const t = makeT(widgetMessages, session.idioma);
  const [tab, setTab] = useState<Tab>('mis');
  const [filtro, setFiltro] = useState<SubFiltro>('todos');
  const [mios, setMios] = useState<Doc<Ticket>[]>([]);
  const [grupo, setGrupo] = useState<Doc<Ticket>[]>([]);
  const [sistema, setSistema] = useState<Doc<Ticket>[]>([]);

  useEffect(() => subscribeMyTickets(fb, session, setMios), [fb, session]);
  useEffect(() => subscribeGroupTickets(fb, session, setGrupo), [fb, session]);
  useEffect(() => subscribeSystemTickets(fb, setSistema), [fb]);

  const lista = useMemo(() => {
    const base = tab === 'mis' ? mios : tab === 'grupo' ? grupo : sistema;
    return base.filter((tk) =>
      filtro === 'todos'
        ? true
        : filtro === 'resueltos'
          ? tk.data.estado === 'resuelto'
          : tk.data.estado !== 'resuelto',
    );
  }, [tab, filtro, mios, grupo, sistema]);

  const seleccionado = [...mios, ...grupo, ...sistema].find((tk) => tk.id === ticketId);
  if (seleccionado) {
    return (
      <TicketDetail
        fb={fb}
        session={session}
        ticket={seleccionado}
        onBack={() => onSelect(null)}
        onClose={onClose}
        mostrarVolver={mostrarVolver}
      />
    );
  }

  return (
    <div class="ac-tickets">
      <div class="ac-tk-tabs">
        {(
          [
            ['mis', t('tickets.mis')],
            ...(session.groupId ? [['grupo', t('tickets.deMiGrupo')]] : []),
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
              {tk.data.ambito === 'grupo' && <span class="ac-icon ac-tk-public">groups</span>}
              <span class={`ac-chip ac-chip-${tk.data.estado}`}>
                {ticketStatusLabels[session.idioma][tk.data.estado]}
              </span>
            </div>
            <div class="ac-tk-card-asunto">{tk.data.asunto}</div>
            <div class="ac-tk-card-meta">
              {tk.data.ambito === 'sistema'
                ? t('tickets.afectaVarios')
                : tk.data.ambito === 'grupo'
                  ? (tk.data.groupName ?? t('tickets.delGrupo'))
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
        {lista.length === 0 && (
          <div class="ac-tk-vacio">
            <div class="ac-tk-vacio-ico">
              <span class="ac-icon">confirmation_number</span>
            </div>
            <div class="ac-tk-vacio-tit">{t('tickets.vacioTitulo')}</div>
            <div class="ac-tk-vacio-sub">
              {filtro === 'resueltos'
                ? t('tickets.vacioResueltos')
                : filtro === 'abiertos'
                  ? t('tickets.vacioAbiertos')
                  : tab === 'sistema'
                    ? t('tickets.vacioSistemaSub')
                    : tab === 'grupo'
                      ? t('tickets.vacioGrupoSub')
                      : t('tickets.vacioMisSub')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TicketDetail({
  fb,
  session,
  ticket,
  onBack,
  onClose,
  mostrarVolver = true,
}: {
  fb: WidgetFirebase;
  session: WidgetSessionResponse;
  ticket: Doc<Ticket>;
  onBack(): void;
  onClose?(): void;
  mostrarVolver?: boolean;
}) {
  const t = makeT(widgetMessages, session.idioma);
  const [eventos, setEventos] = useState<Doc<TicketEvent>[]>([]);
  useEffect(() => subscribeTicketHistory(fb, ticket.id, setEventos), [fb, ticket.id]);
  const d = ticket.data;
  // Ticket público ajeno (grupo/sistema): no revelar de dónde se originó —
  // solo descripción y progresión de estados.
  const esAjeno = d.contactId !== session.contactId;
  const eventosVisibles = esAjeno
    ? eventos.filter((e) => e.data.tipo === 'estado' || e.data.tipo === 'resolucion')
    : eventos;

  return (
    <div class="ac-tk-detalle">
      {/* Header estilo chat: volver (←) a la lista + asunto/estado + cerrar.
          En el panel derecho de escritorio (mostrarVolver=false) queda solo `‹`. */}
      <div class="ac-tk-d-topbar">
        {mostrarVolver && (
          <button class="ac-icon-btn" aria-label="Volver" onClick={onBack}>
            <span class="ac-icon">arrow_back</span>
          </button>
        )}
        <div class="ac-chat-avatar ac-tk-d-ava">
          <span class="ac-icon">confirmation_number</span>
        </div>
        <div class="ac-tk-d-topbar-txt">
          <span class="ac-tk-d-topbar-tit">{d.asunto}</span>
          <span class={`ac-chip ac-chip-${d.estado}`}>
            {ticketStatusLabels[session.idioma][d.estado]}
          </span>
        </div>
        {mostrarVolver ? (
          onClose && (
            <button class="ac-icon-btn" aria-label="Cerrar" onClick={onClose}>
              <span class="ac-icon">close</span>
            </button>
          )
        ) : (
          <button
            class="ac-icon-btn"
            aria-label="Cerrar"
            onClick={() => (onClose ? onClose() : onBack())}
          >
            <span class="ac-icon">chevron_left</span>
          </button>
        )}
      </div>

      <div class="ac-tk-d-body">
        {/* Número + (sistema) */}
        <div class="ac-tk-d-hero">
          <span class="ac-tk-d-num ac-mono">{formatTicketNumber(d.numero)}</span>
          {d.ambito === 'sistema' && (
            <span class="ac-chip ac-chip-sistema">
              <span class="ac-icon" style="font-size:13px">public</span>
              {t('tickets.delSistema')}
            </span>
          )}
          {d.ambito === 'grupo' && (
            <span class="ac-chip ac-chip-sistema">
              <span class="ac-icon" style="font-size:13px">groups</span>
              {d.groupName ?? t('tickets.delGrupo')}
            </span>
          )}
        </div>

        {/* Descripción */}
        {d.descripcion && (
          <div class="ac-tk-d-seccion">
            <div class="ac-tk-d-seccion-tit">{t('tickets.detalle.descripcion')}</div>
            <div class="ac-tk-d-desc">{d.descripcion}</div>
          </div>
        )}

        {/* Resolución */}
        {d.resolucion && (
          <div class="ac-tk-d-resolucion">
            <span class="ac-icon">task_alt</span>
            <div>
              <div class="ac-tk-d-resolucion-tit">{ticketStatusLabels[session.idioma].resuelto}</div>
              <div>{d.resolucion.texto}</div>
            </div>
          </div>
        )}

        {/* Actividad (izq) + Datos (der) lado a lado */}
        <div class="ac-tk-d-cols">
          {eventosVisibles.length > 0 && (
            <div class="ac-tk-d-seccion ac-tk-d-card ac-tk-d-col-main">
              <div class="ac-tk-d-seccion-tit">{t('tickets.detalle.actividad')}</div>
              <div class="ac-tk-d-timeline">
                {eventosVisibles.map((e) => (
                  <div key={e.id} class="ac-tl-item">
                    <span class="ac-tl-dot">
                      <span class="ac-icon">{iconoEvento(e.data.tipo)}</span>
                    </span>
                    <div class="ac-tl-body">
                      <div class="ac-tl-desc">{e.data.descripcion}</div>
                      <div class="ac-tl-meta">{fecha(e.data.createdAt, session.idioma, true)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div class="ac-tk-d-datos ac-tk-d-card ac-tk-d-col-side">
            <div class="ac-tk-d-dato">
              <span class="ac-label">{t('tickets.detalle.asignadoA')}</span>
              <span class="ac-tk-d-dato-v">{d.asignadoNombre ?? '—'}</span>
            </div>
            <div class="ac-tk-d-dato">
              <span class="ac-label">{t('tickets.detalle.creado')}</span>
              <span class="ac-tk-d-dato-v">{fecha(d.createdAt, session.idioma, true)}</span>
            </div>
            {!esAjeno && (
              <div class="ac-tk-d-dato">
                <span class="ac-label">{t('tickets.detalle.origen')}</span>
                <span class="ac-tk-d-dato-v">
                  {d.conversationId ? t('tickets.detalle.origenChat') : '—'}
                </span>
              </div>
            )}
          </div>
        </div>

        <div class="ac-tk-d-aviso">
          <span class="ac-icon">lock</span>
          {t('tickets.detalle.soloLectura')}
        </div>
      </div>
    </div>
  );
}

/** Icono por tipo de evento del timeline. */
function iconoEvento(tipo: string): string {
  switch (tipo) {
    case 'creado':
      return 'confirmation_number';
    case 'asignado':
      return 'person';
    case 'estado':
      return 'swap_horiz';
    case 'prioridad':
      return 'flag';
    case 'resolucion':
      return 'task_alt';
    case 'edicion':
      return 'edit';
    default:
      return 'chat_bubble';
  }
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
