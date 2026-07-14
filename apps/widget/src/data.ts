import {
  addDoc,
  collection,
  doc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import type {
  Conversation,
  CsatRating,
  Message,
  Ticket,
  TicketEvent,
  WidgetSessionResponse,
} from '@aditum-chat/shared';
import type { WidgetFirebase } from './firebase.js';

export interface Doc<T> {
  id: string;
  data: T;
}

/** Última conversación directa del contacto (la activa). */
export function subscribeMyConversation(
  fb: WidgetFirebase,
  session: WidgetSessionResponse,
  cb: (conv: Doc<Conversation> | null) => void,
): Unsubscribe {
  const q = query(
    collection(fb.db, 'conversations'),
    where('tipo', '==', 'directa'),
    where('contactId', '==', session.contactId),
    orderBy('updatedAt', 'desc'),
    limit(1),
  );
  return onSnapshot(q, (snap) => {
    const d = snap.docs[0];
    cb(d ? { id: d.id, data: d.data() as Conversation } : null);
  });
}

/** Todas las conversaciones directas del contacto (para el hilo continuo). */
export function subscribeMyConversations(
  fb: WidgetFirebase,
  session: WidgetSessionResponse,
  cb: (convs: Doc<Conversation>[]) => void,
): Unsubscribe {
  const q = query(
    collection(fb.db, 'conversations'),
    where('tipo', '==', 'directa'),
    where('contactId', '==', session.contactId),
    orderBy('updatedAt', 'desc'),
    limit(20),
  );
  // Solo emitimos conversaciones YA confirmadas por el servidor. Una conversación
  // recién creada aparece primero como escritura local pendiente; si nos suscribimos
  // a sus mensajes en ese instante, la regla hace get() del padre que aún no existe
  // en el servidor → permission-denied y el listener muere. Esperamos la confirmación
  // (pero una vez confirmada, la mantenemos aunque tenga updates pendientes).
  const confirmadas = new Set<string>();
  return onSnapshot(q, (snap) => {
    const rows: Doc<Conversation>[] = [];
    for (const d of snap.docs) {
      if (!d.metadata.hasPendingWrites) confirmadas.add(d.id);
      if (confirmadas.has(d.id)) rows.push({ id: d.id, data: d.data() as Conversation });
    }
    cb(rows);
  });
}

/**
 * Segmentos del chat grupal del cliente donde participa el contacto. Se
 * encadenan como las directas: la activa = la más reciente no resuelta.
 * Consulta por `participantes` (respeta las reglas: el contacto solo lee
 * grupos donde está).
 */
export function subscribeMyGroupConversations(
  fb: WidgetFirebase,
  session: WidgetSessionResponse,
  cb: (convs: Doc<Conversation>[]) => void,
): Unsubscribe {
  // El filtro `tipo == 'grupo'` es OBLIGATORIO: la regla de lectura exige
  // `tipo == 'grupo' && myContactId() in participantes`, y Firestore autoriza la
  // query por alineación estática con la regla (sin él → permission-denied).
  const q = query(
    collection(fb.db, 'conversations'),
    where('tipo', '==', 'grupo'),
    where('participantes', 'array-contains', session.contactId),
    orderBy('updatedAt', 'desc'),
    limit(20),
  );
  const confirmadas = new Set<string>();
  return onSnapshot(
    q,
    (snap) => {
      const rows: Doc<Conversation>[] = [];
      for (const d of snap.docs) {
        if (!d.metadata.hasPendingWrites) confirmadas.add(d.id);
        if (!confirmadas.has(d.id)) continue;
        const data = d.data() as Conversation;
        // v2 group chats are org-level: keyed by groupId (they carry no
        // clientId). Same filter ensureGroupConversation uses below.
        if (!session.groupId || data.groupId === session.groupId) {
          rows.push({ id: d.id, data });
        }
      }
      cb(rows);
    },
    () => cb([]), // degradar sin romper si la query falla
  );
}

/**
 * Conversación destino del chat grupal: el segmento ACTIVO (no resuelto) o uno
 * NUEVO (copiando participantes del último) si el actual quedó resuelto. Igual que
 * las directas: el chat de equipo contiene múltiples conversaciones segmentadas.
 */
export async function ensureGroupConversation(
  fb: WidgetFirebase,
  session: WidgetSessionResponse,
): Promise<string> {
  const q = query(
    collection(fb.db, 'conversations'),
    where('tipo', '==', 'grupo'),
    where('participantes', 'array-contains', session.contactId),
    orderBy('updatedAt', 'desc'),
    limit(20),
  );
  const grupos = (await getDocs(q)).docs.filter((d) => {
    const x = d.data() as Conversation;
    return !session.groupId || x.groupId === session.groupId;
  });
  const activo = grupos.find((d) => (d.data() as Conversation).estado !== 'resolved');
  if (activo) return activo.id;

  const base = grupos[0]?.data() as Conversation | undefined;
  const ref = doc(collection(fb.db, 'conversations'));
  await setDoc(ref, {
    tipo: 'grupo',
    siteId: session.siteId,
    groupId: base?.groupId ?? session.groupId,
    groupName: base?.groupName ?? session.groupName ?? session.groupId ?? '',
    participantes: base?.participantes ?? [session.contactId],
    participantesInfo: base?.participantesInfo ?? {
      [session.contactId]: { nombre: session.nombre, tipo: 'user', rol: session.rol ?? '' },
    },
    estado: 'open',
    unread: {},
    idioma: session.idioma,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/** Página de mensajes hacia atrás (estática) dentro de una conversación. */
export async function fetchOlderMessages(
  fb: WidgetFirebase,
  convId: string,
  pageSize: number,
  cursor: unknown | null,
): Promise<{ docs: Doc<Message>[]; cursor: unknown | null; hayMas: boolean }> {
  const { getDocs: getDocsFn, startAfter } = await import('firebase/firestore');
  const base = collection(fb.db, 'conversations', convId, 'messages');
  const q = cursor
    ? query(base, orderBy('createdAt', 'desc'), startAfter(cursor as never), limit(pageSize))
    : query(base, orderBy('createdAt', 'desc'), limit(pageSize));
  const snap = await getDocsFn(q);
  return {
    docs: snap.docs.map((d) => ({ id: d.id, data: d.data() as Message })).reverse(),
    cursor: snap.docs[snap.docs.length - 1] ?? cursor,
    hayMas: snap.docs.length === pageSize,
  };
}

/** Suscripción en vivo a la última página de una conversación (desc → invertida). */
export function subscribeLatestMessages(
  fb: WidgetFirebase,
  convId: string,
  pageSize: number,
  cb: (msgs: Doc<Message>[], oldestCursor: unknown | null, llena: boolean) => void,
): Unsubscribe {
  const q = query(
    collection(fb.db, 'conversations', convId, 'messages'),
    orderBy('createdAt', 'desc'),
    limit(pageSize),
  );
  return onSnapshot(q, (snap) => {
    cb(
      snap.docs.map((d) => ({ id: d.id, data: d.data() as Message })).reverse(),
      snap.docs[snap.docs.length - 1] ?? null,
      snap.docs.length === pageSize,
    );
  });
}

export function subscribeConversation(
  fb: WidgetFirebase,
  convId: string,
  cb: (conv: Doc<Conversation> | null) => void,
): Unsubscribe {
  return onSnapshot(doc(fb.db, 'conversations', convId), (snap) => {
    cb(snap.exists() ? { id: snap.id, data: snap.data() as Conversation } : null);
  });
}

export function subscribeMessages(
  fb: WidgetFirebase,
  convId: string,
  cb: (msgs: Doc<Message>[]) => void,
): Unsubscribe {
  const q = query(
    collection(fb.db, 'conversations', convId, 'messages'),
    orderBy('createdAt', 'asc'),
    limit(200),
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, data: d.data() as Message })));
  });
}

