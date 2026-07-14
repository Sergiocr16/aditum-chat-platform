import { useEffect, useRef } from 'preact/hooks';

/** Gallery item: an image or a PDF from the thread's attachments. */
export interface VisorItem {
  url: string;
  nombre: string;
  esPdf: boolean;
}

/**
 * WhatsApp-style in-app attachment viewer: fullscreen overlay with prev/next
 * (arrows, ←/→ keys and touch swipe), Esc/backdrop to close, and an
 * open-in-tab escape hatch (iOS renders only the first PDF page in iframes).
 */
export function Visor({
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

  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dy) > Math.abs(dx)) return;
    if (dx > 0 && idx > 0) onIdx(idx - 1);
    else if (dx < 0 && idx < items.length - 1) onIdx(idx + 1);
  };

  return (
    <div class="ac-visor" onClick={onClose} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div class="ac-visor-head" onClick={(e) => e.stopPropagation()}>
        <span class="ac-visor-nombre">{item.nombre}</span>
        {items.length > 1 && (
          <span class="ac-visor-contador">
            {idx + 1} / {items.length}
          </span>
        )}
        <a
          class="ac-visor-btn"
          href={item.url}
          target="_blank"
          rel="noopener"
          aria-label="Abrir en pestaña nueva"
        >
          <span class="ac-icon">open_in_new</span>
        </a>
        <button class="ac-visor-btn" aria-label="Cerrar" onClick={onClose}>
          <span class="ac-icon">close</span>
        </button>
      </div>

      <div class="ac-visor-media">
        {item.esPdf ? (
          <iframe
            class="ac-visor-pdf"
            src={item.url}
            title={item.nombre}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <img
            class="ac-visor-img"
            src={item.url}
            alt={item.nombre}
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </div>

      {idx > 0 && (
        <button
          class="ac-visor-nav ac-visor-prev"
          aria-label="Anterior"
          onClick={(e) => {
            e.stopPropagation();
            onIdx(idx - 1);
          }}
        >
          <span class="ac-icon">chevron_left</span>
        </button>
      )}
      {idx < items.length - 1 && (
        <button
          class="ac-visor-nav ac-visor-next"
          aria-label="Siguiente"
          onClick={(e) => {
            e.stopPropagation();
            onIdx(idx + 1);
          }}
        >
          <span class="ac-icon">chevron_right</span>
        </button>
      )}
    </div>
  );
}
