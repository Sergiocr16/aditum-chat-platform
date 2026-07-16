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

type SessionResult =
  | { ok: true; session: WidgetSessionResponse }
  | { ok: false; status: number; message: string };

async function postWidgetSession(settings: AditumChatSettings, payload: string): Promise<SessionResult> {
  const res = await fetch(`${apiUrl(settings)}/widgetSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteId: settings.siteId, payload }),
  });
  if (res.ok) return { ok: true, session: (await res.json()) as WidgetSessionResponse };
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  return { ok: false, status: res.status, message: body.message ?? `widgetSession falló (${res.status})` };
}

/**
 * Intercambia el payload cifrado del host por una sesión del widget.
 * Fast path: usa el payload EMBEBIDO (fresco al cargar la página) — evita un
 * round-trip a `payloadUrl` en la carga inicial. Solo si el server lo rechaza
 * (embebido vencido, p. ej. página cacheada) y el host configuró `payloadUrl`,
 * pide uno fresco y reintenta.
 */
export async function openSession(settings: AditumChatSettings): Promise<WidgetSessionResponse> {
  if (settings.payload) {
    const r = await postWidgetSession(settings, settings.payload);
    if (r.ok) return r.session;
    if (!settings.payloadUrl) throw new Error(r.message);
  }
  if (!settings.payloadUrl) throw new Error('AditumChatSettings necesita payload o payloadUrl.');
  const fresh = await fetchFreshPayload(settings.payloadUrl);
  const r = await postWidgetSession(settings, fresh);
  if (r.ok) return r.session;
  throw new Error(r.message);
}
