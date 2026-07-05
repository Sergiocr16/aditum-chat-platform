import type { AditumChatSettings, WidgetSessionResponse } from '@aditum-chat/shared';

const DEFAULT_API = 'https://us-central1-aditum-chat-1a5cd.cloudfunctions.net';

export function apiUrl(settings: AditumChatSettings): string {
  return settings.apiUrl?.replace(/\/$/, '') ?? DEFAULT_API;
}

export function usesEmulators(settings: AditumChatSettings): boolean {
  const url = apiUrl(settings);
  return url.includes('localhost') || url.includes('127.0.0.1');
}

/** Intercambia el payload cifrado del host por una sesión del widget. */
export async function openSession(settings: AditumChatSettings): Promise<WidgetSessionResponse> {
  const res = await fetch(`${apiUrl(settings)}/widgetSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteId: settings.siteId, payload: settings.payload }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `widgetSession falló (${res.status})`);
  }
  return (await res.json()) as WidgetSessionResponse;
}
