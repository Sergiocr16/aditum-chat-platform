'use client';

// Pantalla 1r — Contactos: directorio auto-poblado desde el chat.

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Contact, Idioma } from '@aditum-chat/shared';
import { formatTicketNumber, ticketStatusLabels } from '@aditum-chat/shared';
import { useAuth } from '@/lib/auth';
import { useSiteFilter } from '@/components/Shell';
import { fmtRelativo, iniciales, useContactTickets, useSites, type Row } from '@/lib/data';
import { useClients, useContactConversations, useContacts } from '@/lib/data-contactos';

// Catálogo local (las pantallas nuevas no editan packages/shared).
const M = {
  es: {
    titulo: 'Contactos',
    dirAuto: 'Directorio automático',
    dirAutoHint: 'Los contactos se guardan automáticamente al escribir por el chat',
    todosClientes: 'Todos los clientes',
    todosSitios: 'Todos los sitios',
    todosRoles: 'Todos los roles',
    buscar: 'Buscá por nombre o email…',
    colContacto: 'Contacto',
    colCliente: 'Cliente / Condominio',
    colSitio: 'Sitio',
    colActividad: 'Última actividad',
    colActividadDetalle: 'Actividad',
    conversar: 'Conversar',
    conversaciones: 'conversaciones',
    tickets: 'tickets',
    sinResultados: 'No hay contactos que coincidan con los filtros.',
    iniciarConversacion: 'Iniciar conversación',
    convRecientes: 'Conversaciones recientes',
    ticketsSec: 'Tickets',
    sinConversaciones: 'Todavía no hay conversaciones.',
    sinTickets: 'Todavía no hay tickets.',
    cerrar: 'Cerrar panel',
  },
  en: {
    titulo: 'Contacts',
    dirAuto: 'Automatic directory',
    dirAutoHint: 'Contacts are saved automatically when they write through the chat',
    todosClientes: 'All clients',
    todosSitios: 'All sites',
    todosRoles: 'All roles',
    buscar: 'Search by name or email…',
    colContacto: 'Contact',
    colCliente: 'Client / Condo',
    colSitio: 'Site',
    colActividad: 'Last activity',
    colActividadDetalle: 'Activity',
    conversar: 'Chat',
    conversaciones: 'conversations',
    tickets: 'tickets',
    sinResultados: 'No contacts match the filters.',
    iniciarConversacion: 'Start conversation',
    convRecientes: 'Recent conversations',
    ticketsSec: 'Tickets',
    sinConversaciones: 'No conversations yet.',
    sinTickets: 'No tickets yet.',
    cerrar: 'Close panel',
  },
} as const;

