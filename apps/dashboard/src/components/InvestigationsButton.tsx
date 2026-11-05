'use client';

import { useT } from '@/lib/i18n';
import { ClaudeLogo } from './InvestigatorMascot';

/** The context panels' way into the chat's investigations, which open in the Investigar panel. */
export function InvestigationsButton({ onOpen }: { onOpen?(): void }) {
  const t = useT();
  return (
    <div className="border-b border-cream-3 px-4 py-3.5">
      <button
        onClick={onOpen}
        className="flex w-full items-center gap-2.5 rounded-lg border border-warm-border bg-white px-3 py-2.5 text-left shadow-card hover:border-navy focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy"
      >
        <ClaudeLogo className="h-[18px] flex-none" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{t('inv.titulo')}</span>
        <span aria-hidden className="msr flex-none text-[18px] text-warm-gray">chevron_right</span>
      </button>
    </div>
  );
}
