'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDocs,
  increment,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  updateDoc,
  where,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type {
  Contact,
  Conversation,
  CsatRating,
  Message,
  Site,
  TeamMember,
  Ticket,
  TicketEvent,
  TicketNote,
} from '@aditum-chat/shared';
import { db, storage } from './firebase';

export interface Row<T> {
  id: string;
  data: T;
}

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

export function useDoc<T>(path: string | null): Row<T> | null {
  const [row, setRow] = useState<Row<T> | null>(null);
  useEffect(() => {
    if (!path) {
      setRow(null);
      return;
    }
    return onSnapshot(doc(db, path), (snap) => {
      setRow(snap.exists() ? { id: snap.id, data: snap.data() as T } : null);
    });
  }, [path]);
  return row;
}

// ---------------------------------------------------------------- inbox

export type InboxFiltro = 'todas' | 'mias' | 'bot' | 'equipos' | 'sin_asignar' | 'resueltas';

export function useConversations(siteId: string | null, filtro: InboxFiltro, uid: string) {
  const constraints = useMemo(() => {
    const c: QueryConstraint[] = [];
    if (siteId) c.push(where('siteId', '==', siteId));
    if (filtro === 'resueltas') {
      // Las resueltas viven en su propia pestaña — cerradas para el inbox activo.
      c.push(where('estado', '==', 'resolved'));
    } else {
      if (filtro === 'mias') c.push(where('asignadoA', '==', uid));
      // Bot filter = the full bot-channel registry: attending AND resolved.
      if (filtro === 'bot') c.push(where('subcanal', '==', 'bot'));
      if (filtro === 'equipos') c.push(where('tipo', '==', 'grupo'));
      if (filtro === 'sin_asignar') c.push(where('asignadoA', '==', null));
      if (filtro !== 'bot') c.push(where('estado', 'in', ['bot', 'open', 'pending']));
    }
    c.push(orderBy('updatedAt', 'desc'), fsLimit(100));
    return c;
  }, [siteId, filtro, uid]);
  return useCollection<Conversation>('conversations', constraints, [siteId, filtro, uid]);
}

/**
 * Inbox row after collapsing a contact's channel docs (bot + agente) into one:
 * the freshest doc represents the contact, unread is summed across its docs.
 */
export interface InboxRow {
  conv: Row<Conversation>;
  /** Sum of unread.agentes across the contact's fetched docs. */
  unreadTotal: number;
  /** The contact ALSO has a live bot-channel conversation. */
  botVivo: boolean;
}

/**
 * Collapses directa conversations to one row per contact (rows must already be
 * ordered updatedAt desc, so the first doc per contact is the representative).
 * Group conversations and directas without contactId pass through 1:1.
 */
export function collapseByContact(rows: Row<Conversation>[]): InboxRow[] {
  const out: InboxRow[] = [];
  const porContacto = new Map<string, InboxRow>();
  for (const conv of rows) {
    const d = conv.data;
    const esBotVivo = (d.subcanal ?? 'agente') === 'bot' && d.estado === 'bot';
    const unread = d.unread?.agentes ?? 0;
    const key = d.tipo === 'directa' ? d.contactId : null;
    if (!key) {
      out.push({ conv, unreadTotal: unread, botVivo: false });
      continue;
    }
    const existente = porContacto.get(key);
    if (existente) {
      existente.unreadTotal += unread;
      existente.botVivo ||= esBotVivo;
    } else {
      const row: InboxRow = { conv, unreadTotal: unread, botVivo: esBotVivo };
      porContacto.set(key, row);
      out.push(row);
    }
  }
  return out;
}

/** Conversaciones resueltas de un contacto (panel de contexto). */
export function useResolvedConversations(contactId: string | null) {
  return useCollection<Conversation>(
    'conversations',
    [
      where('tipo', '==', 'directa'),
      where('contactId', '==', contactId ?? '_'),
      where('estado', '==', 'resolved'),
      orderBy('updatedAt', 'desc'),
      fsLimit(50),
    ],
    [contactId],
  );
}

