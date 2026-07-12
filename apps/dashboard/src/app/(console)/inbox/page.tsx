'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Conversation } from '@aditum-chat/shared';
import { categoryLabel, conversationStatusLabels } from '@aditum-chat/shared';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { useSiteFilter } from '@/components/Shell';
import {
  fmtRelativo,
  iniciales,
  useConversations,
  useDoc,
  useSites,
  type InboxFiltro,
  type Row,
} from '@/lib/data';
import { ConversationView, type ConversationViewHandle } from '@/components/ConversationView';
import { ContextPanel } from '@/components/ContextPanel';
import { GroupContextPanel } from '@/components/GroupContextPanel';
import { ResizeHandle, useColumnWidth, useMediaQuery } from '@/components/ResizeHandle';

const FILTROS: { key: InboxFiltro; msg: 'inbox.filtro.todas' | 'inbox.filtro.mias' | 'inbox.filtro.bot' | 'inbox.filtro.equipos' | 'inbox.filtro.sinAsignar' | 'inbox.filtro.resueltas'; icon?: string }[] = [
  { key: 'todas', msg: 'inbox.filtro.todas' },
  { key: 'mias', msg: 'inbox.filtro.mias' },
  { key: 'bot', msg: 'inbox.filtro.bot' },
  { key: 'equipos', msg: 'inbox.filtro.equipos', icon: 'groups' },
  { key: 'sin_asignar', msg: 'inbox.filtro.sinAsignar' },
  { key: 'resueltas', msg: 'inbox.filtro.resueltas', icon: 'check_circle' },
];

