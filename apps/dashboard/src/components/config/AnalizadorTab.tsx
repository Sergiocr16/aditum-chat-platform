'use client';

// Tab "Analizador" de /configuracion: cómo llegar a la Raspberry Pi y su conexión a la base de producción.
// Las contraseñas nunca vuelven al navegador. La Pi se prueba desde el servidor; MySQL, desde la Pi.

import { useEffect, useState } from 'react';
import type {
  Idioma,
  InvestigatorDbCheck,
  InvestigatorDbConfig,
  InvestigatorGatewayState,
  InvestigatorPiCheck,
  InvestigatorPiConfig,
  InvestigatorPiInstallStep,
} from '@aditum-chat/shared';
import { useAuth } from '@/lib/auth';
import { fmtFecha, useDoc } from '@/lib/data';
import {
  installInvestigatorOnPi,
  removeInvestigatorDb,
  removeInvestigatorPi,
  saveInvestigatorDb,
  saveInvestigatorPi,
  testInvestigatorDb,
  testInvestigatorPi,
  useGatewayOnline,
} from '@/lib/data-investigations';
import { Campo, Card } from './ui';

const M = {
  es: {
    titulo: 'Conexión a producción',
    subtitulo: 'Con esta conexión el analizador consulta datos de producción en las investigaciones',
    host: 'IP o host',
    puerto: 'Puerto',
    usuario: 'Usuario',
    contrasena: 'Contraseña',
    contrasenaGuardada: 'Guardada. Dejala vacía para no cambiarla.',
    base: 'Base',
    aviso: 'Usá el usuario de solo lectura de las vistas enmascaradas. Si el usuario tiene más permisos, la conexión se rechaza.',
    guardar: 'Guardar y probar',
    guardando: 'Guardando…',
    probar: 'Probar de nuevo',
    quitar: 'Quitar conexión',
    quitarConfirmar: '¿Seguro? La base no se va a consultar hasta volver a configurarla.',
    quitarSi: 'Sí, quitar',
    cancelar: 'Cancelar',
    error: 'No se pudo guardar. Intentá de nuevo.',
    estado: 'Prueba de la conexión a producción',
    pendiente: 'Probando desde la Pi…',
    correcta: 'Conexión correcta',
    fallida: 'La conexión no pasó la prueba y no se va a usar',
    piOnline: 'El analizador está activo en la Pi',
    piOffline: 'El analizador no responde en la Pi. La prueba corre cuando vuelva.',
    ipFirewall: 'MySQL debe permitir conexiones desde',
    sinPrueba: 'Todavía no hay una conexión guardada.',
    pi: {
      titulo: 'Raspberry Pi',
      subtitulo: 'La máquina donde corre el analizador',
      host: 'IP pública o host',
      puerto: 'Puerto SSH',
      aviso: 'El servidor de Aditum Chat entra por SSH, así que el router tiene que dejar pasar este puerto hacia la Pi.',
      pendiente: 'Entrando a la Pi…',
      correcta: 'La Pi responde',
      fallida: 'No se pudo entrar a la Pi',
      huella: 'Huella guardada',
      quitarConfirmar: '¿Seguro? Se borran la contraseña y la huella guardadas.',
      checks: { connect: 'Acceso', hostKey: 'Huella', system: 'Máquina', claude: 'Claude Code' },
      instalar: {
        titulo: 'Analizador en la Pi',
        descripcion: 'Instala o actualiza el analizador. Tarda varios minutos y este usuario necesita sudo.',
        token: 'Token de Claude Code',
        tokenAyuda: 'Generalo con `claude setup-token` en una máquina con tu sesión de Claude.',
        tokenGuardado: 'Guardado. Dejalo vacío para no cambiarlo.',
        boton: 'Instalar en la Pi',
        actualizar: 'Actualizar la Pi',
        confirmar:
          'Va a crear sus propios usuarios y carpetas en /opt, /var/lib y /etc, y dos servicios. No toca nada más de la máquina. ¿Comparaste la huella con la de tu Pi?',
        confirmarSi: 'Sí, instalar',
        corriendo: 'Instalando…',
        listo: 'Instalación terminada',
        fallo: 'La instalación no terminó',
        version: 'Versión',
        detalle: 'Ver detalle',
        pasos: {
          connect: 'Entrando a la Pi',
          prepare: 'Revisando la máquina',
          users: 'Creando usuarios y carpetas',
          node: 'Instalando Node',
          build: 'Compilando el analizador',
          claude: 'Instalando Claude Code',
          config: 'Guardando la configuración',
          services: 'Arrancando los servicios',
          verify: 'Revisando que hayan arrancado',
        },
      },
    },
    checks: {
      connect: 'Conexión',
      tls: 'Cifrado',
      grants: 'Permisos',
      views: 'Vistas',
      read: 'Lectura',
    },
  },
  en: {
    titulo: 'Production connection',
    subtitulo: 'The analyzer uses this connection to query production data during investigations',
    host: 'IP or host',
    puerto: 'Port',
    usuario: 'User',
    contrasena: 'Password',
    contrasenaGuardada: 'Saved. Leave it empty to keep it.',
    base: 'Database',
    aviso: 'Use the read-only user of the masked views. A user with broader permissions is rejected.',
    guardar: 'Save and test',
    guardando: 'Saving…',
    probar: 'Test again',
    quitar: 'Remove connection',
    quitarConfirmar: 'Are you sure? The database stops being queried until it is set up again.',
    quitarSi: 'Yes, remove',
    cancelar: 'Cancel',
    error: "Couldn't save. Try again.",
    estado: 'Production connection test',
    pendiente: 'Testing from the Pi…',
    correcta: 'Connection OK',
    fallida: "The connection failed the test and won't be used",
    piOnline: 'The analyzer is running on the Pi',
    piOffline: "The analyzer isn't responding on the Pi. The test runs when it returns.",
    ipFirewall: 'MySQL must allow connections from',
    sinPrueba: 'No connection saved yet.',
    pi: {
      titulo: 'Raspberry Pi',
      subtitulo: 'The machine that runs the analyzer',
      host: 'Public IP or host',
      puerto: 'SSH port',
      aviso: 'The Aditum Chat server logs in over SSH, so the router has to forward this port to the Pi.',
      pendiente: 'Logging in to the Pi…',
      correcta: 'The Pi responds',
      fallida: "Couldn't log in to the Pi",
      huella: 'Saved fingerprint',
      quitarConfirmar: 'Are you sure? The saved password and fingerprint are deleted.',
      checks: { connect: 'Access', hostKey: 'Fingerprint', system: 'Machine', claude: 'Claude Code' },
      instalar: {
        titulo: 'Analyzer on the Pi',
        descripcion: 'Installs or updates the analyzer. It takes several minutes and this user needs sudo.',
        token: 'Claude Code token',
        tokenAyuda: 'Generate it with `claude setup-token` on a machine signed in to Claude.',
        tokenGuardado: 'Saved. Leave it empty to keep it.',
        boton: 'Install on the Pi',
        actualizar: 'Update the Pi',
        confirmar:
          'It creates its own users and folders in /opt, /var/lib and /etc, and two services. Nothing else on the machine changes. Did you compare the fingerprint with your Pi?',
        confirmarSi: 'Yes, install',
        corriendo: 'Installing…',
        listo: 'Install finished',
        fallo: "The install didn't finish",
        version: 'Version',
        detalle: 'Show details',
        pasos: {
          connect: 'Logging in to the Pi',
          prepare: 'Checking the machine',
          users: 'Creating users and folders',
          node: 'Installing Node',
          build: 'Building the analyzer',
          claude: 'Installing Claude Code',
          config: 'Saving the settings',
          services: 'Starting the services',
          verify: 'Checking they started',
        },
      },
    },
    checks: {
      connect: 'Connection',
      tls: 'Encryption',
      grants: 'Permissions',
      views: 'Views',
      read: 'Read',
    },
  },
} as const;

