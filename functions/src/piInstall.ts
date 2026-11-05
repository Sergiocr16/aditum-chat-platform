import { Client, type ClientChannel } from 'ssh2';
import type { InvestigatorPiInstallStep } from '@aditum-chat/shared';
import { hostKeyFingerprint, type PiConnection } from './piCheck.js';

const REPO_URL = 'https://github.com/Sergiocr16/aditum-chat-platform.git';
const SOURCE_DIR = '/opt/aditum-investigator/src';

const CONNECT_TIMEOUT_MS = 20_000;
const INSTALL_TIMEOUT_MS = 24 * 60_000;
const MAX_LOG_LINES = 40;
const MAX_LINE_CHARS = 300;
const PROGRESS_INTERVAL_MS = 2_000;

export interface PiInstallOptions {
  gitRef: string;
  settings: Record<string, string>;
}

export interface PiInstallProgress {
  step: InvestigatorPiInstallStep;
  commit?: string;
  log: string[];
}

export interface PiInstallResult extends PiInstallProgress {
  ok: boolean;
  detail?: string;
}

const STEPS: readonly string[] = ['prepare', 'users', 'node', 'build', 'claude', 'config', 'services', 'verify'];

/** Settings end up in env files that systemd reads, so a value can't carry anything that file would interpret. */
export const isCleanSetting = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 1024 && /^[\w.:/@+=-]+$/.test(value);

export function renderSettings(settings: Record<string, string>): string {
  return Object.entries(settings)
    .map(([key, value]) => {
      if (!isCleanSetting(value)) throw new Error(`Valor no válido en ${key}`);
      return `${key}=${value}\n`;
    })
    .join('');
}

/** Cloned as root into a directory only root writes to, and from there install.sh takes over. */
export function bootstrapScript(gitRef: string): string {
  if (!/^[\w./-]{1,100}$/.test(gitRef) || gitRef.startsWith('-')) throw new Error('Referencia de git no válida');
  return `#!/usr/bin/env bash
set -euo pipefail
exec </dev/null
settings=$1
trap 'rm -rf "$(dirname "$settings")"' EXIT HUP TERM
missing=""
command -v git >/dev/null || missing="$missing git"
command -v curl >/dev/null || missing="$missing curl"
if [ -n "$missing" ]; then DEBIAN_FRONTEND=noninteractive apt-get install -y -q $missing; fi
install -d -m 755 /opt/aditum-investigator
if [ ! -d ${SOURCE_DIR}/.git ]; then
  rm -rf ${SOURCE_DIR}
  git clone --quiet --depth 1 --no-checkout ${REPO_URL} ${SOURCE_DIR}
fi
git -C ${SOURCE_DIR} fetch --quiet --depth 1 origin '${gitRef}'
git -C ${SOURCE_DIR} checkout --quiet --force --detach FETCH_HEAD
bash ${SOURCE_DIR}/services/investigator/deploy/install.sh "$settings"
`;
}

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

/** The log is stored and shown, so no secret may survive into it, however the Pi came to print it. */
export function cleanLine(line: string, secrets: string[]): string {
  let clean = line.replace(ANSI, '').trim();
  for (const secret of secrets) if (secret) clean = clean.split(secret).join('[oculto]');
  return clean.slice(0, MAX_LINE_CHARS);
}

function exec(client: Client, command: string): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => (error ? reject(error) : resolve(stream)));
  });
}

/** Sends `input` on stdin, never on the command line, where `ps` would show it. */
async function runWithInput(client: Client, command: string, input: string): Promise<{ code: number | null; output: string }> {
  const stream = await exec(client, command);
  return new Promise((resolve) => {
    let output = '';
    stream.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    stream.stderr.on('data', () => {});
    stream.on('close', (code: number | null) => resolve({ code, output: output.trim() }));
    stream.end(input);
  });
}

function connect(connection: PiConnection, pinnedFingerprint: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client.on('ready', () => resolve(client));
    client.on('error', reject);
    client.connect({
      host: connection.host,
      port: connection.port,
      username: connection.user,
      password: connection.password,
      readyTimeout: CONNECT_TIMEOUT_MS,
      hostVerifier: (key: Buffer) => hostKeyFingerprint(key) === pinnedFingerprint,
    });
  });
}

