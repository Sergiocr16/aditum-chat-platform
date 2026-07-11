'use client';

import { useState } from 'react';
import type { GroupClientRef } from '@aditum-chat/shared';

/**
 * Collapsible list of the clients (condos) a group manages. Groups can manage
 * 30+ units, so only the count shows by default and the list expands downward.
 */
export function GroupClientsList({ clients, label }: { clients: GroupClientRef[]; label: string }) {
  const [open, setOpen] = useState(false);
  if (clients.length === 0) return null;
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[11px] font-semibold text-navy hover:opacity-75"
      >
        {label}
        <span className="msr text-[15px]">{open ? 'expand_less' : 'expand_more'}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-1.5 mt-2 max-h-48 overflow-y-auto pr-1">
          {clients.map((cl) => (
            <div key={cl.id} className="flex items-center gap-1.5 text-[11.5px] text-ink-2">
              <span className="msr text-[13px] text-warm-gray-2 flex-none">apartment</span>
              <span className="truncate">{cl.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
