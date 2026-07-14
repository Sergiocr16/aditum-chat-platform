'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { iniciales, toDate, useConversations, useSites } from '@/lib/data';
import { playNotificationSound } from '@/lib/sound';
import {
  deshabilitarPush,
  habilitarPush,
  pushDisponible,
  pushPreferencia,
  type PushEstado,
} from '@/lib/messaging';

// Sitio seleccionado globalmente ("Todos los sitios" = null) — diseño 1e.
const SiteCtx = createContext<{ siteId: string | null; setSiteId(v: string | null): void }>({
  siteId: null,
  setSiteId: () => {},
});
export const useSiteFilter = () => useContext(SiteCtx);

// Mobile topbar visibility — the inbox hides it while a conversation is open
// to reclaim vertical space (the back arrow keeps navigation reachable).
const TopbarCtx = createContext<{ setOculto(v: boolean): void }>({ setOculto: () => {} });
export const useMobileTopbar = () => useContext(TopbarCtx);

const NAV = [
  { href: '/inbox', icon: 'inbox', key: 'nav.inbox' as const },
  { href: '/tickets', icon: 'confirmation_number', key: 'nav.tickets' as const },
  { href: '/contactos', icon: 'group', key: 'nav.contactos' as const },
  { href: '/bot', icon: 'smart_toy', key: 'nav.bot' as const, badge: 'CLAUDE', admin: true },
  { href: '/reportes', icon: 'monitoring', key: 'nav.reportes' as const, admin: true },
  { href: '/configuracion', icon: 'settings', key: 'nav.config' as const, admin: true },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const { agent, loading, logout } = useAuth();
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const sites = useSites();
  const [siteId, setSiteId] = useState<string | null>(null);
  // Drawer de la barra lateral en móvil (off-canvas). En ≥md siempre visible.
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [topbarOculto, setTopbarOculto] = useState(false);
  // Al navegar, cerrar el drawer.
  useEffect(() => {
    setMenuAbierto(false);
  }, [pathname]);

  // Push de escritorio (FCM). En emulador queda 'no-disponible'.
  const [push, setPush] = useState<PushEstado>('desactivado');
  useEffect(() => {
    if (!pushDisponible()) return setPush('no-disponible');
    if (pushPreferencia() && agent) {
      habilitarPush(agent.uid).then(setPush);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent?.uid]);

  async function togglePush() {
    if (!agent || push === 'no-disponible') return;
    setPush(push === 'activado' ? await deshabilitarPush(agent.uid) : await habilitarPush(agent.uid));
  }

  // Conversaciones del sitio (global): alimenta el aviso sonoro en cualquier
  // página y el chip de no-leídos junto a "Inbox".
  const convsGlobal = useConversations(siteId, 'todas', agent?.uid ?? '_');
  const inboxUnread = convsGlobal.filter((c) => (c.data.unread?.agentes ?? 0) > 0).length;
  const vistosRef = useRef<Map<string, number> | null>(null);
  useEffect(() => {
    if (convsGlobal.length === 0) return;
    const actuales = new Map(
      convsGlobal.map((c) => [c.id, toDate(c.data.lastMessage?.at)?.getTime() ?? 0]),
    );
    if (!vistosRef.current) {
      vistosRef.current = actuales; // primer snapshot: no sonar por el historial
      return;
    }
    const huboNuevo = convsGlobal.some((c) => {
      const ts = actuales.get(c.id) ?? 0;
      const visto = vistosRef.current!.get(c.id) ?? 0;
      return ts > visto && c.data.lastMessage?.senderTipo === 'user';
    });
    vistosRef.current = actuales;
    if (huboNuevo && localStorage.getItem('aditum-chat-sonido') !== 'off') {
      playNotificationSound();
    }
  }, [convsGlobal]);

  useEffect(() => {
    if (!loading && !agent) router.replace('/login');
  }, [loading, agent, router]);

  if (loading || !agent) {
    return <div className="min-h-screen flex items-center justify-center text-warm-gray">…</div>;
  }

  const esAdmin = agent.perfil?.rol === 'admin';

  return (
    <SiteCtx.Provider value={{ siteId, setSiteId }}>
      <TopbarCtx.Provider value={{ setOculto: setTopbarOculto }}>
      <div className="flex h-screen overflow-hidden">
        {/* Backdrop del drawer (solo móvil) */}
        {menuAbierto && (
          <div
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => setMenuAbierto(false)}
            aria-hidden
          />
        )}
        <aside
          className={`fixed inset-y-0 left-0 z-50 w-52 flex-none bg-navy-deep text-white flex flex-col transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
            menuAbierto ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="px-4 py-4 pt-[max(1rem,env(safe-area-inset-top))]">
            {/* Logo sobre fondo transparente: isotipo en su color + "ADITUM" en blanco */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/aditum-logo-menu.png" alt="Aditum" className="h-7 w-auto" />
          </div>

          <div className="px-3 pb-3">
            <select
              value={siteId ?? ''}
              onChange={(e) => setSiteId(e.target.value || null)}
              className="w-full bg-white/10 text-white text-xs font-medium rounded-lg px-2.5 py-2 outline-none cursor-pointer [&>option]:text-ink"
            >
              <option value="">{t('nav.todosLosSitios')}</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.data.nombre}
                </option>
              ))}
            </select>
          </div>

          <nav className="flex-1 px-2 flex flex-col gap-0.5">
            {NAV.filter((n) => !n.admin || esAdmin).map((n) => {
              const activo = pathname.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors ${
                    activo ? 'bg-white/15 text-white' : 'text-white/65 hover:bg-white/8 hover:text-white'
                  }`}
                >
                  <span className={`msr text-[19px] ${activo ? 'msr-fill' : ''}`}>{n.icon}</span>
                  <span className="flex-1">{t(n.key)}</span>
                  {n.href === '/inbox' && inboxUnread > 0 && (
                    <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center">
                      {inboxUnread}
                    </span>
                  )}
                  {n.badge && (
                    <span className="text-[8px] font-bold tracking-wider bg-ai text-white px-1.5 py-0.5 rounded">
                      {n.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="p-3 border-t border-white/10 flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-full bg-navy flex items-center justify-center text-[11px] font-bold">
              {iniciales(agent.perfil?.nombre ?? agent.user.email ?? '?')}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-semibold truncate">
                {agent.perfil?.nombre ?? agent.user.email}
              </div>
              <div className="text-[10.5px] text-white/55 flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-ok inline-block" />
                {agent.perfil?.rol === 'admin' ? 'Admin' : 'Agente'} · En línea
              </div>
            </div>
            <button
              onClick={togglePush}
              className={
                push === 'activado' ? 'text-ok hover:text-white' : 'text-white/50 hover:text-white'
              }
              title={
                push === 'no-disponible'
                  ? 'Notificaciones de escritorio: requiere proyecto Firebase de producción (VAPID)'
                  : push === 'denegado'
                    ? 'Permiso de notificaciones denegado en el navegador'
                    : push === 'activado'
                      ? 'Notificaciones de escritorio activadas'
                      : 'Activar notificaciones de escritorio'
              }
              disabled={push === 'no-disponible'}
            >
              <span className="msr text-[18px]">
                {push === 'activado' ? 'notifications_active' : 'notifications_off'}
              </span>
            </button>
            <button
              onClick={() => logout().then(() => router.replace('/login'))}
              className="text-white/50 hover:text-white"
              title="Salir"
            >
              <span className="msr text-[18px]">logout</span>
            </button>
          </div>
        </aside>

        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Topbar móvil: hamburguesa + logo (oculto en ≥md y con conversación abierta) */}
          <header
            className={`${topbarOculto ? 'hidden' : 'flex'} md:hidden flex-none items-center gap-3 min-h-14 px-3 pt-[env(safe-area-inset-top)] bg-navy-deep text-white`}
          >
            <button
              onClick={() => setMenuAbierto(true)}
              className="relative -ml-1 p-1.5 text-white/80 hover:text-white"
              aria-label="Abrir menú"
            >
              <span className="msr text-[24px]">menu</span>
              {inboxUnread > 0 && (
                <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-danger ring-2 ring-navy-deep" />
              )}
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/aditum-logo-menu.png" alt="Aditum" className="h-6 w-auto" />
          </header>
          <main className="flex-1 min-w-0 overflow-hidden bg-cream-1">{children}</main>
        </div>
      </div>
      </TopbarCtx.Provider>
    </SiteCtx.Provider>
  );
}
