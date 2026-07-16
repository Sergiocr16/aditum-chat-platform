import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AditumChatSettings, Conversation, WidgetSessionResponse } from '@aditum-chat/shared';
import { makeT, widgetMessages } from '@aditum-chat/shared';
import { getWidgetFirebase, signIn, type WidgetFirebase } from '../firebase.js';
import { openSession, usesEmulators } from '../session.js';
import {
  convSubcanal,
  subscribeMyConversations,
  subscribeMyGroupConversations,
  toDate,
  type Doc,
} from '../data.js';
import { playNotificationSound } from '../sound.js';
import { Home, HomeSkeleton } from './Home.js';
import { Chat } from './Chat.js';
import { LauncherIcon } from './LauncherIcon.js';
import { Tickets } from './Tickets.js';

export type WidgetView = 'inicio' | 'chat' | 'grupo' | 'tickets';

export interface AppControls {
  open(view?: string): void;
  close(): void;
}

interface Props {
  settings: AditumChatSettings;
  onReady(controls: AppControls): void;
  emit(event: 'opened' | 'closed' | 'unreadCount', data?: unknown): void;
}

type SessionState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; session: WidgetSessionResponse; fb: WidgetFirebase }
  | { status: 'error'; message: string };

export function App({ settings, onReady, emit }: Props) {
  const [openPanel, setOpenPanel] = useState(false);
  const [view, setView] = useState<WidgetView>('inicio');
  const [chatModo, setChatModo] = useState<'bot' | 'open'>('bot');
  const [ticketSel, setTicketSel] = useState<string | null>(null);
  const [unreadAlAbrir, setUnreadAlAbrir] = useState(0);
  // Escritorio: pestaña del widget izquierdo (el widget original completo).
  const [tabIzq, setTabIzq] = useState<'inicio' | 'tickets'>('inicio');
  const [state, setState] = useState<SessionState>({ status: 'idle' });
  const [directas, setDirectas] = useState<Doc<Conversation>[]>([]);
  const [grupo, setGrupo] = useState<Doc<Conversation> | null>(null);

  // Escritorio (≥900px): layout de dos paneles tipo WhatsApp Web.
  const [esEscritorio, setEsEscritorio] = useState(
    typeof window !== 'undefined' && window.innerWidth >= 900,
  );
  useEffect(() => {
    const onResize = () => setEsEscritorio(window.innerWidth >= 900);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // On-screen keyboard height (iOS Safari does not resize the layout viewport,
  // so the fullscreen panel would stay behind the keyboard). Exposed to CSS as
  // --ac-kb; the ≤640px block subtracts it from the panel height. On browsers
  // that resize the layout viewport (Android Chrome) this stays ≈0.
  const [keyboardInset, setKeyboardInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv || !openPanel || esEscritorio) {
      setKeyboardInset(0);
      return;
    }
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setKeyboardInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
      });
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [openPanel, esEscritorio]);

  useEffect(() => {
    onReady({
      open: (v) => {
        if (v) setView(v as WidgetView);
        setOpenPanel(true);
      },
      close: () => setOpenPanel(false),
    });
  }, [onReady]);

  useEffect(() => emit(openPanel ? 'opened' : 'closed'), [openPanel, emit]);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    (async () => {
      try {
        const session = await openSession(settings);
        const fb = getWidgetFirebase(usesEmulators(settings));
        await signIn(fb, session.token);
        if (!cancelled) setState({ status: 'ready', session, fb });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', message: (err as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settings]);

  // No-leídos para el badge de la burbuja.
  useEffect(() => {
    if (state.status !== 'ready') return;
    const { fb, session } = state;
    const u1 = subscribeMyConversations(fb, session, setDirectas);
    // Chat grupal segmentado: el badge usa el segmento más reciente.
    const u2 = session.grupoConversationId
      ? subscribeMyGroupConversations(fb, session, (list) => setGrupo(list[0] ?? null))
      : undefined;
    return () => {
      u1();
      u2?.();
    };
  }, [state]);

  const contactId = state.status === 'ready' ? state.session.contactId : '';
  const grupoSilenciado = Boolean(grupo?.data.silenciado?.[contactId]);
  // Última conversación de cada canal (la lista viene ordenada por updatedAt desc).
  const directaBot = directas.find((c) => convSubcanal(c.data) === 'bot') ?? null;
  const directaAgente = directas.find((c) => convSubcanal(c.data) === 'agente') ?? null;
  const unread =
    state.status === 'ready'
      ? (directaBot?.data.unread?.[contactId] ?? 0) +
        (directaAgente?.data.unread?.[contactId] ?? 0) +
        (grupoSilenciado ? 0 : (grupo?.data.unread?.[contactId] ?? 0))
      : 0;

  useEffect(() => emit('unreadCount', unread), [unread, emit]);

  // Aviso in-panel: cuando el panel está abierto y llega algo en OTRA vista,
  // se muestra un chip indicando dónde habló (Bot / Agente / Equipo).
  const [aviso, setAviso] = useState<{ view: 'chat' | 'grupo'; modo?: 'bot' | 'open'; origen: 'bot' | 'agente' | 'equipo' } | null>(null);
  const avisoTimer = useRef<number | null>(null);

  // Sonido de notificación en mensajes entrantes (respeta el silencio por chat).
  // Línea base POR CONVERSACIÓN: la primera vez que vemos una conversación
  // (recarga incluida) solo se registra su timestamp — nunca suena el historial.
  const ultimoBot = toDate(directaBot?.data.lastMessage?.at)?.getTime() ?? 0;
  const ultimoAgente = toDate(directaAgente?.data.lastMessage?.at)?.getTime() ?? 0;
  const ultimoGrupo = toDate(grupo?.data.lastMessage?.at)?.getTime() ?? 0;
  const vistos = useRef(new Map<string, number>());
  useEffect(() => {
    if (state.status !== 'ready') return;
    const revisar = (
      conv: Doc<Conversation> | null,
      ts: number,
      silenciada: boolean,
      destino: 'chat' | 'grupo',
      modoDestino?: 'bot' | 'open',
    ) => {
      if (!conv || !ts) return;
      const previo = vistos.current.get(conv.id);
      vistos.current.set(conv.id, Math.max(ts, previo ?? 0));
      if (previo === undefined || ts <= previo || silenciada) return;
      const lm = conv.data.lastMessage;
      const ajeno = lm?.senderId ? lm.senderId !== contactId : lm?.senderTipo !== 'user';
      if (!ajeno) return;
      const viendoEsa =
        openPanel && view === destino && (destino !== 'chat' || chatModo === modoDestino);
      if (viendoEsa) return; // estás leyendo ese chat: ni sonido ni aviso
      playNotificationSound();
      if (openPanel) {
        const origen =
          destino === 'grupo' ? 'equipo' : modoDestino === 'bot' ? 'bot' : 'agente';
        setAviso({ view: destino, modo: modoDestino, origen });
        if (avisoTimer.current) window.clearTimeout(avisoTimer.current);
        avisoTimer.current = window.setTimeout(() => setAviso(null), 8000);
      }
    };
    revisar(directaBot, ultimoBot, false, 'chat', 'bot');
    revisar(directaAgente, ultimoAgente, false, 'chat', 'open');
    revisar(grupo, ultimoGrupo, grupoSilenciado, 'grupo');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, ultimoBot, ultimoAgente, ultimoGrupo, grupoSilenciado, contactId, directaBot?.id, directaAgente?.id, grupo?.id, openPanel, view, chatModo]);

  function irAlAviso() {
    if (!aviso) return;
    const conv = aviso.view === 'grupo' ? grupo : aviso.modo === 'bot' ? directaBot : directaAgente;
    setUnreadAlAbrir(conv?.data.unread?.[contactId] ?? 0);
    if (aviso.view === 'chat' && aviso.modo) setChatModo(aviso.modo);
    setView(aviso.view);
    setAviso(null);
  }

  // Si el usuario navega por su cuenta a la vista del aviso, se descarta.
  useEffect(() => {
    if (aviso && view === aviso.view && (aviso.view !== 'chat' || chatModo === aviso.modo)) {
      setAviso(null);
    }
  }, [view, chatModo, aviso]);

  const idioma = state.status === 'ready' ? state.session.idioma : 'es';
  const t = useMemo(() => makeT(widgetMessages, idioma), [idioma]);
  // Prioridad: override del snippet del host → config por sitio (consola) → default.
  const sessionCfg = state.status === 'ready' ? state.session.widgetConfig : null;
  const color = settings.config?.color ?? sessionCfg?.color ?? '#123C68';
  const accent = settings.config?.accent ?? sessionCfg?.accent ?? '#E8EEF5';
  const colorBurbuja = settings.config?.colorBurbuja ?? sessionCfg?.colorBurbuja ?? color;
  const posicion = settings.config?.posicion ?? sessionCfg?.posicion ?? 'bottom-left';
  const ocultarBurbuja = settings.config?.ocultarBurbuja ?? sessionCfg?.ocultarBurbuja ?? false;

  function go(v: WidgetView, opts?: { modo?: 'bot' | 'open'; ticketId?: string }) {
    if (esEscritorio) {
      // En escritorio el widget izquierdo navega con sus tabs; solo el chat,
      // el grupo o el DETALLE de un ticket van al panel derecho.
      if (v === 'inicio') return setTabIzq('inicio');
      if (v === 'tickets' && !opts?.ticketId) return setTabIzq('tickets');
      // Tocar la opción ya activa cierra el panel derecho (toggle).
      const mismoChat = v === 'chat' && view === 'chat' && (opts?.modo ?? 'bot') === chatModo;
      const mismoGrupo = v === 'grupo' && view === 'grupo';
      const mismoTicket = v === 'tickets' && view === 'tickets' && opts?.ticketId === ticketSel;
      if (mismoChat || mismoGrupo || mismoTicket) {
        setView('inicio');
        setTicketSel(null);
        setUnreadAlAbrir(0);
        return;
      }
    }
    if (opts?.modo) setChatModo(opts.modo);
    setTicketSel(opts?.ticketId ?? null);
    // Divisor de no-leídos al entrar a un chat desde cualquier lado.
    if (v === 'chat') {
      const conv = (opts?.modo ?? 'bot') === 'bot' ? directaBot : directaAgente;
      setUnreadAlAbrir(conv?.data.unread?.[contactId] ?? 0);
    }
    else if (v === 'grupo') setUnreadAlAbrir(grupo?.data.unread?.[contactId] ?? 0);
    else setUnreadAlAbrir(0);
    setView(v);
  }

  /** Cierra el panel y resetea a la vista compacta para la próxima apertura. */
  function cerrarPanel() {
    setOpenPanel(false);
    setView('inicio');
    setUnreadAlAbrir(0);
    setTicketSel(null);
  }

  const enChat = view === 'chat' || view === 'grupo';
  // El detalle de un ticket usa su propio header (estilo chat), así que ocultamos
  // el header/tabbar genéricos, igual que en el chat.
  const enTicketDetalle = view === 'tickets' && !!ticketSel;
  // Escritorio: amplio solo cuando hay algo abierto al lado; si se cierra el
  // chat (X) queda únicamente el widget compacto. Móvil: como antes.
  const amplio = esEscritorio ? view !== 'inicio' : enChat || view === 'tickets';

  return (
    <div class={`ac-root ac-${posicion} ${openPanel ? 'ac-abierto' : ''}`} style={`--ac-primary:${color};--ac-accent:${accent};--ac-bubble:${colorBurbuja};--ac-kb:${keyboardInset}px`}>
      {openPanel && esEscritorio && (
        <div class={`ac-panel ${amplio ? 'ac-panel-amplio' : ''}`}>
          {state.status === 'loading' && <HomeSkeleton />}
          {state.status === 'error' && <div class="ac-error">{state.message}</div>}
          {state.status === 'ready' && (
            <div class={view === 'inicio' ? 'ac-escritorio ac-escritorio-solo' : 'ac-escritorio'}>
              {/* El widget original completo, como columna izquierda */}
              <div class="ac-side-widget">
                <div class="ac-header">
                  <span class="ac-header-brand">
                    {state.session.widgetConfig.logoUrl ? (
                      <img class="ac-logo-marca" src={state.session.widgetConfig.logoUrl} alt="" />
                    ) : (
                      <span class="ac-logo ac-logo-letra">
                        {(state.session.widgetConfig.titulo[0] ?? 'S').toUpperCase()}
                      </span>
                    )}
                  </span>
                  <button class="ac-icon-btn" aria-label="Cerrar" onClick={cerrarPanel}>
                    <span class="ac-icon">close</span>
                  </button>
                </div>
                <div class="ac-body">
                  {tabIzq === 'inicio' ? (
                    <Home
                      fb={state.fb}
                      session={state.session}
                      go={go}
                      directaBot={directaBot}
                      directaAgente={directaAgente}
                      grupo={grupo}
                      activo={{ view, modo: chatModo, ticket: ticketSel }}
                    />
                  ) : (
                    <Tickets
                      fb={state.fb}
                      session={state.session}
                      ticketId={null}
                      onSelect={(id) => {
                        if (id) go('tickets', { ticketId: id });
                      }}
                    />
                  )}
                </div>
                <nav class="ac-tabbar">
                  <button
                    class={`ac-tab ${tabIzq === 'inicio' ? 'ac-tab-active' : ''}`}
                    onClick={() => setTabIzq('inicio')}
                  >
                    <span class="ac-icon">home</span>
                    {t('tabs.inicio')}
                  </button>
                  <button
                    class={`ac-tab ${tabIzq === 'tickets' ? 'ac-tab-active' : ''}`}
                    onClick={() => setTabIzq('tickets')}
                  >
                    <span class="ac-icon">confirmation_number</span>
                    {t('tabs.tickets')}
                  </button>
                </nav>
              </div>

              {view !== 'inicio' && (
                <div class="ac-escritorio-main">
                  {view === 'chat' && (
                    <Chat
                      key={chatModo}
                      fb={state.fb}
                      session={state.session}
                      tipo="directa"
                      modo={chatModo}
                      unreadAlAbrir={unreadAlAbrir}
                      mostrarVolver={false}
                      onBack={() => {}}
                      onClose={() => setView('inicio')}
                      onIrAgente={() => {
                        setChatModo('open');
                        setUnreadAlAbrir(directaAgente?.data.unread?.[contactId] ?? 0);
                      }}
                      onIrTicket={(id) => go('tickets', { ticketId: id })}
                    />
                  )}
                  {view === 'grupo' && (
                    <Chat
                      fb={state.fb}
                      session={state.session}
                      tipo="grupo"
                      unreadAlAbrir={unreadAlAbrir}
                      mostrarVolver={false}
                      onBack={() => {}}
                      onClose={() => setView('inicio')}
                      onIrTicket={(id) => go('tickets', { ticketId: id })}
                    />
                  )}
                  {view === 'tickets' && ticketSel && (
                    <Tickets
                      fb={state.fb}
                      session={state.session}
                      mostrarVolver={false}
                      ticketId={ticketSel}
                      onSelect={(id) => {
                        if (id) setTicketSel(id);
                        else {
                          // "Volver" del detalle: se cierra el panel derecho.
                          setTicketSel(null);
                          setView('inicio');
                        }
                      }}
                      onClose={() => {
                        setTicketSel(null);
                        setView('inicio');
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {aviso && view !== aviso.view && (
            <button class="ac-aviso" onClick={irAlAviso}>
              <span class="ac-icon">
                {aviso.origen === 'equipo'
                  ? 'groups'
                  : aviso.origen === 'bot'
                    ? 'smart_toy'
                    : 'support_agent'}
              </span>
              {t('aviso.nuevo')}
              <span class="ac-aviso-chip">
                {aviso.origen === 'equipo'
                  ? t('aviso.equipo')
                  : aviso.origen === 'bot'
                    ? t('aviso.bot')
                    : t('aviso.agente')}
              </span>
              <span class="ac-icon ac-aviso-flecha">arrow_forward</span>
            </button>
          )}
        </div>
      )}
      {openPanel && !esEscritorio && (
        <div class={`ac-panel ${amplio ? 'ac-panel-amplio' : ''}`}>
          {!enChat && !enTicketDetalle && (
            <div class="ac-header">
              <span class="ac-header-brand">
                {state.status === 'ready' && state.session.widgetConfig.logoUrl && (
                  <img class="ac-logo-marca" src={state.session.widgetConfig.logoUrl} alt="" />
                )}
              </span>
              <button class="ac-icon-btn" aria-label="Cerrar" onClick={cerrarPanel}>
                <span class="ac-icon">close</span>
              </button>
            </div>
          )}
          <div class="ac-body">
            {state.status === 'loading' && <HomeSkeleton />}
            {state.status === 'error' && <div class="ac-error">{state.message}</div>}
            {state.status === 'ready' && (
              <>
                {view === 'inicio' && (
                  <Home
                    fb={state.fb}
                    session={state.session}
                    go={go}
                    directaBot={directaBot}
                    directaAgente={directaAgente}
                    grupo={grupo}
                  />
                )}
                {view === 'chat' && (
                  <Chat
                    key={chatModo}
                    fb={state.fb}
                    session={state.session}
                    tipo="directa"
                    modo={chatModo}
                    unreadAlAbrir={unreadAlAbrir}
                    onBack={() => {
                      setUnreadAlAbrir(0);
                      setView('inicio');
                    }}
                    onClose={() => {
                      setUnreadAlAbrir(0);
                      setView('inicio');
                    }}
                    onIrAgente={() => {
                      setChatModo('open');
                      setUnreadAlAbrir(directaAgente?.data.unread?.[contactId] ?? 0);
                    }}
                    onIrTicket={(id) => go('tickets', { ticketId: id })}
                  />
                )}
                {view === 'grupo' && (
                  <Chat
                    fb={state.fb}
                    session={state.session}
                    tipo="grupo"
                    unreadAlAbrir={unreadAlAbrir}
                    onBack={() => {
                      setUnreadAlAbrir(0);
                      setView('inicio');
                    }}
                    onClose={() => {
                      setUnreadAlAbrir(0);
                      setView('inicio');
                    }}
                    onIrTicket={(id) => go('tickets', { ticketId: id })}
                  />
                )}
                {view === 'tickets' && (
                  <Tickets
                    fb={state.fb}
                    session={state.session}
                    ticketId={ticketSel}
                    onSelect={setTicketSel}
                    onClose={() => {
                      setTicketSel(null);
                      setView('inicio');
                    }}
                  />
                )}
              </>
            )}
          </div>
          {!enChat && !enTicketDetalle && (
            <nav class="ac-tabbar">
              <button
                class={`ac-tab ${view === 'inicio' ? 'ac-tab-active' : ''}`}
                onClick={() => go('inicio')}
              >
                <span class="ac-icon">home</span>
                {t('tabs.inicio')}
              </button>
              <button
                class={`ac-tab ${view === 'tickets' ? 'ac-tab-active' : ''}`}
                onClick={() => go('tickets')}
              >
                <span class="ac-icon">confirmation_number</span>
                {t('tabs.tickets')}
              </button>
            </nav>
          )}

          {aviso && view !== aviso.view && (
            <button class="ac-aviso" onClick={irAlAviso}>
              <span class="ac-icon">
                {aviso.origen === 'equipo'
                  ? 'groups'
                  : aviso.origen === 'bot'
                    ? 'smart_toy'
                    : 'support_agent'}
              </span>
              {t('aviso.nuevo')}
              <span class="ac-aviso-chip">
                {aviso.origen === 'equipo'
                  ? t('aviso.equipo')
                  : aviso.origen === 'bot'
                    ? t('aviso.bot')
                    : t('aviso.agente')}
              </span>
              <span class="ac-icon ac-aviso-flecha">arrow_forward</span>
            </button>
          )}
        </div>
      )}
      {!ocultarBurbuja && (
        <button
          class="ac-bubble"
          aria-label="Abrir chat"
          onClick={() => {
            if (!openPanel) {
              // Por defecto abre en pequeño (solo el widget). Excepción tipo
              // WhatsApp: si hay no-leídos, abre directo en ese chat.
              const unreadBot = directaBot?.data.unread?.[contactId] ?? 0;
              const unreadAgente = directaAgente?.data.unread?.[contactId] ?? 0;
              const unreadGrupo = grupoSilenciado ? 0 : (grupo?.data.unread?.[contactId] ?? 0);
              if (unreadAgente > 0) {
                setUnreadAlAbrir(unreadAgente);
                setChatModo('open');
                setView('chat');
              } else if (unreadBot > 0) {
                setUnreadAlAbrir(unreadBot);
                setChatModo('bot');
                setView('chat');
              } else if (unreadGrupo > 0) {
                setUnreadAlAbrir(unreadGrupo);
                setView('grupo');
              } else {
                setUnreadAlAbrir(0);
                setView('inicio');
              }
              setOpenPanel(true);
            } else {
              cerrarPanel();
            }
          }}
        >
          {openPanel ? <span class="ac-icon ac-bubble-icon">close</span> : <LauncherIcon />}
          {!openPanel && unread > 0 && <span class="ac-badge">{unread}</span>}
        </button>
      )}
    </div>
  );
}
