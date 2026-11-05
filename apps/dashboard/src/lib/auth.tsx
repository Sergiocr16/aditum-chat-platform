'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import type { Idioma, TeamMember } from '@aditum-chat/shared';
import { auth, db } from './firebase';

export interface AgentSession {
  user: User;
  uid: string;
  perfil: TeamMember | null;
  idioma: Idioma;
}

interface AuthCtx {
  loading: boolean;
  agent: AgentSession | null;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  loading: true,
  agent: null,
  login: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [perfil, setPerfil] = useState<TeamMember | null>(null);

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u);
        setLoading(false);
      }),
    [],
  );

  useEffect(() => {
    if (!user) {
      setPerfil(null);
      return;
    }
    return onSnapshot(doc(db, 'team', user.uid), (snap) => {
      setPerfil(snap.exists() ? (snap.data() as TeamMember) : null);
    });
  }, [user]);

  const agent: AgentSession | null = user
    ? { user, uid: user.uid, perfil, idioma: perfil?.idioma ?? 'es' }
    : null;

  return (
    <Ctx.Provider
      value={{
        loading,
        agent,
        login: async (email, password) => {
          await signInWithEmailAndPassword(auth, email, password);
        },
        logout: async () => {
          await signOut(auth);
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);

/** Firebase checks the password and it never reaches functions, which only see that the login is recent. */
export async function confirmPassword(password: string): Promise<void> {
  const user = auth.currentUser;
  if (!user?.email) throw new Error('No hay sesión.');
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
  await user.getIdToken(true);
}

export const isWrongPassword = (error: unknown) => {
  const code = (error as { code?: string } | null)?.code;
  return code === 'auth/wrong-password' || code === 'auth/invalid-credential';
};
