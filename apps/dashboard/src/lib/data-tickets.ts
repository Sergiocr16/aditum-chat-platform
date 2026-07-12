'use client';

// Escrituras directas de tickets desde la consola de agentes (diseño 1n).
// Las rules permiten a los agentes escribir tickets, historial y notas.

import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import type { MessageSender, TicketEventTipo } from '@aditum-chat/shared';
import { db } from './firebase';

/** Actualiza campos del ticket y siempre refresca updatedAt. */
export async function updateTicket(ticketId: string, data: Record<string, unknown>) {
  await updateDoc(doc(db, 'tickets', ticketId), { ...data, updatedAt: serverTimestamp() });
}

/** Agrega un evento al historial del ticket (visible en el widget si el ticket es visible). */
export async function addTicketEvent(
  ticketId: string,
  ev: { tipo: TicketEventTipo; descripcion: string; de?: string; a?: string; por: MessageSender },
) {
  await addDoc(collection(db, 'tickets', ticketId, 'historial'), {
    ...ev,
    createdAt: serverTimestamp(),
  });
}

/** Agrega una nota interna (nunca visible en el widget). */
export async function addTicketNote(ticketId: string, autor: MessageSender, texto: string) {
  await addDoc(collection(db, 'tickets', ticketId, 'notas'), {
    autor,
    texto,
    createdAt: serverTimestamp(),
  });
}

/** Edita el texto de una nota interna. */
export async function updateTicketNote(ticketId: string, notaId: string, texto: string) {
  await updateDoc(doc(db, 'tickets', ticketId, 'notas', notaId), {
    texto,
    editadoAt: serverTimestamp(),
  });
}
