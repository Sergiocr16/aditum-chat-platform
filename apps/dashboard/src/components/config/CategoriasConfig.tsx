'use client';

// Editor de categorías de cierre de conversación (settings/global.categorias).
// Se muestran en el modal de resolución (ResolveModal) para clasificar el historial.

import { useEffect, useRef, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import type { Idioma } from '@aditum-chat/shared';
import { CONVERSATION_CATEGORIES, conversationCategoryLabels } from '@aditum-chat/shared';
import { db } from '@/lib/firebase';
import { useDoc } from '@/lib/data';
import { Card } from './ui';

const M = {
  es: {
    titulo: 'Categorías al cerrar',
    sub: 'Se eligen al marcar una conversación como resuelta, para clasificarla en el historial.',
    nuevaPh: 'Nueva categoría…',
    agregar: 'Agregar',
    vacio: 'Sin categorías. Agregá al menos una.',
    quitar: 'Quitar',
  },
  en: {
    titulo: 'Closing categories',
    sub: 'Chosen when marking a conversation as resolved, to classify it in the history.',
    nuevaPh: 'New category…',
    agregar: 'Add',
    vacio: 'No categories. Add at least one.',
    quitar: 'Remove',
  },
} as const;

export function CategoriasConfig({ idioma }: { idioma: Idioma }) {
  const m = M[idioma];
  const globalRow = useDoc<{ categorias?: string[] }>('settings/global');
  const [cats, setCats] = useState<string[] | null>(null);
  const [nueva, setNueva] = useState('');
  const cargado = useRef(false);

  // Carga una vez (no pisar mientras se edita).
  useEffect(() => {
    if (globalRow && !cargado.current) {
      cargado.current = true;
      setCats(
        globalRow.data.categorias && globalRow.data.categorias.length > 0
          ? globalRow.data.categorias
          : [...CONVERSATION_CATEGORIES],
      );
    }
  }, [globalRow]);

  const lista = cats ?? [];
  const label = (c: string) => conversationCategoryLabels[idioma][c] ?? c;

  const persistir = (next: string[]) => {
    setCats(next);
    void setDoc(doc(db, 'settings', 'global'), { categorias: next }, { merge: true });
  };

  const agregar = () => {
    const v = nueva.trim();
    if (!v || lista.some((c) => c.toLowerCase() === v.toLowerCase())) return;
    persistir([...lista, v]);
    setNueva('');
  };

  return (
    <Card icon="sell" title={m.titulo} subtitle={m.sub}>
      <div className="flex flex-wrap gap-1.5">
        {lista.map((c) => (
          <span
            key={c}
            className="inline-flex items-center gap-1 text-[12px] font-semibold bg-cream-2 text-ink-2 rounded-full pl-3 pr-1.5 py-1"
          >
            {label(c)}
            <button
              onClick={() => persistir(lista.filter((x) => x !== c))}
              className="msr text-[15px] text-warm-gray-2 hover:text-danger"
              aria-label={m.quitar}
            >
              close
            </button>
          </span>
        ))}
        {lista.length === 0 && <span className="text-[12px] text-warm-gray-2">{m.vacio}</span>}
      </div>
      <div className="flex items-center gap-2 mt-3">
        <input
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') agregar();
          }}
          placeholder={m.nuevaPh}
          maxLength={30}
          className="flex-1 border border-warm-border rounded-lg px-3 py-2 text-[13px] outline-none focus:border-navy bg-white"
        />
        <button
          onClick={agregar}
          disabled={!nueva.trim()}
          className="flex items-center gap-1.5 bg-navy text-white text-[12.5px] font-semibold px-3.5 py-2 rounded-lg disabled:opacity-40 hover:bg-navy-light transition-colors"
        >
          <span className="msr text-[16px]">add</span>
          {m.agregar}
        </button>
      </div>
    </Card>
  );
}
