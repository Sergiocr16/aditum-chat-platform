import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Conversation, Message, WidgetSessionResponse } from '@aditum-chat/shared';
import { categoryLabel, formatTicketNumber, makeT, widgetMessages } from '@aditum-chat/shared';
import {
  convSubcanal,
  editMessage,
  ensureDirectConversation,
  fetchOlderMessages,
  formatTime,
  markRead,
  sendAttachment,
  sendMessage,
  setTyping,
  submitCsat,
  subscribeConversation,
  subscribeLatestMessages,
  subscribeMyConversations,
  subscribeTyping,
  toggleMute,
  toggleReaction,
  toDate,
  type Doc,
} from '../data.js';
import type { WidgetFirebase } from '../firebase.js';

const EMOJIS = ['👍', '❤️', '😂', '😮', '🙏'];
const PAGE = 30;

/** Fila del hilo continuo: mensaje + conversación a la que pertenece. */
interface Fila {
  convId: string;
  msg: Doc<Message>;
}

interface Props {
  fb: WidgetFirebase;
  session: WidgetSessionResponse;
  tipo: 'directa' | 'grupo';
  modo?: 'bot' | 'open';
  /** No-leídos al momento de abrir (para el divisor tipo WhatsApp). */
  unreadAlAbrir?: number;
  /** false en el layout de escritorio (el menú lateral ya navega). */
  mostrarVolver?: boolean;
  onBack(): void;
  /** Cierra el chat dejando solo el widget (X arriba a la derecha). */
  onClose?(): void;
  /** Navega al chat de "Hablar con un agente" (chip y escalamiento del bot). */
  onIrAgente?(): void;
}

