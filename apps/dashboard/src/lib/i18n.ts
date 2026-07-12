'use client';

import { dashboardMessages, makeT, type DashMsgKey, type Idioma } from '@aditum-chat/shared';
import { useAuth } from './auth';

export function useT(): (key: DashMsgKey, params?: Record<string, string | number>) => string {
  const { agent } = useAuth();
  return makeT(dashboardMessages, (agent?.idioma ?? 'es') as Idioma);
}