export default function ContactosPage() {
  const { agent } = useAuth();
  const idioma: Idioma = agent?.idioma ?? 'es';
  const m = M[idioma];
  const router = useRouter();
  const { siteId: siteGlobal } = useSiteFilter();

  const [clientId, setClientId] = useState('');
  const [siteLocal, setSiteLocal] = useState('');
  const [rol, setRol] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [selId, setSelId] = useState<string | null>(null);

  // El dropdown local refina; si no se elige nada, manda el filtro global del Shell.
  const siteEfectivo = siteLocal || siteGlobal;

  const { todos, filtrados } = useContacts({
    clientId: clientId || null,
    siteId: siteEfectivo || null,
    rol: rol || null,
    busqueda,
  });
  const clients = useClients();
  const sites = useSites();

  const siteNombre = useMemo(
    () => Object.fromEntries(sites.map((s) => [s.id, s.data.nombre])),
    [sites],
  );
  const clientNombre = useMemo(
    () => Object.fromEntries(clients.map((c) => [c.id, c.data.nombre])),
    [clients],
  );
  const roles = useMemo(
    () => [...new Set(todos.map((c) => c.data.rol).filter((r): r is string => !!r))].sort(),
    [todos],
  );

  const sel = filtrados.find((c) => c.id === selId) ?? null;

  return (
    <div className="flex h-full">
      <section className="flex-1 min-w-0 flex flex-col">
        <header className="px-5 pt-4 pb-3 border-b border-warm-border bg-white">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-[15px] font-bold">
              {m.titulo}{' '}
              <span className="text-warm-gray font-medium">
                · {todos.length.toLocaleString(idioma === 'es' ? 'es-CR' : 'en-US')}
              </span>
            </h1>
            <span
              title={m.dirAutoHint}
              className="flex items-center gap-1 text-[10.5px] font-semibold bg-info-bg text-navy px-2.5 py-1 rounded-full cursor-default"
            >
              <span className="msr text-[13px]">sync</span>
              {m.dirAuto}
            </span>
            <span className="text-[11px] text-warm-gray-2 hidden xl:inline">{m.dirAutoHint}</span>
          </div>

          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="text-[12px] font-medium bg-white border border-warm-border rounded-lg px-2.5 py-1.5 outline-none cursor-pointer"
            >
              <option value="">{m.todosClientes}</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.data.nombre}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1 text-[12px] font-medium bg-white border border-warm-border rounded-lg px-2.5 py-1.5">
              <span className="msr text-[15px] text-warm-gray">language</span>
              <select
                value={siteLocal}
                onChange={(e) => setSiteLocal(e.target.value)}
                className="outline-none cursor-pointer bg-transparent"
              >
                <option value="">
                  {siteGlobal ? (siteNombre[siteGlobal] ?? siteGlobal) : m.todosSitios}
                </option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.data.nombre}
                  </option>
                ))}
              </select>
            </div>

            <select
              value={rol}
              onChange={(e) => setRol(e.target.value)}
              className="text-[12px] font-medium bg-white border border-warm-border rounded-lg px-2.5 py-1.5 outline-none cursor-pointer"
            >
              <option value="">{m.todosRoles}</option>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1.5 flex-1 min-w-[180px] max-w-[320px] bg-white border border-warm-border rounded-lg px-2.5 py-1.5">
              <span className="msr text-[15px] text-warm-gray">search</span>
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder={m.buscar}
                className="flex-1 min-w-0 text-[12px] outline-none bg-transparent placeholder:text-warm-gray-3"
              />
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto">
          <table className="w-full min-w-[680px] text-left">
            <thead className="sticky top-0 bg-cream-1 z-10">
              <tr className="text-[9.5px] font-bold tracking-wider text-warm-gray-2 border-b border-warm-border">
                <th className="px-5 py-2.5">{m.colContacto.toUpperCase()}</th>
                <th className="px-3 py-2.5">{m.colCliente.toUpperCase()}</th>
                <th className="px-3 py-2.5">{m.colSitio.toUpperCase()}</th>
                <th className="px-3 py-2.5">{m.colActividad.toUpperCase()}</th>
                <th className="px-3 py-2.5">{m.colActividadDetalle.toUpperCase()}</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filtrados.map((c) => (
                <ContactRow
                  key={c.id}
                  contact={c}
                  activo={c.id === selId}
                  siteNombre={siteNombre[c.data.siteId] ?? c.data.siteId.replace(/-/g, ' ')}
                  clientNombre={
                    c.data.clientId ? (clientNombre[c.data.clientId] ?? c.data.clientId) : '—'
                  }
                  m={m}
                  onSelect={() => setSelId(c.id === selId ? null : c.id)}
                  onConversar={() => router.push('/inbox')}
                />
              ))}
            </tbody>
          </table>
          {filtrados.length === 0 && (
            <div className="p-8 text-sm text-warm-gray-2 text-center">
              <span className="msr text-[36px] block mb-2 text-warm-gray-3">group</span>
              {m.sinResultados}
            </div>
          )}
        </div>
      </section>

      {sel && (
        <>
          {/* Backdrop del panel overlay (solo móvil/tablet) */}
          <div
            className="fixed inset-0 z-30 bg-black/40 lg:hidden"
            onClick={() => setSelId(null)}
            aria-hidden
          />
          <ContactPanel
            contact={sel}
            siteNombre={siteNombre[sel.data.siteId] ?? sel.data.siteId.replace(/-/g, ' ')}
            idioma={idioma}
            m={m}
            onClose={() => setSelId(null)}
            onConversar={() => router.push('/inbox')}
          />
        </>
      )}
    </div>
  );
}

type Msgs = (typeof M)[Idioma];

function ContactRow({
  contact,
  activo,
  siteNombre,
  clientNombre,
  m,
  onSelect,
  onConversar,
}: {
  contact: Row<Contact>;
  activo: boolean;
  siteNombre: string;
  clientNombre: string;
  m: Msgs;
  onSelect(): void;
  onConversar(): void;
}) {
  const c = contact.data;
  return (
    <tr
      onClick={onSelect}
      className={`border-b border-cream-3 cursor-pointer transition-colors ${
        activo ? 'bg-info-bg' : 'bg-white hover:bg-cream-0'
      }`}
    >
      <td className="px-5 py-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-full flex-none flex items-center justify-center text-[10.5px] font-bold bg-cream-3 text-ink-2">
            {iniciales(c.nombre)}
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold truncate">{c.nombre}</div>
            {c.email && <div className="text-[11px] text-warm-gray truncate">{c.email}</div>}
          </div>
        </div>
      </td>
      <td className="px-3 py-3 text-[12px] text-ink-2">{clientNombre}</td>
      <td className="px-3 py-3">
        <span className="text-[8.5px] font-bold tracking-wider bg-tag-blue-bg text-navy px-1.5 py-0.5 rounded whitespace-nowrap">
          {siteNombre.toUpperCase()}
        </span>
      </td>
      <td className="px-3 py-3 text-[11.5px] text-warm-gray whitespace-nowrap">
        {fmtRelativo(c.lastActivity)}
      </td>
      <td className="px-3 py-3 text-[11.5px] text-warm-gray whitespace-nowrap">
        {c.conversacionesCount ?? 0} {m.conversaciones} · {c.ticketsCount ?? 0} {m.tickets}
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-1 justify-end pr-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onConversar();
            }}
            className="flex items-center gap-1 text-[11px] font-semibold text-navy border border-warm-border rounded-full px-2.5 py-1 hover:bg-info-bg transition-colors"
          >
            <span className="msr text-[13px]">chat</span>
            {m.conversar}
          </button>
          <button
            onClick={(e) => e.stopPropagation()}
            className="text-warm-gray-2 hover:text-ink p-1"
            aria-label="Más opciones"
          >
            <span className="msr text-[17px]">more_horiz</span>
          </button>
        </div>
      </td>
    </tr>
  );
}

