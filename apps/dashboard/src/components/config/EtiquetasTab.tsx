'use client';

// Configuración → Etiquetas. Catálogo de etiquetas POR SITIO que luego se
// asignan a los residentes desde el panel de la conversación. Color hex libre.

import { useEffect, useState } from 'react';
import type { Idioma } from '@aditum-chat/shared';
import { useAuth } from '@/lib/auth';
import { useSiteFilter } from '@/components/Shell';
import { useSites, type Row } from '@/lib/data';
import { actualizarTag, borrarTag, crearTag, useTags } from '@/lib/data-tags';
import type { Tag } from '@aditum-chat/shared';
import { TagChip } from '@/components/chips';
import { Card } from './ui';

const M = {
  es: {
    sitio: 'Sitio:',
    titulo: 'Etiquetas del sitio',
    sub: 'Se asignan a los residentes desde el panel de la conversación.',
    vacio: 'Todavía no hay etiquetas para este sitio. Creá la primera abajo.',
    nombrePh: 'Nombre de la etiqueta',
    agregar: 'Agregar',
    color: 'Color',
    borrar: 'Borrar',
    confirmar: '¿Borrar?',
    si: 'Sí',
    no: 'No',
  },
  en: {
    sitio: 'Site:',
    titulo: 'Site tags',
    sub: 'Assigned to residents from the conversation panel.',
    vacio: 'No tags for this site yet. Create the first one below.',
    nombrePh: 'Tag name',
    agregar: 'Add',
    color: 'Color',
    borrar: 'Delete',
    confirmar: 'Delete?',
    si: 'Yes',
    no: 'No',
  },
} as const;

type Msgs = (typeof M)[Idioma];

export function EtiquetasTab() {
  const { agent } = useAuth();
  const idioma: Idioma = agent?.idioma ?? 'es';
  const m = M[idioma];
  const { siteId: filtroGlobal } = useSiteFilter();
  const sites = useSites();
  const [siteId, setSiteId] = useState<string | null>(null);

  // Sitio inicial: el del filtro global si aplica, si no el primero.
  useEffect(() => {
    if (!siteId && sites.length > 0) {
      const pre =
        filtroGlobal && sites.some((s) => s.id === filtroGlobal) ? filtroGlobal : sites[0].id;
      setSiteId(pre);
    }
  }, [sites, siteId, filtroGlobal]);

  const tags = useTags(siteId);

  const [nombre, setNombre] = useState('');
  const [color, setColor] = useState('#123C68');
  const [guardando, setGuardando] = useState(false);

  const agregar = async () => {
    const n = nombre.trim();
    if (!n || !siteId || guardando) return;
    setGuardando(true);
    try {
      await crearTag(siteId, n, color, tags.length);
      setNombre('');
      setColor('#123C68');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Selector de sitio */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12px] font-semibold text-warm-gray">{m.sitio}</span>
        {sites.map((s) => (
          <button
            key={s.id}
            onClick={() => setSiteId(s.id)}
            className={`flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-full border transition-colors ${
              siteId === s.id
                ? 'bg-navy border-navy text-white'
                : 'bg-white border-warm-border text-warm-gray hover:border-navy'
            }`}
          >
            <span className="msr text-[15px]">{s.data.icono || 'apartment'}</span>
            {s.data.nombre}
          </button>
        ))}
      </div>

      <Card icon="sell" title={m.titulo} subtitle={m.sub}>
        <div className="flex flex-col divide-y divide-cream-3">
          {tags.map((t) => (
            <TagRow key={t.id} tag={t} m={m} />
          ))}
          {tags.length === 0 && (
            <div className="py-6 text-center text-[12px] text-warm-gray-2">{m.vacio}</div>
          )}
        </div>

        {/* Alta de etiqueta */}
        <div className="mt-4 pt-4 border-t border-cream-3 flex items-center gap-2">
          <ColorInput value={color} onChange={setColor} />
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') agregar();
            }}
            placeholder={m.nombrePh}
            maxLength={24}
            className="flex-1 border border-warm-border rounded-lg px-3 py-2 text-[13px] text-ink outline-none focus:border-navy bg-white"
          />
          <button
            onClick={agregar}
            disabled={!nombre.trim() || !siteId || guardando}
            className="flex items-center gap-1.5 bg-navy text-white text-[12.5px] font-semibold px-3.5 py-2 rounded-lg disabled:opacity-40 hover:bg-navy-light transition-colors"
          >
            <span className="msr text-[16px]">add</span>
            {m.agregar}
          </button>
        </div>
      </Card>
    </div>
  );
}

function TagRow({ tag, m }: { tag: Row<Tag>; m: Msgs }) {
  const [nombre, setNombre] = useState(tag.data.nombre);
  const [porBorrar, setPorBorrar] = useState(false);

  // Mantener sincronizado si cambia desde otro lado.
  useEffect(() => setNombre(tag.data.nombre), [tag.data.nombre]);

  const guardarNombre = () => {
    const n = nombre.trim();
    if (n && n !== tag.data.nombre) actualizarTag(tag.id, { nombre: n });
    else setNombre(tag.data.nombre);
  };

  return (
    <div className="flex items-center gap-3 py-2.5">
      <ColorInput
        value={tag.data.color}
        onChange={(c) => actualizarTag(tag.id, { color: c })}
      />
      <input
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        onBlur={guardarNombre}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        maxLength={24}
        className="flex-1 min-w-0 border border-transparent hover:border-warm-border rounded-lg px-2 py-1.5 text-[13px] text-ink outline-none focus:border-navy bg-transparent focus:bg-white transition-colors"
      />
      <TagChip nombre={tag.data.nombre} color={tag.data.color} />
      {porBorrar ? (
        <span className="flex items-center gap-1.5 text-[11.5px]">
          <span className="text-warm-gray">{m.confirmar}</span>
          <button
            onClick={() => borrarTag(tag.id)}
            className="font-semibold text-danger hover:underline"
          >
            {m.si}
          </button>
          <button
            onClick={() => setPorBorrar(false)}
            className="font-semibold text-warm-gray hover:underline"
          >
            {m.no}
          </button>
        </span>
      ) : (
        <button
          onClick={() => setPorBorrar(true)}
          title={m.borrar}
          className="msr text-[17px] text-warm-gray-3 hover:text-danger flex-none"
        >
          delete
        </button>
      )}
    </div>
  );
}

/** Swatch de color: input nativo type=color con marco redondeado. */
function ColorInput({ value, onChange }: { value: string; onChange(v: string): void }) {
  return (
    <label
      className="h-7 w-7 flex-none rounded-lg border border-warm-border cursor-pointer overflow-hidden relative"
      style={{ backgroundColor: value }}
      title={value}
    >
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer"
      />
    </label>
  );
}
