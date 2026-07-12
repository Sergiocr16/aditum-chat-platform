'use client';

import { getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { connectDatabaseEmulator, getDatabase } from 'firebase/database';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';

export const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS !== 'false';

const config = useEmulators
  ? {
      projectId: 'demo-aditum-chat',
      apiKey: 'demo',
      appId: 'demo',
      authDomain: 'localhost',
      storageBucket: 'demo-aditum-chat.appspot.com',
      databaseURL: 'http://127.0.0.1:9102/?ns=demo-aditum-chat-default-rtdb',
    }
  : {
      // Proyecto de producción: aditum-chat-1a5cd (overrideable por env).
      projectId: process.env.NEXT_PUBLIC_FB_PROJECT_ID ?? 'aditum-chat-1a5cd',
      apiKey: process.env.NEXT_PUBLIC_FB_API_KEY ?? 'AIzaSyCMXz4cGSOAROb3uw3uGWGfKj1UWRwEnkw',
      appId: process.env.NEXT_PUBLIC_FB_APP_ID ?? '1:285856962512:web:1d9243e54e6df1e0cb8bd5',
      authDomain: process.env.NEXT_PUBLIC_FB_AUTH_DOMAIN ?? 'aditum-chat-1a5cd.firebaseapp.com',
      storageBucket:
        process.env.NEXT_PUBLIC_FB_STORAGE_BUCKET ?? 'aditum-chat-1a5cd.firebasestorage.app',
      messagingSenderId: process.env.NEXT_PUBLIC_FB_SENDER_ID ?? '285856962512',
      databaseURL:
        process.env.NEXT_PUBLIC_FB_DATABASE_URL ??
        'https://aditum-chat-1a5cd-default-rtdb.firebaseio.com',
    };

export const firebaseConfig = config;

export const app = getApps()[0] ?? initializeApp(config);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const rtdb = getDatabase(app);
export const fns = getFunctions(app, 'us-central1');

export const functionsBaseUrl = useEmulators
  ? 'http://127.0.0.1:5201/demo-aditum-chat/us-central1'
  : `https://us-central1-${config.projectId}.cloudfunctions.net`;

let connected = false;
if (useEmulators && typeof window !== 'undefined' && !connected) {
  connected = true;
  connectAuthEmulator(auth, 'http://127.0.0.1:9101', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8181);
  connectStorageEmulator(storage, '127.0.0.1', 9103);
  connectDatabaseEmulator(rtdb, '127.0.0.1', 9102);
  connectFunctionsEmulator(fns, '127.0.0.1', 5201);
}
