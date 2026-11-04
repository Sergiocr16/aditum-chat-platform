import { afterEach, describe, expect, it } from 'vitest';
import { Server, utils } from 'ssh2';
import { hostKeyFingerprint } from './piCheck.js';
import { bootstrapScript, cleanLine, installOnPi, isCleanSetting, renderSettings, type PiInstallProgress } from './piInstall.js';

const PASSWORD = 'fixture-password';
const SETTINGS = { RUNNER_SHARED_SECRET: 'fixture-runner-secret', CLAUDE_CODE_OAUTH_TOKEN: 'fixture-claude-token' };

interface Exec {
  command: string;
  stdin: string;
}

interface FakePi {
  port: number;
  fingerprint: string;
  execs: Exec[];
  authAttempts: () => number;
}

const closers: (() => void)[] = [];
afterEach(() => closers.splice(0).forEach((close) => close()));

/** `sudoOutput` is what the install prints, as if sudo had run it. */
async function fakePi(sudoOutput: string, sudoCode = 0): Promise<FakePi> {
  const hostKey = utils.generateKeyPairSync('ed25519').private;
  const parsed = utils.parseKey(hostKey);
  if (parsed instanceof Error) throw parsed;
  const execs: Exec[] = [];
  let attempts = 0;
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on('error', () => {});
    client.on('authentication', (ctx) => {
      attempts += 1;
      return ctx.method === 'password' && ctx.password === PASSWORD ? ctx.accept() : ctx.reject(['password']);
    });
    client.on('ready', () => {
      client.on('session', (accept) => {
        accept().on('exec', (acceptExec, _reject, info) => {
          const stream = acceptExec();
          const record: Exec = { command: info.command, stdin: '' };
          execs.push(record);
          const reply = (output: string, code: number) => {
            stream.write(output);
            stream.exit(code);
            stream.end();
          };
          stream.on('data', (chunk: Buffer) => {
            record.stdin += chunk.toString('utf8');
          });
          stream.on('end', () => {
            if (info.command.includes('mktemp')) reply('/tmp/tmp.fixture\n', 0);
            else if (info.command.startsWith('cat >')) reply('', 0);
            else if (info.command.includes('sudo')) reply(sudoOutput, sudoCode);
            else reply('', 127);
          });
        });
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  closers.push(() => server.close());
  return {
    port: (server.address() as { port: number }).port,
    fingerprint: hostKeyFingerprint(parsed.getPublicSSH() as Buffer),
    execs,
    authAttempts: () => attempts,
  };
}

const connection = (port: number) => ({ host: '127.0.0.1', port, user: 'pi', password: PASSWORD });
const options = { gitRef: 'main', settings: SETTINGS };

describe('installOnPi', () => {
  it('reports the steps and keeps every secret off the command line', async () => {
    const pi = await fakePi('::step prepare\n::commit abc123\n::step build\nbuilding\n::step verify\n::done\n');
    const progress: PiInstallProgress[] = [];
    const result = await installOnPi(connection(pi.port), pi.fingerprint, options, async (p) => progress.push(p));
    expect(result).toMatchObject({ ok: true, step: 'verify', commit: 'abc123', log: ['building'] });
    expect(progress.map((p) => p.step)).toEqual(['prepare', 'build', 'verify']);
    for (const secret of [PASSWORD, ...Object.values(SETTINGS)]) {
      expect(pi.execs.some((e) => e.command.includes(secret))).toBe(false);
    }
    expect(pi.execs[0]?.stdin).toContain('RUNNER_SHARED_SECRET=fixture-runner-secret');
    expect(pi.execs[2]?.stdin).toBe(`${PASSWORD}\n`);
  });

  it('never prints a secret into the log', async () => {
    const pi = await fakePi(`::step build\ntoken fixture-claude-token leaked\npass ${PASSWORD}\n::done\n`);
    const result = await installOnPi(connection(pi.port), pi.fingerprint, options, async () => {});
    expect(result.log).toEqual(['token [oculto] leaked', 'pass [oculto]']);
  });

  it('fails if the script exits cleanly without finishing', async () => {
    const pi = await fakePi('::step build\n');
    const result = await installOnPi(connection(pi.port), pi.fingerprint, options, async () => {});
    expect(result.ok).toBe(false);
  });

  it('reports a failure with its step and output', async () => {
    const pi = await fakePi('::step services\nthe service did not start\n', 1);
    const result = await installOnPi(connection(pi.port), pi.fingerprint, options, async () => {});
    expect(result).toMatchObject({ ok: false, step: 'services', log: ['the service did not start'] });
  });

  it('explains a user that cannot use sudo', async () => {
    const pi = await fakePi('pi is not in the sudoers file.\n', 1);
    const result = await installOnPi(connection(pi.port), pi.fingerprint, options, async () => {});
    expect(result.detail).toContain('sudo');
  });

  it('does not log in to a machine with another host key', async () => {
    const pi = await fakePi('::done\n');
    const result = await installOnPi(connection(pi.port), 'SHA256:other', options, async () => {});
    expect(result.ok).toBe(false);
    expect(pi.authAttempts()).toBe(0);
    expect(pi.execs).toEqual([]);
  });
});

describe('settings and bootstrap', () => {
  it('rejects a value that could break out of the env file', () => {
    expect(isCleanSetting('sk-ant-oat01-abc_DEF.123')).toBe(true);
    expect(isCleanSetting('https://us-central1-x.cloudfunctions.net/fn')).toBe(true);
    for (const bad of ['a\nEVIL=1', 'a b', '$(reboot)', '`id`', '', 'a;b', "a'b"]) expect(isCleanSetting(bad)).toBe(false);
    expect(() => renderSettings({ A: 'a\nEVIL=1' })).toThrow();
  });

  it('rejects a git ref that could break out of the script', () => {
    expect(bootstrapScript('eco/w2jjy1cloy0h')).toContain("origin 'eco/w2jjy1cloy0h'");
    for (const bad of ["main'; reboot; '", '--upload-pack=x', 'a b', '']) expect(() => bootstrapScript(bad)).toThrow();
  });

  it('removes ANSI codes and caps long lines', () => {
    expect(cleanLine('\u001b[32mok\u001b[0m', [])).toBe('ok');
    expect(cleanLine('x'.repeat(500), [])).toHaveLength(300);
  });
});
