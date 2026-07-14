'use client';

// Hooks de datos para /contactos y /reportes — separado de data.ts a propósito
// (los agentes de pantallas nuevas no tocan data.ts).

import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  where,
  type QueryConstraint,
} from 'firebase/firestore';
import type { Client, Contact, Conversation, CsatRating, DailyMetrics } from '@aditum-chat/shared';
import { db } from './firebase';
import type { Row } from './data';

function useCollection<T>(path: string, constraints: QueryConstraint[], deps: unknown[]): Row<T>[] {
  const [rows, setRows] = useState<Row<T>[]>([]);
  useEffect(() => {
    const q = query(collection(db, path), ...constraints);
    return onSnapshot(q, (snap) => {
      setRows(snap.docs.map((d) => ({ id: d.id, data: d.data() as T })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return rows;
}

// ---------------------------------------------------------------- contactos

export interface ContactFiltros {
  clientId: string | null;
  siteId: string | null;
  rol: string | null;
  busqueda: string;
}

/**
 * Directorio de contactos (pantalla 1r). Firestore trae los 200 más recientes
 * por lastActivity; los filtros de cliente/sitio/rol y la búsqueda por
 * nombre/email se aplican client-side.
 */
export function useContacts(filtros: ContactFiltros): {
  todos: Row<Contact>[];
  filtrados: Row<Contact>[];
} {
  const todos = useCollection<Contact>(
    'contacts',
    [orderBy('lastActivity', 'desc'), fsLimit(200)],
    [],
  );
  const filtrados = useMemo(() => {
    const q = filtros.busqueda.trim().toLowerCase();
    return todos.filter((c) => {
      if (filtros.clientId && c.data.clientId !== filtros.clientId) return false;
      if (filtros.siteId && c.data.siteId !== filtros.siteId) return false;
      if (filtros.rol && c.data.rol !== filtros.rol) return false;
      if (q && !`${c.data.nombre} ${c.data.email ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [todos, filtros.clientId, filtros.siteId, filtros.rol, filtros.busqueda]);
  return { todos, filtrados };
}

/** Catálogo de clientes/condominios para el dropdown de filtro. */
export function useClients() {
  return useCollection<Client>('clients', [orderBy('nombre', 'asc')], []);
}

/** Conversaciones recientes de un contacto (panel lateral de 1r). */
export function useContactConversations(contactId: string | null) {
  return useCollection<Conversation>(
    'conversations',
    [where('contactId', '==', contactId ?? '_'), orderBy('updatedAt', 'desc'), fsLimit(5)],
    [contactId],
  );
}

// ---------------------------------------------------------------- métricas (1h)

/** Métricas diarias para reportes. Colección top-level `metrics_daily`.
 *  180 días: alcanza para comparar el rango de 90 con su período anterior. */
export function useDailyMetrics() {
  return useCollection<DailyMetrics>('metrics_daily', [orderBy('fecha', 'desc'), fsLimit(180)], []);
}

/** Valoraciones CSAT individuales (distribución, tendencia y por agente). */
export function useCsatRatings() {
  return useCollection<CsatRating>('csat', [orderBy('createdAt', 'desc'), fsLimit(1000)], []);
}

/** Mediana simple; null si la lista está vacía. */
export function mediana(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}