const inputClass = 'w-full rounded-lg border border-warm-border px-2.5 py-2 text-[13px] outline-none focus:border-navy';

function CheckRow({ check, label }: { check: InvestigatorDbCheck | InvestigatorPiCheck; label: string }) {
  return (
    <li className="flex items-start gap-2 text-[12.5px]">
      <span className={`msr flex-none text-[17px] ${check.ok ? 'text-ok' : 'text-warn-dark'}`}>
        {check.ok ? 'check_circle' : 'error'}
      </span>
      <span className="min-w-0">
        <span className="font-semibold">{label}: </span>
        <span className="break-words text-ink-2">{check.detail}</span>
      </span>
    </li>
  );
}

function PiInstallSection({ idioma, config }: { idioma: Idioma; config: InvestigatorPiConfig }) {
  const m = M[idioma].pi.instalar;
  const [token, setToken] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const install = config.install;
  const running = calling || install?.status === 'running';
  const canInstall = (token.trim() || config.hasClaudeToken) && !running;

  async function start() {
    setConfirming(false);
    setCalling(true);
    setError(null);
    try {
      await installInvestigatorOnPi(token.trim());
      setToken('');
    } catch (e) {
      setError((e as { message?: string }).message || M[idioma].error);
    } finally {
      setCalling(false);
    }
  }

  return (
    <div className="mt-4 space-y-3 border-t border-warm-border pt-3" data-testid="pi-install">
      <div>
        <p className="text-[13px] font-bold">{m.titulo}</p>
        <p className="text-[11.5px] text-warm-gray">{m.descripcion}</p>
      </div>
      <Campo label={m.token}>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="new-password"
          placeholder={config.hasClaudeToken ? m.tokenGuardado : ''}
          className={inputClass}
        />
      </Campo>
      <p className="text-[11.5px] text-warm-gray">{m.tokenAyuda}</p>
      {error && <p className="text-[12px] text-warn-dark">{error}</p>}
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-warn-bg p-2 text-[12px] text-warn-dark">
          <span className="min-w-0 flex-1 basis-64">{m.confirmar}</span>
          <button type="button" onClick={() => setConfirming(false)} className="font-semibold hover:underline">
            {M[idioma].cancelar}
          </button>
          <button type="button" onClick={() => void start()} className="font-bold hover:underline">
            {m.confirmarSi}
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={!canInstall}
          onClick={() => setConfirming(true)}
          className="rounded-lg bg-navy px-3.5 py-2 text-[12.5px] font-semibold text-white hover:brightness-110 disabled:opacity-40"
        >
          {running ? m.corriendo : install?.status === 'ok' ? m.actualizar : m.boton}
        </button>
      )}
      {install && (
        <div data-testid="pi-install-status">
          <p
            className={`text-[13px] font-bold ${
              install.status === 'ok' ? 'text-ok-dark' : install.status === 'failed' ? 'text-warn-dark' : 'text-ink-2'
            }`}
          >
            {install.status === 'ok'
              ? m.listo
              : install.status === 'failed'
                ? m.fallo
                : `${m.pasos[install.step as InvestigatorPiInstallStep]}…`}
          </p>
          {install.status === 'failed' && (
            <p className="mt-1 text-[12px] text-ink-2">
              {m.pasos[install.step as InvestigatorPiInstallStep]}
              {install.detail ? `: ${install.detail}` : ''}
            </p>
          )}
          {install.commit && (
            <p className="mt-1 text-[11px] text-warm-gray">
              {m.version}: <span className="font-mono">{install.commit.slice(0, 8)}</span>
            </p>
          )}
          {install.finishedAt != null && <p className="mt-1 text-[11px] text-warm-gray">{fmtFecha(install.finishedAt, true)}</p>}
          {install.log.length > 0 && (
            <details className="mt-2" open={install.status === 'failed'}>
              <summary className="cursor-pointer text-[12px] font-semibold text-ink-2">{m.detalle}</summary>
              <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-cream-1 p-2 font-mono text-[11px] text-ink-2">
                {install.log.join('\n')}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function PiCard({ idioma }: { idioma: Idioma }) {
  const m = M[idioma];
  const saved = useDoc<InvestigatorPiConfig>('investigator/pi');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [loadedVersion, setLoadedVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Carga lo guardado una vez por versión, para no pisar lo que se está escribiendo.
  const version = saved?.data.version ?? null;
  useEffect(() => {
    if (!saved || version === loadedVersion) return;
    setHost(saved.data.host);
    setPort(String(saved.data.port));
    setUser(saved.data.user);
    setPassword('');
    setLoadedVersion(version);
  }, [saved, version, loadedVersion]);

  const hasSaved = Boolean(saved);
  const canSave = host.trim() && user.trim() && (password || hasSaved) && !busy;
  const test = saved?.data.test;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as { message?: string }).message || m.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card icon="developer_board" title={m.pi.titulo} subtitle={m.pi.subtitulo}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => saveInvestigatorPi({ host: host.trim(), port: Number(port), user: user.trim(), password }));
        }}
        className="space-y-3"
        autoComplete="off"
        data-testid="pi-form"
      >
        <div className="grid grid-cols-[1fr_96px] gap-3">
          <Campo label={m.pi.host}>
            <input value={host} onChange={(e) => setHost(e.target.value)} className={inputClass} spellCheck={false} />
          </Campo>
          <Campo label={m.pi.puerto}>
            <input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" className={inputClass} />
          </Campo>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo label={m.usuario}>
            <input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" spellCheck={false} className={inputClass} />
          </Campo>
          <Campo label={m.contrasena}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder={hasSaved ? m.contrasenaGuardada : ''}
              className={inputClass}
            />
          </Campo>
        </div>
        <p className="text-[11.5px] text-warm-gray">{m.pi.aviso}</p>
        {error && <p className="text-[12px] text-warn-dark">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={!canSave}
            className="rounded-lg bg-navy px-3.5 py-2 text-[12.5px] font-semibold text-white hover:brightness-110 disabled:opacity-40"
          >
            {busy ? m.pi.pendiente : m.guardar}
          </button>
          {hasSaved && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(testInvestigatorPi)}
              className="rounded-lg border border-warm-border px-3.5 py-2 text-[12.5px] font-semibold hover:border-navy disabled:opacity-40"
            >
              {m.probar}
            </button>
          )}
          {hasSaved && !confirmRemove && (
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              className="ml-auto text-[12px] font-semibold text-warn-dark hover:underline"
            >
              {m.quitar}
            </button>
          )}
        </div>
        {confirmRemove && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-warn-bg p-2 text-[12px] text-warn-dark">
            <span className="flex-1">{m.pi.quitarConfirmar}</span>
            <button type="button" onClick={() => setConfirmRemove(false)} className="font-semibold hover:underline">
              {m.cancelar}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmRemove(false);
                setLoadedVersion(null);
                setHost('');
                setPort('22');
                setUser('');
                setPassword('');
                void run(removeInvestigatorPi);
              }}
              className="font-bold hover:underline"
            >
              {m.quitarSi}
            </button>
          </div>
        )}
      </form>

      {test && (
        <div className="mt-4 border-t border-warm-border pt-3" data-testid="pi-status">
          <p
            className={`text-[13px] font-bold ${
              test.status === 'ok' ? 'text-ok-dark' : test.status === 'failed' ? 'text-warn-dark' : 'text-ink-2'
            }`}
          >
            {test.status === 'ok' ? m.pi.correcta : test.status === 'failed' ? m.pi.fallida : m.pi.pendiente}
          </p>
          {test.status !== 'pending' && (
            <>
              <ul className="mt-2 space-y-1.5">
                {(test.checks ?? []).map((check) => (
                  <CheckRow key={check.id} check={check} label={m.pi.checks[check.id]} />
                ))}
              </ul>
              {saved?.data.hostKeyFingerprint && (
                <p className="mt-2 break-all text-[11px] text-warm-gray">
                  {m.pi.huella}: <span className="font-mono">{saved.data.hostKeyFingerprint}</span>
                </p>
              )}
              {test.finishedAt != null && <p className="mt-1 text-[11px] text-warm-gray">{fmtFecha(test.finishedAt, true)}</p>}
            </>
          )}
        </div>
      )}
      {saved?.data.hostKeyFingerprint && test?.status === 'ok' && <PiInstallSection idioma={idioma} config={saved.data} />}
    </Card>
  );
}

