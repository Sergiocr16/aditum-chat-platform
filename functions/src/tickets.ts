import { HttpsError, onCall } from 'firebase-functions/v2/https';
import type { MessageSender, Ticket, TicketPriority } from '@aditum-chat/shared';
import { db, FieldValue } from './lib/admin.js';

export interface CrearTicketParams {
  siteId: string;
  clientId?: string;
  clientNombre?: string;
  contactId?: string;
  contactNombre?: string;
  conversationId?: string | null;
  asunto: string;
  descripcion: string;
  prioridad: TicketPriority;
  publico: boolean;
  ambito: 'cliente' | 'sistema';
  asignadoA?: string | null;
  asignadoNombre?: string | null;
  creadoPor: MessageSender;
}

/** Crea el ticket con numeración transaccional + historial + chip en la conversación. */
export async function crearTicketInterno(
  params: CrearTicketParams,
): Promise<{ ticketId: string; numero: number }> {
  const { ticketId, numero } = await db.runTransaction(async (tx) => {
    const counterRef = db.doc('counters/tickets');
    const counter = await tx.get(counterRef);
    const next = (counter.data()?.next as number | undefined) ?? 1;
    tx.set(counterRef, { next: next + 1 }, { merge: true });

    const ticketRef = db.collection('tickets').doc();
    const doc: Record<string, unknown> = {
      numero: next,
      siteId: params.siteId,
      asunto: params.asunto.trim(),
      descripcion: params.descripcion ?? '',
      estado: 'abierto',
      prioridad: params.prioridad ?? 'media',
      ambito: params.ambito ?? 'cliente',
      publico: params.publico ?? false,
      conversationId: params.conversationId ?? null,
      asignadoA: params.asignadoA ?? null,
      asignadoNombre: params.asignadoNombre ?? null,
      devRef: null,
      sla: { estado: 'en_sla', pausas: [] },
      resolucion: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (params.clientId) doc.clientId = params.clientId;
    if (params.clientNombre) doc.clientNombre = params.clientNombre;
    if (params.contactId) doc.contactId = params.contactId;
    if (params.contactNombre) doc.contactNombre = params.contactNombre;
    tx.set(ticketRef, doc);

    tx.set(ticketRef.collection('historial').doc(), {
      tipo: 'creado',
      descripcion: params.conversationId
        ? `Creado desde el chat por ${params.creadoPor.nombre}`
        : `Creado por ${params.creadoPor.nombre}`,
      por: params.creadoPor,
      createdAt: FieldValue.serverTimestamp(),
    });
    if (params.asignadoA && params.asignadoNombre) {
      tx.set(ticketRef.collection('historial').doc(), {
        tipo: 'asignado',
        descripcion: `Asignado a ${params.asignadoNombre}`,
        por: params.creadoPor,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    if (params.contactId) {
      tx.update(db.doc(`contacts/${params.contactId}`), {
        ticketsCount: FieldValue.increment(1),
      });
    }
    return { ticketId: ticketRef.id, numero: next };
  });

  if (params.conversationId) {
    await linkConversation(params.conversationId, ticketId, numero, params.creadoPor.nombre);
  }
  return { ticketId, numero };
}

interface CreateTicketInput {
  siteId: string;
  clientId?: string;
  clientNombre?: string;
  contactId?: string;
  contactNombre?: string;
  conversationId?: string;
  asunto: string;
  descripcion: string;
  prioridad: TicketPriority;
  publico: boolean;
  ambito: 'cliente' | 'sistema';
  asignadoA?: string | null;
  asignadoNombre?: string | null;
  /** Si viene, adjunta la conversación a un ticket existente en vez de crear. */
  adjuntarA?: string;
}

/** Numeración transaccional + historial + chip en la conversación. Solo agentes. */
export const createTicket = onCall({ region: 'us-central1' }, async (req) => {
  if (req.auth?.token.kind !== 'agent') {
    throw new HttpsError('permission-denied', 'Solo agentes pueden crear tickets.');
  }
  const input = req.data as CreateTicketInput;
  if (!input.asunto?.trim() || !input.siteId) {
    throw new HttpsError('invalid-argument', 'Faltan campos requeridos.');
  }
  const agenteNombre = (req.auth.token.name as string) ?? 'Agente';
  const por = { tipo: 'agent' as const, id: req.auth.uid, nombre: agenteNombre };

  // Adjuntar a ticket existente.
  if (input.adjuntarA) {
    const ref = db.doc(`tickets/${input.adjuntarA}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'El ticket no existe.');
    const ticket = snap.data() as Ticket;
    await ref.collection('historial').add({
      tipo: 'comentario',
      descripcion: `Conversación adjuntada por ${agenteNombre}`,
      por,
      createdAt: FieldValue.serverTimestamp(),
    });
    if (input.conversationId) {
      await linkConversation(input.conversationId, input.adjuntarA, ticket.numero, agenteNombre);
    }
    return { ticketId: input.adjuntarA, numero: ticket.numero };
  }

  // Crear ticket nuevo con número secuencial.
  return crearTicketInterno({ ...input, creadoPor: por });
});

async function linkConversation(
  conversationId: string,
  ticketId: string,
  numero: number,
  agenteNombre: string,
): Promise<void> {
  const convRef = db.doc(`conversations/${conversationId}`);
  await convRef.collection('messages').add({
    sender: { tipo: 'sistema', id: 'sistema', nombre: 'Sistema' },
    texto: `${agenteNombre} creó un ticket a partir de esta conversación`,
    tipoContenido: 'sistema',
    ticketRef: { ticketId, numero },
    createdAt: FieldValue.serverTimestamp(),
  });
  await convRef.update({ updatedAt: FieldValue.serverTimestamp() });
}
