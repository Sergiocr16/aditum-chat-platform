'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import type { Attachment, Conversation, Idioma, Message } from '@aditum-chat/shared';
import { categoryLabel } from '@aditum-chat/shared';
import { fns } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import {
  agentSendAttachment,
  agentSendMessage,
  ensureAgentConversation,
  fmtHora,
  iniciales,
  updateConversation,
  useContactThread,
  useCsat,
  usePaginatedMessages,
  useTeam,
  type Row,
  type ThreadRow,
} from '@/lib/data';
import { ConvertTicketModal } from './ConvertTicketModal';
import { ResolveModal } from './ResolveModal';

export interface ConversationViewHandle {
  scrollToConversation(convId: string): void;
}

export const ConversationView = forwardRef<
  ConversationViewHandle,
  { conv: Row<Conversation>; onBack?: () => void }
>(function ConversationView({ conv, onBack }, ref) {
  const { agent } = useAuth();
  const t = useT();
  const team = useTeam();
  const idioma = agent?.idioma ?? 'es';
  const c = conv.data;
  const grupo = c.tipo === 'grupo';

  // Grupo → una sola conversación. Directa → hilo continuo del contacto.
  const pag = usePaginatedMessages(grupo ? conv.id : null);
  const thread = useContactThread(grupo ? null : (c.contactId ?? null));

  const filas: ThreadRow[] = grupo
    ? pag.mensajes.map((m) => ({ convId: conv.id, msg: m }))
    : thread.filas;
  const hayMas = grupo ? pag.hayMas : thread.hayMas;
  const cargando = grupo ? pag.cargando : thread.cargando;
  const loadOlder = grupo ? pag.loadOlder : thread.loadOlder;
  const activa = grupo ? conv : (thread.activa ?? conv);
  const convPorId = thread.convPorId;

  const [tab, setTab] = useState<'responder' | 'nota'>('responder');
  const [draft, setDraft] = useState('');
  const [showConvert, setShowConvert] = useState(false);
  const [showAsignar, setShowAsignar] = useState(false);
  const [showResolve, setShowResolve] = useState(false);
  const [sugiriendo, setSugiriendo] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [enElFondo, setEnElFondo] = useState(true);

  const fileRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const ajusteScroll = useRef<number | null>(null);
  const enElFondoRef = useRef(true);
  const hayMasRef = useRef(hayMas);
  useEffect(() => {
    hayMasRef.current = hayMas;
  }, [hayMas]);

  const nombre = grupo ? (c.clientNombre ?? 'Equipo') : (c.contactNombre ?? '—');

  function cargarAnteriores() {
    const el = bodyRef.current;
    if (!el || cargando || !hayMas) return;
    ajusteScroll.current = el.scrollHeight;
    void loadOlder();
  }

  // Al prepender páginas, preservar la posición de lectura.
  useEffect(() => {
    const el = bodyRef.current;
    if (el && ajusteScroll.current !== null) {
      el.scrollTop += el.scrollHeight - ajusteScroll.current;
      ajusteScroll.current = null;
    }
  }, [filas.length]);

  // Mientras estás al fondo: mantener anclado ahí y rellenar con historial si el
  // contenido no desborda (para dar contexto y permitir el scroll hacia atrás).
  // `[&>*:first-child]:mt-auto` empuja el contenido corto hacia abajo (WhatsApp).
  useEffect(() => {
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

  // Subir el hilo hasta una conversación anterior (desde el panel de contexto).
  useImperativeHandle(
    ref,
    () => ({
      async scrollToConversation(convId: string) {
        const find = () => bodyRef.current?.querySelector(`[data-convid="${CSS.escape(convId)}"]`);
        for (let i = 0; i < 60; i++) {
          const el = find();
          if (el) {
            el.scrollIntoView({ block: 'start' });
            return;
          }
          if (!hayMasRef.current) return;
          await loadOlder();
          // dar tiempo a React a re-renderizar y commitear el DOM antes de reintentar.
          await new Promise((r) => setTimeout(r, 60));
        }
      },
    }),
    [loadOlder],
  );

  async function sugerirRespuesta() {
    setSugiriendo(true);
    try {
      const call = httpsCallable(fns, 'aiAssist');
      const { data } = (await call({ conversationId: activa.id, modo: 'sugerir_respuesta' })) as {
        data: { texto: string };
      };
      setDraft(data.texto);
      setTab('responder');
    } catch {
      // sin API key u otro error: no bloquea el composer
    } finally {
      setSugiriendo(false);
    }
  }

  /** Conversación destino para escribir: activa si sigue abierta, o una nueva. */
  async function convDestino(): Promise<Row<Conversation> | null> {
    if (grupo) return conv;
    if (!c.contactId || !agent) return null;
    const targetId = await ensureAgentConversation({
      contactId: c.contactId,
      contactNombre: c.contactNombre,
      siteId: c.siteId,
      clientId: c.clientId,
      clientNombre: c.clientNombre,
      uid: agent.uid,
      nombreAgente: agent.perfil?.nombre ?? 'Agente',
    });
    return { id: targetId, data: { ...c, estado: 'open' } };
  }

  /** Si el destino sigue en 'bot', el agente toma el control. */
  async function tomarSiBot(targetId: string) {
    if (!agent) return;
    if (convPorId.get(targetId)?.data.estado === 'bot') {
      await updateConversation(targetId, {
        estado: 'open',
        asignadoA: agent.uid,
        asignadoNombre: agent.perfil?.nombre ?? '',
        asignadoFoto: agent.perfil?.fotoUrl ?? null,
      });
    }
  }

  async function enviar() {
    const texto = draft.trim();
    if (!texto || !agent) return;
    setDraft('');
    const nombreChat = agent.perfil?.nombreChat ?? agent.perfil?.nombre ?? 'Soporte';
    const target = await convDestino();
    if (!target) return;
    await agentSendMessage(target, agent.uid, nombreChat, texto, tab === 'nota');
    if (!grupo && tab === 'responder') await tomarSiBot(target.id);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !agent || subiendo) return;
    setSubiendo(true);
    try {
      const nombreChat = agent.perfil?.nombreChat ?? agent.perfil?.nombre ?? 'Soporte';
      const target = await convDestino();
      if (!target) return;
      await agentSendAttachment(target, agent.uid, nombreChat, file);
      if (!grupo) await tomarSiBot(target.id);
    } finally {
      setSubiendo(false);
    }
  }

  async function asignar(uid: string, nombreAgente: string, foto?: string) {
    setShowAsignar(false);
    await updateConversation(activa.id, {
      asignadoA: uid,
      asignadoNombre: nombreAgente,
      asignadoFoto: foto ?? null,
      ...(activa.data.estado === 'bot' ? { estado: 'open' } : {}),
    });
  }

  return (
    <div className="flex flex-col h-full">
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
              : `${c.clientNombre ?? ''}${activa.data.asignadoNombre ? ` · ${activa.data.asignadoNombre}` : ''}`}
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
          <button
            onClick={() => setShowAsignar(!showAsignar)}
            className="flex items-center gap-1.5 border border-warm-border text-ink-2 text-[12px] font-semibold px-2.5 sm:px-3 py-1.5 rounded-lg hover:border-navy flex-none"
          >
            <span className="msr text-[15px]">person_add</span>
            <span className="hidden sm:inline">{t('inbox.asignar')}</span>
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
                    {m.data.nombre}
                  </button>
                ))}
            </div>
          )}
        </div>
        {activa.data.estado !== 'resolved' && (
          <button
            onClick={() => setShowResolve(true)}
            title={t('inbox.resolver')}
            className="h-8 w-8 rounded-lg flex items-center justify-center border border-warm-border text-warm-gray hover:border-ok hover:text-ok"
          >
            <span className="msr text-[18px]">check_circle</span>
          </button>
        )}
      </header>

      <div className="relative flex-1 min-h-0">
        <div
          ref={bodyRef}
          onScroll={onScrollBody}
          className="chat-doodle-bg absolute inset-0 overflow-y-auto px-5 py-4 flex flex-col gap-2.5 [&>*:first-child]:mt-auto"
        >
          {cargando && (
            <div className="self-center text-[11px] text-warm-gray-2 py-1 animate-pulse">···</div>
          )}
          {filas.flatMap((f, i) => {
            const prev = filas[i - 1];
            const next = filas[i + 1];
            const primeraFila = i === 0;
            const cambioConv = !grupo && !!prev && prev.convId !== f.convId;
            const finDeConv = !grupo && (!next || next.convId !== f.convId);
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
                <Burbuja key={`${f.convId}_${f.msg.id}`} m={md} grupo={grupo} dataConvId={dataConvId} />,
              );
            }

            // Marcador "Conversación resuelta · categoría" al final de una
            // conversación resuelta — se muestra al instante (derivado del estado).
            if (finDeConv && convActual?.data.estado === 'resolved') {
              const cat = convActual.data.categoria
                ? categoryLabel(convActual.data.categoria, idioma)
                : '';
              nodes.push(
                <div
                  key={`res_${f.convId}`}
                  className="self-center my-1 inline-flex items-center gap-1.5 text-[10px] font-bold tracking-wide bg-ok-bg text-ok-dark rounded-full px-3 py-1"
                >
                  <span className="msr text-[13px]">check_circle</span>
                  {t('inbox.convResuelta')}
                  {cat ? ` · ${cat}` : ''}
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

      <footer className="bg-white border-t border-warm-border px-4 pt-2 pb-3">
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
            title="Sugerir respuesta con IA"
            className="ml-auto flex items-center gap-1 text-[12px] font-semibold text-ai disabled:opacity-50 hover:underline"
          >
            <span className="msr text-[14px]">auto_awesome</span>
            {sugiriendo ? '…' : 'IA'}
          </button>
        </div>
        <div
          className={`flex items-end gap-2 rounded-xl border p-2 ${
            tab === 'nota' ? 'bg-gold-bg border-gold' : 'bg-cream-0 border-warm-border'
          }`}
        >
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
                <span className={`msr text-[20px] ${subiendo ? 'animate-spin' : ''}`}>
                  {subiendo ? 'progress_activity' : 'attach_file'}
                </span>
              </button>
              <input
                ref={fileRef}
                type="file"
                hidden
                accept="image/*,video/*,.pdf,.doc,.docx,.txt"
                onChange={onFile}
              />
            </>
          )}
          <textarea
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                enviar();
              }
            }}
            placeholder={
              tab === 'nota'
                ? t('inbox.placeholderNota')
                : t('inbox.placeholderRespuesta', { nombre: nombre.split(' ')[0] })
            }
            className="flex-1 bg-transparent resize-none outline-none text-[13px] px-1.5 py-1"
          />
          <button
            onClick={enviar}
            disabled={!draft.trim()}
            className="bg-navy text-white text-[12px] font-semibold px-4 py-2 rounded-lg disabled:opacity-40 hover:bg-navy-light"
          >
            {t('inbox.enviar')}
          </button>
        </div>
        <div className="text-[10.5px] text-warm-gray-2 mt-1.5">{t('inbox.hintEnter')}</div>
      </footer>

      {showConvert && <ConvertTicketModal conv={activa} onClose={() => setShowConvert(false)} />}
      {showResolve && <ResolveModal convId={activa.id} onClose={() => setShowResolve(false)} />}
    </div>
  );
});

