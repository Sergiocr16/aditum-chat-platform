'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { httpsCallable } from 'firebase/functions';
import type { Attachment, Conversation, Idioma, Message } from '@aditum-chat/shared';
import { categoryLabel, EMOJI_CATEGORIES, formatTicketNumber } from '@aditum-chat/shared';
import { fns } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import {
  agentEditMessage,
  agentSendAttachment,
  agentSendMessage,
  ensureAgentConversation,
  ensureAgentGroupConversation,
  fmtHora,
  iniciales,
  toggleReaction,
  updateConversation,
  useContactThread,
  useCsat,
  useGroupThread,
  useTeam,
  type Row,
  type ThreadRow,
} from '@/lib/data';
import { ConvertTicketModal } from './ConvertTicketModal';
import { useMediaQuery } from './ResizeHandle';
import { ResolveModal } from './ResolveModal';
import { TicketDetailModal } from './TicketDetailModal';
import { VisorAdjuntos, type VisorItem } from './VisorAdjuntos';

export interface ConversationViewHandle {
  scrollToConversation(convId: string): void;
  /** Refresca el bloque de una conversación (mensaje nuevo, p. ej. ticket) y salta a ella. */
  refrescarYVer(convId: string): Promise<void>;
}

const EMOJIS = ['👍', '❤️', '😂', '😮', '🙏'];
// Storage rules cap attachments at 25 MB; reject earlier for better UX.
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const ConversationView = forwardRef<
  ConversationViewHandle,
  {
    conv: Row<Conversation>;
    onBack?: () => void;
    /** Abre otra conversación en el inbox (ej. "Ver conversación del bot"). */
    onOpenConversation?: (convId: string) => void;
    /** Opens the context panel as a mobile drawer (button only shows below lg). */
    onOpenContext?: () => void;
    /** Estado del panel de contexto colapsado (escritorio). */
    ctxColapsado?: boolean;
    /** Toggle del panel de contexto (escritorio); si no viene, no hay panel. */
    onToggleCtx?: () => void;
  }
