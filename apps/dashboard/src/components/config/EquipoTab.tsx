'use client';

// Tab "Equipo y roles" de /configuracion — spec 1j (tabla + matriz de permisos).

import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import type { Idioma, TeamMember } from '@aditum-chat/shared';
import { fns } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { iniciales, useTeam, type Row } from '@/lib/data';
import { Card, Toggle } from './ui';
import { EditarUsuarioModal } from './EditarUsuarioModal';

const M = {
  es: {
    invitar: 'Invitar usuario',
    miembro: 'Miembro',
    correo: 'Correo',
    rol: 'Rol',
    estado: 'Estado',
    carga: 'Carga',
    activo: 'Activo',
    admin: 'Admin',
    agente: 'Agente',
    enLinea: 'En línea',
    ausente: 'Ausente',
    desconectado: 'Desconectado',
    cargaFmt: (chats: number, tickets: number) => `${chats} chats · ${tickets} tickets`,
    editar: 'Editar usuario',
    permisos: 'Matriz de permisos',
    permisosSub: 'Qué puede hacer cada rol — informativa, no editable',
    permisoFilas: [
      { label: 'Atender conversaciones y tickets', icon: 'forum', admin: true, agente: true },
      { label: 'Configurar el bot y su conocimiento', icon: 'smart_toy', admin: true, agente: false },
      { label: 'Ver reportes de SLA', icon: 'monitoring', admin: true, agente: false },
      { label: 'Definir políticas de SLA e invitar usuarios', icon: 'shield_person', admin: true, agente: false },
    ],
    error: 'No se pudo actualizar. Intentá de nuevo.',
  },
  en: {
    invitar: 'Invite user',
    miembro: 'Member',
    correo: 'Email',
    rol: 'Role',
    estado: 'Status',
    carga: 'Load',
    activo: 'Active',
    admin: 'Admin',
    agente: 'Agent',
    enLinea: 'Online',
    ausente: 'Away',
    desconectado: 'Offline',
    cargaFmt: (chats: number, tickets: number) => `${chats} chats · ${tickets} tickets`,
    editar: 'Edit user',
    permisos: 'Permission matrix',
    permisosSub: 'What each role can do — informational, not editable',
    permisoFilas: [
      { label: 'Handle conversations and tickets', icon: 'forum', admin: true, agente: true },
      { label: 'Configure the bot and its knowledge', icon: 'smart_toy', admin: true, agente: false },
      { label: 'View SLA reports', icon: 'monitoring', admin: true, agente: false },
      { label: 'Define SLA policies and invite users', icon: 'shield_person', admin: true, agente: false },
    ],
    error: 'Could not update. Try again.',
  },
} as const;

export function EquipoTab() {
  const { agent } = useAuth();
  const idioma: Idioma = agent?.idioma ?? 'es';
  const m = M[idioma];

  const team = useTeam();
  const [modal, setModal] = useState<{ modo: 'crear' } | { modo: 'editar'; row: Row<TeamMember> } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [togglingUid, setTogglingUid] = useState<string | null>(null);

  async function toggleActivo(row: Row<TeamMember>, activo: boolean) {
    setTogglingUid(row.id);
    setError(null);
    try {
      const call = httpsCallable(fns, 'manageTeam');
      await call({ accion: 'actualizar', uid: row.id, activo });
    } catch (e) {
      setError((e as Error).message || m.error);
    } finally {
      setTogglingUid(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        {error ? <div className="text-danger text-[12px]">{error}</div> : <span />}
        <button
          onClick={() => setModal({ modo: 'crear' })}
          className="flex items-center gap-1.5 bg-navy text-white text-[12.5px] font-semibold px-4 py-2 rounded-lg hover:bg-navy-light"
        >
          <span className="msr text-[16px]">person_add</span>
          {m.invitar}
        </button>
      </div>

      {/* Tabla de miembros */}
      <div className="bg-white border border-warm-border shadow-card rounded-lg overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-cream-3 text-[10px] font-bold tracking-wider text-warm-gray uppercase">
              <th className="px-4 py-3">{m.miembro}</th>
              <th className="px-4 py-3 hidden md:table-cell">{m.correo}</th>
              <th className="px-4 py-3">{m.rol}</th>
              <th className="px-4 py-3 hidden md:table-cell">{m.estado}</th>
              <th className="px-4 py-3 hidden md:table-cell">{m.carga}</th>
              <th className="px-4 py-3">{m.activo}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {team.map((row) => {
              const p = row.data;
              const enLinea = p.presencia === 'en_linea';
              return (
                <tr key={row.id} className="border-b border-cream-3 last:border-0 hover:bg-cream-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      {p.fotoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.fotoUrl}
                          alt={p.nombre}
                          className="h-8 w-8 rounded-full object-cover flex-none"
                        />
                      ) : (
                        <div className="h-8 w-8 rounded-full bg-cream-3 text-ink-2 flex items-center justify-center text-[11px] font-bold flex-none">
                          {iniciales(p.nombre)}
                        </div>
                      )}
                      <div>
                        <div className="text-[12.5px] font-semibold text-ink">{p.nombre}</div>
                        <div className="text-[10.5px] text-warm-gray-2">{p.nombreChat}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-warm-gray hidden md:table-cell">
                    {p.email}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full ${
                        p.rol === 'admin' ? 'bg-navy text-white' : 'bg-cream-2 text-warm-gray'
                      }`}
                    >
                      {(p.rol === 'admin' ? m.admin : m.agente).toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="flex items-center gap-1.5 text-[11.5px] text-warm-gray">
                      <span
                        className={`h-2 w-2 rounded-full ${enLinea ? 'bg-ok' : 'bg-warm-gray-4'}`}
                      />
                      {enLinea ? m.enLinea : p.presencia === 'ausente' ? m.ausente : m.desconectado}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[11.5px] text-warm-gray hidden md:table-cell">
                    {m.cargaFmt(p.carga?.chats ?? 0, p.carga?.tickets ?? 0)}
                  </td>
                  <td className="px-4 py-3">
                    <Toggle
                      on={p.activo}
                      disabled={togglingUid === row.id}
                      onChange={(v) => toggleActivo(row, v)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setModal({ modo: 'editar', row })}
                      className="text-warm-gray hover:text-navy p-1 rounded-lg hover:bg-cream-1"
                      title={m.editar}
                    >
                      <span className="msr text-[18px]">more_horiz</span>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Matriz de permisos */}
      <Card icon="shield_person" title={m.permisos} subtitle={m.permisosSub}>
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-cream-3 text-[10px] font-bold tracking-wider text-warm-gray uppercase">
              <th className="py-2" />
              <th className="py-2 w-14 sm:w-24 text-center">{m.admin}</th>
              <th className="py-2 w-14 sm:w-24 text-center">{m.agente}</th>
            </tr>
          </thead>
          <tbody>
            {m.permisoFilas.map((fila) => (
              <tr key={fila.label} className="border-b border-cream-3 last:border-0">
                <td className="py-2.5">
                  <span className="flex items-center gap-2 text-[12.5px] text-ink-2">
                    <span className="msr text-[16px] text-warm-gray">{fila.icon}</span>
                    {fila.label}
                  </span>
                </td>
                <td className="py-2.5 text-center">
                  {fila.admin && <span className="msr msr-fill text-[18px] text-ok">check_circle</span>}
                </td>
                <td className="py-2.5 text-center">
                  {fila.agente && <span className="msr msr-fill text-[18px] text-ok">check_circle</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {modal && (
        <EditarUsuarioModal
          modo={modal.modo}
          row={modal.modo === 'editar' ? modal.row : undefined}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