/** Subcanal de una conversación directa (datos viejos sin campo = 'agente'). */
export function convSubcanal(data: { subcanal?: 'bot' | 'agente' }): 'bot' | 'agente' {
  return data.subcanal ?? 'agente';
}

/**
 * Conversación directa ACTIVA del contacto en su subcanal ('bot' o 'agente'). El
 * "chat" (hilo) es único por (contacto, subcanal), pero contiene MÚLTIPLES
 * conversaciones: si la activa está resuelta se abre una NUEVA (segmento), que se
 * suma al historial de resueltas. Nunca reabre (no pierde el cierre); al haber a
 * lo sumo una activa por (contacto, subcanal), tampoco duplica el chat.
 */
export async function ensureDirectConversation(
  fb: WidgetFirebase,
  session: WidgetSessionResponse,
  nombre: string,
  modo: 'bot' | 'open',
): Promise<string> {
  const subcanal = session.botConfig.activo && modo === 'bot' ? 'bot' : 'agente';
  const q = query(
    collection(fb.db, 'conversations'),
    where('tipo', '==', 'directa'),
    where('contactId', '==', session.contactId),
    where('estado', 'in', ['bot', 'open', 'pending']),
    orderBy('updatedAt', 'desc'),
    limit(10),
  );
  const existing = await getDocs(q);
  const mismo = existing.docs.find(
    (d) => convSubcanal(d.data() as { subcanal?: 'bot' | 'agente' }) === subcanal,
  );
  if (mismo) return mismo.id;

  const ref = doc(collection(fb.db, 'conversations'));
  const conv: Record<string, unknown> = {
    tipo: 'directa',
    subcanal,
    siteId: session.siteId,
    contactId: session.contactId,
    contactNombre: nombre,
    estado: subcanal === 'bot' ? 'bot' : 'open',
    asignadoA: null,
    botIntentos: 0,
    idioma: session.idioma,
    unread: {},
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (session.clientId) conv.clientId = session.clientId;
  if (session.clientNombre) conv.clientNombre = session.clientNombre;
  if (session.groupId) {
    conv.groupId = session.groupId;
    conv.groupName = session.groupName ?? session.groupId;
  }
  await setDoc(ref, conv);
  return ref.id;
}

/** Incrementos de no-leídos al enviar: agentes + otros miembros del grupo. */
function unreadIncrements(
  session: WidgetSessionResponse,
  otrosParticipantes?: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { 'unread.agentes': increment(1) };
  for (const p of otrosParticipantes ?? []) {
    if (p !== session.contactId && p.includes('_')) out[`unread.${p}`] = increment(1);
  }
  return out;
}

export async function sendMessage(
  fb: WidgetFirebase,
  session: WidgetSessionResponse,
  convId: string,
  nombre: string,
  texto: string,
  replyTo?: Doc<Message>,
  otrosParticipantes?: string[],
): Promise<void> {
  await addDoc(collection(fb.db, 'conversations', convId, 'messages'), {
    sender: { tipo: 'user', id: session.contactId, nombre },
    texto,
    tipoContenido: 'texto',
    ...(replyTo
      ? {
          replyTo: {
            messageId: replyTo.id,
            texto: replyTo.data.texto.slice(0, 120),
            senderNombre: replyTo.data.sender.nombre,
          },
        }
      : {}),
    createdAt: serverTimestamp(),
  });
  await updateDoc(doc(fb.db, 'conversations', convId), {
    lastMessage: {
      texto,
      senderTipo: 'user',
      senderId: session.contactId,
      senderNombre: nombre,
      at: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
    ...unreadIncrements(session, otrosParticipantes),
  });
}

/** Pone en cero mis no-leídos de una conversación. */
export async function markRead(
  fb: WidgetFirebase,
  session: WidgetSessionResponse,
  convId: string,
): Promise<void> {
  await updateDoc(doc(fb.db, 'conversations', convId), {
    [`unread.${session.contactId}`]: 0,
  }).catch(() => {});
}

/** Silenciar/activar notificaciones de una conversación (por participante). */
export async function toggleMute(
  fb: WidgetFirebase,
  session: WidgetSessionResponse,
  convId: string,
  silenciar: boolean,
): Promise<void> {
  await updateDoc(doc(fb.db, 'conversations', convId), {
    [`silenciado.${session.contactId}`]: silenciar,
  });
}

// ---------------------------------------------------------------------------
// Tickets (vista 1d)
// ---------------------------------------------------------------------------

export function subscribeMyTickets(
  fb: WidgetFirebase,
  session: WidgetSessionResponse,
  cb: (tickets: Doc<Ticket>[]) => void,
): Unsubscribe {
  const q = query(
    collection(fb.db, 'tickets'),
    where('contactId', '==', session.contactId),
    orderBy('updatedAt', 'desc'),
    limit(50),
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, data: d.data() as Ticket })));
  });
}