>(function ConversationView(
  { conv, onBack, onOpenConversation, onOpenContext, ctxColapsado, onToggleCtx },
  ref,
) {
  const { agent } = useAuth();
  const t = useT();
  const esSm = useMediaQuery('(min-width: 640px)');
  const team = useTeam();
  const idioma = agent?.idioma ?? 'es';
  const c = conv.data;
  const grupo = c.tipo === 'grupo';

  // Ambos son hilos continuos segmentados: el grupo encadena sus segmentos por
  // cliente; la directa, las conversaciones del contacto.
  const directaThread = useContactThread(grupo ? null : (c.contactId ?? null));
  const grupoThread = useGroupThread(grupo ? (c.groupId ?? null) : null);
  const thread = grupo ? grupoThread : directaThread;

  const filas: ThreadRow[] = thread.filas;
  const hayMas = thread.hayMas;
  const cargando = thread.cargando;
  const listo = thread.listo;
  const loadOlder = thread.loadOlder;
  const activa = thread.activa ?? conv;
  const convPorId = thread.convPorId;

  // Live agent-channel conversation. Agent replies always go to this channel:
  // the bot channel is a separate registry the console never writes into
  // (legacy docs without subcanal count as 'agente'). Map preserves the
  // updatedAt-desc order of the thread, so the first match is the freshest.
  const activaAgente = useMemo(
    () =>
      [...convPorId.values()].find(
        (cv) => (cv.data.subcanal ?? 'agente') === 'agente' && cv.data.estado !== 'resolved',
      ) ?? null,
    [convPorId],
  );
  // Resolve targets the live agent conversation; with only a live bot doc it
  // lets the console close that one (registry hygiene).
  const convResolver = activaAgente ?? (activa.data.estado !== 'resolved' ? activa : null);

  // Visor de adjuntos: galería con las imágenes y PDFs del hilo cargado.
  const galeria = useMemo<VisorItem[]>(
    () =>
      filas.flatMap((f) =>
        (f.msg.data.adjuntos ?? [])
          .filter((a) => a.url && (a.tipo === 'imagen' || (a.tipo === 'archivo' && esPdf(a))))
          .map((a) => ({
            url: a.url!,
            nombre: a.nombre ?? 'archivo',
            esPdf: a.tipo !== 'imagen',
          })),
      ),
    [filas],
  );
  const [visorIdx, setVisorIdx] = useState<number | null>(null);
  const abrirVisor = (url: string) => {
    const i = galeria.findIndex((g) => g.url === url);
    if (i >= 0) setVisorIdx(i);
  };

  const [tab, setTab] = useState<'responder' | 'nota'>('responder');
  const [draft, setDraft] = useState('');
  const [showConvert, setShowConvert] = useState(false);
  const [showAsignar, setShowAsignar] = useState(false);
  const [showResolve, setShowResolve] = useState(false);
  const [verTicketId, setVerTicketId] = useState<string | null>(null);
  const [sugiriendo, setSugiriendo] = useState(false);
  // Suggestion review modal: null = closed, '' with error flag = failed.
  const [sugerencia, setSugerencia] = useState<string | null>(null);
  const [sugerenciaError, setSugerenciaError] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [enElFondo, setEnElFondo] = useState(true);
  const [replyTo, setReplyTo] = useState<{
    messageId: string;
    texto: string;
    senderNombre: string;
  } | null>(null);
  const [menuMsg, setMenuMsg] = useState<string | null>(null);
  const [editando, setEditando] = useState<{ convId: string; msgId: string; texto: string } | null>(
    null,
  );
  // WhatsApp-style emoji picker in the composer.
  const [showEmoji, setShowEmoji] = useState(false);

  // WhatsApp-style staged attachment: pick → preview + caption → send as one message.
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
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

  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // WhatsApp-style auto-grow: the textarea tracks its content height
  // (the CSS max-height caps it; beyond that it scrolls).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (!draft) {
      // Empty: let CSS size it naturally (measuring at mount can freeze
      // fallback-font metrics before the webfont loads).
      el.style.height = '';
      return;
    }
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [draft, tab]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const ajusteScroll = useRef<number | null>(null);
  const enElFondoRef = useRef(true);
  const hayMasRef = useRef(hayMas);
  useEffect(() => {
    hayMasRef.current = hayMas;
  }, [hayMas]);

  const nombre = grupo ? (c.groupName ?? c.clientNombre ?? 'Equipo') : (c.contactNombre ?? '—');

  function cargarAnteriores() {
    const el = bodyRef.current;
    if (!el || cargando || !hayMas) return;
    ajusteScroll.current = el.scrollHeight;
    void loadOlder();
  }

  // Al prepender páginas, preservar la posición de lectura. Layout effect:
  // corre antes del paint, así el ajuste no se ve como un brinco.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el && ajusteScroll.current !== null) {
      el.scrollTop += el.scrollHeight - ajusteScroll.current;
      ajusteScroll.current = null;
    }
  }, [filas.length]);

  // Mientras estás al fondo: mantener anclado ahí y rellenar con historial si el
  // contenido no desborda (para dar contexto y permitir el scroll hacia atrás).
  // `[&>*:first-child]:mt-auto` empuja el contenido corto hacia abajo (WhatsApp).
  // Layout effect: al entrar al chat los mensajes aparecen YA anclados al fondo.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || cargando || filas.length === 0 || ajusteScroll.current !== null) return;
    if (!enElFondoRef.current) return;
    el.scrollTop = el.scrollHeight;
    if (hayMas && el.scrollHeight <= el.clientHeight + 8) {
      void loadOlder();
    } else {
      // Re-anclar tras cargar imágenes (cambian el alto).
      setTimeout(() => {
        const e = bodyRef.current;
        if (e && enElFondoRef.current) e.scrollTop = e.scrollHeight;
      }, 250);
    }
  }, [filas.length, hayMas, cargando, loadOlder]);

  function onScrollBody(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const desborda = el.scrollHeight > el.clientHeight + 8;
    if (desborda && el.scrollTop < 80 && hayMas && !cargando) cargarAnteriores();
    const cerca = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (cerca !== enElFondoRef.current) {
      enElFondoRef.current = cerca;
      setEnElFondo(cerca);
    }
  }

  function irAlFondo() {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  /** Re-ancla al fondo (al enviar): baja ya y deja que el mensaje nuevo también baje. */
  function anclarAlFondo() {
    enElFondoRef.current = true;
    setEnElFondo(true);
    requestAnimationFrame(irAlFondo);
  }

  // Subir el hilo hasta una conversación anterior (desde el panel de contexto).
  const refrescarConversacion = thread.refrescarConversacion;
  useImperativeHandle(
    ref,
    () => {
      const irA = async (convId: string) => {
        const find = () =>
          bodyRef.current?.querySelector<HTMLElement>(`[data-convid="${CSS.escape(convId)}"]`);
        for (let i = 0; i < 60; i++) {
          const el = find();
          const body = bodyRef.current;
          if (el && body) {
            // Dejar aire entre el inicio de la conversación y el header (no pegado al borde).
            const top = el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
            body.scrollTo({ top: Math.max(0, top - 72), behavior: 'smooth' });
            // Resaltar dónde inicia la conversación (la primera burbuja) para no perderse.
            const target = el.querySelector<HTMLElement>('[data-msgid]') ?? el;
            target.classList.add('ring-2', 'ring-navy');
            window.setTimeout(() => target.classList.remove('ring-2', 'ring-navy'), 1800);
            return;
          }
          if (!hayMasRef.current) return;
          await loadOlder();
          // dar tiempo a React a re-renderizar y commitear el DOM antes de reintentar.
          await new Promise((r) => setTimeout(r, 60));
        }
      };
      return {
        scrollToConversation(convId: string) {
          void irA(convId);
        },
        async refrescarYVer(convId: string) {
          await refrescarConversacion(convId);
          await new Promise((r) => setTimeout(r, 80)); // dejar commitear el DOM
          await irA(convId);
        },
      };
    },
    [loadOlder, refrescarConversacion],
  );

  /** Scroll al mensaje citado de un reply (carga páginas si hace falta) + resaltado. */
  async function irAMensaje(messageId: string) {
    const find = () =>
      bodyRef.current?.querySelector<HTMLElement>(`[data-msgid="${CSS.escape(messageId)}"]`);
    for (let i = 0; i < 60; i++) {
      const el = find();
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.add('ring-2', 'ring-navy');
        window.setTimeout(() => el.classList.remove('ring-2', 'ring-navy'), 1600);
        return;
      }
      if (!hayMasRef.current) return;
      await loadOlder();
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  // IA: genera una sugerencia (conversación actual + base de conocimiento) y la
  // muestra en un modal de revisión — nunca se inserta sin confirmar.
  async function sugerirRespuesta() {
    setSugiriendo(true);
    setSugerenciaError(false);
    if (sugerencia === null) setSugerencia('');
    try {
      const call = httpsCallable(fns, 'aiAssist');
      const { data } = (await call({ conversationId: activa.id, modo: 'sugerir_respuesta' })) as {
        data: { texto: string };
      };
      setSugerencia(data.texto ?? '');
    } catch {
      setSugerencia('');
      setSugerenciaError(true);
    } finally {
      setSugiriendo(false);
    }
  }

  function usarSugerencia() {
    if (!sugerencia?.trim()) return;
    setDraft(sugerencia);
    setTab('responder');
    setSugerencia(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  /** Conversación destino para escribir: activa si sigue abierta, o una nueva. */
  async function convDestino(): Promise<Row<Conversation> | null> {
    if (grupo) {
      // Segmento activo del grupo; si el actual está resuelto, se abre uno nuevo
      // (el anterior queda con su cierre en el historial).
      if (activa.data.estado !== 'resolved') return activa;
      const id = await ensureAgentGroupConversation(activa);
      return { id, data: { ...activa.data, estado: 'open' } };
    }
    if (!c.contactId || !agent) return null;
    if (activaAgente) return activaAgente;
    const targetId = await ensureAgentConversation({
      contactId: c.contactId,
      contactNombre: c.contactNombre,
      siteId: c.siteId,
      clientId: c.clientId,
      clientNombre: c.clientNombre,
      uid: agent.uid,
      nombreAgente: agent.perfil?.nombre ?? 'Agente',
    });
    return { id: targetId, data: { ...c, estado: 'open', subcanal: 'agente' } };
  }

  /** Empezar a responder un mensaje concreto (cita + foco en el input). */
  function responderA(r: { messageId: string; texto: string; senderNombre: string }) {
    setReplyTo(r);
    setEditando(null);
    setTab('responder');
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  /** Empezar a editar un mensaje propio (rellena el input). */
  function editarMensaje(convId: string, msgId: string, texto: string) {
    setEditando({ convId, msgId, texto });
    setReplyTo(null);
    setTab('responder');
    setDraft(texto);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function enviar() {
    setShowEmoji(false);
    const texto = draft.trim();
    if (!agent) return;
    // Modo edición: actualiza el mensaje (guarda la versión anterior).
    if (editando) {
      if (!texto) return;
      if (texto !== editando.texto) {
        await agentEditMessage(editando.convId, editando.msgId, texto, editando.texto);
      }
      setEditando(null);
      setDraft('');
      return;
    }
    if (pendingFile && tab === 'responder') {
      // Attachment + caption go out together as a single message.
      if (subiendo) return;
      setSubiendo(true);
      anclarAlFondo();
      try {
        const nombreChat = agent.perfil?.nombreChat ?? agent.perfil?.nombre ?? 'Soporte';
        const target = await convDestino();
        if (!target) return;
        await agentSendAttachment(target, agent.uid, nombreChat, pendingFile, texto);
        setDraft('');
        setPendingFile(null);
        setReplyTo(null);
      } finally {
        setSubiendo(false);
      }
      return;
    }
    if (!texto) return;
    setDraft('');
    const cita = tab === 'responder' ? replyTo : null;
    setReplyTo(null);
    anclarAlFondo();
    const nombreChat = agent.perfil?.nombreChat ?? agent.perfil?.nombre ?? 'Soporte';
    // Internal notes annotate the viewed conversation (even a bot/resolved one);
    // replies always route to the agent channel via convDestino.
    const target = tab === 'nota' ? activa : await convDestino();
    if (!target) return;
    await agentSendMessage(target, agent.uid, nombreChat, texto, tab === 'nota', cita);
  }

  /** Inserts an emoji at the caret position, keeping focus in the textarea. */
  function insertEmoji(emoji: string) {
    const el = inputRef.current;
    const focused = el && document.activeElement === el;
    const start = focused ? (el.selectionStart ?? draft.length) : draft.length;
    const end = focused ? (el.selectionEnd ?? draft.length) : draft.length;
    setDraft(draft.slice(0, start) + emoji + draft.slice(end));
    el?.focus();
    requestAnimationFrame(() => {
      if (!el) return;
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function flashAttachError(msg: string) {
    setAttachError(msg);
    if (attachErrorTimer.current) window.clearTimeout(attachErrorTimer.current);
    attachErrorTimer.current = window.setTimeout(() => setAttachError(null), 4000);
  }

  /** Tipos aceptados (mismo criterio que el `accept` del selector y storage.rules).
   *  El drag & drop no pasa por `accept`, así que acá validamos explícitamente. */
  function tipoPermitido(file: File): boolean {
    return (
      /^(image|video|text)\//.test(file.type) ||
      file.type === 'application/pdf' ||
      /(word|document|sheet|excel|officedocument|ms-excel)/.test(file.type) ||
      /\.(pdf|docx?|txt|xlsx?|csv)$/i.test(file.name)
    );
  }

  /** Valida (tipo + tamaño) y deja el archivo listo para enviar con caption.
   *  Lo usan el selector de archivos y el drag & drop. */
  function stageFile(file: File | null | undefined) {
    if (!file) return;
    if (!tipoPermitido(file)) {
      flashAttachError(idioma === 'es' ? 'Tipo de archivo no permitido' : 'File type not allowed');
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      flashAttachError(idioma === 'es' ? 'El archivo supera los 25 MB' : 'File exceeds 25 MB');
      return;
    }
    setAttachError(null);
    // Stage it (replacing any previous pick); it is sent from enviar() with the caption.
    setPendingFile(file);
    inputRef.current?.focus();
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    stageFile(file);
  }

  // --- Drag & drop: overlay "soltá aquí" que alimenta el mismo flujo staged.
  //     Solo en la pestaña "Responder" (los adjuntos van a la conversación, no a notas).
  function onDragOverConv(e: React.DragEvent) {
    if (tab !== 'responder' || editando) return;
    if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
    e.preventDefault();
    setDragging(true);
  }
  function onDropConv(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (tab === 'responder' && !editando) stageFile(e.dataTransfer?.files?.[0]);
  }

  async function asignar(uid: string, nombreAgente: string, foto?: string) {
    setShowAsignar(false);
    // Assignment targets the agent channel when it exists; it never converts a
    // bot conversation (the bot keeps attending its channel until handoff).
    await updateConversation((activaAgente ?? activa).id, {
      asignadoA: uid,
      asignadoNombre: nombreAgente,
      asignadoFoto: foto ?? null,
    });
  }

  return (
    <div
      className="relative flex flex-col h-full"
      onDragEnter={onDragOverConv}
      onDragOver={onDragOverConv}
    >
      {dragging && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-navy/60 p-4"
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={onDropConv}
        >
          <div className="pointer-events-none flex flex-col items-center gap-2.5 rounded-2xl border-2 border-dashed border-white/75 bg-white/10 px-8 py-6 text-center text-white">
            <span className="msr text-[36px]">upload_file</span>
            <div className="text-[14px] font-semibold leading-snug">
              {idioma === 'es' ? 'Soltá el archivo para adjuntarlo' : 'Drop the file to attach it'}
            </div>
          </div>
        </div>
      )}
      {/* PWA standalone: franja blanca tras el status bar del teléfono (el header
          no queda debajo). Con status bar 'default' mide 0; es solo respaldo. */}
      {/* Plum status-bar strip: iOS renders white clock text over it. */}
      <div className="md:hidden flex-none bg-navy-deep h-[env(safe-area-inset-top)]" />
      <header className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 bg-white border-b border-warm-border">
        {onBack && (
          <button
            onClick={onBack}
            className="md:hidden -ml-1 p-1 text-warm-gray hover:text-ink flex-none"
            aria-label="Volver"
          >
            <span className="msr text-[22px]">arrow_back</span>
          </button>
        )}
        <div className="h-9 w-9 rounded-full bg-cream-3 flex items-center justify-center text-[11px] font-bold text-ink-2 flex-none">
          {grupo ? <span className="msr text-[18px]">groups</span> : iniciales(nombre)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-bold truncate">{nombre}</div>
          <div className="text-[11px] text-warm-gray truncate">
            {grupo
              ? Object.values(c.participantesInfo ?? {})
                  .map((p) => p.nombre.split(' ')[0])
                  .join(', ')
              : `${c.clientNombre ?? ''}${(activaAgente ?? activa).data.asignadoNombre ? ` · ${(activaAgente ?? activa).data.asignadoNombre}` : ''}`}
          </div>
        </div>
        <button
          onClick={() => setShowConvert(true)}
          className="flex items-center gap-1.5 bg-navy text-white text-[12px] font-semibold px-2.5 sm:px-3 py-1.5 rounded-lg hover:bg-navy-light flex-none"
        >
          <span className="msr text-[15px]">confirmation_number</span>
          <span className="hidden sm:inline">{t('inbox.convertirTicket')}</span>
        </button>
        <div className="relative">
          {/* Asignada: el botón muestra al agente (avatar/inicial + nombre);
              sin asignar conserva el "Asignar" genérico. Siempre abre el menú. */}
          <button
            onClick={() => setShowAsignar(!showAsignar)}
            title={(activaAgente ?? activa).data.asignadoNombre ?? t('inbox.asignar')}
            className="flex items-center gap-1.5 border border-warm-border text-ink-2 text-[12px] font-semibold px-2.5 sm:px-3 py-1.5 rounded-lg hover:border-navy flex-none"
          >
            {(activaAgente ?? activa).data.asignadoNombre ? (
              <>
                {(activaAgente ?? activa).data.asignadoFoto ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={(activaAgente ?? activa).data.asignadoFoto!}
                    alt=""
                    className="h-5 w-5 rounded-full object-cover -ml-0.5"
                  />
                ) : (
                  <span className="h-5 w-5 rounded-full bg-navy text-white text-[9px] font-bold flex items-center justify-center -ml-0.5">
                    {iniciales((activaAgente ?? activa).data.asignadoNombre!)}
                  </span>
                )}
                <span className="hidden sm:inline max-w-24 truncate">
                  {(activaAgente ?? activa).data.asignadoNombre!.split(' ')[0]}
                </span>
              </>
            ) : (
              <>
                <span className="msr text-[15px]">person_add</span>
                <span className="hidden sm:inline">{t('inbox.asignar')}</span>
              </>
            )}
          </button>
          {showAsignar && (
            <div className="absolute right-0 top-full mt-1 bg-white border border-warm-border rounded-lg shadow-raised z-20 w-48 py-1">
              {team
                .filter((m) => m.data.activo)
                .map((m) => (
                  <button
                    key={m.id}
                    onClick={() => asignar(m.id, m.data.nombre, m.data.fotoUrl)}
                    className="w-full text-left px-3 py-2 text-[12.5px] hover:bg-cream-1 flex items-center gap-2"
                  >
                    <span className="h-6 w-6 rounded-full bg-cream-3 text-[9px] font-bold flex items-center justify-center">
                      {iniciales(m.data.nombre)}
                    </span>
                    <span className="flex-1 truncate">{m.data.nombre}</span>
                    {(activaAgente ?? activa).data.asignadoA === m.id && (
                      <span className="msr text-[15px] text-ok">check</span>
                    )}
                  </button>
                ))}
            </div>
          )}
        </div>
        {convResolver && (
          <button
            onClick={() => setShowResolve(true)}
            title={t('inbox.resolver')}
            className="h-8 w-8 rounded-lg flex items-center justify-center border border-warm-border text-warm-gray hover:border-ok hover:text-ok"
          >
            <span className="msr text-[18px]">check_circle</span>
          </button>
        )}
        {onOpenContext && (
          <button
            onClick={onOpenContext}
            title="Información"
            className="lg:hidden h-8 w-8 rounded-lg flex items-center justify-center border border-warm-border text-warm-gray hover:border-navy hover:text-navy flex-none"
          >
            <span className="msr text-[18px]">info</span>
          </button>
        )}
        {/* Escritorio: colapsar/mostrar el panel de contexto (persistido en el inbox). */}
        {onToggleCtx && (
          <button
            onClick={onToggleCtx}
            title={ctxColapsado ? 'Mostrar panel de información' : 'Ocultar panel de información'}
            aria-pressed={ctxColapsado}
            className="hidden lg:flex h-8 w-8 rounded-lg items-center justify-center border border-warm-border text-warm-gray hover:border-navy hover:text-navy flex-none"
          >
            <span className="msr text-[18px]">
              {ctxColapsado ? 'right_panel_open' : 'right_panel_close'}
            </span>
          </button>
        )}
      </header>

      <div className="relative flex-1 min-h-0">
        <div
          ref={bodyRef}
          onScroll={onScrollBody}
          onClick={() => setMenuMsg(null)}
          className="chat-doodle-bg absolute inset-0 overflow-y-auto px-5 py-4 flex flex-col gap-2.5 [&>*:first-child]:mt-auto"
        >
          {/* Skeleton del primer load: burbujas fantasma en vez del brinco. */}
          {!listo && (
            <div className="flex flex-col gap-2.5" aria-hidden>
              <div className="h-11 w-[46%] rounded-xl bg-white/70 animate-pulse" />
              <div className="h-11 w-[32%] rounded-xl bg-[#D9FDD3]/60 animate-pulse self-end" />
              <div className="h-11 w-[54%] rounded-xl bg-white/70 animate-pulse" />
              <div className="h-11 w-[38%] rounded-xl bg-[#D9FDD3]/60 animate-pulse self-end" />
            </div>
          )}
          {listo && cargando && (
            <div className="self-center text-[11px] text-warm-gray-2 py-1 animate-pulse">···</div>
          )}
          {filas.flatMap((f, i) => {
            const prev = filas[i - 1];
            const next = filas[i + 1];
            const primeraFila = i === 0;
            // Grupo y directa son hilos segmentados: separadores por límite de
            // conversación en ambos.
            const cambioConv = !!prev && prev.convId !== f.convId;
            const finDeConv = !next || next.convId !== f.convId;
            const convActual = convPorId.get(f.convId);
            const dataConvId = primeraFila || cambioConv ? f.convId : undefined;
            const md = f.msg.data;
            // Mensajes de sistema de resolución viejos: se ocultan (el marcador
            // ahora se deriva del estado, sin duplicar).
            const esResueltaSistema =
              md.tipoContenido === 'sistema' &&
              /^(Conversación resuelta|Conversation resolved)/.test(md.texto ?? '');
            const nodes: React.ReactNode[] = [];

            if (md.tipoContenido === 'csat') {
              nodes.push(
                <CsatIndicator
                  key={`${f.convId}_${f.msg.id}`}
                  convId={f.convId}
                  idioma={idioma}
                  dataConvId={dataConvId}
                />,
              );
            } else if (esResueltaSistema) {
              // Se oculta el mensaje pero se conserva el ancla para scrollToConversation.
              if (dataConvId) {
                nodes.push(<div key={`anchor_${f.msg.id}`} data-convid={dataConvId} className="h-0" />);
              }
            } else {
              nodes.push(
                <Burbuja
                  key={`${f.convId}_${f.msg.id}`}
                  m={md}
                  msgId={f.msg.id}
                  grupo={grupo}
                  dataConvId={dataConvId}
                  selfId={agent?.uid ?? ''}
                  menuAbierto={menuMsg === f.msg.id}
                  onMenu={() => setMenuMsg((prev) => (prev === f.msg.id ? null : f.msg.id))}
                  onReaccion={(emoji) =>
                    agent && toggleReaction(f.convId, f.msg.id, emoji, agent.uid, md.reacciones)
                  }
                  onVerTicket={setVerTicketId}
                  onIrMensaje={irAMensaje}
                  onResponder={responderA}
                  onEditar={() => editarMensaje(f.convId, f.msg.id, md.texto)}
                  onAbrirAdjunto={abrirVisor}
                  onVerConvBot={
                    md.botConvRef && onOpenConversation
                      ? () => onOpenConversation(md.botConvRef!)
                      : undefined
                  }
                />,
              );
            }

            // Marcador al final de una conversación cerrada — se muestra al
            // instante (derivado del estado). Un segmento escalado al agente
            // se marca distinto de uno resuelto.
            if (finDeConv && convActual?.data.estado === 'resolved') {
              const escalada = Boolean(convActual.data.escaladoA);
              const cat = convActual.data.categoria
                ? categoryLabel(convActual.data.categoria, idioma)
                : '';
              nodes.push(
                <div key={`res_${f.convId}_${f.msg.id}`} className="self-stretch my-1 flex justify-center">
                  <span
                    className={`inline-flex items-center gap-1.5 text-[10px] font-bold tracking-wide rounded-full px-3 py-1 ${
                      escalada ? 'bg-ai-bg text-ai' : 'bg-ok-bg text-ok-dark'
                    }`}
                  >
                    <span className="msr text-[13px]">
                      {escalada ? 'support_agent' : 'check_circle'}
                    </span>
                    {escalada ? t('inbox.convEscalada') : t('inbox.convResuelta')}
                    {!escalada && cat ? ` · ${cat}` : ''}
                  </span>
                </div>,
              );
            }
            return nodes;
          })}
        </div>

        {!enElFondo && filas.length > 0 && (
          <button
            onClick={irAlFondo}
            title={t('inbox.irAlFinal')}
            aria-label={t('inbox.irAlFinal')}
            className="absolute right-4 bottom-4 z-10 h-10 w-10 rounded-full bg-navy text-white shadow-raised flex items-center justify-center hover:bg-navy-light transition-colors"
          >
            <span className="msr text-[22px]">arrow_downward</span>
          </button>
        )}
      </div>

      <footer className="bg-white border-t border-warm-border px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex gap-4 mb-2">
          <button
            onClick={() => setTab('responder')}
            className={`text-[12px] font-semibold pb-1 border-b-2 ${
              tab === 'responder' ? 'border-navy text-navy' : 'border-transparent text-warm-gray'
            }`}
          >
            {t('inbox.responder')}
          </button>
          <button
            onClick={() => setTab('nota')}
            className={`flex items-center gap-1 text-[12px] font-semibold pb-1 border-b-2 ${
              tab === 'nota' ? 'border-gold text-warn-dark' : 'border-transparent text-warm-gray'
            }`}
          >
            <span className="msr text-[13px]">lock</span>
            {t('inbox.notaInterna')}
          </button>
          <button
            onClick={sugerirRespuesta}
            disabled={sugiriendo}
            title={t('inbox.iaSugerir')}
            className="ml-auto flex items-center gap-1 text-[12px] font-semibold text-ai disabled:opacity-50 hover:underline"
          >
            <span className={`msr text-[14px] ${sugiriendo ? 'animate-spin' : ''}`}>
              {sugiriendo ? 'progress_activity' : 'auto_awesome'}
            </span>
            IA
          </button>
        </div>
        {replyTo && tab === 'responder' && !editando && (
          <div className="flex items-start gap-2 mb-2 rounded-lg bg-cream-1 border-l-2 border-navy px-2.5 py-1.5">
            <div className="flex-1 min-w-0">
              <div className="text-[10.5px] font-bold text-navy">{replyTo.senderNombre}</div>
              <div className="text-[11.5px] text-warm-gray truncate">{replyTo.texto}</div>
            </div>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              className="flex-none text-warm-gray hover:text-ink"
              aria-label="Cancelar"
            >
              <span className="msr text-[16px]">close</span>
            </button>
          </div>
        )}
        {editando && (
          <div className="flex items-center gap-2 mb-2 rounded-lg bg-cream-1 border-l-2 border-navy px-2.5 py-1.5">
            <span className="msr text-[15px] text-navy flex-none">edit</span>
            <div className="text-[11.5px] font-semibold text-navy flex-1">Editando mensaje</div>
            <button
              type="button"
              onClick={() => {
                setEditando(null);
                setDraft('');
              }}
              className="flex-none text-warm-gray hover:text-ink"
              aria-label="Cancelar"
            >
              <span className="msr text-[16px]">close</span>
            </button>
          </div>
        )}
        {pendingFile && tab === 'responder' && !editando && (
          <div className="flex items-center gap-2.5 mb-2 rounded-lg bg-cream-1 border border-warm-border px-2.5 py-2">
            {pendingFileUrl ? (
              <img
                src={pendingFileUrl}
                alt=""
                className="h-10 w-10 rounded-lg object-cover flex-none border border-warm-border"
              />
            ) : (
              <span className="msr text-[20px] text-navy flex-none h-10 w-10 rounded-lg bg-white border border-warm-border flex items-center justify-center">
                {pendingFile.type.startsWith('video/') ? 'movie' : 'description'}
              </span>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[11.5px] font-semibold text-ink truncate">
                {pendingFile.name}
              </div>
              <div className="text-[10.5px] text-warm-gray">{formatBytes(pendingFile.size)}</div>
            </div>
            <button
              type="button"
              onClick={() => setPendingFile(null)}
              disabled={subiendo}
              className="flex-none text-warm-gray hover:text-ink disabled:opacity-40"
              aria-label="Quitar adjunto"
            >
              <span className="msr text-[16px]">close</span>
            </button>
          </div>
        )}
        {attachError && <div className="text-[11px] text-danger mb-1.5">{attachError}</div>}
        {showEmoji && (
          <div className="h-52 overflow-y-auto mb-2 rounded-xl border border-warm-border bg-white px-2.5 pb-2.5 pt-1">
            {EMOJI_CATEGORIES.map((cat) => (
              <div key={cat.label.es}>
                <div className="text-[10px] font-bold tracking-wide uppercase text-warm-gray-2 mt-2 mb-1 px-0.5">
                  {cat.label[idioma]}
                </div>
                <div className="grid grid-cols-10">
                  {cat.emojis.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => insertEmoji(emoji)}
                      className="text-[20px] leading-none py-1 rounded-lg hover:bg-cream-1 transition-colors"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <div
          className={`flex items-end gap-2 rounded-xl border p-2 ${
            tab === 'nota' ? 'bg-gold-bg border-gold' : 'bg-cream-0 border-warm-border'
          }`}
        >
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setShowEmoji((v) => !v)}
            title="Emoji"
            aria-label="Emoji"
            className={`flex-none self-end p-1.5 transition-colors ${
              showEmoji ? 'text-navy' : 'text-warm-gray hover:text-navy'
            }`}
          >
            <span className="msr text-[20px]">{showEmoji ? 'keyboard' : 'mood'}</span>
          </button>
          {tab === 'responder' && (
            <>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={subiendo}
                title={t('inbox.adjuntar')}
                aria-label={t('inbox.adjuntar')}
                className="flex-none self-end p-1.5 text-warm-gray hover:text-navy disabled:opacity-40 transition-colors"
              >
                <span className="msr text-[20px]">attach_file</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                hidden
                accept="image/*,video/*,.pdf,.doc,.docx,.txt,.xlsx,.xls,.csv"
                onChange={onFile}
              />
            </>
          )}
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Touch devices: Enter inserts a newline; sending is the button
              // (WhatsApp behavior). Desktop keeps Enter=send.
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                !window.matchMedia('(hover: none)').matches
              ) {
                e.preventDefault();
                enviar();
              }
            }}
            placeholder={
              pendingFile && tab === 'responder' && !editando
                ? idioma === 'es'
                  ? 'Agregá un comentario…'
                  : 'Add a caption…'
                : tab === 'nota'
                  ? t('inbox.placeholderNota')
                  : esSm
                    ? t('inbox.placeholderRespuesta', { nombre: nombre.split(' ')[0] })
                    : t('inbox.placeholderRespuestaCorta')
            }
            className="flex-1 bg-transparent resize-none outline-none text-[13px] leading-[1.45] px-1.5 py-1 min-h-[46px] max-h-40 overflow-y-auto"
          />
          <button
            onClick={enviar}
            disabled={
              (!draft.trim() && !(pendingFile && tab === 'responder' && !editando)) || subiendo
            }
            className="bg-navy text-white text-[12px] font-semibold px-4 py-2 rounded-lg disabled:opacity-40 hover:bg-navy-light"
          >
            {subiendo ? (
              <span className="msr text-[14px] animate-spin inline-block align-middle">
                progress_activity
              </span>
            ) : editando ? (
              'Guardar'
            ) : (
              t('inbox.enviar')
            )}
          </button>
        </div>
        <div className="text-[10.5px] text-warm-gray-2 mt-1.5">{t('inbox.hintEnter')}</div>
      </footer>

      {showConvert && <ConvertTicketModal conv={activa} onClose={() => setShowConvert(false)} />}
      {showResolve && convResolver && (
        <ResolveModal convId={convResolver.id} onClose={() => setShowResolve(false)} />
      )}
      {visorIdx !== null && galeria[visorIdx] && (
        <VisorAdjuntos
          items={galeria}
          idx={visorIdx}
          onIdx={setVisorIdx}
          onClose={() => setVisorIdx(null)}
        />
      )}
      {verTicketId && (
        <TicketDetailModal ticketId={verTicketId} onClose={() => setVerTicketId(null)} />
      )}

      {/* Revisión de la sugerencia de IA: editable, se inserta solo al confirmar */}
      {sugerencia !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setSugerencia(null)}
        >
          <div
            className="bg-white rounded-panel shadow-raised w-full max-w-lg p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 text-[14px] font-bold text-ink">
              <span className="msr text-[19px] text-ai">auto_awesome</span>
              {t('inbox.iaTitulo')}
            </div>
            <p className="text-[12px] text-warm-gray mt-1.5 leading-relaxed">{t('inbox.iaSub')}</p>
            {sugerenciaError ? (
              <div className="text-danger text-[12.5px] mt-4">{t('inbox.iaError')}</div>
            ) : (
              <textarea
                value={sugerencia}
                onChange={(e) => setSugerencia(e.target.value)}
                rows={6}
                disabled={sugiriendo}
                placeholder={sugiriendo ? '…' : undefined}
                className="w-full mt-3 rounded-lg border border-warm-border bg-cream-0 text-[13px] text-ink px-3 py-2.5 outline-none resize-none focus:border-navy leading-relaxed disabled:opacity-60"
              />
            )}
            <div className="flex items-center justify-end gap-1.5 mt-4">
              <button
                onClick={() => setSugerencia(null)}
                className="text-[12.5px] font-semibold text-warm-gray px-3 py-2 rounded-lg hover:bg-cream-1"
              >
                {t('inbox.iaCancelar')}
              </button>
              <button
                onClick={sugerirRespuesta}
                disabled={sugiriendo}
                className="flex items-center gap-1 text-[12.5px] font-semibold text-navy px-3 py-2 rounded-lg hover:bg-cream-1 disabled:opacity-50"
              >
                <span className={`msr text-[15px] ${sugiriendo ? 'animate-spin' : ''}`}>
                  {sugiriendo ? 'progress_activity' : 'refresh'}
                </span>
                {t('inbox.iaRegenerar')}
              </button>
              <button
                onClick={usarSugerencia}
                disabled={sugiriendo || sugerenciaError || !sugerencia.trim()}
                className="bg-navy text-white text-[12.5px] font-semibold px-4 py-2 rounded-lg hover:bg-navy-light disabled:opacity-40"
              >
                {t('inbox.iaUsar')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

/** Convierte URLs del texto en enlaces clicables (resto queda como texto plano). */
export function linkificar(texto: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
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
        className="text-navy underline break-all hover:text-navy-light"
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
 * Mini-markdown seguro para los cuerpos de mensaje (el bot responde con este
 * formato): **negrita**, *cursiva*, `código` y listas (- / 1.). Construye nodos
 * React — nunca HTML crudo — y linkifica las URLs del texto plano.
 */
function renderInline(texto: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(`[^`\n]+`)|(\*\*[^*\n][^*]*?\*\*)|(\*[^*\s][^*\n]*?\*)/g;
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    if (m.index > last) out.push(...linkificar(texto.slice(last, m.index)));
    if (m[1]) {
      out.push(
        <code key={`c${k++}`} className="bg-black/[.07] rounded px-1 font-mono text-[0.9em]">
          {m[1].slice(1, -1)}
        </code>,
      );
    } else if (m[2]) {
      out.push(<b key={`b${k++}`}>{renderInline(m[2].slice(2, -2))}</b>);
    } else {
      out.push(<i key={`i${k++}`}>{renderInline(m[3].slice(1, -1))}</i>);
    }
    last = m.index + m[0].length;
  }
  if (last < texto.length) out.push(...linkificar(texto.slice(last)));
  return out;
}

export function renderMarkdown(texto: string): React.ReactNode[] {
  const lines = texto.split('\n');
  const out: React.ReactNode[] = [];
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
      const cls = 'my-1 pl-5 whitespace-normal flex flex-col gap-0.5';
      out.push(
        esOrdered ? (
          <ol key={`l${k++}`} className={`list-decimal ${cls}`}>
            {li}
          </ol>
        ) : (
          <ul key={`l${k++}`} className={`list-disc ${cls}`}>
            {li}
          </ul>
        ),
      );
      continue;
    }
    out.push(...renderInline(lines[i]));
    if (i < lines.length - 1) out.push('\n');
    i++;
  }
  return out;
}

function Burbuja({
  m,
  msgId,
  grupo,
  dataConvId,
  selfId,
  menuAbierto,
  onMenu,
  onReaccion,
  onVerTicket,
  onIrMensaje,
  onResponder,
  onEditar,
  onVerConvBot,
  onAbrirAdjunto,
}: {
  m: Message;
  msgId?: string;
  grupo: boolean;
  dataConvId?: string;
  selfId?: string;
  menuAbierto?: boolean;
  onMenu?(): void;
  onReaccion?(emoji: string): void;
  onVerTicket?(ticketId: string): void;
  onIrMensaje?(messageId: string): void;
  onResponder?(r: { messageId: string; texto: string; senderNombre: string }): void;
  onEditar?(): void;
  /** Mensajes de sistema con botConvRef: abre la conversación del bot de origen. */
  onVerConvBot?(): void;
  /** Abre el visor in-app de adjuntos (imágenes/PDF). */
  onAbrirAdjunto?(url: string): void;
}) {
  const t = useT();
  const own = m.sender.tipo === 'agent';
  const bot = m.sender.tipo === 'bot';
  const sistema = m.sender.tipo === 'sistema';
  const reacciones = Object.entries(m.reacciones ?? {}).filter(([, ids]) => ids.length > 0);

  // Swipe-to-reply (WhatsApp): drag right to quote — also the reply path for
  // media messages on touch, whose tap opens the viewer instead of the menu.
  const swipe = useRef<{ x: number; y: number; dx: number; eje: 'h' | 'v' | null } | null>(null);
  const swipeReciente = useRef(false);
  const burbujaRef = useRef<HTMLDivElement>(null);
  function swipeMove(t: React.Touch) {
    const s = swipe.current;
    const el = burbujaRef.current;
    if (!s || !el) return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (!s.eje) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      // Right-and-mostly-horizontal captures the gesture; anything else scrolls.
      s.eje = dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.3 ? 'h' : 'v';
    }
    if (s.eje !== 'h') return;
    s.dx = Math.max(0, Math.min(dx, 96));
    el.style.transition = 'none';
    el.style.transform = `translateX(${s.dx * 0.55}px)`;
    el.style.setProperty('--swipe', String(Math.min(1, s.dx / 56)));
  }
  function swipeEnd(cancelado: boolean) {
    const s = swipe.current;
    const el = burbujaRef.current;
    swipe.current = null;
    if (!s || !el) return;
    el.style.transition = 'transform .18s ease';
    el.style.transform = '';
    el.style.setProperty('--swipe', '0');
    swipeReciente.current = s.dx > 10; // suppress the tap that follows a drag
    if (!cancelado && s.eje === 'h' && s.dx >= 56 && onResponder) {
      onResponder({
        messageId: msgId ?? '',
        texto: m.texto || resumenAdjunto(m),
        senderNombre: m.sender.nombre,
      });
    }
  }

  const chipTicket = m.ticketRef ? (
    <button
      type="button"
      onClick={() => onVerTicket?.(m.ticketRef!.ticketId)}
      className="inline-flex items-center gap-1 rounded-md bg-tag-blue-bg px-2 py-1 text-[11px] font-bold text-navy transition hover:brightness-95 disabled:cursor-default disabled:hover:brightness-100"
      disabled={!onVerTicket}
    >
      <span className="msr text-[13px]">confirmation_number</span>
      {formatTicketNumber(m.ticketRef.numero)}
    </button>
  ) : null;

  if (sistema) {
    return (
      <div
        data-convid={dataConvId}
        className="self-center flex flex-col items-center gap-1.5"
      >
        <span className="text-[11px] text-warm-gray bg-cream-2 rounded-full px-3 py-1">
          {m.texto}
        </span>
        {chipTicket}
        {m.botConvRef && onVerConvBot && (
          <button
            type="button"
            onClick={onVerConvBot}
            className="inline-flex items-center gap-1 rounded-md bg-ai-bg px-2 py-1 text-[11px] font-bold text-ai transition hover:brightness-95"
          >
            <span className="msr text-[13px]">smart_toy</span>
            {t('inbox.verConvBot')}
          </button>
        )}
      </div>
    );
  }
  if (m.interno) {
    return (
      <div
        data-convid={dataConvId}
        className="self-end max-w-[70%] bg-gold-bg border border-gold/40 rounded-xl px-3 py-2"
      >
        <div className="flex items-center gap-1 text-[10px] font-bold text-warn-dark mb-0.5">
          <span className="msr text-[12px]">lock</span>
          NOTA INTERNA · {m.sender.nombre}
        </div>
        <div className="text-[13px] text-ink-2 whitespace-pre-wrap">{linkificar(m.texto)}</div>
        <div className="text-[10px] text-warm-gray-2 text-right mt-0.5">{fmtHora(m.createdAt)}</div>
      </div>
    );
  }
  return (
    <div
      data-convid={dataConvId}
      className={`group flex gap-2 max-w-[75%] ${own ? 'self-end flex-row-reverse' : 'self-start'}`}
    >
      <div
        className={`h-7 w-7 rounded-full flex-none self-end flex items-center justify-center text-[9px] font-bold text-white ${
          bot ? 'bg-ai' : own ? 'bg-navy' : 'bg-warm-gray-3'
        }`}
      >
        {bot ? <span className="msr text-[15px]">smart_toy</span> : iniciales(m.sender.nombre)}
      </div>
      <div
        ref={burbujaRef}
        data-msgid={msgId}
        onClick={(e) => {
          e.stopPropagation();
          if (swipeReciente.current) {
            swipeReciente.current = false;
            return;
          }
          // Touch devices have no hover (no chevron): tapping the bubble
          // itself toggles the actions menu. Inner links/buttons keep their
          // own behavior.
          if (
            window.matchMedia('(hover: none)').matches &&
            !(e.target as HTMLElement).closest('a, button')
          ) {
            onMenu?.();
          }
        }}
        onTouchStart={(e) => {
          swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, eje: null };
        }}
        onTouchMove={(e) => swipeMove(e.touches[0])}
        onTouchEnd={() => swipeEnd(false)}
        onTouchCancel={() => swipeEnd(true)}
        className={`relative rounded-xl px-3 py-2 shadow-card transition-shadow ${own ? 'bg-[#D9FDD3]' : 'bg-white'}`}
      >
        {/* Swipe-to-reply affordance: fades in as the bubble drags right. */}
        <span
          aria-hidden
          className="msr absolute -left-8 top-1/2 -mt-2.5 text-[19px] text-warm-gray-2 opacity-[var(--swipe,0)] pointer-events-none"
        >
          reply
        </span>
        {/* Flechita: abre menú de acciones (reaccionar / responder / copiar). */}
        <button
          type="button"
          aria-label="Opciones"
          onClick={() => onMenu?.()}
          className="absolute top-1 right-1 h-5 w-5 rounded-full text-[#8696a0] opacity-0 group-hover:opacity-100 [@media(hover:none)]:hidden hover:bg-black/5 flex items-center justify-center transition-opacity"
        >
          <span className="msr text-[16px]">expand_more</span>
        </button>
        {menuAbierto && (
          <div
            className={`absolute z-20 top-6 w-40 bg-white border border-warm-border rounded-lg shadow-raised py-1 ${
              own ? 'right-1' : 'left-1'
            }`}
          >
            <div className="flex justify-around px-1 pb-1 mb-1 border-b border-cream-3">
              {EMOJIS.map((e2) => (
                <button
                  key={e2}
                  onClick={() => {
                    onMenu?.();
                    onReaccion?.(e2);
                  }}
                  className="text-[17px] leading-none p-1 rounded hover:bg-cream-1"
                >
                  {e2}
                </button>
              ))}
            </div>
            {onResponder && (m.texto || m.adjuntos?.length) && (
              <button
                onClick={() =>
                  onResponder({
                    messageId: msgId ?? '',
                    texto: m.texto || resumenAdjunto(m),
                    senderNombre: m.sender.nombre,
                  })
                }
                className="w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-cream-1 flex items-center gap-2"
              >
                <span className="msr text-[15px] text-warm-gray">reply</span>
                Responder
              </button>
            )}
            {m.texto && (
              <button
                onClick={() => {
                  onMenu?.();
                  void navigator.clipboard?.writeText(m.texto);
                }}
                className="w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-cream-1 flex items-center gap-2"
              >
                <span className="msr text-[15px] text-warm-gray">content_copy</span>
                Copiar
              </button>
            )}
            {onEditar && !!selfId && m.sender.id === selfId && m.texto && (
              <button
                onClick={() => {
                  onMenu?.();
                  onEditar();
                }}
                className="w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-cream-1 flex items-center gap-2"
              >
                <span className="msr text-[15px] text-warm-gray">edit</span>
                Editar
              </button>
            )}
          </div>
        )}
        {(grupo || bot) && (
          <div className="text-[10.5px] font-bold text-navy mb-0.5">{m.sender.nombre}</div>
        )}
        {m.replyTo && (
          <button
            type="button"
            onClick={() => onIrMensaje?.(m.replyTo!.messageId)}
            className="mb-1 w-full text-left rounded-md bg-black/5 border-l-2 border-navy px-2 py-1 transition-colors hover:bg-black/10"
          >
            <div className="text-[10.5px] font-bold text-navy">{m.replyTo.senderNombre}</div>
            <div className="text-[11.5px] text-warm-gray truncate max-w-[240px]">
              {m.replyTo.texto}
            </div>
          </button>
        )}
        <Adjuntos adjuntos={m.adjuntos} onAbrir={onAbrirAdjunto} />
        {m.texto && (
          <div className="text-[13px] text-[#111B21] whitespace-pre-wrap break-words">
            {renderMarkdown(m.texto)}
          </div>
        )}
        {chipTicket && <div className="mt-1">{chipTicket}</div>}
        {/* Voto "¿te sirvió?" que recibió esta respuesta del bot. */}
        {bot && m.feedback && (
          <div className="mt-1">
            <span
              className={`inline-flex items-center gap-1 text-[10.5px] font-bold rounded-full px-2 py-0.5 ${
                m.feedback === 'helpful' ? 'bg-ok-bg text-ok-dark' : 'bg-danger-bg text-danger'
              }`}
            >
              <span className="msr text-[12px]">
                {m.feedback === 'helpful' ? 'thumb_up' : 'thumb_down'}
              </span>
              {m.feedback === 'helpful' ? t('inbox.feedbackUtil') : t('inbox.feedbackNoUtil')}
            </span>
          </div>
        )}
        {reacciones.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {reacciones.map(([emoji, ids]) => {
              const mio = !!selfId && ids.includes(selfId);
              return (
                <button
                  key={emoji}
                  onClick={() => onReaccion?.(emoji)}
                  className={`inline-flex items-center gap-0.5 text-[11px] rounded-full px-1.5 py-0.5 border transition-colors ${
                    mio ? 'bg-tag-blue-bg border-navy/30' : 'bg-cream-1 border-warm-border hover:bg-cream-2'
                  }`}
                >
                  <span>{emoji}</span>
                  <span className="text-[10px] text-warm-gray font-semibold">{ids.length}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="text-[10px] text-[#667781] text-right mt-0.5">
          {!!m.editadoAt && (
            <span className="relative cursor-help group/ed">
              editado
              {m.textoAnterior && (
                <span className="hidden group-hover/ed:flex flex-col gap-0.5 absolute bottom-full right-0 mb-1.5 w-max max-w-[240px] bg-[#2b2b2b] text-white text-[11px] font-normal leading-snug px-2 py-1.5 rounded-lg shadow-raised z-30 whitespace-pre-wrap break-words text-left normal-case">
                  <b className="text-[9px] font-semibold opacity-60">Versión anterior</b>
                  <span>{m.textoAnterior}</span>
                </span>
              )}
              <span> · </span>
            </span>
          )}
          {fmtHora(m.createdAt)}
        </div>
      </div>
    </div>
  );
}

/** Adjuntos de un mensaje: imagen, video o archivo (mismo formato que el widget). */
/** PDF detection: `tipo` collapses every non-media file into 'archivo'. */
export function esPdf(a: Attachment): boolean {
  return (
    a.mimeType === 'application/pdf' ||
    (a.nombre ?? a.storagePath ?? '').toLowerCase().endsWith('.pdf')
  );
}

/** Quote preview for attachment-only messages ("📷 Foto", "📄 recibo.pdf"). */
function resumenAdjunto(m: Message): string {
  const a = m.adjuntos?.[0];
  if (!a) return '';
  if (a.tipo === 'imagen') return '📷 Foto';
  if (a.tipo === 'video') return '🎥 Video';
  return `📄 ${a.nombre ?? 'Archivo'}`;
}

function Adjuntos({
  adjuntos,
  onAbrir,
}: {
  adjuntos?: Attachment[];
  onAbrir?: (url: string) => void;
}) {
  if (!adjuntos?.length) return null;
  return (
    <div className="flex flex-col gap-1.5 mb-1">
      {adjuntos.map((a, i) => {
        if (a.tipo === 'imagen' && a.url) {
          return (
            // Abre el visor in-app (no una pestaña nueva).
            <button
              key={i}
              type="button"
              onClick={() => a.url && onAbrir?.(a.url)}
              className="block p-0 border-0 bg-transparent cursor-pointer text-left"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.url}
                alt={a.nombre ?? 'imagen'}
                className="max-w-[240px] max-h-[240px] rounded-lg block object-cover"
              />
            </button>
          );
        }
        if (a.tipo === 'video' && a.url) {
          return (
            <video
              key={i}
              src={a.url}
              controls
              preload="metadata"
              className="max-w-[260px] rounded-lg block"
            />
          );
        }
        if (esPdf(a) && a.url) {
          return (
            <button
              key={i}
              type="button"
              onClick={() => a.url && onAbrir?.(a.url)}
              className="inline-flex items-center gap-2 bg-cream-2 rounded-lg px-3 py-2 text-[12.5px] font-semibold text-navy hover:bg-cream-3 transition-colors max-w-[240px] cursor-pointer border-0"
            >
              <span className="msr text-[16px] flex-none">picture_as_pdf</span>
              <span className="truncate">{a.nombre ?? 'archivo'}</span>
            </button>
          );
        }
        return (
          <a
            key={i}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-cream-2 rounded-lg px-3 py-2 text-[12.5px] font-semibold text-navy hover:bg-cream-3 transition-colors max-w-[240px]"
          >
            <span className="msr text-[16px] flex-none">description</span>
            <span className="truncate">{a.nombre ?? 'archivo'}</span>
          </a>
        );
      })}
    </div>
  );
}

/** Estado de la encuesta CSAT de una conversación: estrellas + comentario si el
 *  cliente calificó, o "sin responder aún". Reactivo a la colección `csat`. */
function CsatIndicator({
  convId,
  idioma,
  dataConvId,
}: {
  convId: string;
  idioma: Idioma;
  dataConvId?: string;
}) {
  const csats = useCsat(convId);
  const rating = csats[0]?.data.rating;
  const comentario = csats[0]?.data.comentario;
  return (
    <div
      data-convid={dataConvId}
      className="self-center my-1 flex flex-col items-center gap-1 bg-cream-2 rounded-xl px-4 py-2.5 max-w-[300px]"
    >
      <div className="flex items-center gap-1.5 text-[9.5px] font-bold tracking-wider text-warm-gray-2">
        <span className="msr text-[13px]">reviews</span>
        {idioma === 'es' ? 'ENCUESTA DE SATISFACCIÓN' : 'SATISFACTION SURVEY'}
      </div>
      {rating ? (
        <>
          <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <span
                key={n}
                className="msr text-[17px]"
                style={{
                  color: n <= rating ? '#E3A93C' : '#D9D3C7',
                  fontVariationSettings: n <= rating ? "'FILL' 1" : "'FILL' 0",
                }}
              >
                star
              </span>
            ))}
          </div>
          {comentario && (
            <div className="text-[11.5px] text-ink-2 text-center leading-snug">“{comentario}”</div>
          )}
        </>
      ) : (
        <div className="text-[11px] text-warm-gray-2">
          {idioma === 'es' ? 'Enviada · sin responder aún' : 'Sent · awaiting response'}
        </div>
      )}
    </div>
  );
}