function Burbuja({
  m,
  grupo,
  dataConvId,
}: {
  m: Message;
  grupo: boolean;
  dataConvId?: string;
}) {
  const own = m.sender.tipo === 'agent';
  const bot = m.sender.tipo === 'bot';
  const sistema = m.sender.tipo === 'sistema';

  if (sistema) {
    return (
      <div
        data-convid={dataConvId}
        className="self-center text-[11px] text-warm-gray bg-cream-2 rounded-full px-3 py-1"
      >
        {m.texto}
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
        <div className="text-[13px] text-ink-2 whitespace-pre-wrap">{m.texto}</div>
        <div className="text-[10px] text-warm-gray-2 text-right mt-0.5">{fmtHora(m.createdAt)}</div>
      </div>
    );
  }
  return (
    <div
      data-convid={dataConvId}
      className={`flex gap-2 max-w-[75%] ${own ? 'self-end flex-row-reverse' : 'self-start'}`}
    >
      <div
        className={`h-7 w-7 rounded-full flex-none self-end flex items-center justify-center text-[9px] font-bold text-white ${
          bot ? 'bg-ai' : own ? 'bg-navy' : 'bg-warm-gray-3'
        }`}
      >
        {bot ? <span className="msr text-[15px]">smart_toy</span> : iniciales(m.sender.nombre)}
      </div>
      <div className={`rounded-xl px-3 py-2 shadow-card ${own ? 'bg-[#D9FDD3]' : 'bg-white'}`}>
        {(grupo || bot) && (
          <div className="text-[10.5px] font-bold text-navy mb-0.5">{m.sender.nombre}</div>
        )}
        <Adjuntos adjuntos={m.adjuntos} />
        {m.texto && (
          <div className="text-[13px] text-[#111B21] whitespace-pre-wrap break-words">{m.texto}</div>
        )}
        <div className="text-[10px] text-[#667781] text-right mt-0.5">
          {m.editadoAt ? 'editado · ' : ''}
          {fmtHora(m.createdAt)}
        </div>
      </div>
    </div>
  );
}

/** Adjuntos de un mensaje: imagen, video o archivo (mismo formato que el widget). */
function Adjuntos({ adjuntos }: { adjuntos?: Attachment[] }) {
  if (!adjuntos?.length) return null;
  return (
    <div className="flex flex-col gap-1.5 mb-1">
      {adjuntos.map((a, i) => {
        if (a.tipo === 'imagen' && a.url) {
          return (
            <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.url}
                alt={a.nombre ?? 'imagen'}
                className="max-w-[240px] max-h-[240px] rounded-lg block object-cover"
              />
            </a>
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
