import { createHash } from 'node:crypto';
import { Client } from 'ssh2';
import type { InvestigatorPiCheck } from '@aditum-chat/shared';

export interface PiConnection {
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface PiCheckResult {
  /** True when the Pi was reached and logged in to. The other checks only inform. */
  connected: boolean;
  /** Set only after a successful login, so a host that rejects us never gets pinned. */
  fingerprint: string | null;
  checks: InvestigatorPiCheck[];
}

const CONNECT_TIMEOUT_MS = 15_000;
const COMMAND_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_CHARS = 4_000;
const MIN_MEMORY_MB = 3_500;

// Fixed commands: nothing typed in the console reaches the Pi's shell.
const SYSTEM_COMMAND = `uname -m; awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo`;
const CLAUDE_COMMAND = `bash -lc 'claude --version'`;

/** Same format as `ssh-keygen -lf`, so an admin can compare it on the Pi. */
export function hostKeyFingerprint(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}

function connectFailure(error: Error & { level?: string; code?: string }, target: string): string {
  if (error.level === 'client-authentication') return 'Usuario o contraseña incorrectos.';
  if (error.level === 'client-timeout' || error.code === 'ETIMEDOUT') {
    return `${target} no respondió. Revisá la IP, el puerto y que el router deje pasar SSH.`;
  }
  if (error.code === 'ENOTFOUND') return `No existe el host de ${target}.`;
  return `No se pudo llegar a ${target}. Revisá la IP, el puerto y que el router deje pasar SSH.`;
}

function run(client: Client, command: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), COMMAND_TIMEOUT_MS);
    client.exec(command, (error, stream) => {
      if (error) {
        clearTimeout(timer);
        reject(error);
        return;
      }
      let output = '';
      stream.on('data', (chunk: Buffer) => {
        if (output.length < MAX_OUTPUT_CHARS) output += chunk.toString('utf8');
      });
      stream.stderr.on('data', () => {});
      stream.on('close', (code: number | null) => {
        clearTimeout(timer);
        resolve({ code, output: output.slice(0, MAX_OUTPUT_CHARS).trim() });
      });
    });
  });
}

async function systemCheck(client: Client): Promise<InvestigatorPiCheck> {
  const { output } = await run(client, SYSTEM_COMMAND);
  const [arch = '', memory = ''] = output.split('\n').map((line) => line.trim());
  const memoryMb = Number(memory);
  if (!arch || !Number.isFinite(memoryMb) || memoryMb <= 0) {
    return { id: 'system', ok: false, detail: 'No se pudo leer la arquitectura y la memoria de la máquina.' };
  }
  const description = `${arch.slice(0, 32)}, ${(memoryMb / 1024).toFixed(1)} GB de memoria`;
  if (arch !== 'aarch64' && arch !== 'x86_64') {
    return { id: 'system', ok: false, detail: `${description}. Claude Code necesita un sistema de 64 bits.` };
  }
  if (memoryMb < MIN_MEMORY_MB) {
    return { id: 'system', ok: false, detail: `${description}. Claude Code necesita al menos 4 GB.` };
  }
  return { id: 'system', ok: true, detail: `${description}.` };
}

async function claudeCheck(client: Client): Promise<InvestigatorPiCheck> {
  const { code, output } = await run(client, CLAUDE_COMMAND);
  const version = output.split('\n').find((line) => /^\d+\.\d+/.test(line.trim()));
  if (code !== 0 || !version) return { id: 'claude', ok: false, detail: 'Este usuario no tiene Claude Code disponible.' };
  return { id: 'claude', ok: true, detail: `Claude Code ${version.trim().slice(0, 40)}.` };
}

const settle = (check: Promise<InvestigatorPiCheck>, id: InvestigatorPiCheck['id']): Promise<InvestigatorPiCheck> =>
  check.catch(() => ({ id, ok: false, detail: 'La revisión no terminó a tiempo.' }));

/**
 * Logs in over SSH and looks at the machine. With a pinned fingerprint, a different host key ends
 * the handshake before the password is sent, so a reassigned IP can't collect it.
 */
export function checkPi(connection: PiConnection, pinnedFingerprint: string | null): Promise<PiCheckResult> {
  const target = `${connection.host}:${connection.port}`;
  return new Promise((resolve) => {
    const client = new Client();
    let seen: string | null = null;
    let settled = false;
    const finish = (result: PiCheckResult) => {
      if (settled) return;
      settled = true;
      client.end();
      resolve(result);
    };

    client.on('ready', () => {
      void (async () => {
        const system = await settle(systemCheck(client), 'system');
        const claude = await settle(claudeCheck(client), 'claude');
        finish({
          connected: true,
          fingerprint: seen,
          checks: [
            { id: 'connect', ok: true, detail: `Entró a ${target} como ${connection.user}.` },
            {
              id: 'hostKey',
              ok: true,
              detail: pinnedFingerprint
                ? 'La huella de la máquina coincide con la guardada.'
                : `Primera conexión, huella guardada: ${seen}. Compará que sea la de tu Pi.`,
            },
            system,
            claude,
          ],
        });
      })();
    });

    client.on('error', (error: Error & { level?: string; code?: string }) => {
      if (pinnedFingerprint && seen && seen !== pinnedFingerprint) {
        finish({
          connected: false,
          fingerprint: null,
          checks: [
            {
              id: 'hostKey',
              ok: false,
              detail: `La máquina en ${target} tiene otra huella (${seen}), así que no se le mandó la contraseña. Si reinstalaste la Pi, quitá esta conexión y volvé a guardarla.`,
            },
          ],
        });
        return;
      }
      finish({
        connected: false,
        fingerprint: null,
        checks: [{ id: 'connect', ok: false, detail: connectFailure(error, target) }],
      });
    });

    client.connect({
      host: connection.host,
      port: connection.port,
      username: connection.user,
      password: connection.password,
      readyTimeout: CONNECT_TIMEOUT_MS,
      hostVerifier: (key: Buffer) => {
        seen = hostKeyFingerprint(key);
        return !pinnedFingerprint || seen === pinnedFingerprint;
      },
    });
  });
}
