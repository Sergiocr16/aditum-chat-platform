import { useEffect, useState } from 'preact/hooks';
import type { Conversation, Ticket, WidgetSessionResponse } from '@aditum-chat/shared';
import { formatTicketNumber, makeT, ticketStatusLabels, widgetMessages } from '@aditum-chat/shared';
import { subscribeMyTickets, timeAgo, type Doc } from '../data.js';
import type { WidgetFirebase } from '../firebase.js';
import type { WidgetView } from './App.js';

interface Props {
  fb: WidgetFirebase;
  session: WidgetSessionResponse;
  go(view: WidgetView, opts?: { modo?: 'bot' | 'open'; ticketId?: string }): void;
  directaBot?: Doc<Conversation> | null;
  directaAgente?: Doc<Conversation> | null;
  grupo?: Doc<Conversation> | null;
  /** Escritorio: qué está abierto al lado, para marcar activo en el menú. */
  activo?: { view: WidgetView; modo: 'bot' | 'open'; ticket?: string | null };
}

export function Home({ fb, session, go, directaBot, directaAgente, grupo, activo }: Props) {
  const t = makeT(widgetMessages, session.idioma);
  const [tickets, setTickets] = useState<Doc<Ticket>[]>([]);

  useEffect(() => subscribeMyTickets(fb, session, setTickets), [fb, session]);

  const abiertos = tickets.filter((tk) => tk.data.estado !== 'resuelto').slice(0, 3);
  const primerNombre = session.nombre.split(' ')[0];
  const cfg = session.widgetConfig;

  // No-leídos por botón: cada canal (bot / agente / equipo) tiene su conversación.
  const unreadBot = directaBot?.data.unread?.[session.contactId] ?? 0;
  const unreadAgente = directaAgente?.data.unread?.[session.contactId] ?? 0;
  const unreadGrupo = grupo?.data.unread?.[session.contactId] ?? 0;
  const grupoSilenciado = Boolean(grupo?.data.silenciado?.[session.contactId]);

  const Badge = ({ n, muted }: { n: number; muted?: boolean }) =>
    n > 0 ? <span class={`ac-accion-badge ${muted ? 'ac-accion-badge-muted' : ''}`}>{n}</span> : null;

  // Icono del botón: imagen configurada por el sitio o el icono Material por defecto.
  const IcoBoton = ({ url, icono }: { url?: string; icono: string }) =>
    url ? (
      <img class="ac-accion-ico-img" src={url} alt="" />
    ) : (
      <span class="ac-icon ac-accion-ico">{icono}</span>
    );

  const activoBot = activo?.view === 'chat' && activo.modo === 'bot';
  const activoAgente = activo?.view === 'chat' && activo.modo === 'open';
  const activoGrupo = activo?.view === 'grupo';

  return (
    <div class="ac-home">
      <div class="ac-home-hero">
        <div class="ac-home-marca">{cfg.titulo}</div>
        <div class="ac-home-saludo">{t('inicio.saludo', { nombre: primerNombre })}</div>
        {session.rol && <span class="ac-home-rol">{session.rol}</span>}
        <div class={`ac-home-status ${session.enHorario ? 'ac-home-status-on' : 'ac-home-status-off'}`}>
          <div class="ac-home-status-head">
            <span class={`ac-dot ${session.enHorario ? 'ac-dot-on' : 'ac-dot-off'}`} />
            {session.enHorario ? t('inicio.enLinea') : t('inicio.fueraHorario')}
          </div>
          <div class="ac-home-status-sub">
            {session.enHorario ? t('inicio.enLineaSub') : t('inicio.asistente247')}
          </div>
          {session.scheduleText && (
            <div class="ac-home-status-horario" title={t('inicio.horario')}>
              <span class="ac-icon">schedule</span>
              {session.scheduleText}
            </div>
          )}
        </div>
      </div>

      <div class="ac-home-acciones">
        {cfg.botonBot && session.botConfig.activo && (
          <button class={`ac-accion ${activoBot ? 'ac-accion-on' : ''}`} onClick={() => go('chat', { modo: 'bot' })}>
            <IcoBoton url={cfg.botonBotIcono} icono="smart_toy" />
            <span class="ac-accion-txt">{cfg.botonBotTexto || t('inicio.preguntasSistema')}</span>
            <span class="ac-accion-ai">AI</span>
            <Badge n={unreadBot} />
            <span class="ac-icon ac-accion-flecha">{activoBot ? 'chevron_left' : 'chevron_right'}</span>
          </button>
        )}
        {cfg.botonAgente && (
          <button class={`ac-accion ${activoAgente ? 'ac-accion-on' : ''}`} onClick={() => go('chat', { modo: 'open' })}>
            <IcoBoton url={cfg.botonAgenteIcono} icono="support_agent" />
            <span class="ac-accion-txt">{cfg.botonAgenteTexto || t('inicio.hablarAgente')}</span>
            <Badge n={unreadAgente} />
            <span class="ac-icon ac-accion-flecha">{activoAgente ? 'chevron_left' : 'chevron_right'}</span>
          </button>
        )}
        {cfg.botonChatEquipo && session.grupoConversationId && (
          <button class={`ac-accion ${activoGrupo ? 'ac-accion-on' : ''}`} onClick={() => go('grupo')}>
            <IcoBoton url={cfg.botonEquipoIcono} icono="groups" />
            <span class="ac-accion-txt">{cfg.botonEquipoTexto || t('inicio.chatEquipo')}</span>
            <Badge n={unreadGrupo} muted={grupoSilenciado} />
            <span class="ac-icon ac-accion-flecha">{activoGrupo ? 'chevron_left' : 'chevron_right'}</span>
          </button>
        )}
      </div>

      {abiertos.length > 0 && (
        <div class="ac-home-tickets">
          <div class="ac-home-tickets-head">
            <span>{t('inicio.ticketsAbiertos')}</span>
            <button class="ac-link" onClick={() => go('tickets')}>
              {t('inicio.verTodos')}
            </button>
          </div>
          {abiertos.map((tk) => (
            <button
              key={tk.id}
              class={`ac-ticket-mini ${activo?.view === 'tickets' && activo.ticket === tk.id ? 'ac-accion-on' : ''}`}
              onClick={() => go('tickets', { ticketId: tk.id })}
            >
              <div class="ac-ticket-mini-top">
                <span class="ac-mono">{formatTicketNumber(tk.data.numero)}</span>
                <span class={`ac-chip ac-chip-${tk.data.estado}`}>
                  {ticketStatusLabels[session.idioma][tk.data.estado]}
                </span>
              </div>
              <div class="ac-ticket-mini-asunto">{tk.data.asunto}</div>
              <div class="ac-ticket-mini-meta">
                {t('inicio.actualizadoHace', { hace: timeAgo(tk.data.updatedAt, session.idioma) })}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