/** Tickets públicos "del sistema" (afectan a varios condominios). */
export function subscribeSystemTickets(
  fb: WidgetFirebase,
  cb: (tickets: Doc<Ticket>[]) => void,
): Unsubscribe {
  const q = query(
    collection(fb.db, 'tickets'),
    where('publico', '==', true),
    where('ambito', '==', 'sistema'),
    orderBy('updatedAt', 'desc'),
    limit(20),
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, data: d.data() as Ticket })));
  });
}

/** Tickets públicos del grupo (organización) del admin. */
export function subscribeGroupTickets(
  fb: WidgetFirebase,
  session: WidgetSessionResponse,
  cb: (tickets: Doc<Ticket>[]) => void,
): Unsubscribe {
  if (!session.groupId) return () => {};
  const q = query(
    collection(fb.db, 'tickets'),
    where('publico', '==', true),
    where('groupId', '==', session.groupId),
    orderBy('updatedAt', 'desc'),
    limit(50),
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, data: d.data() as Ticket })));
  });
}

export function subscribeTicketHistory(
  fb: WidgetFirebase,
  ticketId: string,
  cb: (events: Doc<TicketEvent>[]) => void,
): Unsubscribe {
  const q = query(
    collection(fb.db, 'tickets', ticketId, 'historial'),
    orderBy('createdAt', 'asc'),
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, data: d.data() as TicketEvent })));
  });
}