export function Chat({
  fb,
  session,
  tipo,
  modo = 'bot',
  unreadAlAbrir = 0,
  mostrarVolver = true,
  onBack,
  onClose,
  onIrAgente,
}: Props) {
  const t = makeT(widgetMessages, session.idioma);
  const grupo = tipo === 'grupo';

  // --- Conversaciones del hilo (asc: vieja → nueva). El hilo nunca se pierde:
  // se muestran TODAS las conversaciones del contacto, resueltas incluidas.
  const [convsDesc, setConvsDesc] = useState<Doc<Conversation>[]>([]);
  const [convsCargadas, setConvsCargadas] = useState(false);
  useEffect(() => {
    if (grupo) {
      if (!session.grupoConversationId) return;
      return subscribeConversation(fb, session.grupoConversationId, (c) => {
        setConvsDesc(c ? [c] : []);
        setConvsCargadas(true);
      });
    }
    const subcanal = session.botConfig.activo && modo === 'bot' ? 'bot' : 'agente';
    return subscribeMyConversations(fb, session, (list) => {
      // Cada vista muestra SOLO su canal: bot o agente (viejas sin campo = agente).
      setConvsDesc(list.filter((c) => convSubcanal(c.data) === subcanal));
      setConvsCargadas(true);
    });
  }, [fb, session, grupo, modo]);

  const convsAsc = useMemo(() => [...convsDesc].reverse(), [convsDesc]);
  const convPorId = useMemo(
    () => new Map(convsDesc.map((c) => [c.id, c])),
    [convsDesc],
  );
  const activa = convsDesc[0] ?? null; // la más reciente

  // Primera conversación: SOLO cuando ya llegó el primer snapshot y no hay ninguna
  // (evita crear conversaciones fantasma por la carrera del primer render).
  const creando = useRef(false);
  useEffect(() => {
    if (grupo || creando.current || !convsCargadas) return;
    if (convsDesc.length === 0) {
      creando.current = true;
      void ensureDirectConversation(fb, session, session.nombre, modo);
    }
  }, [grupo, convsCargadas, convsDesc.length, fb, session, modo]);

  // --- Página en vivo (última conversación) + páginas históricas.
  const [liveMsgs, setLiveMsgs] = useState<Fila[]>([]);
  const [viejos, setViejos] = useState<Fila[]>([]);
  const [cargandoMas, setCargandoMas] = useState(false);
  const cursorRef = useRef<{ convId: string; cursor: unknown | null; agotada: boolean } | null>(null);
  const liveConvIdRef = useRef<string | null>(null);
  const [hayMas, setHayMas] = useState(false);
  // Se incrementa cada vez que cambia cursorRef para forzar el recálculo de hayMas.
  const [cursorVersion, setCursorVersion] = useState(0);

  const recalcHayMas = useCallback(() => {
    const cur = cursorRef.current;
    if (!cur) return setHayMas(false);
    const idx = convsAsc.findIndex((c) => c.id === cur.convId);
    setHayMas(!cur.agotada || idx > 0);
  }, [convsAsc]);

  useEffect(() => recalcHayMas(), [recalcHayMas, cursorVersion]);

  useEffect(() => {
    const liveId = activa?.id ?? null;
    if (!liveId || liveConvIdRef.current === liveId) return;

    // Cambió la conversación activa (ej. se creó una nueva tras resolver):
    // los mensajes vivos anteriores pasan al histórico y se re-ancla el vivo.
    if (liveConvIdRef.current) {
      setViejos((prev) => [...prev, ...liveMsgsRef.current]);
    }
    liveConvIdRef.current = liveId;
    setLiveMsgs([]);

    const unsub = subscribeLatestMessages(fb, liveId, PAGE, (msgs, oldestCursor, llena) => {
      setLiveMsgs(msgs.map((m) => ({ convId: liveId, msg: m })));
      // El cursor del vivo solo se fija si aún no empezamos a paginar hacia atrás.
      if (!cursorRef.current) {
        cursorRef.current = { convId: liveId, cursor: oldestCursor, agotada: !llena };
        setCursorVersion((v) => v + 1);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fb, activa?.id]);

  const liveMsgsRef = useRef<Fila[]>([]);
  useEffect(() => {
    liveMsgsRef.current = liveMsgs;
  }, [liveMsgs]);

  async function loadOlder() {
    const cur = cursorRef.current;
    if (!cur || cargandoMas) return;
    setCargandoMas(true);
    try {
      if (!cur.agotada) {
        const page = await fetchOlderMessages(fb, cur.convId, PAGE, cur.cursor);
        cursorRef.current = { convId: cur.convId, cursor: page.cursor, agotada: !page.hayMas };
        setViejos((prev) => [...page.docs.map((m) => ({ convId: cur.convId, msg: m })), ...prev]);
      } else {
        const idx = convsAsc.findIndex((c) => c.id === cur.convId);
        const prevConv = idx > 0 ? convsAsc[idx - 1] : null;
        if (!prevConv) {
          setHayMas(false);
          return;
        }
        const page = await fetchOlderMessages(fb, prevConv.id, PAGE, null);
        cursorRef.current = { convId: prevConv.id, cursor: page.cursor, agotada: !page.hayMas };
        setViejos((prev) => [...page.docs.map((m) => ({ convId: prevConv.id, msg: m })), ...prev]);
      }
      setCursorVersion((v) => v + 1);
    } finally {
      setCargandoMas(false);
    }
  }

  // Hilo final (dedup por id de mensaje en la frontera vivo/histórico).
  const filas = useMemo(() => {
    const idsViejos = new Set(viejos.map((f) => f.msg.id));
    const todas = [...viejos, ...liveMsgs.filter((f) => !idsViejos.has(f.msg.id))];
    return todas.filter((f) => !f.msg.data.interno);
  }, [viejos, liveMsgs]);

  // Divisor "N MENSAJES NO LEÍDOS" (WhatsApp): id del primer mensaje entrante
  // de los últimos N recibidos al momento de abrir. Se congela una sola vez.
  const [noLeidoDesde, setNoLeidoDesde] = useState<string | null>(null);
  const noLeidoFijado = useRef(false);
  useEffect(() => {
    if (noLeidoFijado.current || unreadAlAbrir <= 0 || filas.length === 0) return;
    const entrantes = filas.filter(
      (f) => f.msg.data.sender.id !== session.contactId && f.msg.data.sender.tipo !== 'sistema',
    );
    const primero = entrantes[Math.max(0, entrantes.length - unreadAlAbrir)];
    if (primero) {
      setNoLeidoDesde(primero.msg.id);
      noLeidoFijado.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filas.length, unreadAlAbrir]);

  // Si el bot escala (aparece escaladoA en la conversación), pasar al chat de agente.
  const escaladoVisto = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (grupo || modo !== 'bot') return;
    const actual = activa?.data.escaladoA ?? null;
    if (escaladoVisto.current === undefined) {
      escaladoVisto.current = actual; // línea base al montar: no saltar por escalados viejos
      return;
    }
    if (actual && actual !== escaladoVisto.current) {
      escaladoVisto.current = actual;
      onIrAgente?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupo, modo, activa?.data.escaladoA]);

  // --- Estado de UI del chat.
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<Fila | null>(null);
  const [editando, setEditando] = useState<Fila | null>(null);
  const [menuMsg, setMenuMsg] = useState<string | null>(null);
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const [csatEnviados, setCsatEnviados] = useState<Set<string>>(new Set());
  const bodyRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingTimer = useRef<number | null>(null);
  const ajusteScroll = useRef<number | null>(null);

  useEffect(() => {
    if (!activa?.id) return;
    const u = subscribeTyping(fb, activa.id, session.contactId, setTypingNames);
    markRead(fb, session, activa.id);
    return () => {
      u();
      setTyping(fb, session, activa.id, false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fb, activa?.id, session]);

  // Preservar posición al prepender; auto-scroll abajo solo con mensajes nuevos.
  const ultimoId = filas[filas.length - 1]?.msg.id;
  const prevUltimoId = useRef<string | undefined>(undefined);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (ajusteScroll.current !== null) {
      // Se prependió una página: mantener el punto de lectura.
      el.scrollTop += el.scrollHeight - ajusteScroll.current;
      ajusteScroll.current = null;
    } else if (prevUltimoId.current !== ultimoId || typingNames.length > 0) {
      el.scrollTo({ top: el.scrollHeight });
      if (activa?.id) markRead(fb, session, activa.id);
    }
    prevUltimoId.current = ultimoId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filas.length, typingNames.length]);

  // Al fijarse el divisor de no-leídos, llevar la vista ahí (no al fondo).
  useEffect(() => {
    if (!noLeidoDesde) return;
    requestAnimationFrame(() => {
      bodyRef.current?.querySelector('[data-noleidos]')?.scrollIntoView({ block: 'center' });
    });
  }, [noLeidoDesde]);

  function onScrollBody() {
    const el = bodyRef.current;
    if (el && el.scrollTop < 60 && hayMas && !cargandoMas) {
      ajusteScroll.current = el.scrollHeight;
      void loadOlder();
    }
  }

  const estado = activa?.data.estado ?? modo;
  // Título: el NOMBRE de quien atiende (agente asignado o bot), no la marca.
  const headerTitle = grupo
    ? (activa?.data.clientNombre ?? t('chat.equipoAdministrador'))
    : estado === 'bot'
      ? session.botConfig.nombre
      : (activa?.data.asignadoNombre ?? session.widgetConfig.titulo);
  const headerSub =
    typingNames.length > 0
      ? `${typingNames.join(', ')} ${t('chat.escribiendo')}`
      : grupo
        ? participantesResumen(activa)
        : estado === 'bot' || activa?.data.asignadoNombre
          ? t('chat.enLinea')
          : t('chat.soporte');

  function onInputDraft(value: string) {
    setDraft(value);
    if (!activa?.id) return;
    setTyping(fb, session, activa.id, true);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    const convId = activa.id;
    typingTimer.current = window.setTimeout(() => setTyping(fb, session, convId, false), 4000);
  }

  /** Conversación destino para escribir: la activa si sigue abierta, o una nueva. */
  async function convParaEscribir(): Promise<string> {
    if (grupo) return session.grupoConversationId!;
    if (activa && activa.data.estado !== 'resolved') return activa.id;
    return ensureDirectConversation(fb, session, session.nombre, modo);
  }

  async function submit() {
    const texto = draft.trim();
    if (!texto) return;
    setDraft('');
    if (editando) {
      await editMessage(fb, editando.convId, editando.msg.id, texto);
      setEditando(null);
      return;
    }
    const convId = await convParaEscribir();
    setTyping(fb, session, convId, false);
    await sendMessage(
      fb,
      session,
      convId,
      session.nombre,
      texto,
      replyTo?.msg,
      grupo ? activa?.data.participantes : undefined,
    );
    setReplyTo(null);
  }

  async function onFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    (e.target as HTMLInputElement).value = '';
    const convId = await convParaEscribir();
    await sendAttachment(
      fb,
      session,
      convId,
      session.nombre,
      file,
      grupo ? activa?.data.participantes : undefined,
    );
  }

  async function onChipAgente() {
    // El canal del bot no se convierte: se pasa al chat de agente.
    if (onIrAgente) return onIrAgente();
    const convId = await convParaEscribir();
    await sendMessage(fb, session, convId, session.nombre, t('inicio.hablarAgente'));
  }

  const mostrarChips = !grupo && estado === 'bot' && filas.length <= 1;

  return (
    <div class="ac-chat">
      <div class="ac-chat-header">
        {mostrarVolver && (
          <button class="ac-icon-btn" aria-label="Volver" onClick={onBack}>
            <span class="ac-icon">arrow_back</span>
          </button>
        )}
        <div class="ac-chat-avatar">
          {grupo ? (
            <span class="ac-icon">groups</span>
          ) : estado === 'bot' ? (
            <span class="ac-icon">smart_toy</span>
          ) : activa?.data.asignadoFoto ? (
            <img class="ac-avatar-img" src={activa.data.asignadoFoto} alt="" />
          ) : activa?.data.asignadoNombre ? (
            iniciales(activa.data.asignadoNombre)
          ) : (
            (session.widgetConfig.titulo[0] ?? 'A').toUpperCase()
          )}
        </div>
        <div class="ac-chat-htxt">
          <div class="ac-chat-htitle">{headerTitle}</div>
          <div class="ac-chat-hsub">{headerSub}</div>
        </div>
        {grupo && activa?.id && (
          <button
            class="ac-icon-btn"
            title={
              activa?.data.silenciado?.[session.contactId]
                ? session.idioma === 'es'
                  ? 'Activar notificaciones'
                  : 'Unmute notifications'
                : session.idioma === 'es'
                  ? 'Silenciar este chat'
                  : 'Mute this chat'
            }
            onClick={() =>
              toggleMute(fb, session, activa.id, !activa?.data.silenciado?.[session.contactId])
            }
          >
            <span class="ac-icon">
              {activa?.data.silenciado?.[session.contactId] ? 'notifications_off' : 'notifications'}
            </span>
          </button>
        )}
        <button
          class="ac-icon-btn"
          aria-label="Cerrar chat"
          title={mostrarVolver ? undefined : 'Cerrar conversación'}
          onClick={() => (onClose ? onClose() : onBack())}
        >
          <span class="ac-icon">{mostrarVolver ? 'close' : 'chevron_left'}</span>
        </button>
      </div>

      <div class="ac-chat-body" ref={bodyRef} onClick={() => setMenuMsg(null)} onScroll={onScrollBody}>
        {cargandoMas && <div class="ac-sep ac-cargando">···</div>}
        {filas.map((fila, i) => {
          const m = fila.msg;
          const prev = filas[i - 1];
          const cambioConv = prev && prev.convId !== fila.convId;
          const convAnterior = cambioConv ? convPorId.get(prev.convId) : null;
          const sep = dateSeparator(m, cambioConv ? undefined : prev?.msg, session.idioma);
          const own = m.data.sender.id === session.contactId;
          const sistema = m.data.sender.tipo === 'sistema';
          const csat = m.data.tipoContenido === 'csat';
          const esActiva = fila.convId === activa?.id;

          return (
            <div key={`${fila.convId}_${m.id}`}>
              {noLeidoDesde === m.id && (
                <div class="ac-sep ac-sep-noleidos" data-noleidos>
                  {unreadAlAbrir === 1
                    ? t('chat.noLeido1')
                    : t('chat.noLeidos', { n: unreadAlAbrir })}
                </div>
              )}
              {cambioConv && (
                <div class="ac-sep ac-sep-conv">
                  <span class="ac-icon">check_circle</span>
                  {convAnterior?.data.categoria
                    ? t('chat.convResuelta', {
                        categoria: categoryLabel(convAnterior.data.categoria, session.idioma),
                      })
                    : t('chat.convResueltaSin')}
                </div>
              )}
              {sep && <div class="ac-sep">{sep}</div>}
              {csat ? (
                <CsatCard
                  texto={m.data.texto}
                  enviado={csatEnviados.has(fila.convId) || !esActiva}
                  gracias={t('csat.gracias')}
                  onRate={async (r) => {
                    if (csatEnviados.has(fila.convId)) return;
                    setCsatEnviados((s) => new Set(s).add(fila.convId));
                    await submitCsat(fb, session, fila.convId, r);
                  }}
                />
              ) : sistema ? (
                <div class="ac-msg-sistema">
                  {m.data.texto}
                  {m.data.ticketRef && (
                    <span class="ac-ticket-chip">
                      <span class="ac-icon">confirmation_number</span>
                      {formatTicketNumber(m.data.ticketRef.numero)}
                    </span>
                  )}
                </div>
              ) : (
                <div class={`ac-msg ${own ? 'ac-msg-own' : 'ac-msg-other'}`}>
                  {!own && (
                    <div class="ac-msg-avatar" data-tipo={m.data.sender.tipo}>
                      {m.data.sender.tipo === 'bot' ? (
                        <span class="ac-icon">smart_toy</span>
                      ) : (
                        iniciales(m.data.sender.nombre)
                      )}
                    </div>
                  )}
                  <div
                    class={`ac-burbuja ${own ? 'ac-burbuja-own' : ''}`}
                    onDblClick={() => setMenuMsg(menuMsg === m.id ? null : m.id)}
                  >
                    <button
                      class="ac-msg-mas"
                      aria-label="Opciones"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuMsg(menuMsg === m.id ? null : m.id);
                      }}
                    >
                      <span class="ac-icon">expand_more</span>
                    </button>
                    {grupo && !own && (
                      <div class="ac-msg-nombre">
                        {m.data.sender.nombre}
                        {m.data.sender.tipo === 'agent' && (
                          <span class="ac-badge-soporte">SOPORTE ADITUM</span>
                        )}
                      </div>
                    )}
                    {m.data.replyTo && (
                      <div class="ac-reply-ref">
                        <span class="ac-reply-nombre">{m.data.replyTo.senderNombre}</span>
                        <span class="ac-reply-texto">{m.data.replyTo.texto}</span>
                      </div>
                    )}
                    <Adjuntos m={m.data} />
                    {m.data.texto && <div class="ac-msg-texto">{m.data.texto}</div>}
                    {m.data.ticketRef && (
                      <div class="ac-ticket-chip">
                        <span class="ac-icon">confirmation_number</span>
                        {formatTicketNumber(m.data.ticketRef.numero)}
                      </div>
                    )}
                    <div class="ac-msg-meta">
                      {m.data.editadoAt && <span>{t('chat.editado')} · </span>}
                      {formatTime(m.data.createdAt)}
                      {own && <span class="ac-icon ac-check">done_all</span>}
                    </div>
                    <Reacciones
                      fila={fila}
                      selfId={session.contactId}
                      onToggle={(emoji) =>
                        toggleReaction(fb, session, fila.convId, m.id, emoji, m.data.reacciones)
                      }
                    />
                    {menuMsg === m.id && (
                      <div class="ac-msg-menu" onClick={(e) => e.stopPropagation()}>
                        <div class="ac-msg-menu-emojis">
                          {EMOJIS.map((e2) => (
                            <button
                              key={e2}
                              onClick={() => {
                                setMenuMsg(null);
                                void toggleReaction(fb, session, fila.convId, m.id, e2, m.data.reacciones);
                              }}
                            >
                              {e2}
                            </button>
                          ))}
                        </div>
                        <button
                          class="ac-msg-menu-item"
                          onClick={() => {
                            setReplyTo(fila);
                            setEditando(null);
                            setMenuMsg(null);
                          }}
                        >
                          <span class="ac-icon">reply</span>
                          {session.idioma === 'es' ? 'Responder' : 'Reply'}
                        </button>
                        {own && m.data.tipoContenido === 'texto' && esActiva && (
                          <button
                            class="ac-msg-menu-item"
                            onClick={() => {
                              setEditando(fila);
                              setReplyTo(null);
                              setDraft(m.data.texto);
                              setMenuMsg(null);
                            }}
                          >
                            <span class="ac-icon">edit</span>
                            {session.idioma === 'es' ? 'Editar' : 'Edit'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {typingNames.length > 0 && (
          <div class="ac-msg ac-msg-other">
            <div class="ac-burbuja ac-typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}

        {mostrarChips && (
          <div class="ac-chips">
            <button class="ac-chip-sugerencia" onClick={onChipAgente}>
              {t('inicio.hablarAgente')}
            </button>
            <button
              class="ac-chip-sugerencia"
              onClick={() =>
                setDraft(
                  session.idioma === 'es' ? 'Tengo un problema con cobros' : 'I have a billing issue',
                )
              }
            >
              {session.idioma === 'es' ? 'Problema con cobros' : 'Billing issue'}
            </button>
            <button
              class="ac-chip-sugerencia"
              onClick={() =>
                setDraft(
                  session.idioma === 'es'
                    ? 'Consulta sobre reservas de amenidades'
                    : 'Amenity bookings question',
                )
              }
            >
              {session.idioma === 'es' ? 'Reservas de amenidades' : 'Amenity bookings'}
            </button>
          </div>
        )}
      </div>

      {(replyTo || editando) && (
        <div class="ac-composer-ctx">
          <span class="ac-icon">{editando ? 'edit' : 'reply'}</span>
          <span class="ac-composer-ctx-txt">
            {editando
              ? session.idioma === 'es'
                ? 'Editando mensaje'
                : 'Editing message'
              : `${replyTo!.msg.data.sender.nombre}: ${replyTo!.msg.data.texto.slice(0, 60)}`}
          </span>
          <button
            class="ac-icon-btn-dark"
            onClick={() => {
              setReplyTo(null);
              setEditando(null);
              setDraft('');
            }}
          >
            <span class="ac-icon">close</span>
          </button>
        </div>
      )}

      <div class="ac-composer">
        <input type="file" ref={fileRef} hidden onChange={onFile} accept="image/*,video/*,.pdf,.doc,.docx,.txt" />
        <button class="ac-comp-btn" aria-label="Adjuntar" onClick={() => fileRef.current?.click()}>
          <span class="ac-icon">attach_file</span>
        </button>
        <textarea
          class="ac-input"
          rows={1}
          placeholder={grupo ? t('chat.placeholderGrupo') : t('chat.placeholder')}
          value={draft}
          onInput={(e) => onInputDraft((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button class="ac-send" aria-label="Enviar" onClick={submit} disabled={!draft.trim()}>
          <span class="ac-icon">{editando ? 'check' : 'send'}</span>
        </button>
      </div>
    </div>
  );
}

function Adjuntos({ m }: { m: Message }) {
  if (!m.adjuntos?.length) return null;
  return (
    <div class="ac-adjuntos">
      {m.adjuntos.map((a, i) =>
        a.tipo === 'imagen' ? (
          <a key={i} href={a.url} target="_blank" rel="noopener">
            <img class="ac-adj-img" src={a.url} alt={a.nombre ?? 'imagen'} />
          </a>
        ) : a.tipo === 'video' ? (
          <video key={i} class="ac-adj-video" src={a.url} controls preload="metadata" />
        ) : (
          <a key={i} class="ac-adj-file" href={a.url} target="_blank" rel="noopener">
            <span class="ac-icon">description</span>
            {a.nombre ?? 'archivo'}
          </a>
        ),
      )}
    </div>
  );
}

function Reacciones({
  fila,
  selfId,
  onToggle,
}: {
  fila: Fila;
  selfId: string;
  onToggle(emoji: string): void;
}) {
  const entries = Object.entries(fila.msg.data.reacciones ?? {}).filter(([, ids]) => ids.length > 0);
  if (entries.length === 0) return null;
  return (
    <div class="ac-reacciones">
      {entries.map(([emoji, ids]) => (
        <button
          key={emoji}
          class={`ac-reaccion ${ids.includes(selfId) ? 'ac-reaccion-mia' : ''}`}
          onClick={() => onToggle(emoji)}
        >
          {emoji} {ids.length > 1 ? ids.length : ''}
        </button>
      ))}
    </div>
  );
}

function CsatCard({
  texto,
  enviado,
  gracias,
  onRate,
}: {
  texto: string;
  enviado: boolean;
  gracias: string;
  onRate(r: 1 | 2 | 3 | 4 | 5): void;
}) {
  const [hover, setHover] = useState(0);
  const [sel, setSel] = useState(0);
  return (
    <div class="ac-csat">
      <div class="ac-csat-txt">{enviado ? gracias : texto}</div>
      {!enviado && (
        <div class="ac-csat-stars">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              onClick={() => {
                setSel(n);
                onRate(n as 1 | 2 | 3 | 4 | 5);
              }}
              class={`ac-star ${n <= (hover || sel) ? 'ac-star-on' : ''}`}
            >
              <span class="ac-icon">star</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function iniciales(nombre: string): string {
  return nombre
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase();
}

function participantesResumen(conv: Doc<Conversation> | null): string {
  const info = conv?.data.participantesInfo;
  if (!info) return '';
  return Object.values(info)
    .map((p) => p.nombre.split(' ')[0])
    .slice(0, 5)
    .join(', ');
}

function dateSeparator(
  m: Doc<Message>,
  prev: Doc<Message> | undefined,
  idioma: 'es' | 'en',
): string | null {
  const d = toDate(m.data.createdAt);
  if (!d) return null;
  const p = prev ? toDate(prev.data.createdAt) : null;
  if (p && p.toDateString() === d.toDateString()) return null;
  const hoy = new Date();
  const ayer = new Date(Date.now() - 86400000);
  if (d.toDateString() === hoy.toDateString()) return idioma === 'es' ? 'HOY' : 'TODAY';
  if (d.toDateString() === ayer.toDateString()) return idioma === 'es' ? 'AYER' : 'YESTERDAY';
  return d
    .toLocaleDateString(idioma === 'es' ? 'es-CR' : 'en-US', { day: 'numeric', month: 'short' })
    .toUpperCase();
}
