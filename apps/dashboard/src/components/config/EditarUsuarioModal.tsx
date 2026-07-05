'use client';

// Modal de alta/edición de usuario — spec 1m. Alta y edición vía callable manageTeam.

import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import type { Idioma, TeamMember, TeamRole } from '@aditum-chat/shared';
import { fns, storage } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { iniciales, useSites, type Row } from '@/lib/data';
import { Campo, Toggle, inputCls } from './ui';

const M = {
  es: {
    tituloCrear: 'Invitar usuario',
    tituloEditar: 'Editar usuario',
    foto: 'Foto',
    fotoNota: 'PNG/JPG ≥128×128',
    cambiarFoto: 'Cambiar foto',
    nombre: 'Nombre',
    correo: 'Correo',
    password: 'Contraseña temporal',
    passwordHint: 'El usuario la cambia al entrar por primera vez',
    rol: 'Rol',
    adminDesc: 'Configura el bot, el SLA y el equipo. Ve reportes.',
    agenteDesc: 'Atiende conversaciones y tickets de sus sitios.',
    nombreChat: 'Nombre visible en el chat',
    nombreChatPlaceholder: 'Ej. Laura de Aditum',
    sitios: 'Sitios asignados',
    sitiosHint: 'Vacío = todos los sitios',
    activo: 'Usuario activo',
    activoHint: 'Si está inactivo no puede iniciar sesión',
    cancelar: 'Cancelar',
    guardar: 'Guardar',
    invitar: 'Invitar',
    guardando: 'Guardando…',
    errorCampos: 'Completá nombre, correo y contraseña.',
  },
  en: {
    tituloCrear: 'Invite user',
    tituloEditar: 'Edit user',
    foto: 'Photo',
    fotoNota: 'PNG/JPG ≥128×128',
    cambiarFoto: 'Change photo',
    nombre: 'Name',
    correo: 'Email',
    password: 'Temporary password',
    passwordHint: 'The user changes it on first sign-in',
    rol: 'Role',
    adminDesc: 'Configures the bot, SLA and team. Sees reports.',
    agenteDesc: 'Handles conversations and tickets for their sites.',
    nombreChat: 'Name shown in chat',
    nombreChatPlaceholder: 'E.g. Laura from Aditum',
    sitios: 'Assigned sites',
    sitiosHint: 'Empty = all sites',
    activo: 'Active user',
    activoHint: 'Inactive users cannot sign in',
    cancelar: 'Cancel',
    guardar: 'Save',
    invitar: 'Invite',
    guardando: 'Saving…',
    errorCampos: 'Fill in name, email and password.',
  },
} as const;

