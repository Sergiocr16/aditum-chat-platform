/* Service worker de FCM Web Push para la consola de Aditum Chat.
 * Config fija (pública) del proyecto — el patrón estándar y robusto. */
/* global importScripts, firebase, clients, self */

importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCMXz4cGSOAROb3uw3uGWGfKj1UWRwEnkw',
  authDomain: 'aditum-chat-1a5cd.firebaseapp.com',
  projectId: 'aditum-chat-1a5cd',
  storageBucket: 'aditum-chat-1a5cd.firebasestorage.app',
  messagingSenderId: '285856962512',
  appId: '1:285856962512:web:1d9243e54e6df1e0cb8bd5',
});

// El SW nuevo toma control enseguida (sin esperar a que se cierren las pestañas).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const messaging = firebase.messaging();

// Mensajes data-only: construimos la notificación acá (control total, sin duplicados).
messaging.onBackgroundMessage((payload) => {
  const d = payload.data || {};
  self.registration.showNotification(d.title || 'Aditum Chat', {
    body: d.body || 'Nuevo mensaje',
    tag: d.convId || 'aditum-chat',
    icon: '/icon-192.png',
    data: { link: d.link || '/inbox' },
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/inbox';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((abiertas) => {
      for (const c of abiertas) {
        if (c.url.includes(self.location.origin) && 'focus' in c) {
          c.navigate(link);
          return c.focus();
        }
      }
      return clients.openWindow(link);
    }),
  );
});