export function AnalizadorTab() {
  const { agent } = useAuth();
  const idioma: Idioma = agent?.idioma ?? 'es';
  const m = M[idioma];
  const saved = useDoc<InvestigatorDbConfig>('investigator/db');
  const gatewayDoc = useDoc<InvestigatorGatewayState>('investigator/gateway');
  const gatewayOnline = useGatewayOnline(gatewayDoc?.data ?? null);

  const [host, setHost] = useState('');
  const [port, setPort] = useState('3306');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [database, setDatabase] = useState('aditum_ro');
  const [loadedVersion, setLoadedVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Carga lo guardado una vez por versión, para no pisar lo que se está escribiendo.
  const version = saved?.data.version ?? null;
  useEffect(() => {
    if (!saved || version === loadedVersion) return;
    setHost(saved.data.host);
    setPort(String(saved.data.port));
    setUser(saved.data.user);
    setDatabase(saved.data.database);
    setPassword('');
    setLoadedVersion(version);
  }, [saved, version, loadedVersion]);

  const hasSaved = Boolean(saved);
  const canSave = host.trim() && user.trim() && database.trim() && (password || hasSaved) && !busy;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as { message?: string }).message || m.error);
    } finally {
      setBusy(false);
    }
  }

  const test = saved?.data.test;

  return (
    <div className="max-w-2xl space-y-4">
      <PiCard idioma={idioma} />
      <Card icon="database" title={m.titulo} subtitle={m.subtitulo}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(() =>
              saveInvestigatorDb({ host: host.trim(), port: Number(port), user: user.trim(), database: database.trim(), password }),
            );
          }}
          className="space-y-3"
          autoComplete="off"
        >
          <div className="grid grid-cols-[1fr_96px] gap-3">
            <Campo label={m.host}>
              <input value={host} onChange={(e) => setHost(e.target.value)} className={inputClass} spellCheck={false} />
            </Campo>
            <Campo label={m.puerto}>
              <input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" className={inputClass} />
            </Campo>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label={m.usuario}>
              <input
                value={user}
                onChange={(e) => setUser(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className={inputClass}
              />
            </Campo>
            <Campo label={m.base}>
              <input value={database} onChange={(e) => setDatabase(e.target.value)} spellCheck={false} className={inputClass} />
            </Campo>
          </div>
          <Campo label={m.contrasena}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder={hasSaved ? m.contrasenaGuardada : ''}
              className={inputClass}
            />
          </Campo>
          <p className="text-[11.5px] text-warm-gray">{m.aviso}</p>
          {error && <p className="text-[12px] text-warn-dark">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={!canSave}
              className="rounded-lg bg-navy px-3.5 py-2 text-[12.5px] font-semibold text-white hover:brightness-110 disabled:opacity-40"
            >
              {busy ? m.guardando : m.guardar}
            </button>
            {hasSaved && (
              <button
                type="button"
                disabled={busy || test?.status === 'pending'}
                onClick={() => void run(testInvestigatorDb)}
                className="rounded-lg border border-warm-border px-3.5 py-2 text-[12.5px] font-semibold hover:border-navy disabled:opacity-40"
              >
                {m.probar}
              </button>
            )}
            {hasSaved && !confirmRemove && (
              <button
                type="button"
                onClick={() => setConfirmRemove(true)}
                className="ml-auto text-[12px] font-semibold text-warn-dark hover:underline"
              >
                {m.quitar}
              </button>
            )}
          </div>
          {confirmRemove && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-warn-bg p-2 text-[12px] text-warn-dark">
              <span className="flex-1">{m.quitarConfirmar}</span>
              <button type="button" onClick={() => setConfirmRemove(false)} className="font-semibold hover:underline">
                {m.cancelar}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmRemove(false);
                  setLoadedVersion(null);
                  setHost('');
                  setUser('');
                  setPassword('');
                  void run(removeInvestigatorDb);
                }}
                className="font-bold hover:underline"
              >
                {m.quitarSi}
              </button>
            </div>
          )}
        </form>
      </Card>

      <Card icon="lan" title={m.estado}>
        <p className={`text-[12.5px] ${gatewayOnline ? 'text-ok-dark' : 'text-warn-dark'}`}>
          {gatewayOnline ? m.piOnline : m.piOffline}
        </p>
        {gatewayOnline && gatewayDoc?.data.publicIp && (
          <p className="mt-1 text-[12.5px] text-ink-2">
            {m.ipFirewall} <span className="font-mono font-semibold">{gatewayDoc.data.publicIp}</span>
          </p>
        )}
        {!test ? (
          <p className="mt-3 text-[12.5px] text-warm-gray">{m.sinPrueba}</p>
        ) : (
          <div className="mt-3">
            <p
              className={`text-[13px] font-bold ${
                test.status === 'ok' ? 'text-ok-dark' : test.status === 'failed' ? 'text-warn-dark' : 'text-ink-2'
              }`}
            >
              {test.status === 'ok' ? m.correcta : test.status === 'failed' ? m.fallida : m.pendiente}
            </p>
            {test.status !== 'pending' && (
              <>
                <ul className="mt-2 space-y-1.5">
                  {(test.checks ?? []).map((check) => (
                    <CheckRow key={check.id} check={check} label={m.checks[check.id]} />
                  ))}
                </ul>
                {test.finishedAt != null && <p className="mt-2 text-[11px] text-warm-gray">{fmtFecha(test.finishedAt, true)}</p>}
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
