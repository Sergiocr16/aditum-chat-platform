'use client';

// Etiquetas (tags) configurables por sitio y su asignación a contactos.
// Separado de data.ts para no tocar archivos existentes.

import { useEffect, useState } from 'react';
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import type { Tag } from '@aditum-chat/shared';
import { db } from './firebase';
import type { Row } from './data';

/** Etiquetas de un sitio, ordenadas por `orden` y luego por nombre (client-side). */
export function useTags(siteId: string | null): Row<Tag>[] {
  const [rows, setRows] = useState<Row<Tag>[]>([]);
  useEffect(() => {
    if (!siteId) {
      setRows([]);
      return;
    }
    const q = query(collection(db, 'tags'), where('siteId', '==', siteId));
    return onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, data: d.data() as Tag }));
      list.sort(
        (a, b) =>
          (a.data.orden ?? 0) - (b.data.orden ?? 0) ||
          a.data.nombre.localeCompare(b.data.nombre),
      );
      setRows(list);
    });
  }, [siteId]);
  return rows;
}

export function crearTag(siteId: string, nombre: string, color: string, orden = 0) {
  return addDoc(collection(db, 'tags'), {
    siteId,
    nombre: nombre.trim(),
    color,
    orden,
    createdAt: serverTimestamp(),
  });
}

export function actualizarTag(id: string, patch: Partial<Pick<Tag, 'nombre' | 'color' | 'orden'>>) {
  return updateDoc(doc(db, 'tags', id), patch);
}

export function borrarTag(id: string) {
  return deleteDoc(doc(db, 'tags', id));
}

/** Asigna o quita una etiqueta a un contacto. */
export function toggleContactTag(contactId: string, tagId: string, asignar: boolean) {
  return updateDoc(doc(db, 'contacts', contactId), {
    tags: asignar ? arrayUnion(tagId) : arrayRemove(tagId),
  });
}

/** Asigna o quita una etiqueta al condominio/cliente (conversaciones de equipo). */
export function toggleClientTag(clientId: string, tagId: string, asignar: boolean) {
  return updateDoc(doc(db, 'clients', clientId), {
    tags: asignar ? arrayUnion(tagId) : arrayRemove(tagId),
  });
}

/** Asigna o quita una etiqueta al grupo (organización). */
export function toggleGroupTag(groupId: string, tagId: string, asignar: boolean) {
  return updateDoc(doc(db, 'groups', groupId), {
    tags: asignar ? arrayUnion(tagId) : arrayRemove(tagId),
  });
}

/**
 * Estilo del chip a partir de un hex libre: fondo del color, texto con contraste
 * (blanco u oscuro según la luminancia) y un borde tenue para que los colores
 * muy claros no se pierdan sobre fondo blanco.
 */
export function tagChipStyle(hex: string): { backgroundColor: string; color: string; borderColor: string } {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const claro = lum > 0.62;
  return {
    backgroundColor: hex,
    color: claro ? '#26241F' : '#ffffff',
    borderColor: claro ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.18)',
  };
}
