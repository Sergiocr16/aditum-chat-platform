'use client';

import { useEffect, useRef } from 'react';

/** Gallery item: an image or a PDF from the thread's attachments. */
export interface VisorItem {
  url: string;
  nombre: string;
  esPdf: boolean;
}

/**
 * WhatsApp-style in-app attachment viewer (fullscreen lightbox): prev/next via
 * arrows, ←/→ keys and touch swipe; Esc/backdrop closes; open-in-tab escape
 * hatch (iOS renders only the first PDF page inside iframes).
 */
export function VisorAdjuntos({
  items,
  idx,
  onIdx,
  onClose,
}: {
  items: VisorItem[];
  idx: number;
  onIdx: (i: number) => void;
  onClose: () => void;
}) {
  const item = items[idx];
  const touch = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && idx > 0) onIdx(idx - 1);
      else if (e.key === 'ArrowRight' && idx < items.length - 1) onIdx(idx + 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [idx, items.length, onIdx, onClose]);

  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-[rgba(26,15,26,0.93)] flex flex-col"
      onClick={onClose}
      onTouchStart={(e) => {
        const t = e.touches[0];
        touch.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        const start = touch.current;
        touch.current = null;
        if (!start) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (Math.abs(dx) < 48 || Math.abs(dy) > Math.abs(dx)) return;
        if (dx > 0 && idx > 0) onIdx(idx - 1);
        else if (dx < 0 && idx < items.length - 1) onIdx(idx + 1);
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2.5 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="flex-1 min-w-0 text-[13px] font-semibold truncate">{item.nombre}</span>
        {items.length > 1 && (
          <span className="flex-none text-[12px] text-white/70 tabular-nums">
            {idx + 1} / {items.length}
          </span>
        )}
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          title="Abrir en pestaña nueva"
          className="flex-none p-1.5 rounded-lg text-white/85 hover:text-white hover:bg-white/10"
        >
          <span className="msr text-[19px]">open_in_new</span>
        </a>
        <button
          onClick={onClose}
          title="Cerrar"
          className="flex-none p-1.5 rounded-lg text-white/85 hover:text-white hover:bg-white/10"
        >
          <span className="msr text-[20px]">close</span>
        </button>
      </div>

      {/* Media */}
      <div className="flex-1 min-h-0 flex items-center justify-center px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {item.esPdf ? (
          <iframe
            src={item.url}
            title={item.nombre}
            className="w-full h-full border-0 rounded-md bg-white"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.url}
            alt={item.nombre}
            className="max-w-full max-h-full object-contain rounded-md"
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </div>

      {/* Flechas */}
      {idx > 0 && (
        <button
          aria-label="Anterior"
          onClick={(e) => {
            e.stopPropagation();
            onIdx(idx - 1);
          }}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center"
        >
          <span className="msr text-[26px]">chevron_left</span>
        </button>
      )}
      {idx < items.length - 1 && (
        <button
          aria-label="Siguiente"
          onClick={(e) => {
            e.stopPropagation();
            onIdx(idx + 1);
          }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center"
        >
          <span className="msr text-[26px]">chevron_right</span>
        </button>
      )}
    </div>
  );
}
