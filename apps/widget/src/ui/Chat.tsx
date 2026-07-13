import type { VNode } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Conversation, Message, WidgetSessionResponse } from '@aditum-chat/shared';
import {
  categoryLabel,
  EMOJI_CATEGORIES,
  formatTicketNumber,
  makeT,
  widgetMessages,
} from '@aditum-chat/shared';
import {
  acceptAgentOffer,
  botFeedbackId,
  convSubcanal,
  editMessage,
  ensureDirectConversation,
  ensureGroupConversation,
  fetchOlderMessages,
  formatTime,
  markRead,
  sendAttachment,
  sendMessage,
  setTyping,
  submitBotFeedback,
  submitCsat,
  subscribeLatestMessages,
  subscribeMyBotFeedback,
  subscribeMyConversations,
  subscribeMyCsat,
  subscribeMyGroupConversations,
  subscribeTyping,
  toggleMute,
  toggleReaction,
  toDate,
  type Doc,
} from '../data.js';
import type { WidgetFirebase } from '../firebase.js';

const EMOJIS = ['👍', '❤️', '😂', '😮', '🙏'];
const PAGE = 30;
// Storage rules cap attachments at 25 MB; reject earlier for better UX.
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Convierte URLs del texto en enlaces clicables (resto queda como texto plano). */
function linkificar(texto: string): (string | VNode)[] {
  const out: (string | VNode)[] = [];
  const re = /(?:https?:\/\/|www\.)[^\s]+/gi;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    if (m.index > last) out.push(texto.slice(last, m.index));
    let url = m[0];
    const trail = url.match(/[.,;:!?)\]]+$/);
    const suffix = trail ? trail[0] : '';
    if (suffix) url = url.slice(0, -suffix.length);
    const href = url.startsWith('http') ? url : `https://${url}`;
    out.push(
      <a
        key={i++}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        class="ac-link-msg"
        onClick={(e) => e.stopPropagation()}
      >
        {url}
      </a>,
    );
    if (suffix) out.push(suffix);
    last = m.index + m[0].length;
  }
  if (last < texto.length) out.push(texto.slice(last));
  return out;
}

/**
 * Mini-markdown seguro para los mensajes (el bot responde con este formato):
 * **negrita**, *cursiva*, `código` y listas (- / 1.). Construye VNodes — nunca
 * HTML crudo — y linkifica las URLs de los tramos de texto plano.
 */