// ---------------------------------------------------------------------------
// CSAT, adjuntos, reacciones y typing
// ---------------------------------------------------------------------------

/**
 * Conversaciones que este contacto YA calificó (→ Map convId→rating). Persiste
 * entre recargas sin depender del trigger de functions: leemos directamente las
 * valoraciones propias (permitido por las reglas).
 */
export function subscribeMyCsat(
  fb: WidgetFirebase,
  session: WidgetSessionResponse,
  cb: (rated: Map<string, number>) => void,
): Unsubscribe {
  const q = query(
    collection(fb.db, 'csat'),
    where('contactId', '==', session.contactId),
    limit(200),
  );
  return onSnapshot(
    q,
    (snap) => {
      const m = new Map<string, number>();
      for (const d of snap.docs) {
        const r = d.data() as CsatRating;
        if (r.conversationId) m.set(r.conversationId, r.rating);
      }
      cb(m);
    },
    () => cb(new Map()), // degradar sin romper si la regla/consulta falla
  );
}

export async function submitCsat(
  fb: WidgetFirebase,
  session: WidgetSessionResponse,
  convId: string,
  rating: 1 | 2 | 3 | 4 | 5,
): Promise<void> {
  const { addDoc: add, collection: col } = await import('firebase/firestore');
  await add(col(fb.db, 'csat'), {
    rating,
    conversationId: convId,
    contactId: session.contactId,
    siteId: session.siteId,
    createdAt: serverTimestamp(),
  });
}

// ---------------------------------------------------------------------------
// Feedback de utilidad del bot ("¿te sirvió esta respuesta?")
// ---------------------------------------------------------------------------

/** Deterministic doc id: one vote per bot message. */
export function botFeedbackId(convId: string, messageId: string): string {
  return `${convId}_${messageId}`;
}

/**
 * Records the helpful/not-helpful vote for a bot reply. The doc id is
 * deterministic, so a second vote is rejected by the rules (create-only) —
 * callers should treat that error as "already voted".
 */
export async function submitBotFeedback(
  fb: WidgetFirebase,
  session: WidgetSessionResponse,
  convId: string,
  messageId: string,
  helpful: boolean,
): Promise<void> {
  await setDoc(doc(fb.db, 'bot_feedback', botFeedbackId(convId, messageId)), {
    conversationId: convId,
    messageId,
    contactId: session.contactId,
    siteId: session.siteId,
    helpful,
    createdAt: serverTimestamp(),
  });
}

/**
 * Accepts the "talk to an agent" offer after a negative vote. The
 * onBotFeedbackWrite trigger performs the handoff and bumps escaladoAt, which
 * makes the widget jump to the agent channel.
 */
export async function acceptAgentOffer(
  fb: WidgetFirebase,
  convId: string,
  messageId: string,
): Promise<void> {
  await updateDoc(doc(fb.db, 'bot_feedback', botFeedbackId(convId, messageId)), {
    escalate: true,
  });
}

/**
 * Votes already cast by this contact (Map botFeedbackId → helpful). Persists
 * across reloads without depending on the stamping trigger.
 */
export function subscribeMyBotFeedback(
  fb: WidgetFirebase,
  session: WidgetSessionResponse,
  cb: (votes: Map<string, boolean>) => void,
): Unsubscribe {
  const q = query(
    collection(fb.db, 'bot_feedback'),
    where('contactId', '==', session.contactId),
    limit(300),
  );
  return onSnapshot(
    q,
    (snap) => {
      const votes = new Map<string, boolean>();
      snap.docs.forEach((d) => votes.set(d.id, Boolean(d.data().helpful)));
      cb(votes);
    },
    () => cb(new Map()),
  );
}