export function EditarUsuarioModal({
  modo,
  row,
  onClose,
}: {
  modo: 'crear' | 'editar';
  row?: Row<TeamMember>;
  onClose(): void;
}) {
  const { agent } = useAuth();
  const idioma: Idioma = agent?.idioma ?? 'es';
  const m = M[idioma];
  const sites = useSites();

  const p = row?.data;
  const [nombre, setNombre] = useState(p?.nombre ?? '');
  const [email, setEmail] = useState(p?.email ?? '');
  const [password, setPassword] = useState('');
  const [rol, setRol] = useState<TeamRole>(p?.rol ?? 'agente');
  const [nombreChat, setNombreChat] = useState(p?.nombreChat ?? '');
  const [sitios, setSitios] = useState<string[]>(p?.sitios ?? []);
  const [activo, setActivo] = useState(p?.activo ?? true);
  const [foto, setFoto] = useState<File | null>(null);
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function elegirFoto(f: File | null) {
    setFoto(f);
    setFotoPreview(f ? URL.createObjectURL(f) : null);
  }

  function toggleSitio(id: string) {
    setSitios((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  async function subirFoto(uid: string): Promise<string> {
    const r = ref(storage, `perfiles/${uid}.png`);
    await uploadBytes(r, foto!, { contentType: foto!.type });
    return getDownloadURL(r);
  }

  async function guardar() {
    if (modo === 'crear' && (!nombre.trim() || !email.trim() || !password)) {
      setError(m.errorCampos);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const call = httpsCallable<Record<string, unknown>, { uid: string }>(fns, 'manageTeam');
      if (modo === 'crear') {
        const res = await call({
          accion: 'crear',
          email: email.trim(),
          password,
          nombre: nombre.trim(),
          nombreChat: nombreChat.trim() || nombre.trim(),
          rol,
          sitios,
        });
        const uid = res.data.uid;
        const extra: Record<string, unknown> = {};
        if (foto) extra.fotoUrl = await subirFoto(uid);
        if (!activo) extra.activo = false;
        if (Object.keys(extra).length) await call({ accion: 'actualizar', uid, ...extra });
      } else if (row) {
        const fotoUrl = foto ? await subirFoto(row.id) : undefined;
        await call({
          accion: 'actualizar',
          uid: row.id,
          nombre: nombre.trim(),
          email: email.trim(),
          nombreChat: nombreChat.trim() || nombre.trim(),
          rol,
          sitios,
          activo,
          ...(fotoUrl ? { fotoUrl } : {}),
        });
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const fotoActual = fotoPreview ?? p?.fotoUrl ?? null;

  return (
    <div className="fixed inset-0 z-50 bg-navy-deep/50 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="bg-white rounded-panel shadow-modal w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-cream-3 flex items-center justify-between">
          <h3 className="text-[15px] font-bold">{modo === 'crear' ? m.tituloCrear : m.tituloEditar}</h3>
          <button onClick={onClose} className="text-warm-gray hover:text-ink">
            <span className="msr text-[20px]">close</span>
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {/* Foto */}
          <div className="flex items-center gap-3">
            {fotoActual ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fotoActual} alt="" className="h-14 w-14 rounded-full object-cover flex-none" />
            ) : (
              <div className="h-14 w-14 rounded-full bg-cream-3 text-ink-2 flex items-center justify-center text-[15px] font-bold flex-none">
                {nombre ? iniciales(nombre) : <span className="msr text-[24px] text-warm-gray-3">person</span>}
              </div>
            )}
            <div>
              <label className="inline-flex items-center gap-1.5 border border-warm-border rounded-lg px-3 py-1.5 text-[12px] font-semibold text-ink cursor-pointer hover:border-navy">
                <span className="msr text-[15px]">photo_camera</span>
                {m.cambiarFoto}
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={(e) => elegirFoto(e.target.files?.[0] ?? null)}
                />
              </label>
              <div className="text-[10.5px] text-warm-gray-2 mt-1">{m.fotoNota}</div>
            </div>
          </div>

          <Campo label={m.nombre}>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputCls} />
          </Campo>

          <Campo label={m.correo}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
            />
          </Campo>

          {modo === 'crear' && (
            <Campo label={m.password}>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
              />
              <span className="text-[10.5px] text-warm-gray-2">{m.passwordHint}</span>
            </Campo>
          )}

          {/* Rol */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10.5px] font-bold tracking-wide text-warm-gray uppercase">{m.rol}</span>
            <div className="flex flex-col gap-2">
              {(
                [
                  ['admin', 'Admin', m.adminDesc],
                  ['agente', idioma === 'es' ? 'Agente' : 'Agent', m.agenteDesc],
                ] as const
              ).map(([val, label, desc]) => (
                <label
                  key={val}
                  className={`flex items-start gap-2.5 border rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${
                    rol === val ? 'border-navy bg-info-bg' : 'border-warm-border hover:border-navy'
                  }`}
                >
                  <input
                    type="radio"
                    name="rol"
                    checked={rol === val}
                    onChange={() => setRol(val)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-[12.5px] font-semibold text-ink">{label}</span>
                    <span className="block text-[11px] text-warm-gray mt-0.5">{desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <Campo label={m.nombreChat}>
            <input
              value={nombreChat}
              onChange={(e) => setNombreChat(e.target.value)}
              placeholder={m.nombreChatPlaceholder}
              className={inputCls}
            />
          </Campo>

          {/* Sitios asignados */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10.5px] font-bold tracking-wide text-warm-gray uppercase">{m.sitios}</span>
            <div className="flex flex-col gap-1.5">
              {sites.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-[12.5px] text-ink-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sitios.includes(s.id)}
                    onChange={() => toggleSitio(s.id)}
                  />
                  <span className="msr text-[15px] text-warm-gray">{s.data.icono}</span>
                  {s.data.nombre}
                </label>
              ))}
            </div>
            <span className="text-[10.5px] text-warm-gray-2">{m.sitiosHint}</span>
          </div>

          {/* Activo */}
          <div className="flex items-center gap-3 border-t border-cream-3 pt-4">
            <div className="flex-1">
              <div className="text-[12.5px] font-semibold text-ink">{m.activo}</div>
              <div className="text-[11px] text-warm-gray mt-0.5">{m.activoHint}</div>
            </div>
            <Toggle on={activo} onChange={setActivo} />
          </div>

          {error && <div className="text-danger text-[12px]">{error}</div>}
        </div>

        <div className="px-5 py-4 border-t border-cream-3 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="text-[12.5px] font-semibold text-warm-gray px-4 py-2 rounded-lg hover:bg-cream-1"
          >
            {m.cancelar}
          </button>
          <button
            onClick={guardar}
            disabled={busy || !nombre.trim() || !email.trim() || (modo === 'crear' && !password)}
            className="bg-navy text-white text-[12.5px] font-semibold px-4 py-2 rounded-lg hover:bg-navy-light disabled:opacity-50"
          >
            {busy ? m.guardando : modo === 'crear' ? m.invitar : m.guardar}
          </button>
        </div>
      </div>
    </div>
  );
}
