'use client';

// Hooks y acciones de la pantalla 1i — Configuración del bot (/bot).
// Separado de data.ts para no tocar archivos existentes.

import { useEffect, useState } from 'react';
import {
  collection,
  doc,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import type { BotConfig, GlobalSettings, KbDoc, Site, WidgetConfig } from '@aditum-chat/shared';
import { db, fns, storage } from './firebase';
import { useDoc, type Row } from './data';

// ---------------------------------------------------------------- hooks

/** Lista reactiva de documentos de la base de conocimiento (kb/). */
export function useKbDocs(enabled: boolean): Row<KbDoc>[] {
  const [rows, setRows] = useState<Row<KbDoc>[]>([]);
  useEffect(() => {
    if (!enabled) {
      setRows([]);
      return;
    }
    const q = query(collection(db, 'kb'), orderBy('createdAt', 'desc'), fsLimit(100));
    return onSnapshot(q, (snap) => {
      setRows(snap.docs.map((d) => ({ id: d.id, data: d.data() as KbDoc })));
    });
  }, [enabled]);
  return rows;
}

/** settings/global — para calcular los valores efectivos (herencia). */
export function useGlobalSettings(enabled: boolean): Row<GlobalSettings> | null {
  return useDoc<GlobalSettings>(enabled ? 'settings/global' : null);
}

/** sites/{siteId} — el doc completo del sitio que se está configurando. */
export function useSite(siteId: string | null): Row<Site> | null {
  return useDoc<Site>(siteId ? `sites/${siteId}` : null);
}

// ---------------------------------------------------------------- acciones

/** Guarda el override del bot del sitio (objeto completo del override). */
export async function guardarBotOverride(siteId: string, override: Partial<BotConfig>): Promise<void> {
  await updateDoc(doc(db, 'sites', siteId), { botConfig: override });
}

/** Campos de widgetConfig que se editan desde la pantalla del bot. */
export type WidgetMessageKey = 'mensajeAI' | 'mensajeAgente' | 'mensajeFueraHorario';

/**
 * Guarda las respuestas automáticas (widgetConfig.mensaje*) con dot-paths para
 * no pisar el resto del override del widget (colores, botones, etc.).
 */
export async function guardarWidgetMensajes(
  siteId: string,
  patch: Partial<Pick<WidgetConfig, WidgetMessageKey>>,
): Promise<void> {
  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) updates[`widgetConfig.${k}`] = v;
  }
  if (Object.keys(updates).length > 0) {
    await updateDoc(doc(db, 'sites', siteId), updates);
  }
}

/** Extensions accepted by the KB uploader. */
export const KB_FILE_EXTENSIONS = ['pdf', 'txt', 'md'] as const;

const KB_CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
};

/** True if the file has a KB-supported extension (.pdf/.txt/.md). */
export function isKbFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return ext in KB_CONTENT_TYPES;
}

/**
 * Uploads a KB file (.pdf/.txt/.md): creates the kb/{docId} doc and stores the
 * file at `kb/{docId}.{ext}` — the storage trigger indexes it.
 */
export async function uploadKbFile(file: File, sitio: string): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const contentType = KB_CONTENT_TYPES[ext];
  if (!contentType) throw new Error(`Formato no soportado: .${ext}`);
  const ref = doc(collection(db, 'kb'));
  await setDoc(ref, {
    tipo: ext === 'pdf' ? 'pdf' : 'text',
    nombre: file.name.replace(/\.(pdf|txt|md)$/i, ''),
    sitio,
    estado: 'sincronizando',
    storagePath: `kb/${ref.id}.${ext}`,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await uploadBytes(storageRef(storage, `kb/${ref.id}.${ext}`), file, { contentType });
  return ref.id;
}

/** Agrega una URL a la KB y dispara la sincronización inmediata. */
export async function agregarUrlKb(url: string, nombre: string, sitio: string): Promise<string> {
  const ref = doc(collection(db, 'kb'));
  await setDoc(ref, {
    tipo: 'url',
    url,
    nombre,
    sitio,
    estado: 'sincronizando',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  // Si la sync falla, el propio callable/trigger marca estado 'error'.
  await httpsCallable(fns, 'kbSyncNow')({ docId: ref.id }).catch(() => {});
  return ref.id;
}

/** Sube la imagen del bot a Storage y devuelve la URL pública. */
export async function subirAvatarBot(siteId: string, file: File): Promise<string> {
  const ref = storageRef(storage, `perfiles/bot-${siteId}.png`);
  await uploadBytes(ref, file, { contentType: file.type || 'image/png' });
  return getDownloadURL(ref);
}

/** Callable testBot — panel "Probar el bot" (config actual sin guardar). */
export interface TestBotTurn {
  rol: 'user' | 'bot';
  texto: string;
}

export interface TestBotImage {
  /** Base64 sin el prefijo data:. */
  data: string;
  mimeType: string;
}

export async function testBotPregunta(
  siteId: string,
  pregunta: string,
  botConfigOverride: Partial<BotConfig>,
  opts?: { historial?: TestBotTurn[]; imagen?: TestBotImage },
): Promise<string> {
  const call = httpsCallable<
    {
      siteId: string;
      pregunta: string;
      botConfigOverride?: Partial<BotConfig>;
      historial?: TestBotTurn[];
      imagen?: TestBotImage;
    },
    { texto: string }
  >(fns, 'testBot');
  const res = await call({
    siteId,
    pregunta,
    botConfigOverride,
    historial: opts?.historial,
    imagen: opts?.imagen,
  });
  return res.data.texto;
}