export async function sendAttachment(
  fb: WidgetFirebase,
  session: WidgetSessionResponse,
  convId: string,
  nombre: string,
  file: File,
  otrosParticipantes?: string[],
  caption?: string,
): Promise<void> {
  const { ref: sref, uploadBytes, getDownloadURL } = await import('firebase/storage');
  const path = `adjuntos/${convId}/${Date.now()}_${file.name}`;
  const fileRef = sref(fb.storage, path);
  await uploadBytes(fileRef, file, { contentType: file.type });
  const url = await getDownloadURL(fileRef);
  const esImagen = file.type.startsWith('image/');
  const esVideo = file.type.startsWith('video/');
  const tipoContenido = esImagen ? 'imagen' : esVideo ? 'video' : 'archivo';
  const texto = caption?.trim() ?? '';
  const emoji = esImagen ? '📷' : esVideo ? '🎥' : '📎';
  await addDoc(collection(fb.db, 'conversations', convId, 'messages'), {
    sender: { tipo: 'user', id: session.contactId, nombre },
    texto,
    tipoContenido,
    adjuntos: [
      {
        tipo: tipoContenido,
        storagePath: path,
        url,
        nombre: file.name,
        mimeType: file.type,
      },
    ],
    createdAt: serverTimestamp(),
  });
  await updateDoc(doc(fb.db, 'conversations', convId), {
    lastMessage: {
      texto: texto
        ? `${emoji} ${texto}`
        : esImagen
          ? '📷 Foto'
          : esVideo
            ? '🎥 Video'
            : `📎 ${file.name}`,
      senderTipo: 'user',
      senderId: session.contactId,
      senderNombre: nombre,
      at: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
    ...unreadIncrements(session, otrosParticipantes),
  });
}

export async function toggleReaction(
  fb: WidgetFirebase,
  session: WidgetSessionResponse,
  convId: string,
  messageId: string,
  emoji: string,
  actuales: Record<string, string[]> | undefined,
): Promise<void> {
  const ya = actuales?.[emoji]?.includes(session.contactId);
  const { arrayRemove, arrayUnion } = await import('firebase/firestore');
  await updateDoc(doc(fb.db, 'conversations', convId, 'messages', messageId), {
    [`reacciones.${emoji}`]: ya ? arrayRemove(session.contactId) : arrayUnion(session.contactId),
  });
}

export async function editMessage(
  fb: WidgetFirebase,
  convId: string,
  messageId: string,
  texto: string,
  textoAnterior?: string,
): Promise<void> {
  await updateDoc(doc(fb.db, 'conversations', convId, 'messages', messageId), {
    texto,
    editadoAt: serverTimestamp(),
    ...(textoAnterior !== undefined ? { textoAnterior } : {}),
  });
}

/** Indicador "escribiendo…" vía RTDB con onDisconnect. */
export async function setTyping(
  fb: WidgetFirebase,
  session: WidgetSessionResponse,
  convId: string,
  typing: boolean,
): Promise<void> {
  try {
    const { getDatabase, ref, set, onDisconnect } = await import('firebase/database');
    const rtdb = getDatabase(fb.app);
    const node = ref(rtdb, `typing/${convId}/${session.contactId}`);
    if (typing) {
      await set(node, { nombre: session.nombre.split(' ')[0], at: Date.now() });
      onDisconnect(node).remove();
    } else {
      await set(node, null);
    }
  } catch {
    // RTDB es opcional — sin emulador de database no rompe el chat.
  }
}

export function subscribeTyping(
  fb: WidgetFirebase,
  convId: string,
  selfId: string,
  cb: (nombres: string[]) => void,
): () => void {
  let unsub = () => {};
  (async () => {
    try {
      const { getDatabase, ref, onValue, off } = await import('firebase/database');
      const rtdb = getDatabase(fb.app);
      const node = ref(rtdb, `typing/${convId}`);
      onValue(node, (snap) => {
        const val = (snap.val() ?? {}) as Record<string, { nombre: string; at: number }>;
        cb(
          Object.entries(val)
            .filter(([id, v]) => id !== selfId && Date.now() - v.at < 15000)
            .map(([, v]) => v.nombre),
        );
      });
      unsub = () => off(node);
    } catch {
      // sin RTDB no hay typing, no pasa nada
    }
  })();
  return () => unsub();
}

// ---------------------------------------------------------------------------
// Utilidades de tiempo
// ---------------------------------------------------------------------------

export function toDate(ts: unknown): Date | null {
  if (!ts) return null;
  const t = ts as { toDate?: () => Date };
  return typeof t.toDate === 'function' ? t.toDate() : null;
}

export function formatTime(ts: unknown): string {
  const d = toDate(ts);
  if (!d) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function timeAgo(ts: unknown, idioma: 'es' | 'en'): string {
  const d = toDate(ts);
  if (!d) return '';
  const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
  if (mins < 60) return idioma === 'es' ? `hace ${mins} min` : `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return idioma === 'es' ? `hace ${hours} h` : `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return idioma === 'es' ? `hace ${days} d` : `${days} d ago`;
}
