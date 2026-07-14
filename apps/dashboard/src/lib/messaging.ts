'use client';

// FCM Web Push para la consola: registra el token del agente en team/{uid}.
// Requiere proyecto Firebase real + VAPID key (NEXT_PUBLIC_FB_VAPID_KEY).
// En el emulador queda 'no-disponible' y la UI lo indica.

import { arrayRemove, arrayUnion, doc, updateDoc } from 'firebase/firestore';
import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported,
  onMessage,
  type Messaging,
} from 'firebase/messaging';
import { app, db, useEmulators } from './firebase';

export type PushEstado = 'activado' | 'desactivado' | 'no-disponible' | 'denegado';

// Clave pública Web Push (VAPID) del proyecto aditum-chat-1a5cd; overrideable por env.
const VAPID_KEY =
  process.env.NEXT_PUBLIC_FB_VAPID_KEY ??
  'BF3Hu4HXwrERRfuNO7jjkShwGezF41cE1ZSJD1x2eMnge_rSmHtR5czaujHbH2PEuz3TECnr1e-sQDBCiXwB0Rg';
const PREF_KEY = 'aditum-chat-push';

export function pushDisponible(): boolean {
  return (
    !useEmulators &&
    Boolean(VAPID_KEY) &&
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator
  );
}

/** Preferencia guardada en este navegador: 'on' | 'off' | null (nunca eligió). */
export function pushPreferencia(): 'on' | 'off' | null {
  if (typeof window === 'undefined') return null;
  const v = localStorage.getItem(PREF_KEY);
  return v === 'on' ? 'on' : v === 'off' ? 'off' : null;
}

let messagingInstance: Messaging | null = null;
async function obtenerMessaging(): Promise<Messaging | null> {
  if (!pushDisponible() || !(await isSupported().catch(() => false))) return null;
  messagingInstance ??= getMessaging(app);
  return messagingInstance;
}

async function registrarSw(): Promise<ServiceWorkerRegistration> {
  // El SW trae la config fija; no hace falta querystring.
  return navigator.serviceWorker.register('/firebase-messaging-sw.js');
}

/** Pide permiso, obtiene el token FCM y lo guarda en team/{uid}. */
export async function habilitarPush(uid: string): Promise<PushEstado> {
  const messaging = await obtenerMessaging();
  if (!messaging) return 'no-disponible';

  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') return 'denegado';
  // Record the intent as soon as permission exists — a later failure in
  // token registration must not leave the preference unsaved.
  localStorage.setItem(PREF_KEY, 'on');

  const registration = await registrarSw();
  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration,
  });
  if (!token) return 'no-disponible';

  await updateDoc(doc(db, 'team', uid), { fcmTokens: arrayUnion(token) });

  // En primer plano solo notificar si la pestaña está oculta (el inbox ya suena).
  // Mensajes data-only: título/cuerpo vienen en payload.data.
  onMessage(messaging, (payload) => {
    if (!document.hidden) return;
    const d = payload.data ?? {};
    if (!d.title) return;
    // Tag único por mensaje para que las notificaciones se apilen (ver SW).
    const notif = new Notification(d.title, {
      body: d.body,
      tag: d.msgId ? `${d.convId}_${d.msgId}` : `aditum-chat-${Date.now()}`,
      icon: '/icon-192.png',
    });
    notif.onclick = () => {
      window.focus();
      if (d.link) window.location.href = d.link;
    };
  });
  return 'activado';
}

/** Borra el token local y lo quita del doc del agente. */
export async function deshabilitarPush(uid: string): Promise<PushEstado> {
  localStorage.setItem(PREF_KEY, 'off');
  const messaging = await obtenerMessaging();
  if (!messaging) return 'no-disponible';
  try {
    const registration = await registrarSw();
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    if (token) {
      await updateDoc(doc(db, 'team', uid), { fcmTokens: arrayRemove(token) });
      await deleteToken(messaging);
    }
  } catch {
    // sin token que borrar
  }
  return 'desactivado';
}