export default function InboxPage() {
  const { agent } = useAuth();
  const t = useT();
  const { siteId } = useSiteFilter();
  const [filtro, setFiltro] = useState<InboxFiltro>('todas');
  const [selId, setSelId] = useState<string | null>(null);
  const [scrollAOrigen, setScrollAOrigen] = useState<string | null>(null);

  // Deep link a una conversación (/inbox?c=<convId> desde una notificación push):
  // la selecciona y sube el hilo hasta ella.
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('c');
    if (c) {
      setSelId(c);
      setScrollAOrigen(c);
    }
  }, []);

  const convs = useConversations(siteId, filtro, agent?.uid ?? '_');
  const sites = useSites();
  const siteNombre = useMemo(
    () => Object.fromEntries(sites.map((s) => [s.id, s.data.nombre])),
    [sites],
  );

  const abiertas = convs.filter((c) => c.data.estado !== 'resolved').length;
  // La selección puede venir de fuera de la lista filtrada (ej. "Ver conversación
  // completa" desde el panel de contexto) — en ese caso se carga por id.
  const externa = useDoc<Conversation>(
    selId && !convs.some((c) => c.id === selId) ? `conversations/${selId}` : null,
  );
  const sel = convs.find((c) => c.id === selId) ?? externa ?? null;
  const idioma = agent?.idioma ?? 'es';

  // Toggle de sonido (el listener global vive en el Shell — suena en toda la consola).
  const [sonido, setSonido] = useState(true);
  useEffect(() => {
    setSonido(localStorage.getItem('aditum-chat-sonido') !== 'off');
  }, []);

  function toggleSonido() {
    const next = !sonido;
    setSonido(next);
    localStorage.setItem('aditum-chat-sonido', next ? 'on' : 'off');
  }

  // Anchos redimensionables de las columnas (persistentes). Se aplican solo tras
  // montar para evitar mismatch de hidratación con el export estático.
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  const esMd = useMediaQuery('(min-width: 768px)');
  const esLg = useMediaQuery('(min-width: 1024px)');
  const lista = useColumnWidth('aditum-inbox-lista', 340, 260, 560);
  const contexto = useColumnWidth('aditum-inbox-contexto', 280, 220, 460);
  const esDirectaCtx = !!(sel && sel.data.tipo === 'directa' && sel.data.contactId);
  const esGrupoCtx = !!(sel && sel.data.tipo === 'grupo');
  const mostrarCtx = esDirectaCtx || esGrupoCtx;

  // Para que el panel de contexto pueda subir el hilo a una conversación anterior.
  const convViewRef = useRef<ConversationViewHandle>(null);

  // Deep link a un segmento concreto (ej. "Ver conversación" desde un ticket):
  // una vez montada la vista de esa conversación, sube el hilo hasta ella.
  useEffect(() => {
    if (!scrollAOrigen || sel?.id !== scrollAOrigen) return;
    const id = setTimeout(() => {
      convViewRef.current?.scrollToConversation(scrollAOrigen);
      setScrollAOrigen(null);
    }, 500);
    return () => clearTimeout(id);
  }, [scrollAOrigen, sel]);

  return (
    <div className="flex h-full">
      {/* Lista de conversaciones — en móvil se oculta al abrir una conversación */}
      <section
        className={`${sel ? 'hidden md:flex' : 'flex'} flex-col w-full ${
          montado ? 'md:w-auto' : 'md:w-[340px]'
        } flex-none bg-white`}
        style={montado && esMd ? { width: lista.width } : undefined}
      >
        <header className="px-4 pt-4 pb-2">
          <h1 className="text-[15px] font-bold flex items-center">
            <span className="flex-1">
              Inbox{' '}
              <span className="text-warm-gray font-medium">
                · {t('inbox.abiertas', { n: abiertas })}
              </span>
            </span>
            <button
              onClick={toggleSonido}
              title={sonido ? 'Silenciar notificaciones' : 'Activar sonido'}
              className={`msr text-[18px] ${sonido ? 'text-navy' : 'text-warm-gray-3'}`}
            >
              {sonido ? 'notifications_active' : 'notifications_off'}
            </button>
          </h1>
          <div className="flex gap-1.5 mt-3 flex-wrap">
            {FILTROS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFiltro(f.key)}
                className={`flex items-center gap-1 text-[11.5px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                  filtro === f.key
                    ? 'bg-navy border-navy text-white'
                    : 'bg-white border-warm-border text-warm-gray hover:border-navy'
                }`}
              >
                {f.icon && <span className="msr text-[14px]">{f.icon}</span>}
                {t(f.msg)}
              </button>
            ))}
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">
          {convs.map((c) => (
            <ConversationRow
              key={c.id}
              conv={c}
              activa={c.id === selId}
              siteNombre={siteNombre[c.data.siteId] ?? c.data.siteId}
              idioma={idioma}
              onClick={() => setSelId(c.id)}
              t={t}
            />
          ))}
          {convs.length === 0 && (
            <div className="p-6 text-sm text-warm-gray-2 text-center">—</div>
          )}
        </div>
      </section>

      {/* Divisor arrastrable lista ↔ conversación (escritorio) */}
      {montado && esMd && (
        <ResizeHandle
          className="hidden md:block"
          onStart={(e) => lista.startDrag(e, 1)}
          onReset={lista.reset}
        />
      )}

      {/* Conversación activa — en móvil ocupa toda la pantalla */}
      <section
        className={`${sel ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 flex-col bg-cream-1`}
      >
        {sel ? (
          <ConversationView
            ref={convViewRef}
            key={sel.id}
            conv={sel}
            onBack={() => setSelId(null)}
            onOpenConversation={setSelId}
          />
        ) : (
          <InboxVacio convs={convs} t={t} />
        )}
      </section>

      {/* Divisor arrastrable conversación ↔ contexto (pantallas anchas) */}
      {montado && esLg && mostrarCtx && (
        <ResizeHandle
          className="hidden lg:block"
          onStart={(e) => contexto.startDrag(e, -1)}
          onReset={contexto.reset}
        />
      )}

      {/* Panel de contexto: residente (directa) o equipo (grupo) */}
      {esDirectaCtx && (
        <ContextPanel
          contactId={sel!.data.contactId!}
          onScrollToConversation={(id) => convViewRef.current?.scrollToConversation(id)}
          onTicketCreado={(id) => convViewRef.current?.refrescarYVer(id)}
          width={montado ? contexto.width : undefined}
        />
      )}
      {esGrupoCtx && (
        <GroupContextPanel
          conv={sel!}
          onScrollToConversation={(id) => convViewRef.current?.scrollToConversation(id)}
          onTicketCreado={(id) => convViewRef.current?.refrescarYVer(id)}
          width={montado ? contexto.width : undefined}
        />
      )}
    </div>
  );
}

