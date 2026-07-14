'use client';

import { useEffect, useRef, useState } from 'react';
import type { Tag } from '@aditum-chat/shared';
import type { Row } from '@/lib/data';
import { TagChip } from './chips';

/**
 * Chips de las etiquetas asignadas + botón "+" para asignar/quitar del catálogo
 * del sitio. Reutilizado por el panel de contacto y el de equipo; la diferencia
 * es a qué entidad apunta `onToggle` (contacto o condominio).
 */
export function EtiquetasBlock({
  siteTags,
  asignados,
  onToggle,
  addLabel,
  emptyLabel,
}: {
  siteTags: Row<Tag>[];
  asignados: Set<string>;
  onToggle(id: string, add: boolean): void;
  addLabel: string;
  emptyLabel: string;
}) {
  const asignadas = siteTags.filter((tg) => asignados.has(tg.id));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {asignadas.map((tg) => (
        <TagChip
          key={tg.id}
          nombre={tg.data.nombre}
          color={tg.data.color}
          onRemove={() => onToggle(tg.id, false)}
        />
      ))}
      <TagPicker
        siteTags={siteTags}
        asignados={asignados}
        onToggle={onToggle}
        addLabel={addLabel}
        emptyLabel={emptyLabel}
      />
    </div>
  );
}

/** Botón "+" con dropdown para asignar/quitar etiquetas del catálogo del sitio. */
function TagPicker({
  siteTags,
  asignados,
  onToggle,
  addLabel,
  emptyLabel,
}: {
  siteTags: Row<Tag>[];
  asignados: Set<string>;
  onToggle(id: string, add: boolean): void;
  addLabel: string;
  emptyLabel: string;
}) {
  const [open, setOpen] = useState(false);
  // Fixed positioning: the context panel scrolls (overflow-y-auto), which
  // clips absolutely-positioned children — a fixed dropdown escapes it.
  // Flips upward when there isn't room below (tags sit low in the panel).
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number }>({ right: 0 });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    // Any scroll detaches a fixed dropdown from its trigger: close it.
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  function toggle() {
    if (!open && ref.current) {
      const r = ref.current.getBoundingClientRect();
      const MENU_H = 268; // max-h-64 + margin
      let right = window.innerWidth - r.right;
      right = Math.max(8, Math.min(right, window.innerWidth - 224 - 8)); // keep w-56 on-screen
      const espacioAbajo = window.innerHeight - r.bottom;
      setPos(
        espacioAbajo >= MENU_H || espacioAbajo >= r.top
          ? { top: r.bottom + 4, right }
          : { bottom: window.innerHeight - r.top + 4, right },
      );
    }
    setOpen((v) => !v);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        title={addLabel}
        aria-label={addLabel}
        className="inline-flex items-center text-warm-gray border border-dashed border-warm-border rounded-full px-1.5 py-0.5 hover:border-navy hover:text-navy transition-colors"
      >
        <span className="msr text-[14px]">add</span>
      </button>
      {open && (
        <div
          style={pos}
          className="fixed z-50 w-56 bg-white border border-warm-border rounded-lg shadow-raised py-1 max-h-64 overflow-y-auto"
        >
          {siteTags.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-warm-gray-2 leading-relaxed">
              {emptyLabel}
            </div>
          ) : (
            siteTags.map((tg) => {
              const on = asignados.has(tg.id);
              return (
                <button
                  key={tg.id}
                  onClick={() => onToggle(tg.id, !on)}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-cream-1 transition-colors"
                >
                  <span
                    className="msr text-[16px] flex-none"
                    style={{ color: on ? '#5D3A5F' : '#C9C3B6' }}
                  >
                    {on ? 'check_box' : 'check_box_outline_blank'}
                  </span>
                  <TagChip nombre={tg.data.nombre} color={tg.data.color} />
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