function ContactPanel({
  contact,
  siteNombre,
  idioma,
  m,
  onClose,
  onConversar,
}: {
  contact: Row<Contact>;
  siteNombre: string;
  idioma: Idioma;
  m: Msgs;
  onClose(): void;
  onConversar(): void;
}) {
  const c = contact.data;
  const convs = useContactConversations(contact.id);
  const tickets = useContactTickets(contact.id);

  return (
    <aside className="fixed inset-y-0 right-0 z-40 w-full max-w-sm shadow-2xl lg:static lg:z-auto lg:max-w-none lg:w-[300px] lg:shadow-none flex-none border-l border-warm-border bg-white overflow-y-auto">
      <div className="p-4 border-b border-cream-3">
        <div className="flex items-start gap-3">
          <div className="h-11 w-11 rounded-full flex-none flex items-center justify-center text-[13px] font-bold bg-cream-3 text-ink-2">
            {iniciales(c.nombre)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-bold truncate">{c.nombre}</div>
            {c.email && <div className="text-[11.5px] text-warm-gray truncate">{c.email}</div>}
          </div>
          <button onClick={onClose} className="text-warm-gray-2 hover:text-ink" title={m.cerrar}>
            <span className="msr text-[18px]">close</span>
          </button>
        </div>
        <div className="flex gap-1.5 mt-2.5 flex-wrap">
          {c.rol && (
            <span className="text-[9px] font-bold tracking-wide bg-cream-2 text-ink-2 px-1.5 py-0.5 rounded">
              {c.rol.toUpperCase()}
            </span>
          )}
          <span className="text-[9px] font-bold tracking-wide bg-tag-blue-bg text-navy px-1.5 py-0.5 rounded">
            {siteNombre.toUpperCase()}
          </span>
        </div>
        <button
          onClick={onConversar}
          className="w-full mt-3 flex items-center justify-center gap-1.5 bg-navy text-white text-[12.5px] font-semibold rounded-lg px-3 py-2 hover:bg-navy-light transition-colors"
        >
          <span className="msr text-[15px]">chat</span>
          {m.iniciarConversacion}
        </button>
      </div>

      <div className="p-4 border-b border-cream-3">
        <div className="flex items-center gap-1.5 text-[9.5px] font-bold tracking-wider text-warm-gray-2 mb-2">
          <span className="msr text-[13px]">forum</span>
          {m.convRecientes.toUpperCase()}
        </div>
        {convs.length === 0 && (
          <div className="text-[11.5px] text-warm-gray-2">{m.sinConversaciones}</div>
        )}
        <div className="flex flex-col gap-2">
          {convs.map((cv) => (
            <div key={cv.id} className="rounded-card bg-cream-0 border border-cream-3 px-2.5 py-2">
              <div className="flex items-baseline gap-2">
                <span className="text-[11.5px] font-semibold truncate flex-1">
                  {cv.data.clientNombre ?? siteNombre}
                </span>
                <span className="text-[10px] text-warm-gray-2 flex-none">
                  {fmtRelativo(cv.data.updatedAt)}
                </span>
              </div>
              <div className="text-[11px] text-warm-gray truncate mt-0.5">
                {cv.data.lastMessage
                  ? `${cv.data.lastMessage.senderNombre ? cv.data.lastMessage.senderNombre.split(' ')[0] + ': ' : ''}${cv.data.lastMessage.texto}`
                  : '—'}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-center gap-1.5 text-[9.5px] font-bold tracking-wider text-warm-gray-2 mb-2">
          <span className="msr text-[13px]">confirmation_number</span>
          {m.ticketsSec.toUpperCase()}
        </div>
        {tickets.length === 0 && <div className="text-[11.5px] text-warm-gray-2">{m.sinTickets}</div>}
        <div className="flex flex-col gap-1.5">
          {tickets.map((tk) => (
            <div key={tk.id} className="flex items-center gap-2 text-[11.5px]">
              <span className="font-mono font-semibold text-warm-gray flex-none">
                {formatTicketNumber(tk.data.numero)}
              </span>
              <span className="truncate flex-1">{tk.data.asunto}</span>
              <span className="text-[9px] font-bold text-warm-gray-2 flex-none">
                {ticketStatusLabels[idioma][tk.data.estado]}
              </span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