/**
 * Segmentos resueltos del chat grupal de un grupo. Reusa el índice
 * `tipo+groupId+updatedAt` y filtra por estado en cliente (solo hay 1 segmento
 * activo, así que el resto del tope son resueltos).
 */
export function useResolvedGroupConversations(groupId: string | null) {
  const todas = useCollection<Conversation>(
    'conversations',
    [
      where('tipo', '==', 'grupo'),
      where('groupId', '==', groupId ?? '_'),
      orderBy('updatedAt', 'desc'),
      fsLimit(50),
    ],
    [groupId],
  );
  return useMemo(() => todas.filter((c) => c.data.estado === 'resolved'), [todas]);
}

/** Resuelve una conversación con categoría (el historial no se toca). */
export async function resolveConversation(
  convId: string,
  categoria: string,
  _categoriaLabel: string,
  uid: string,
  nombre: string,
) {
  // El indicador "Conversación resuelta · categoría" se deriva del ESTADO de la
  // conversación (se muestra al instante en el hilo), sin un mensaje de sistema.
  await updateDoc(doc(db, 'conversations', convId), {
    estado: 'resolved',
    categoria,
    resueltaPor: uid,
    resueltaNombre: nombre,
    resueltaAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** Valoración CSAT de una conversación (reactivo): permite mostrar en la consola
 *  si el cliente calificó, con cuántas estrellas y su comentario. */
export function useCsat(convId: string) {
  return useCollection<CsatRating>(
    'csat',
    [where('conversationId', '==', convId), fsLimit(1)],
    [convId],
  );
}

export function useMessages(convId: string | null) {
  return useCollection<Message>(
    convId ? `conversations/${convId}/messages` : 'conversations/_/messages',
    [orderBy('createdAt', 'asc'), fsLimit(300)],
    [convId],
  );
}

export interface PaginatedMessages {
  mensajes: Row<Message>[];
  hayMas: boolean;
  cargando: boolean;
  loadOlder(): Promise<void>;
}

/**
 * Infinite scroll de mensajes: la página más reciente en vivo (onSnapshot) y
 * páginas anteriores estáticas que se van prependeando con loadOlder().
 */
export function usePaginatedMessages(convId: string | null, pageSize = 50): PaginatedMessages {
  const [recientes, setRecientes] = useState<Row<Message>[]>([]);
  const [viejos, setViejos] = useState<Row<Message>[]>([]);
  const [hayMas, setHayMas] = useState(false);
  const [cargando, setCargando] = useState(false);
  const cursorRef = useRef<QueryDocumentSnapshot | null>(null);

  useEffect(() => {
    setRecientes([]);
    setViejos([]);
    setHayMas(false);
    cursorRef.current = null;
    if (!convId) return;
    const q = query(
      collection(db, 'conversations', convId, 'messages'),
      orderBy('createdAt', 'desc'),
      fsLimit(pageSize),
    );
    return onSnapshot(q, (snap) => {
      const docs = snap.docs;
      // El cursor apunta al doc más viejo de la página en vivo (solo se fija una vez).
      if (!cursorRef.current && docs.length === pageSize) {
        cursorRef.current = docs[docs.length - 1];
        setHayMas(true);
      }
      setRecientes(docs.map((d) => ({ id: d.id, data: d.data() as Message })).reverse());
    });
  }, [convId, pageSize]);

  const loadOlder = useCallback(async () => {
    if (!convId || !cursorRef.current || cargando) return;
    setCargando(true);
    try {
      const snap = await getDocs(
        query(
          collection(db, 'conversations', convId, 'messages'),
          orderBy('createdAt', 'desc'),
          startAfter(cursorRef.current),
          fsLimit(pageSize),
        ),
      );
      cursorRef.current = snap.docs[snap.docs.length - 1] ?? cursorRef.current;
      setHayMas(snap.docs.length === pageSize);
      const pagina = snap.docs.map((d) => ({ id: d.id, data: d.data() as Message })).reverse();
      setViejos((prev) => [...pagina, ...prev]);
    } finally {
      setCargando(false);
    }
  }, [convId, pageSize, cargando]);

  const mensajes = useMemo(() => {
    // Dedup por id en la frontera entre páginas.
    const ids = new Set(viejos.map((m) => m.id));
    return [...viejos, ...recientes.filter((m) => !ids.has(m.id))];
  }, [viejos, recientes]);

  return { mensajes, hayMas, cargando, loadOlder };
}

// ------------------------------------------------------- hilo continuo (directa)

export interface ThreadRow {
  convId: string;
  msg: Row<Message>;
}

export interface ContactThread {
  filas: ThreadRow[];
  hayMas: boolean;
  cargando: boolean;
  loadOlder(): Promise<void>;
  /** Re-lee los mensajes de una conversación ya cargada y mete los nuevos en su
   *  bloque (p. ej. el mensaje de sistema al crear un ticket de una vieja). */
  refrescarConversacion(convId: string): Promise<void>;
  /** Conversación más reciente del contacto (destino de acciones del header). */
  activa: Row<Conversation> | null;
  convPorId: Map<string, Row<Conversation>>;
}

/**
 * Hilo continuo genérico: une TODAS las conversaciones que matchean `constraints`
 * en un solo scroll cronológico (mismo patrón que el widget). Un listener en vivo
 * sobre la más reciente + páginas históricas estáticas que saltan a la anterior
 * cuando la actual se agota. `key` dispara el reset (null = deshabilitado).
 * Lo consumen `useContactThread` (directa) y `useGroupThread` (chat grupal).
 */
function useConvThread(
  key: string | null,
  constraints: QueryConstraint[],
  pageSize: number,
): ContactThread {
  const [convsDesc, setConvsDesc] = useState<Row<Conversation>[]>([]);
  const [liveMsgs, setLiveMsgs] = useState<ThreadRow[]>([]);
  const [viejos, setViejos] = useState<ThreadRow[]>([]);
  const [cargando, setCargando] = useState(false);
  const [hayMas, setHayMas] = useState(false);
  const [cursorVersion, setCursorVersion] = useState(0);

  const liveConvIdRef = useRef<string | null>(null);
  const liveMsgsRef = useRef<ThreadRow[]>([]);
  const cursorRef = useRef<{ convId: string; cursor: QueryDocumentSnapshot | null; agotada: boolean } | null>(null);
  const convsAscRef = useRef<Row<Conversation>[]>([]);

  useEffect(() => {
    liveMsgsRef.current = liveMsgs;
  }, [liveMsgs]);

  const activa = convsDesc[0] ?? null;
  const convsAsc = useMemo(() => [...convsDesc].reverse(), [convsDesc]);
  // Se actualiza en render (no en efecto) para que loadOlder siempre vea la lista
  // vigente al saltar de una conversación a la anterior.
  convsAscRef.current = convsAsc;
  const convPorId = useMemo(() => new Map(convsDesc.map((c) => [c.id, c])), [convsDesc]);

  // hayMas derivado: se recomputa con el valor VIVO de convsAsc y cada cambio de
  // cursor. Hay más si la conversación actual no se agotó, o si existe una anterior.
  useEffect(() => {
    const cur = cursorRef.current;
    if (!cur) return setHayMas(false);
    if (!cur.agotada) return setHayMas(true);
    const idx = convsAsc.findIndex((cc) => cc.id === cur.convId);
    setHayMas(idx > 0);
  }, [convsAsc, cursorVersion]);

  // 1. Conversaciones directa del contacto (desc por updatedAt). Solo confirmadas
  //    por servidor (evita un listener sobre un doc recién creado localmente).
  useEffect(() => {
    setConvsDesc([]);
    setLiveMsgs([]);
    setViejos([]);
    setHayMas(false);
    liveConvIdRef.current = null;
    cursorRef.current = null;
    if (!key) return;
    const q = query(collection(db, 'conversations'), ...constraints);
    const confirmadas = new Set<string>();
    return onSnapshot(q, (snap) => {
      const rows: Row<Conversation>[] = [];
      for (const d of snap.docs) {
        if (!d.metadata.hasPendingWrites) confirmadas.add(d.id);
        if (confirmadas.has(d.id)) rows.push({ id: d.id, data: d.data() as Conversation });
      }
      setConvsDesc(rows);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // 2. Listener en vivo sobre la conversación activa (la más reciente). Al cambiar
  //    (p. ej. se resolvió y nació otra), los mensajes vivos pasan al histórico.
  useEffect(() => {
    const liveId = activa?.id ?? null;
    if (!liveId || liveConvIdRef.current === liveId) return;
    if (liveConvIdRef.current) {
      setViejos((prev) => [...prev, ...liveMsgsRef.current]);
    }
    liveConvIdRef.current = liveId;
    setLiveMsgs([]);
    let first = true;
    const q = query(
      collection(db, 'conversations', liveId, 'messages'),
      orderBy('createdAt', 'desc'),
      fsLimit(pageSize),
    );
    return onSnapshot(q, (snap) => {
      const docs = snap.docs;
      setLiveMsgs(
        docs.map((d) => ({ convId: liveId, msg: { id: d.id, data: d.data() as Message } })).reverse(),
      );
      if (first) {
        first = false;
        cursorRef.current = {
          convId: liveId,
          cursor: docs[docs.length - 1] ?? null,
          agotada: docs.length < pageSize,
        };
        setCursorVersion((v) => v + 1);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activa?.id, pageSize]);

  const loadOlder = useCallback(async () => {
    const cur = cursorRef.current;
    if (!cur || cargando) return;
    setCargando(true);
    try {
      let targetConv = cur.convId;
      let start: QueryDocumentSnapshot | null = cur.cursor;
      if (cur.agotada) {
        const idx = convsAscRef.current.findIndex((c) => c.id === cur.convId);
        const prevConv = idx > 0 ? convsAscRef.current[idx - 1] : null;
        if (!prevConv) {
          setHayMas(false);
          return;
        }
        targetConv = prevConv.id;
        start = null;
      }
      const cons: QueryConstraint[] = [orderBy('createdAt', 'desc')];
      if (start) cons.push(startAfter(start));
      cons.push(fsLimit(pageSize));
      const snap = await getDocs(query(collection(db, 'conversations', targetConv, 'messages'), ...cons));
      const docs = snap.docs;
      cursorRef.current = {
        convId: targetConv,
        cursor: docs[docs.length - 1] ?? start,
        agotada: docs.length < pageSize,
      };
      setViejos((prev) => [
        ...docs.map((d) => ({ convId: targetConv, msg: { id: d.id, data: d.data() as Message } })).reverse(),
        ...prev,
      ]);
      setCursorVersion((v) => v + 1);
    } finally {
      setCargando(false);
    }
  }, [cargando, pageSize]);

  // Re-lee los mensajes de una conversación ya cargada (no activa) e inserta los
  // NUEVOS al final de su bloque, sin moverla ni duplicar. La activa la maneja el
  // listener en vivo.
  const refrescarConversacion = useCallback(
    async (convId: string) => {
      if (liveConvIdRef.current === convId) return;
      const snap = await getDocs(
        query(
          collection(db, 'conversations', convId, 'messages'),
          orderBy('createdAt', 'desc'),
          fsLimit(pageSize),
        ),
      );
      const frescas = snap.docs
        .map((d) => ({ convId, msg: { id: d.id, data: d.data() as Message } }))
        .reverse();
      setViejos((prev) => {
        let ini = prev.findIndex((f) => f.convId === convId);
        if (ini === -1) return prev; // no está cargada: nada que refrescar
        let fin = ini;
        while (fin < prev.length && prev[fin].convId === convId) fin++;
        const presentes = new Set(prev.slice(ini, fin).map((f) => f.msg.id));
        const faltantes = frescas.filter((f) => !presentes.has(f.msg.id));
        if (faltantes.length === 0) return prev;
        return [...prev.slice(0, fin), ...faltantes, ...prev.slice(fin)];
      });
    },
    [pageSize],
  );

  const filas = useMemo(() => {
    // Dedup por clave COMPUESTA convId+msgId: un mensaje puede quedar dos veces al
    // cambiar de conversación (vuelco a `viejos` + re-fetch de `loadOlder`), y los
    // automáticos con id fijo (_bienvenida/_autorespuesta) se repiten entre convs.
    const seen = new Set<string>();
    const out: ThreadRow[] = [];
    for (const f of [...viejos, ...liveMsgs]) {
      const k = `${f.convId}_${f.msg.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(f);
    }
    return out;
  }, [viejos, liveMsgs]);

  return { filas, hayMas, cargando, loadOlder, refrescarConversacion, activa, convPorId };
}

/** Hilo continuo de un contacto: todas sus conversaciones `directa` encadenadas. */
export function useContactThread(contactId: string | null, pageSize = 40): ContactThread {
  const constraints = useMemo<QueryConstraint[]>(
    () =>
      contactId
        ? [
            where('tipo', '==', 'directa'),
            where('contactId', '==', contactId),
            orderBy('updatedAt', 'desc'),
            fsLimit(20),
          ]
        : [],
    [contactId],
  );
  return useConvThread(contactId, constraints, pageSize);
}

/**
 * Hilo continuo del chat grupal de un cliente: todos los segmentos `grupo`
 * encadenados (activa = el más reciente no resuelto), igual que las directas.
 */
export function useGroupThread(groupId: string | null, pageSize = 40): ContactThread {
  const constraints = useMemo<QueryConstraint[]>(
    () =>
      groupId
        ? [
            where('tipo', '==', 'grupo'),
            where('groupId', '==', groupId),
            orderBy('updatedAt', 'desc'),
            fsLimit(20),
          ]
        : [],
    [groupId],
  );
  return useConvThread(groupId, constraints, pageSize);
}

/**
 * Conversación `directa` ACTIVA del canal agente del contacto. Si la última quedó
 * resuelta, abre una NUEVA (segmento) — igual que el widget: el chat mantiene la
 * segmentación y las resueltas quedan en el historial. Nunca reabre (no pierde el
 * cierre), y al haber a lo sumo una activa por contacto, tampoco duplica.
 */
export async function ensureAgentConversation(params: {
  contactId: string;
  contactNombre?: string;
  siteId: string;
  clientId?: string;
  clientNombre?: string;
  uid: string;
  nombreAgente: string;
}): Promise<string> {
  const snap = await getDocs(
    query(
      collection(db, 'conversations'),
      where('tipo', '==', 'directa'),
      where('contactId', '==', params.contactId),
      where('estado', 'in', ['bot', 'open', 'pending']),
      orderBy('updatedAt', 'desc'),
      fsLimit(10),
    ),
  );
  // Reuse only the agent channel: the bot channel is a separate registry the
  // console must never write into (legacy docs without subcanal are 'agente').
  const activo = snap.docs.find(
    (d) => ((d.data() as Conversation).subcanal ?? 'agente') === 'agente',
  );
  if (activo) return activo.id;
  const ref = await addDoc(collection(db, 'conversations'), {
    tipo: 'directa',
    subcanal: 'agente',
    siteId: params.siteId,
    contactId: params.contactId,
    contactNombre: params.contactNombre ?? '',
    ...(params.clientId ? { clientId: params.clientId } : {}),
    ...(params.clientNombre ? { clientNombre: params.clientNombre } : {}),
    estado: 'open',
    asignadoA: params.uid,
    asignadoNombre: params.nombreAgente,
    unread: {},
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/**
 * Segmento ACTIVO del chat grupal de un grupo, o uno NUEVO (copiando
 * participantes del último) si el actual quedó resuelto — igual que el widget,
 * mantiene la segmentación.
 */
export async function ensureAgentGroupConversation(base: Row<Conversation>): Promise<string> {
  const { siteId, groupId } = base.data;
  if (!groupId) return base.id;
  const snap = await getDocs(
    query(
      collection(db, 'conversations'),
      where('tipo', '==', 'grupo'),
      where('groupId', '==', groupId),
      orderBy('updatedAt', 'desc'),
      fsLimit(10),
    ),
  );
  const activo = snap.docs.find((d) => (d.data() as Conversation).estado !== 'resolved');
  if (activo) return activo.id;
  const src = (snap.docs[0]?.data() as Conversation | undefined) ?? base.data;
  const ref = await addDoc(collection(db, 'conversations'), {
    tipo: 'grupo',
    siteId,
    groupId,
    groupName: src.groupName ?? groupId,
    participantes: src.participantes ?? [],
    participantesInfo: src.participantesInfo ?? {},
    estado: 'open',
    unread: {},
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/** Edita el texto de un mensaje del agente y guarda la versión anterior. */
export async function agentEditMessage(
  convId: string,
  messageId: string,
  texto: string,
  textoAnterior: string,
) {
  await updateDoc(doc(db, 'conversations', convId, 'messages', messageId), {
    texto,
    editadoAt: serverTimestamp(),
    textoAnterior,
  });
}

/** Alterna una reacción del agente (uid) en un mensaje. */
export async function toggleReaction(
  convId: string,
  messageId: string,
  emoji: string,
  uid: string,
  actuales: Record<string, string[]> | undefined,
) {
  const ya = actuales?.[emoji]?.includes(uid);
  await updateDoc(doc(db, 'conversations', convId, 'messages', messageId), {
    [`reacciones.${emoji}`]: ya ? arrayRemove(uid) : arrayUnion(uid),
  });
}

export async function agentSendMessage(
  conv: Row<Conversation>,
  uid: string,
  nombreChat: string,
  texto: string,
  interno: boolean,
  replyTo?: { messageId: string; texto: string; senderNombre: string } | null,
) {
  await addDoc(collection(db, 'conversations', conv.id, 'messages'), {
    sender: { tipo: 'agent', id: uid, nombre: nombreChat },
    texto,
    tipoContenido: 'texto',
    interno,
    ...(replyTo ? { replyTo: { ...replyTo, texto: replyTo.texto.slice(0, 120) } } : {}),
    createdAt: serverTimestamp(),
  });
  if (!interno) {
    // Destinatarios del contador de no-leídos: el contacto (directa) o TODOS
    // los participantes contacto del grupo (los agentes usan 'unread.agentes').
    const destinos =
      conv.data.tipo === 'grupo'
        ? (conv.data.participantes ?? []).filter((p) => p.includes('_'))
        : conv.data.contactId
          ? [conv.data.contactId]
          : [];
    const incrementos = Object.fromEntries(destinos.map((d) => [`unread.${d}`, increment(1)]));
    await updateDoc(doc(db, 'conversations', conv.id), {
      lastMessage: {
        texto,
        senderTipo: 'agent',
        senderId: uid,
        senderNombre: nombreChat,
        at: serverTimestamp(),
      },
      updatedAt: serverTimestamp(),
      'unread.agentes': deleteField(),
      ...incrementos,
    });
  }
}

/** Destinatarios del contador de no-leídos: el contacto (directa) o los
 *  participantes-contacto del grupo. */
function destinosNoLeidos(conv: Row<Conversation>): string[] {
  return conv.data.tipo === 'grupo'
    ? (conv.data.participantes ?? []).filter((p) => p.includes('_'))
    : conv.data.contactId
      ? [conv.data.contactId]
      : [];
}

/** El agente adjunta una imagen/video/archivo (con caption opcional) y lo envía al cliente (widget). */
export async function agentSendAttachment(
  conv: Row<Conversation>,
  uid: string,
  nombreChat: string,
  file: File,
  caption?: string,
) {
  const { ref: sref, uploadBytes, getDownloadURL } = await import('firebase/storage');
  const path = `adjuntos/${conv.id}/${Date.now()}_${file.name}`;
  const fileRef = sref(storage, path);
  await uploadBytes(fileRef, file, { contentType: file.type });
  const url = await getDownloadURL(fileRef);

  const esImagen = file.type.startsWith('image/');
  const esVideo = file.type.startsWith('video/');
  const tipoContenido = esImagen ? 'imagen' : esVideo ? 'video' : 'archivo';
  const texto = caption?.trim() ?? '';
  const emoji = esImagen ? '📷' : esVideo ? '🎥' : '📎';

  await addDoc(collection(db, 'conversations', conv.id, 'messages'), {
    sender: { tipo: 'agent', id: uid, nombre: nombreChat },
    texto,
    tipoContenido,
    adjuntos: [{ tipo: tipoContenido, storagePath: path, url, nombre: file.name, mimeType: file.type }],
    createdAt: serverTimestamp(),
  });

  const incrementos = Object.fromEntries(
    destinosNoLeidos(conv).map((d) => [`unread.${d}`, increment(1)]),
  );
  await updateDoc(doc(db, 'conversations', conv.id), {
    lastMessage: {
      texto: texto
        ? `${emoji} ${texto}`
        : esImagen
          ? '📷 Foto'
          : esVideo
            ? '🎥 Video'
            : `📎 ${file.name}`,
      senderTipo: 'agent',
      senderId: uid,
      senderNombre: nombreChat,
      at: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
    'unread.agentes': deleteField(),
    ...incrementos,
  });
}

export async function updateConversation(convId: string, data: Record<string, unknown>) {
  await updateDoc(doc(db, 'conversations', convId), { ...data, updatedAt: serverTimestamp() });
}

// ---------------------------------------------------------------- tickets

export interface TicketFiltros {
  estado?: string;
  prioridad?: string;
  asignadoA?: string;
  siteId?: string;
}

export function useTickets(filtros: TicketFiltros) {
  const constraints = useMemo(() => {
    const c: QueryConstraint[] = [];
    if (filtros.estado) c.push(where('estado', '==', filtros.estado));
    if (filtros.prioridad) c.push(where('prioridad', '==', filtros.prioridad));
    if (filtros.asignadoA) c.push(where('asignadoA', '==', filtros.asignadoA));
    if (filtros.siteId) c.push(where('siteId', '==', filtros.siteId));
    c.push(orderBy('updatedAt', 'desc'), fsLimit(100));
    return c;
  }, [filtros.estado, filtros.prioridad, filtros.asignadoA, filtros.siteId]);
  return useCollection<Ticket>('tickets', constraints, [
    filtros.estado,
    filtros.prioridad,
    filtros.asignadoA,
    filtros.siteId,
  ]);
}

export function useTicketHistory(ticketId: string | null) {
  return useCollection<TicketEvent>(
    ticketId ? `tickets/${ticketId}/historial` : 'tickets/_/historial',
    [orderBy('createdAt', 'asc')],
    [ticketId],
  );
}

export function useTicketNotes(ticketId: string | null) {
  return useCollection<TicketNote>(
    ticketId ? `tickets/${ticketId}/notas` : 'tickets/_/notas',
    [orderBy('createdAt', 'asc')],
    [ticketId],
  );
}

export function useContactTickets(contactId: string | null) {
  return useCollection<Ticket>(
    'tickets',
    [where('contactId', '==', contactId ?? '_'), orderBy('updatedAt', 'desc'), fsLimit(50)],
    [contactId],
  );
}

/** Tickets del condominio/cliente (para conversaciones de equipo). */
export function useClientTickets(clientId: string | null) {
  return useCollection<Ticket>(
    'tickets',
    [where('clientId', '==', clientId ?? '_'), orderBy('updatedAt', 'desc'), fsLimit(50)],
    [clientId],
  );
}

// ---------------------------------------------------------------- catálogos

export function useSites() {
  return useCollection<Site>('sites', [orderBy('nombre', 'asc')], []);
}

export function useTeam() {
  return useCollection<TeamMember>('team', [orderBy('nombre', 'asc')], []);
}

export function useContact(contactId: string | null) {
  return useDoc<Contact>(contactId ? `contacts/${contactId}` : null);
}

// ---------------------------------------------------------------- formato

export function toDate(ts: unknown): Date | null {
  if (!ts) return null;
  const t = ts as { toDate?: () => Date };
  return typeof t.toDate === 'function' ? t.toDate() : null;
}

export function fmtHora(ts: unknown): string {
  const d = toDate(ts);
  return d ? d.toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
}

export function fmtFecha(ts: unknown, conHora = false): string {
  const d = toDate(ts);
  if (!d) return '';
  const f = d.toLocaleDateString('es-CR', { day: 'numeric', month: 'short' });
  return conHora ? `${f}, ${fmtHora(ts)}` : f;
}

export function fmtRelativo(ts: unknown): string {
  const d = toDate(ts);
  if (!d) return '';
  const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  return fmtFecha(ts);
}

export function iniciales(nombre: string): string {
  return nombre
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase();
}
