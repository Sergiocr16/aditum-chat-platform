import { readFileSync } from 'node:fs';
import { checkConnection, type DbConnection } from './dbCheck.js';
import { Gateway } from './gateway.js';

const SYNC_MS = 15_000;
const HEARTBEAT_MS = 60_000;
/** Grants can widen after the fact, so a connection that passed gets checked again. */
const RECHECK_MS = 60 * 60_000;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name}`);
  return value;
}

const functionUrl = required('GATEWAY_FUNCTION_URL');
const secret = required('GATEWAY_SHARED_SECRET');
const caPem = process.env.RO_DB_CA_FILE ? readFileSync(process.env.RO_DB_CA_FILE, 'utf8') : null;

const gateway = new Gateway({
  adminToken: required('GATEWAY_ADMIN_TOKEN'),
  logDir: required('GATEWAY_LOG_DIR'),
  caPem,
});
const port = await gateway.listen(Number(process.env.GATEWAY_PORT ?? 7801));
console.log(`gateway listening on 127.0.0.1:${port}`);

async function call<T>(action: string, body: object = {}): Promise<T> {
  const response = await fetch(functionUrl, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${action}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

interface SyncResponse {
  /** Only sent when it changed or a test was asked for, so the password travels as little as possible. */
  config?: (DbConnection & { version: string }) | null;
}

let knownVersion: string | null = null;
let current: DbConnection | null = null;
let lastCheck = 0;
let lastHeartbeat = 0;

/** A connection is only ever used after passing, and stops being used the moment it fails. */
async function verify(db: DbConnection, version: string) {
  const { ok, checks } = await checkConnection(db, caPem);
  lastCheck = Date.now();
  current = ok ? db : null;
  gateway.setConnection(current);
  console.log(`connection check ${ok ? 'passed' : 'failed'}`);
  await call('testResult', { version, ok, checks });
}

async function tick() {
  const heartbeat = Date.now() - lastHeartbeat >= HEARTBEAT_MS;
  if (heartbeat) lastHeartbeat = Date.now();
  const { config } = await call<SyncResponse>('sync', { knownVersion, heartbeat });
  if (config === null) {
    knownVersion = null;
    current = null;
    gateway.setConnection(null);
  } else if (config) {
    const { version, ...db } = config;
    knownVersion = version;
    await verify(db, version);
  } else if (current && knownVersion && Date.now() - lastCheck >= RECHECK_MS) {
    await verify(current, knownVersion);
  }
}

for (;;) {
  await tick().catch((e: Error) => console.error('sync', e.message));
  await new Promise((resolve) => setTimeout(resolve, SYNC_MS));
}
