import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithCustomToken, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';
import { connectDatabaseEmulator, getDatabase, type Database } from 'firebase/database';

// La config pública de Firebase se inyecta en build; para emuladores basta
// projectId demo-* y apuntar los SDKs a localhost.
const DEMO_PROJECT = 'demo-aditum-chat';

export interface WidgetFirebase {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  storage: FirebaseStorage;
  rtdb: Database;
}

let instance: WidgetFirebase | null = null;

export function getWidgetFirebase(emulators: boolean): WidgetFirebase {
  if (instance) return instance;
  const app = initializeApp(
    emulators
      ? {
          projectId: DEMO_PROJECT,
          apiKey: 'demo',
          appId: 'demo',
          authDomain: 'localhost',
          databaseURL: 'http://127.0.0.1:9102/?ns=demo-aditum-chat-default-rtdb',
          storageBucket: `${DEMO_PROJECT}.appspot.com`,
        }
      : {
          // Proyecto de producción.
          projectId: 'aditum-chat-1a5cd',
          apiKey: 'AIzaSyCMXz4cGSOAROb3uw3uGWGfKj1UWRwEnkw',
          appId: '1:285856962512:web:1d9243e54e6df1e0cb8bd5',
          authDomain: 'aditum-chat-1a5cd.firebaseapp.com',
          storageBucket: 'aditum-chat-1a5cd.firebasestorage.app',
          messagingSenderId: '285856962512',
          databaseURL: 'https://aditum-chat-1a5cd-default-rtdb.firebaseio.com',
        },
    'aditum-chat-widget',
  );
  const auth = getAuth(app);
  const db = getFirestore(app);
  const storage = getStorage(app);
  const rtdb = getDatabase(app);
  if (emulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9101', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8181);
    connectStorageEmulator(storage, '127.0.0.1', 9103);
    connectDatabaseEmulator(rtdb, '127.0.0.1', 9102);
  }
  instance = { app, auth, db, storage, rtdb };
  return instance;
}

export async function signIn(fb: WidgetFirebase, token: string): Promise<void> {
  await signInWithCustomToken(fb.auth, token);
}
