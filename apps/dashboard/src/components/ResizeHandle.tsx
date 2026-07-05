'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Coincide con un media query y se re-renderiza cuando cambia. */
export function useMediaQuery(q: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return matches;
}

/**
 * Ancho de columna redimensionable por arrastre y persistente en localStorage.
 * `dir` en startDrag: 1 si el handle está a la DERECHA de la columna (arrastrar →
 * agranda), -1 si está a la IZQUIERDA (arrastrar ← agranda).
 */
export function useColumnWidth(key: string, def: number, min: number, max: number) {
  const [width, setWidth] = useState(def);
  const ref = useRef(def);
  useEffect(() => {
    ref.current = width;
  }, [width]);

  useEffect(() => {
    const s = localStorage.getItem(key);
    if (s) {
      const n = Number(s);
      if (!Number.isNaN(n)) setWidth(clamp(n, min, max));
    }
  }, [key, min, max]);

  const startDrag = useCallback(
    (e: React.MouseEvent, dir: 1 | -1) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = ref.current;
      let latest = startW;
      const onMove = (ev: MouseEvent) => {
        latest = clamp(startW + dir * (ev.clientX - startX), min, max);
        setWidth(latest);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem(key, String(Math.round(latest)));
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [key, min, max],
  );

  const reset = useCallback(() => {
    setWidth(def);
    localStorage.setItem(key, String(def));
  }, [def, key]);

  return { width, startDrag, reset };
}

/**
 * Divisor vertical arrastrable entre dos columnas. Doble clic restablece.
 * La línea visible es fina; la zona de agarre se extiende a los lados.
 */
export function ResizeHandle({
  onStart,
  onReset,
  className = '',
}: {
  onStart(e: React.MouseEvent): void;
  onReset?(): void;
  className?: string;
}) {
  return (
    <div
      onMouseDown={onStart}
      onDoubleClick={onReset}
      role="separator"
      aria-orientation="vertical"
      title="Arrastrá para ajustar el ancho · doble clic para restablecer"
      className={`group relative w-px flex-none cursor-col-resize bg-warm-border hover:bg-navy/50 active:bg-navy transition-colors ${className}`}
    >
      {/* Zona de agarre más ancha que la línea visible. */}
      <span className="absolute inset-y-0 -left-2 -right-2 z-10" />
    </div>
  );
}
