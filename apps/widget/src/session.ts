import type { AditumChatSettings, WidgetSessionResponse } from '@aditum-chat/shared';

const DEFAULT_API = 'https://us-central1-aditum-chat-1a5cd.cloudfunctions.net';

export function apiUrl(settings: AditumChatSettings): string {
  return settings.apiUrl?.replace(/\/$/, '') ?? DEFAULT_API;
}

export function usesEmulators(settings: AditumChatSettings): boolean {
  const url = apiUrl(settings);
  return url.includes('localhost') || url.includes('127.0.0.1');
}

/** Pide un payload recién generado al endpoint del host. */
async function fetchFreshPayload(payloadUrl: string): Promise<string> {
  const res = await fetch(payloadUrl, { credentials: 'include' });
  if (!res.ok) throw new Error(`payloadUrl falló (${res.status})`);
  const body = (await res.json()) as { payload?: string };
  if (!body.payload) throw new Error('payloadUrl no devolvió { payload }.');
  return body.payload;
}

/**
 * Intercambia el payload cifrado del host por una sesión del widget.
 * El payload embebido en la página vence a los 5 min, así que si el host
 * configuró `payloadUrl` se pide uno FRESCO en este momento (el embebido queda
 * de fallback si ese endpoint falla).
 */
export async function openSession(settings: AditumChatSettings): Promise<WidgetSessionResponse> {
  let payload = settings.payload;
  if (settings.payloadUrl) {
    try {
      payload = await fetchFreshPayload(settings.payloadUrl);
    } catch (err) {
      if (!payload) throw err as Error;
    }
  }
  if (!payload) throw new Error('AditumChatSettings necesita payload o payloadUrl.');

  const res = await fetch(`${apiUrl(settings)}/widgetSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteId: settings.siteId, payload }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `widgetSession falló (${res.status})`);
  }
  return (await res.json()) as WidgetSessionResponse;
}
