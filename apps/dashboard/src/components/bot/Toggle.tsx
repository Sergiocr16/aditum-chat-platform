'use client';

/** Switch accesible estilo iOS: pill verde (bg-ok) cuando está activo. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange(v: boolean): void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[22px] w-[38px] flex-none items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy ${
        checked ? 'bg-ok' : 'bg-warm-gray-4'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-[18px] w-[18px] rounded-full bg-white shadow-card transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  );
}
