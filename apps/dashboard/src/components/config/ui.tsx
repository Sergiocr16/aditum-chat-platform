'use client';

// Helpers visuales compartidos por las tabs de /configuracion (specs 1j/1k/1m/1o/1p).

import type { Idioma } from '@aditum-chat/shared';

/** Switch estilo iOS — verde (bg-ok) cuando está activo. */
export function Toggle({
  on,
  onChange,
  disabled,
}: {
  on: boolean;
  onChange(v: boolean): void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-[22px] w-[38px] flex-none cursor-pointer items-center rounded-full transition-colors disabled:opacity-50 ${
        on ? 'bg-ok' : 'bg-warm-gray-4'
      }`}
    >
      <span
        className={`inline-block h-[18px] w-[18px] rounded-full bg-white shadow-card transition-transform ${
          on ? 'translate-x-[18px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  );
}

/** Fila con label + hint a la izquierda y toggle a la derecha. */
export function ToggleRow({
  label,
  hint,
  on,
  onChange,
  extra,
}: {
  label: string;
  hint?: string;
  on: boolean;
  onChange(v: boolean): void;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-semibold text-ink">{label}</div>
        {hint && <div className="text-[11px] text-warm-gray mt-0.5">{hint}</div>}
        {extra}
      </div>
      <Toggle on={on} onChange={onChange} />
    </div>
  );
}

/** Card blanca estándar del diseño. */
export function Card({
  icon,
  title,
  subtitle,
  children,
  className = '',
}: {
  icon?: string;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`bg-white border border-warm-border shadow-card rounded-lg ${className}`}>
      {title && (
        <header className="px-5 pt-4 pb-1 flex items-start gap-2.5">
          {icon && <span className="msr text-[19px] text-navy mt-0.5">{icon}</span>}
          <div>
            <h3 className="text-[13px] font-bold text-ink">{title}</h3>
            {subtitle && <p className="text-[11px] text-warm-gray mt-0.5">{subtitle}</p>}
          </div>
        </header>
      )}
      <div className="px-5 pb-5 pt-3">{children}</div>
    </section>
  );
}

/** Etiqueta pequeña de herencia: "(Por sitio)" cuando hay override, "(Global)" si hereda. */
export function HerenciaTag({ porSitio, idioma }: { porSitio: boolean; idioma: Idioma }) {
  const texto = porSitio
    ? idioma === 'es'
      ? '(Por sitio)'
      : '(Per site)'
    : idioma === 'es'
      ? '(Global)'
      : '(Global)';
  return (
    <span
      className={`text-[9.5px] font-bold tracking-wide px-1.5 py-0.5 rounded-full ${
        porSitio ? 'bg-tag-blue-bg text-navy' : 'bg-cream-2 text-warm-gray'
      }`}
    >
      {texto}
    </span>
  );
}

/** Label de campo (mayúsculas pequeñas) con children debajo. */
export function Campo({
  label,
  tag,
  children,
}: {
  label: string;
  tag?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-[10.5px] font-bold tracking-wide text-warm-gray uppercase">
        {label} {tag}
      </span>
      {children}
    </label>
  );
}

export const inputCls =
  'w-full border border-warm-border rounded-lg px-3 py-2 text-[13px] text-ink outline-none focus:border-navy bg-white';