const SUDO_REFUSED = /incorrect password|sorry, try again|no password was provided|not in the sudoers|may not run sudo|not allowed to/i;

/**
 * Runs the install as root and reports its progress. The settings and the bootstrap go to a private
 * temporary directory on the Pi, and the sudo password through stdin, so neither shows up in a process list.
 */
export async function installOnPi(
  connection: PiConnection,
  pinnedFingerprint: string,
  options: PiInstallOptions,
  onProgress: (progress: PiInstallProgress) => Promise<unknown>,
): Promise<PiInstallResult> {
  const secrets = [connection.password, ...Object.values(options.settings)];
  const log: string[] = [];
  let step: InvestigatorPiInstallStep = 'connect';
  let commit: string | undefined;
  const snapshot = (): PiInstallProgress => ({ step, log: [...log], ...(commit && { commit }) });
  const fail = (detail: string): PiInstallResult => ({ ...snapshot(), ok: false, detail });

  let client: Client;
  try {
    client = await connect(connection, pinnedFingerprint);
  } catch {
    return fail('No se pudo entrar a la Pi, o su huella cambió. Probá la conexión de nuevo.');
  }

  try {
    const made = await runWithInput(client, `umask 077; d=$(mktemp -d) && cat > "$d/settings.env" && echo "$d"`, renderSettings(options.settings));
    if (made.code !== 0 || !/^\/[\w/.-]+$/.test(made.output)) return fail('No se pudo preparar la instalación en la Pi.');
    const dir = made.output;
    const written = await runWithInput(client, `cat > '${dir}/bootstrap.sh'`, bootstrapScript(options.gitRef));
    if (written.code !== 0) return fail('No se pudo preparar la instalación en la Pi.');

    const stream = await exec(client, `sudo -S -p '' bash '${dir}/bootstrap.sh' '${dir}/settings.env'; code=$?; rm -rf '${dir}' 2>/dev/null; exit $code`);
    return await new Promise<PiInstallResult>((resolve) => {
      let done = false;
      let sudoRefused = false;
      let pending = '';
      let lastSent = 0;
      let sending: Promise<unknown> = Promise.resolve();
      let succeeded = false;

      const report = (force = false) => {
        if (!force && Date.now() - lastSent < PROGRESS_INTERVAL_MS) return;
        lastSent = Date.now();
        const progress = snapshot();
        sending = sending.then(() => onProgress(progress)).catch(() => {});
      };

      const onLine = (raw: string) => {
        const line = cleanLine(raw, secrets);
        if (!line) return;
        if (line.startsWith('::step ')) {
          const next = line.slice(7).trim();
          if (STEPS.includes(next)) step = next as InvestigatorPiInstallStep;
          report(true);
        } else if (line.startsWith('::commit ')) {
          commit = line.slice(9).trim().slice(0, 40);
        } else if (line === '::done') {
          succeeded = true;
        } else {
          if (SUDO_REFUSED.test(line)) sudoRefused = true;
          log.push(line);
          if (log.length > MAX_LOG_LINES) log.shift();
          report();
        }
      };

      const onData = (chunk: Buffer) => {
        pending += chunk.toString('utf8');
        const lines = pending.split(/\r?\n|\r/);
        pending = lines.pop() ?? '';
        lines.forEach(onLine);
      };

      const finish = (result: () => PiInstallResult) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        void sending.then(() => resolve(result()));
      };

      const timer = setTimeout(() => {
        finish(() => fail('La instalación tardó demasiado. Podés volver a intentarlo: retoma lo que ya hizo.'));
        stream.close();
      }, INSTALL_TIMEOUT_MS);

      stream.on('data', onData);
      stream.stderr.on('data', onData);
      stream.on('close', (code: number | null) => {
        if (pending) onLine(pending);
        finish(() => {
          if (code === 0 && succeeded) return { ...snapshot(), ok: true };
          if (sudoRefused && step === 'connect') return fail('Este usuario no puede usar sudo, y la instalación lo necesita.');
          return fail('La instalación no terminó. Revisá el detalle.');
        });
      });
      stream.end(`${connection.password}\n`);
    });
  } finally {
    client.end();
  }
}