function renderInline(texto: string): (string | VNode)[] {
  const out: (string | VNode)[] = [];
  const re = /(`[^`\n]+`)|(\*\*[^*\n][^*]*?\*\*)|(\*[^*\s][^*\n]*?\*)/g;
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    if (m.index > last) out.push(...linkificar(texto.slice(last, m.index)));
    if (m[1]) out.push(<code key={`c${k++}`}>{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(<b key={`b${k++}`}>{renderInline(m[2].slice(2, -2))}</b>);
    else out.push(<i key={`i${k++}`}>{renderInline(m[3].slice(1, -1))}</i>);
    last = m.index + m[0].length;
  }
  if (last < texto.length) out.push(...linkificar(texto.slice(last)));
  return out;
}

function renderMarkdown(texto: string): (string | VNode)[] {
  const lines = texto.split('\n');
  const out: (string | VNode)[] = [];
  let i = 0;
  let k = 0;
  const BULLET = /^\s*[-*•]\s+(.*)$/;
  const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
  while (i < lines.length) {
    const esBullet = BULLET.test(lines[i]);
    const esOrdered = !esBullet && ORDERED.test(lines[i]);
    if (esBullet || esOrdered) {
      const re = esBullet ? BULLET : ORDERED;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) {
        items.push(re.exec(lines[i])![1]);
        i++;
      }
      const li = items.map((it, j) => <li key={j}>{renderInline(it)}</li>);
      out.push(esOrdered ? <ol key={`l${k++}`}>{li}</ol> : <ul key={`l${k++}`}>{li}</ul>);
      continue;
    }
    out.push(...renderInline(lines[i]));
    if (i < lines.length - 1) out.push('\n');
    i++;
  }
  return out;
}

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
  /** Abre el detalle de un ticket (chip de ticket en los mensajes). */
  onIrTicket?(ticketId: string): void;
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
  onIrTicket,
}: Props) {
  const t = makeT(widgetMessages, session.idioma);
  const grupo = tipo === 'grupo';

  // --- Conversaciones del hilo (asc: vieja → nueva). El hilo nunca se pierde:
  // se muestran TODAS las conversaciones del contacto, resueltas incluidas.
  const [convsDesc, setConvsDesc] = useState<Doc<Conversation>[]>([]);
  const [convsCargadas, setConvsCargadas] = useState(false);
  useEffect(() => {
    if (grupo) {
      // El chat grupal se segmenta como las directas: todos los segmentos del
      // cliente, activa = la más reciente no resuelta.
      return subscribeMyGroupConversations(fb, session, (list) => {
        setConvsDesc(list);
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

  // Conversaciones ya calificadas por este contacto (persiste entre recargas,
  // sin depender del trigger de functions).
  const [csatRateados, setCsatRateados] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (grupo) return;
    return subscribeMyCsat(fb, session, setCsatRateados);
  }, [fb, session, grupo]);
  const ratingDe = useCallback(
    (convId: string): 1 | 2 | 3 | 4 | 5 | undefined =>
      (csatRateados.get(convId) as 1 | 2 | 3 | 4 | 5 | undefined) ??
      convPorId.get(convId)?.data.csatRating,
    [csatRateados, convPorId],
  );

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

  // Hilo final. Dedup por clave COMPUESTA convId+msgId: el mismo mensaje puede
  // quedar dos veces (al cambiar de conversación se vuelca lo vivo a `viejos` y
  // luego `loadOlder` re-fetchea esa conversación), y los mensajes automáticos con
  // id fijo (_bienvenida/_autorespuesta) se repiten entre conversaciones.
  const filas = useMemo(() => {
    const seen = new Set<string>();
    const out: Fila[] = [];
    for (const f of [...viejos, ...liveMsgs]) {
      const k = `${f.convId}_${f.msg.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (!f.msg.data.interno) out.push(f);
    }
    return out;
  }, [viejos, liveMsgs]);

  // Conversaciones que ya tienen tarjeta CSAT cargada (para no duplicar el
  // separador "resuelta" cuando la encuesta actúa como cierre).
  const convsConCsat = useMemo(() => {
    const s = new Set<string>();
    for (const f of filas) if (f.msg.data.tipoContenido === 'csat') s.add(f.convId);
    return s;
  }, [filas]);

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

  // Si el bot escala, pasar al chat de agente. La señal principal es escaladoAt
  // (timestamp que SIEMPRE crece al escalar — re-escalar a la misma conversación
  // no cambia escaladoA); fallback a escaladoA para datos sin el campo nuevo.
  const escaladoVisto = useRef<number | undefined>(undefined);
  const escaladoIdVisto = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    // La línea base se fija recién con el PRIMER snapshot cargado: si se fijara
    // antes (baseline 0/null), el escaladoAt histórico de una conversación ya
    // resuelta parecería un escalamiento nuevo y redirigiría al canal agente
    // cada vez que el usuario vuelve a "Preguntas del sistema".
    if (grupo || modo !== 'bot' || !convsCargadas) return;
    const actualAt = toDate(activa?.data.escaladoAt)?.getTime() ?? 0;
    const actualId = activa?.data.escaladoA ?? null;
    if (escaladoVisto.current === undefined) {
      // Línea base al montar: no saltar por escalados viejos.
      escaladoVisto.current = actualAt;
      escaladoIdVisto.current = actualId;
      return;
    }
    const saltarPorAt = actualAt > escaladoVisto.current;
    const saltarPorId = !actualAt && actualId && actualId !== escaladoIdVisto.current;
    if (saltarPorAt || saltarPorId) {
      escaladoVisto.current = actualAt;
      escaladoIdVisto.current = actualId;
      onIrAgente?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupo, modo, convsCargadas, activa?.data.escaladoAt, activa?.data.escaladoA]);

  // --- Estado de UI del chat.
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<Fila | null>(null);
  const [editando, setEditando] = useState<Fila | null>(null);
  const [menuMsg, setMenuMsg] = useState<string | null>(null);
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const [csatEnviados, setCsatEnviados] = useState<Set<string>>(new Set());
  // Conversaciones cuyo "¡Gracias!" se muestra transitoriamente tras calificar
  // (luego la tarjeta desaparece; en recargas ya no vuelve a salir).
  const [graciasVisibles, setGraciasVisibles] = useState<Set<string>>(new Set());
  const calificar = useCallback(
    async (convId: string, r: 1 | 2 | 3 | 4 | 5) => {
      setCsatEnviados((s) => new Set(s).add(convId));
      setGraciasVisibles((s) => new Set(s).add(convId));
      window.setTimeout(() => {
        setGraciasVisibles((s) => {
          const n = new Set(s);
          n.delete(convId);
          return n;
        });
      }, 3500);
      await submitCsat(fb, session, convId, r);
    },
    [fb, session],
  );
  // --- Feedback de utilidad del bot ("¿te sirvió esta respuesta?").
  // Votos persistidos (bot_feedback) + optimistas (clic inmediato); key = botFeedbackId.
  const [misVotos, setMisVotos] = useState<Map<string, boolean>>(new Map());
  const [votosOptimistas, setVotosOptimistas] = useState<Map<string, boolean>>(new Map());
  // Oferta "¿querés hablar con un agente?" abierta tras un 👎 (docId del voto).
  const [ofertaAbierta, setOfertaAbierta] = useState<string | null>(null);
  const [ofertaPendiente, setOfertaPendiente] = useState(false);
  const ofertaTimer = useRef<number | null>(null);
  useEffect(() => {
    if (grupo || modo !== 'bot') return;
    return subscribeMyBotFeedback(fb, session, setMisVotos);
  }, [fb, session, grupo, modo]);
  useEffect(
    () => () => {
      if (ofertaTimer.current) window.clearTimeout(ofertaTimer.current);
    },
    [],
  );
  const voteOf = useCallback(
    (fila: Fila): boolean | undefined => {
      const id = botFeedbackId(fila.convId, fila.msg.id);
      const optimista = votosOptimistas.get(id);
      if (optimista !== undefined) return optimista;
      const persistido = misVotos.get(id);
      if (persistido !== undefined) return persistido;
      const stamped = fila.msg.data.feedback;
      return stamped === undefined ? undefined : stamped === 'helpful';
    },
    [votosOptimistas, misVotos],
  );
  const voteFeedback = useCallback(
    (fila: Fila, helpful: boolean) => {
      if (voteOf(fila) !== undefined) return; // ya votado (doble clic)
      const id = botFeedbackId(fila.convId, fila.msg.id);
      setVotosOptimistas((v) => new Map(v).set(id, helpful));
      if (!helpful) setOfertaAbierta(id);
      // permission-denied = ya existía el voto; el estado real llega por suscripción.
      void submitBotFeedback(fb, session, fila.convId, fila.msg.id, helpful).catch(() => {});
    },
    [fb, session, voteOf],
  );
  const acceptOffer = useCallback(
    (fila: Fila) => {
      setOfertaPendiente(true);
      void acceptAgentOffer(fb, fila.convId, fila.msg.id).catch(() => {});
      // Respaldo: si el trigger no marcó escaladoAt en ~10s, navegar igual.
      ofertaTimer.current = window.setTimeout(() => {
        setOfertaAbierta(null);
        setOfertaPendiente(false);
        onIrAgente?.();
      }, 10000);
    },
    [fb, onIrAgente],
  );
  const declineOffer = useCallback(() => {
    setOfertaAbierta(null);
    setOfertaPendiente(false);
  }, []);

  // --- Indicador "el bot está pensando": se activa localmente al enviar en el
  // canal bot y se apaga cuando llega la respuesta (o a los 45s de respaldo).
  const [esperandoBot, setEsperandoBot] = useState(false);
  const esperandoBotTimer = useRef<number | null>(null);
  const marcarEsperandoBot = useCallback(() => {
    setEsperandoBot(true);
    if (esperandoBotTimer.current) window.clearTimeout(esperandoBotTimer.current);
    esperandoBotTimer.current = window.setTimeout(() => setEsperandoBot(false), 45000);
  }, []);
  useEffect(
    () => () => {
      if (esperandoBotTimer.current) window.clearTimeout(esperandoBotTimer.current);
    },
    [],
  );

  // --- WhatsApp-style emoji picker in the composer.
  const [showEmoji, setShowEmoji] = useState(false);

  // --- WhatsApp-style staged attachment: pick → preview + caption → send as one message.
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const attachErrorTimer = useRef<number | null>(null);
  const pendingFileUrl = useMemo(
    () =>
      pendingFile && pendingFile.type.startsWith('image/')
        ? URL.createObjectURL(pendingFile)
        : null,
    [pendingFile],
  );
  useEffect(
    () => () => {
      if (pendingFileUrl) URL.revokeObjectURL(pendingFileUrl);
    },
    [pendingFileUrl],
  );
  useEffect(
    () => () => {
      if (attachErrorTimer.current) window.clearTimeout(attachErrorTimer.current);
    },
    [],
  );

  const bodyRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
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
    } else if (prevUltimoId.current !== ultimoId || typingNames.length > 0 || esperandoBot) {
      el.scrollTo({ top: el.scrollHeight });
      if (activa?.id) markRead(fb, session, activa.id);
    }
    prevUltimoId.current = ultimoId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filas.length, typingNames.length, esperandoBot]);

  // Apagar el "pensando" cuando llega cualquier mensaje que no sea del usuario
  // (respuesta del bot, o sistema si escaló).
  useEffect(() => {
    if (!esperandoBot) return;
    const last = filas[filas.length - 1];
    if (last && last.msg.data.sender.tipo !== 'user') {
      setEsperandoBot(false);
      if (esperandoBotTimer.current) window.clearTimeout(esperandoBotTimer.current);
    }
  }, [filas, esperandoBot]);

  // Auto-relleno del historial: si el contenido no llena el viewport y hay más
  // (conversaciones/segmentos anteriores), cargar páginas hacia atrás. El usuario
  // no puede hacer scroll para dispararlo cuando la conversación activa es corta
  // (p. ej. un segmento de grupo recién abierto con 1 mensaje).
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || cargandoMas || filas.length === 0) return;
    if (hayMas && el.scrollHeight <= el.clientHeight + 8) {
      ajusteScroll.current = el.scrollHeight;
      void loadOlder();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filas.length, hayMas, cargandoMas]);

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

  /** Scroll al mensaje original de un reply (estilo WhatsApp) + resaltado breve. */
  function irAMensaje(messageId: string) {
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-msgid="${messageId}"]`);
    if (!el) return; // puede no estar cargado aún (historial paginado)
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('ac-burbuja-resaltada');
    // reflow para reiniciar la animación si se toca dos veces seguidas
    void el.offsetWidth;
    el.classList.add('ac-burbuja-resaltada');
    window.setTimeout(() => el.classList.remove('ac-burbuja-resaltada'), 1600);
  }

  const estado = activa?.data.estado ?? modo;
  // Título: el NOMBRE de quien atiende (agente asignado o bot), no la marca.
  const headerTitle = grupo
    ? (activa?.data.groupName ?? activa?.data.clientNombre ?? t('chat.equipoAdministrador'))
    : estado === 'bot'
      ? session.botConfig.nombre
      : (activa?.data.asignadoNombre ?? session.widgetConfig.titulo);
  const headerSub =
    esperandoBot && estado === 'bot'
      ? `${session.botConfig.nombre} ${t('chat.escribiendo')}`
      : typingNames.length > 0
      ? `${typingNames.join(', ')} ${t('chat.escribiendo')}`
      : grupo
        ? participantesResumen(activa)
        : estado === 'bot' || activa?.data.asignadoNombre
          ? t('chat.enLinea')
          : t('chat.soporte');

  // Saludo del BOT (primer mensaje, antes de escribir). El mensaje REAL lo crea el
  // trigger al crear la conversación; esta versión VIRTUAL cubre el momento previo
  // a escribir (activa resuelta o sin mensajes) y se oculta al llegar el real.
  // El canal de AGENTE NO muestra saludo antes de escribir: responde después del
  // primer mensaje (auto-respuesta / fuera de horario, vía trigger).
  const esBotCanal = !grupo && session.botConfig.activo && modo === 'bot';
  const bienvenida = (session.widgetConfig.mensajeAI?.trim() || session.botConfig.saludo || '')
    .replace(/\{nombre\}/g, session.nombre.split(' ')[0]);
  const mostrarBienvenida =
    esBotCanal &&
    !!bienvenida &&
    (!activa || activa.data.estado === 'resolved' || filas.length === 0);

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
    if (activa && activa.data.estado !== 'resolved') return activa.id;
    // Resuelta (o sin activa): se abre un segmento nuevo — el historial anterior
    // queda con su cierre, igual que en las directas.
    return grupo
      ? ensureGroupConversation(fb, session)
      : ensureDirectConversation(fb, session, session.nombre, modo);
  }

  async function submit() {
    setShowEmoji(false);
    const texto = draft.trim();
    if (editando) {
      if (!texto) return;
      setDraft('');
      await editMessage(fb, editando.convId, editando.msg.id, texto, editando.msg.data.texto);
      setEditando(null);
      return;
    }
    if (pendingFile) {
      // Attachment + caption go out together as a single message.
      if (uploading) return;
      setUploading(true);
      try {
        const convId = await convParaEscribir();
        setTyping(fb, session, convId, false);
        await sendAttachment(
          fb,
          session,
          convId,
          session.nombre,
          pendingFile,
          grupo ? activa?.data.participantes : undefined,
          texto,
        );
        setDraft('');
        setPendingFile(null);
        setReplyTo(null);
        // Solo si el bot sigue atendiendo (si un agente tomó el chat, no responde el bot).
        if (esBotCanal && estado === 'bot') marcarEsperandoBot();
      } finally {
        setUploading(false);
      }
      return;
    }
    if (!texto) return;
    setDraft('');
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
    // El bot va a procesar este mensaje: mostrar el "escribiendo…" de una.
    // Solo si el bot sigue atendiendo (si un agente tomó el chat, no responde el bot).
    if (esBotCanal && estado === 'bot') marcarEsperandoBot();
  }

  /** Inserts an emoji at the caret position, keeping focus in the textarea. */
  function insertEmoji(emoji: string) {
    const el = inputRef.current;
    const focused = el && (el.getRootNode() as ShadowRoot | Document).activeElement === el;
    const start = focused ? (el.selectionStart ?? draft.length) : draft.length;
    const end = focused ? (el.selectionEnd ?? draft.length) : draft.length;
    onInputDraft(draft.slice(0, start) + emoji + draft.slice(end));
    el?.focus();
    requestAnimationFrame(() => {
      if (!el) return;
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function onFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setAttachError(
        session.idioma === 'es' ? 'El archivo supera los 25 MB' : 'File exceeds 25 MB',
      );
      if (attachErrorTimer.current) window.clearTimeout(attachErrorTimer.current);
      attachErrorTimer.current = window.setTimeout(() => setAttachError(null), 4000);
      return;
    }
    setAttachError(null);
    // Stage it (replacing any previous pick); it is sent from submit() with the caption.
    setPendingFile(file);
    inputRef.current?.focus();
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
            session.botConfig.avatarUrl ? (
              <img class="ac-avatar-img" src={session.botConfig.avatarUrl} alt="" />
            ) : (
              <span class="ac-icon">smart_toy</span>
            )
          ) : activa?.data.asignadoFoto ? (
            <img class="ac-avatar-img" src={activa.data.asignadoFoto} alt="" />
          ) : activa?.data.asignadoNombre ? (
            iniciales(activa.data.asignadoNombre)
          ) : (
            (session.widgetConfig.titulo[0] ?? 'A').toUpperCase()
          )}
        </div>
        <div class="ac-chat-htxt">
          <div class="ac-chat-htitle">
            {headerTitle}
            {!grupo && estado === 'bot' && <span class="ac-chip-ai">AI</span>}
          </div>
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
          const next = filas[i + 1];
          const cambioConv = prev && prev.convId !== fila.convId;
          const finDeConv = !next || next.convId !== fila.convId;
          const sep = dateSeparator(m, cambioConv ? undefined : prev?.msg, session.idioma);
          const own = m.data.sender.id === session.contactId;
          const sistema = m.data.sender.tipo === 'sistema';
          const csat = m.data.tipoContenido === 'csat';
          const esActiva = fila.convId === activa?.id;
          const conv = convPorId.get(fila.convId);
          const resuelta = conv?.data.estado === 'resolved';
          // ¿Ya calificó esta conversación? Si sí, la tarjeta se oculta salvo el
          // "¡Gracias!" transitorio justo tras calificar.
          const yaCalifico = !!ratingDe(fila.convId) || csatEnviados.has(fila.convId);
          const mostrarGracias = graciasVisibles.has(fila.convId);
          const mostrarCsat = !yaCalifico || mostrarGracias;
          // Marca "resuelta" derivada del estado (aparece de una, sin esperar
          // el siguiente mensaje): encima de la tarjeta CSAT, o al final de la
          // conversación si se resolvió sin encuesta.
          // El separador de "resuelta" sí se muestra en grupos (marca el cierre de
          // un segmento del historial); la encuesta CSAT no (queda con !grupo abajo).
          const marcaResueltaAntes = resuelta && csat;
          const marcaResueltaDespues =
            resuelta && finDeConv && !csat && !convsConCsat.has(fila.convId);
          const separadorResuelta = (
            <div class="ac-sep ac-sep-conv">
              <span class="ac-icon">check_circle</span>
              {conv?.data.categoria
                ? t('chat.convResuelta', {
                    categoria: categoryLabel(conv.data.categoria, session.idioma),
                  })
                : t('chat.convResueltaSin')}
            </div>
          );

          return (
            <div key={`${fila.convId}_${m.id}`}>
              {noLeidoDesde === m.id && (
                <div class="ac-sep ac-sep-noleidos" data-noleidos>
                  {unreadAlAbrir === 1
                    ? t('chat.noLeido1')
                    : t('chat.noLeidos', { n: unreadAlAbrir })}
                </div>
              )}
              {sep && <div class="ac-sep">{sep}</div>}
              {marcaResueltaAntes && separadorResuelta}
              {csat ? (
                mostrarCsat && (
                  <CsatCard
                    texto={m.data.texto}
                    enviado={csatEnviados.has(fila.convId) || !esActiva || !!ratingDe(fila.convId)}
                    rating={ratingDe(fila.convId)}
                    gracias={t('csat.gracias')}
                    onRate={(r) => {
                      if (csatEnviados.has(fila.convId) || ratingDe(fila.convId)) return;
                      void calificar(fila.convId, r);
                    }}
                  />
                )
              ) : sistema ? (
                <div class="ac-msg-sistema">
                  {m.data.texto}
                  {m.data.ticketRef &&
                    (onIrTicket ? (
                      <button
                        type="button"
                        class="ac-ticket-chip ac-ticket-chip-btn"
                        onClick={() => onIrTicket(m.data.ticketRef!.ticketId)}
                      >
                        <span class="ac-icon">confirmation_number</span>
                        {formatTicketNumber(m.data.ticketRef.numero)}
                      </button>
                    ) : (
                      <span class="ac-ticket-chip">
                        <span class="ac-icon">confirmation_number</span>
                        {formatTicketNumber(m.data.ticketRef.numero)}
                      </span>
                    ))}
                </div>
              ) : (
                <div class={`ac-msg ${own ? 'ac-msg-own' : 'ac-msg-other'}`}>
                  {!own && (
                    <div class="ac-msg-avatar" data-tipo={m.data.sender.tipo}>
                      {m.data.sender.tipo === 'bot' ? (
                        session.botConfig.avatarUrl ? (
                          <img class="ac-avatar-img" src={session.botConfig.avatarUrl} alt="" />
                        ) : (
                          <span class="ac-icon">smart_toy</span>
                        )
                      ) : (
                        iniciales(m.data.sender.nombre)
                      )}
                    </div>
                  )}
                  <div
                    class={`ac-burbuja ${own ? 'ac-burbuja-own' : ''}`}
                    data-msgid={m.id}
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
                      <button
                        type="button"
                        class="ac-reply-ref"
                        onClick={(e) => {
                          e.stopPropagation();
                          irAMensaje(m.data.replyTo!.messageId);
                        }}
                      >
                        <span class="ac-reply-nombre">{m.data.replyTo.senderNombre}</span>
                        <span class="ac-reply-texto">{m.data.replyTo.texto}</span>
                      </button>
                    )}
                    <Adjuntos m={m.data} />
                    {m.data.texto && <div class="ac-msg-texto">{renderMarkdown(m.data.texto)}</div>}
                    {m.data.ticketRef &&
                      (onIrTicket ? (
                        <button
                          type="button"
                          class="ac-ticket-chip ac-ticket-chip-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            onIrTicket(m.data.ticketRef!.ticketId);
                          }}
                        >
                          <span class="ac-icon">confirmation_number</span>
                          {formatTicketNumber(m.data.ticketRef.numero)}
                        </button>
                      ) : (
                        <div class="ac-ticket-chip">
                          <span class="ac-icon">confirmation_number</span>
                          {formatTicketNumber(m.data.ticketRef.numero)}
                        </div>
                      ))}
                    <div class="ac-msg-meta">
                      {m.data.editadoAt && (
                        <span class="ac-editado">
                          {t('chat.editado')}
                          {m.data.textoAnterior && (
                            <span class="ac-editado-tip">
                              <b>{t('chat.versionAnterior')}</b>
                              <span>{m.data.textoAnterior}</span>
                            </span>
                          )}
                          <span> · </span>
                        </span>
                      )}
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
                            // Foco inmediato en el input para responder de una vez.
                            requestAnimationFrame(() => inputRef.current?.focus());
                          }}
                        >
                          <span class="ac-icon">reply</span>
                          {session.idioma === 'es' ? 'Responder' : 'Reply'}
                        </button>
                        {m.data.texto && (
                          <button
                            class="ac-msg-menu-item"
                            onClick={() => {
                              setMenuMsg(null);
                              void navigator.clipboard?.writeText(m.data.texto);
                            }}
                          >
                            <span class="ac-icon">content_copy</span>
                            {session.idioma === 'es' ? 'Copiar' : 'Copy'}
                          </button>
                        )}
                        {own && m.data.tipoContenido === 'texto' && esActiva && (
                          <button
                            class="ac-msg-menu-item"
                            onClick={() => {
                              setEditando(fila);
                              setReplyTo(null);
                              setDraft(m.data.texto);
                              setMenuMsg(null);
                              requestAnimationFrame(() => inputRef.current?.focus());
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
              {/* Feedback "¿te sirvió?" bajo cada respuesta del bot (solo canal bot). */}
              {esBotCanal &&
                m.data.sender.tipo === 'bot' &&
                m.data.tipoContenido === 'texto' &&
                !m.data.bienvenida && (
                  <>
                    <BotFeedbackRow
                      pregunta={t('bot.feedbackPregunta')}
                      si={t('bot.feedbackSi')}
                      no={t('bot.feedbackNo')}
                      gracias={t('bot.feedbackGracias')}
                      voto={voteOf(fila)}
                      interactivo={esActiva && !resuelta}
                      onVote={(helpful) => voteFeedback(fila, helpful)}
                    />
                    {ofertaAbierta === botFeedbackId(fila.convId, m.id) && (
                      <AgentOfferCard
                        pregunta={t('bot.ofertaAgente')}
                        si={t('bot.ofertaSi')}
                        no={t('bot.ofertaNo')}
                        pasando={t('bot.ofertaPasando')}
                        pendiente={ofertaPendiente}
                        onAccept={() => acceptOffer(fila)}
                        onDecline={declineOffer}
                      />
                    )}
                  </>
                )}
              {marcaResueltaDespues && (
                <>
                  {separadorResuelta}
                  {/* La encuesta CSAT es solo para el canal de agente: nunca en el
                      chat de grupo ni en el canal bot (ahí el feedback 👍/👎 ya
                      capturó la satisfacción). */}
                  {!grupo && !esBotCanal && esActiva && mostrarCsat && (
                    <CsatCard
                      texto={t('csat.pregunta')}
                      enviado={csatEnviados.has(fila.convId) || !!ratingDe(fila.convId)}
                      rating={ratingDe(fila.convId)}
                      gracias={t('csat.gracias')}
                      onRate={(r) => {
                        if (csatEnviados.has(fila.convId) || ratingDe(fila.convId)) return;
                        void calificar(fila.convId, r);
                      }}
                    />
                  )}
                </>
              )}
            </div>
          );
        })}

        {mostrarBienvenida && (
          <div class="ac-msg ac-msg-other ac-bienvenida">
            <div class="ac-msg-avatar" data-tipo={esBotCanal ? 'bot' : 'agent'}>
              <span class="ac-icon">{esBotCanal ? 'smart_toy' : 'support_agent'}</span>
            </div>
            <div class="ac-burbuja">
              <div class="ac-msg-texto">{renderMarkdown(bienvenida)}</div>
            </div>
          </div>
        )}

        {(typingNames.length > 0 || esperandoBot) && (
          <div class="ac-msg ac-msg-other">
            {esperandoBot && (
              <div class="ac-msg-avatar" data-tipo="bot">
                {session.botConfig.avatarUrl ? (
                  <img class="ac-avatar-img" src={session.botConfig.avatarUrl} alt="" />
                ) : (
                  <span class="ac-icon">smart_toy</span>
                )}
              </div>
            )}
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

      {pendingFile && !editando && (
        <div class="ac-attach-preview">
          {pendingFileUrl ? (
            <img class="ac-attach-thumb" src={pendingFileUrl} alt="" />
          ) : (
            <span class="ac-attach-file-icon ac-icon">
              {pendingFile.type.startsWith('video/') ? 'movie' : 'description'}
            </span>
          )}
          <div class="ac-attach-meta">
            <span class="ac-attach-name">{pendingFile.name}</span>
            <span class="ac-attach-size">{formatBytes(pendingFile.size)}</span>
          </div>
          <button
            class="ac-icon-btn-dark"
            aria-label={session.idioma === 'es' ? 'Quitar adjunto' : 'Remove attachment'}
            onClick={() => setPendingFile(null)}
            disabled={uploading}
          >
            <span class="ac-icon">close</span>
          </button>
        </div>
      )}
      {attachError && <div class="ac-attach-error">{attachError}</div>}

      {showEmoji && (
        <div class="ac-emoji-panel">
          {EMOJI_CATEGORIES.map((cat) => (
            <div key={cat.label.es}>
              <div class="ac-emoji-cat">{cat.label[session.idioma]}</div>
              <div class="ac-emoji-grid">
                {cat.emojis.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    class="ac-emoji-btn"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertEmoji(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div class="ac-composer">
        <input type="file" ref={fileRef} hidden onChange={onFile} accept="image/*,video/*,.pdf,.doc,.docx,.txt,.xlsx,.xls,.csv" />
        <button
          class={`ac-comp-btn${showEmoji ? ' ac-comp-btn-activo' : ''}`}
          aria-label="Emoji"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setShowEmoji((v) => !v)}
        >
          <span class="ac-icon">{showEmoji ? 'keyboard' : 'mood'}</span>
        </button>
        {/* En el canal bot el clip es configurable por sitio (botConfig.adjuntos). */}
        {!(esBotCanal && session.botConfig.adjuntos === false) && (
          <button class="ac-comp-btn" aria-label="Adjuntar" onClick={() => fileRef.current?.click()}>
            <span class="ac-icon">attach_file</span>
          </button>
        )}
        <textarea
          ref={inputRef}
          class="ac-input"
          rows={1}
          placeholder={
            pendingFile && !editando
              ? session.idioma === 'es'
                ? 'Agregá un comentario…'
                : 'Add a caption…'
              : grupo
                ? t('chat.placeholderGrupo')
                : t('chat.placeholder')
          }
          value={draft}
          onInput={(e) => onInputDraft((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button
          class="ac-send"
          aria-label="Enviar"
          onClick={submit}
          disabled={(!draft.trim() && !(pendingFile && !editando)) || uploading}
        >
          <span class={`ac-icon${uploading ? ' ac-spin' : ''}`}>
            {uploading ? 'progress_activity' : editando ? 'check' : 'send'}
          </span>
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

/** Fila "¿Te sirvió esta respuesta? 👍 Sí / 👎 No" bajo una respuesta del bot. */
function BotFeedbackRow({
  pregunta,
  si,
  no,
  gracias,
  voto,
  interactivo,
  onVote,
}: {
  pregunta: string;
  si: string;
  no: string;
  gracias: string;
  voto: boolean | undefined;
  interactivo: boolean;
  onVote(helpful: boolean): void;
}) {
  if (voto !== undefined) {
    return (
      <div class="ac-feedback ac-feedback-enviado">
        <span class="ac-icon">{voto ? 'thumb_up' : 'thumb_down'}</span>
        {gracias}
      </div>
    );
  }
  if (!interactivo) return null;
  return (
    <div class="ac-feedback">
      <span class="ac-feedback-pregunta">{pregunta}</span>
      <button type="button" class="ac-feedback-btn" onClick={() => onVote(true)}>
        <span class="ac-icon">thumb_up</span>
        {si}
      </button>
      <button type="button" class="ac-feedback-btn" onClick={() => onVote(false)}>
        <span class="ac-icon">thumb_down</span>
        {no}
      </button>
    </div>
  );
}

/** Oferta "¿Querés hablar con un agente?" tras un voto negativo. */
function AgentOfferCard({
  pregunta,
  si,
  no,
  pasando,
  pendiente,
  onAccept,
  onDecline,
}: {
  pregunta: string;
  si: string;
  no: string;
  pasando: string;
  pendiente: boolean;
  onAccept(): void;
  onDecline(): void;
}) {
  return (
    <div class="ac-oferta">
      <div class="ac-oferta-pregunta">{pendiente ? pasando : pregunta}</div>
      {!pendiente && (
        <div class="ac-oferta-botones">
          <button type="button" class="ac-oferta-btn ac-oferta-btn-si" onClick={onAccept}>
            <span class="ac-icon">support_agent</span>
            {si}
          </button>
          <button type="button" class="ac-oferta-btn" onClick={onDecline}>
            {no}
          </button>
        </div>
      )}
    </div>
  );
}

function CsatCard({
  texto,
  enviado,
  rating,
  gracias,
  onRate,
}: {
  texto: string;
  enviado: boolean;
  rating?: 1 | 2 | 3 | 4 | 5;
  gracias: string;
  onRate(r: 1 | 2 | 3 | 4 | 5): void;
}) {
  const [hover, setHover] = useState(0);
  const [sel, setSel] = useState(0);
  const marcadas = rating || sel;
  return (
    <div class="ac-csat">
      <div class="ac-csat-txt">{enviado ? gracias : texto}</div>
      {enviado ? (
        marcadas > 0 && (
          <div class="ac-csat-stars ac-csat-stars-ro">
            {[1, 2, 3, 4, 5].map((n) => (
              <span key={n} class={`ac-star ${n <= marcadas ? 'ac-star-on' : ''}`}>
                <span class="ac-icon">star</span>
              </span>
            ))}
          </div>
        )
      ) : (
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
