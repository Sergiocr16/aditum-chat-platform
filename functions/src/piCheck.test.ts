import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:net';
import { Server, utils } from 'ssh2';
import { checkPi, hostKeyFingerprint } from './piCheck.js';

const PASSWORD = 'fixture-password';

interface FakePi {
  port: number;
  fingerprint: string;
  passwordsSeen: string[];
  close: () => void;
}

const open: FakePi[] = [];
afterEach(() => open.splice(0).forEach((pi) => pi.close()));

async function fakePi(replies: Record<string, { output: string; code: number }>): Promise<FakePi> {
  const hostKey = utils.generateKeyPairSync('ed25519').private;
  const parsed = utils.parseKey(hostKey);
  if (parsed instanceof Error) throw parsed;
  const passwordsSeen: string[] = [];
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.method !== 'password') return ctx.reject(['password']);
      passwordsSeen.push(ctx.password);
      return ctx.password === PASSWORD ? ctx.accept() : ctx.reject(['password']);
    });
    client.on('error', () => {});
    client.on('ready', () => {
      client.on('session', (accept) => {
        accept().on('exec', (acceptExec, _reject, info) => {
          const stream = acceptExec();
          const reply = Object.entries(replies).find(([needle]) => info.command.includes(needle))?.[1];
          stream.write(reply?.output ?? '');
          stream.exit(reply?.code ?? 127);
          stream.end();
        });
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const pi: FakePi = {
    port: (server.address() as { port: number }).port,
    fingerprint: hostKeyFingerprint(parsed.getPublicSSH() as Buffer),
    passwordsSeen,
    close: () => server.close(),
  };
  open.push(pi);
  return pi;
}

const HEALTHY = { uname: { output: 'aarch64\n7820\n', code: 0 }, claude: { output: '2.1.318 (Claude Code)\n', code: 0 } };
const byId = (result: Awaited<ReturnType<typeof checkPi>>, id: string) => result.checks.find((check) => check.id === id);

describe('checkPi', () => {
  it('logs in, pins the host key and reads the machine', async () => {
    const pi = await fakePi(HEALTHY);
    const result = await checkPi({ host: '127.0.0.1', port: pi.port, user: 'pi', password: PASSWORD }, null);
    expect(result.connected).toBe(true);
    expect(result.fingerprint).toBe(pi.fingerprint);
    expect(byId(result, 'system')).toMatchObject({ ok: true, detail: 'aarch64, 7.6 GB de memoria.' });
    expect(byId(result, 'claude')).toMatchObject({ ok: true, detail: 'Claude Code 2.1.318 (Claude Code).' });
  });

  it('reports a wrong password and pins nothing', async () => {
    const pi = await fakePi(HEALTHY);
    const result = await checkPi({ host: '127.0.0.1', port: pi.port, user: 'pi', password: 'wrong' }, null);
    expect(result).toMatchObject({ connected: false, fingerprint: null });
    expect(byId(result, 'connect')?.detail).toBe('Usuario o contraseña incorrectos.');
  });

  it('never sends the password to a machine with another host key', async () => {
    const pi = await fakePi(HEALTHY);
    const result = await checkPi({ host: '127.0.0.1', port: pi.port, user: 'pi', password: PASSWORD }, 'SHA256:other');
    expect(result.connected).toBe(false);
    expect(byId(result, 'hostKey')?.ok).toBe(false);
    expect(pi.passwordsSeen).toEqual([]);
  });

  it('accepts the pinned host key', async () => {
    const pi = await fakePi(HEALTHY);
    const result = await checkPi({ host: '127.0.0.1', port: pi.port, user: 'pi', password: PASSWORD }, pi.fingerprint);
    expect(result.connected).toBe(true);
    expect(byId(result, 'hostKey')?.detail).toBe('La huella de la máquina coincide con la guardada.');
  });

  it('stays connected but flags a machine that cannot run the analyzer', async () => {
    const pi = await fakePi({ uname: { output: 'armv7l\n1024\n', code: 0 }, claude: { output: 'command not found', code: 127 } });
    const result = await checkPi({ host: '127.0.0.1', port: pi.port, user: 'pi', password: PASSWORD }, null);
    expect(result.connected).toBe(true);
    expect(byId(result, 'system')?.ok).toBe(false);
    expect(byId(result, 'claude')?.ok).toBe(false);
  });

  it('explains an unreachable port', async () => {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()));
    const { port } = probe.address() as { port: number };
    await new Promise((resolve) => probe.close(resolve));
    const result = await checkPi({ host: '127.0.0.1', port, user: 'pi', password: PASSWORD }, null);
    expect(result.connected).toBe(false);
    expect(byId(result, 'connect')?.detail).toContain('No se pudo llegar');
  });
});