/** Estado vacío del panel de conversación: guía + pulso de la bandeja visible. */
function InboxVacio({ convs, t }: { convs: Row<Conversation>[]; t: ReturnType<typeof useT> }) {
  const abiertas = convs.filter((c) => c.data.estado !== 'resolved').length;
  const sinLeer = convs.filter((c) => (c.data.unread?.agentes ?? 0) > 0).length;

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="flex flex-col items-center text-center px-6">
        <div className="relative">
          <div className="h-16 w-16 rounded-full bg-white border border-cream-3 shadow-card flex items-center justify-center">
            <span className="msr text-[28px] text-warm-gray-2">forum</span>
          </div>
          {sinLeer > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-[18px] min-w-[18px] px-1 rounded-full bg-navy text-white text-[10px] font-bold flex items-center justify-center">
              {sinLeer}
            </span>
          )}
        </div>
        <div className="mt-4 text-[14px] font-bold text-ink">{t('inbox.vacioTitulo')}</div>
        <div className="mt-1 text-[12px] text-warm-gray max-w-[250px] leading-relaxed">
          {t('inbox.vacioSub')}
        </div>
        {abiertas > 0 && (
          <div className="mt-4 flex gap-1.5">
            <span className="text-[11px] font-semibold text-ink-2 bg-white border border-cream-3 rounded-full px-2.5 py-1">
              {t('inbox.vacioAbiertas', { n: abiertas })}
            </span>
            {sinLeer > 0 && (
              <span className="text-[11px] font-semibold text-navy bg-tag-blue-bg rounded-full px-2.5 py-1">
                {t('inbox.vacioSinLeer', { n: sinLeer })}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ConversationRow({
  conv,
  activa,
  siteNombre,
  idioma,
  onClick,
  t,
}: {
  conv: Row<Conversation>;
  activa: boolean;
  siteNombre: string;
  idioma: 'es' | 'en';
  onClick(): void;
  t: ReturnType<typeof useT>;
}) {
  const c = conv.data;
  const grupo = c.tipo === 'grupo';
  const nombre = grupo ? (c.groupName ?? c.clientNombre ?? 'Equipo') : (c.contactNombre ?? '—');
  const unreadAgentes = c.unread?.agentes ?? 0;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-cream-3 flex gap-2.5 transition-colors ${
        activa ? 'bg-info-bg' : 'hover:bg-cream-0'
      }`}
    >
      <div
        className={`h-9 w-9 rounded-full flex-none flex items-center justify-center text-[11px] font-bold ${
          grupo ? 'bg-navy text-white' : 'bg-cream-3 text-ink-2'
        }`}
      >
        {grupo ? <span className="msr text-[18px]">groups</span> : iniciales(nombre)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold truncate flex-1">{nombre}</span>
          <span className="text-[10.5px] text-warm-gray-2 flex-none">
            {fmtRelativo(c.lastMessage?.at ?? c.updatedAt)}
          </span>
        </div>
        <div className="text-[11px] text-warm-gray truncate">
          {grupo
            ? `${(c.participantes?.length ?? 1) - 1} administradores + soporte`
            : (c.clientNombre ?? '')}
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          {c.estado === 'bot' && <span className="msr text-[13px] text-ai">smart_toy</span>}
          <span className="text-[11.5px] text-warm-gray-2 truncate flex-1">
            {c.lastMessage
              ? `${c.lastMessage.senderNombre ? c.lastMessage.senderNombre.split(' ')[0] + ': ' : ''}${c.lastMessage.texto}`
              : ''}
          </span>
          {unreadAgentes > 0 && (
            <span className="flex-none min-w-[18px] h-[18px] px-1 rounded-full bg-danger-bright text-white text-[10px] font-bold flex items-center justify-center">
              {unreadAgentes}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          {grupo && (
            <span className="text-[8.5px] font-bold tracking-wider bg-navy text-white px-1.5 py-0.5 rounded">
              {t('inbox.chatGlobal')}
            </span>
          )}
          {/* Grupo del contacto; sitio como fallback (en filas de chat grupal el
              título ya es el grupo, ahí el sitio aporta más). */}
          <span className="text-[8.5px] font-bold tracking-wider bg-tag-blue-bg text-navy px-1.5 py-0.5 rounded">
            {(!grupo && c.groupName ? c.groupName : siteNombre).toUpperCase()}
          </span>
          <EstadoChip estado={c.estado} idioma={idioma} />
          {c.estado === 'resolved' && c.categoria && (
            <span className="text-[8.5px] font-bold tracking-wider bg-cream-2 text-warm-gray px-1.5 py-0.5 rounded-full">
              {categoryLabel(c.categoria, idioma).toUpperCase()}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function EstadoChip({ estado, idioma }: { estado: Conversation['estado']; idioma: 'es' | 'en' }) {
  const styles: Record<string, string> = {
    bot: 'bg-ai-bg text-ai',
    open: 'bg-gold-bg text-warn-dark',
    pending: 'bg-warn-bg text-warn-dark',
    resolved: 'bg-ok-bg text-ok-dark',
  };
  return (
    <span className={`text-[8.5px] font-bold tracking-wider px-1.5 py-0.5 rounded-full ${styles[estado]}`}>
      {conversationStatusLabels[idioma][estado].toUpperCase()}
    </span>
  );
}
