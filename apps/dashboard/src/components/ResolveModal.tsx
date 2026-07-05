'use client';

import { useState } from 'react';
import type { GlobalSettings, Idioma } from '@aditum-chat/shared';
import {
  CONVERSATION_CATEGORIES,
  categoryLabel,
  conversationCategoryLabels,
} from '@aditum-chat/shared';
import { useAuth } from '@/lib/auth';
import { resolveConversation, useDoc } from '@/lib/data';

const M = {
  es: {
    titulo: '¿Marcar esta conversación como resuelta?',
    subtitulo: 'Asignale una categoría para clasificarla en el historial.',
    categoria: 'CATEGORÍA',
    otroPlaceholder: 'Escribí la categoría…',
    aviso:
      'El historial no se pierde: la conversación quedará en las conversaciones anteriores del contacto y el usuario seguirá viendo todos sus mensajes.',
    cancelar: 'Cancelar',
    resolver: 'Resolver conversación',
    resolviendo: 'Resolviendo…',
    confirmarTitulo: '¿Cerrar la conversación?',
    confirmarTexto: 'Se marcará como resuelta en la categoría',
    confirmarSi: 'Sí, cerrar',
  },
  en: {
    titulo: 'Mark this conversation as resolved?',
    subtitulo: 'Assign a category to classify it in the history.',
    categoria: 'CATEGORY',
    otroPlaceholder: 'Type the category…',
    aviso:
      'Nothing is lost: the conversation will remain in the contact’s past conversations and the user keeps seeing all their messages.',
    cancelar: 'Cancel',
    resolver: 'Resolve conversation',
    resolviendo: 'Resolving…',
    confirmarTitulo: 'Close the conversation?',
    confirmarTexto: 'It will be marked as resolved in the category',
    confirmarSi: 'Yes, close',
  },
} as const;

export function ResolveModal({
  convId,
  onClose,
  onResolved,
}: {
  convId: string;
  onClose(): void;
  onResolved?(): void;
}) {
  const { agent } = useAuth();
  const idioma: Idioma = agent?.idioma ?? 'es';
  const m = M[idioma];
  const global = useDoc<GlobalSettings & { categorias?: string[] }>('settings/global');
  const categorias: string[] =
    global?.data.categorias && global.data.categorias.length > 0
      ? global.data.categorias
      : [...CONVERSATION_CATEGORIES];

  const [sel, setSel] = useState<string | null>(null);
  const [otro, setOtro] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  const categoriaFinal = sel === 'otro' ? otro.trim() : sel;
  const labelMostrar =
    sel === 'otro' ? otro.trim() : categoryLabel(categoriaFinal ?? undefined, idioma);

  async function confirmar() {
    if (!agent || !categoriaFinal) return;
    setBusy(true);
    setError(null);
    try {
      const label =
        sel === 'otro' ? otro.trim() : categoryLabel(categoriaFinal ?? undefined, idioma);
      await resolveConversation(
        convId,
        categoriaFinal,
        label,
        agent.uid,
        agent.perfil?.nombre ?? '',
      );
      onResolved?.();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
    <div
      className="fixed inset-0 z-50 bg-navy-deep/50 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-panel shadow-modal w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 mb-1">
          <span className="msr text-[22px] text-ok">check_circle</span>
          <h3 className="text-[15px] font-bold">{m.titulo}</h3>
        </div>
        <p className="text-[12px] text-warm-gray mb-4">{m.subtitulo}</p>

        <div className="text-[10.5px] font-bold tracking-wide text-warm-gray mb-2">
          {m.categoria}
        </div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {categorias.map((c) => (
            <button
              key={c}
              onClick={() => setSel(c)}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                sel === c
                  ? 'bg-navy border-navy text-white'
                  : 'bg-white border-warm-border text-warm-gray hover:border-navy'
              }`}
            >
              {conversationCategoryLabels[idioma][c] ?? c}
            </button>
          ))}
        </div>
        {sel === 'otro' && (
          <input
            autoFocus
            value={otro}
            onChange={(e) => setOtro(e.target.value)}
            placeholder={m.otroPlaceholder}
            className="w-full border border-warm-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-navy mb-3"
          />
        )}

        <div className="flex items-start gap-2 bg-info-bg rounded-lg px-3 py-2.5 text-[11.5px] text-ink-2 mb-4">
          <span className="msr text-[15px] text-navy mt-0.5">history</span>
          {m.aviso}
        </div>

        {error && <div className="text-danger text-[12px] mb-3">{error}</div>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="text-[12.5px] font-semibold text-warm-gray px-4 py-2 rounded-lg hover:bg-cream-1"
          >
            {m.cancelar}
          </button>
          <button
            onClick={() => categoriaFinal && setConfirmando(true)}
            disabled={!categoriaFinal}
            className="bg-ok text-white text-[12.5px] font-semibold px-4 py-2 rounded-lg hover:bg-ok-dark disabled:opacity-50"
          >
            {m.resolver}
          </button>
        </div>
      </div>
    </div>

    {confirmando && (
      <div
        className="fixed inset-0 z-[60] bg-navy-deep/60 flex items-center justify-center p-6"
        onClick={() => !busy && setConfirmando(false)}
      >
        <div
          className="bg-white rounded-panel shadow-modal w-full max-w-sm p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2.5 mb-1.5">
            <span className="msr text-[22px] text-ok">check_circle</span>
            <h3 className="text-[15px] font-bold">{m.confirmarTitulo}</h3>
          </div>
          <p className="text-[12.5px] text-warm-gray mb-4">
            {m.confirmarTexto} <strong className="text-ink-2">{labelMostrar || '—'}</strong>.
          </p>
          {error && <div className="text-danger text-[12px] mb-3">{error}</div>}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setConfirmando(false)}
              disabled={busy}
              className="text-[12.5px] font-semibold text-warm-gray px-4 py-2 rounded-lg hover:bg-cream-1 disabled:opacity-50"
            >
              {m.cancelar}
            </button>
            <button
              onClick={confirmar}
              disabled={busy}
              className="bg-ok text-white text-[12.5px] font-semibold px-4 py-2 rounded-lg hover:bg-ok-dark disabled:opacity-50"
            >
              {busy ? m.resolviendo : m.confirmarSi}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
