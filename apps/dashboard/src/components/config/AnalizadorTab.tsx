'use client';

// Tab "Analizador" de /configuracion: cómo llegar a la Raspberry Pi y su conexión a la base de producción.
// Las contraseñas nunca vuelven al navegador. La Pi se prueba desde el servidor; MySQL, desde la Pi.

import { useEffect, useState } from 'react';
import type {
  Idioma,
  InvestigatorBacklogConfig,
  InvestigatorDbCheck,
  InvestigatorDbConfig,
  InvestigatorGatewayState,
  InvestigatorPiCheck,
  InvestigatorPiConfig,
  InvestigatorPiInstallStep,
  InvestigatorWriterConfig,
  InvestigatorWriterState,
  InvestigatorWritesSwitch,
} from '@aditum-chat/shared';
import { useAuth } from '@/lib/auth';
import { fmtFecha, useDoc } from '@/lib/data';
import {
  installInvestigatorOnPi,
  removeInvestigatorBacklog,
  removeInvestigatorDb,
  removeInvestigatorPi,
  saveInvestigatorBacklog,
  saveInvestigatorDb,
  saveInvestigatorPi,
  testInvestigatorBacklog,
  testInvestigatorDb,
  testInvestigatorPi,
  useGatewayOnline,
} from '@/lib/data-investigations';
import {
  removeInvestigatorWriter,
  saveInvestigatorWriter,
  setWritesEnabled,
  testInvestigatorWriter,
  useWriteAudit,
} from '@/lib/data-writes';
import { Campo } from './ui';

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
    aviso: 'Usá un usuario de solo lectura sobre esta base. Si tiene más permisos, la conexión se rechaza.',
    guardar: 'Guardar y probar',
    guardando: 'Guardando…',
    probar: 'Probar de nuevo',
    quitar: 'Quitar conexión',
    quitarConfirmar: '¿Seguro? La base no se va a consultar hasta volver a configurarla.',
    quitarSi: 'Sí, quitar',
    cancelar: 'Cancelar',
    error: 'No se pudo guardar. Intentá de nuevo.',
    pendiente: 'Probando desde la Pi…',
    correcta: 'Conexión correcta',
    fallida: 'La conexión no pasó la prueba y no se va a usar',
    piOnline: 'El analizador está activo en la Pi',
    ipFirewall: 'MySQL debe permitir conexiones desde',
    sinPrueba: 'Todavía no hay una conexión guardada.',
    piApagada: 'El analizador no responde en la Pi, así que la prueba corre cuando vuelva.',
    escrituras: {
      titulo: 'Escrituras en producción',
      subtitulo: 'Con esta conexión se aplican los cambios que un admin aprueba en una investigación',
      aviso: 'Creá este usuario con los GRANT por tabla de create-write-user.sql: esas tablas son todo lo que puede tocar. Se rechaza si tiene algo más que SELECT, INSERT o UPDATE por tabla.',
      contrasenaGuardada: 'Guardada. Hay que volver a escribirla si cambiás el host, el usuario o el certificado.',
      host: 'Host',
      ca: 'Certificado del servidor (PEM)',
      caGuardado: 'Guardado. Dejalo vacío para no cambiarlo.',
      caAyuda: 'Sin este certificado no se conecta. Usá en el host el nombre que aparece en el certificado, no una IP.',
      sinPrueba: 'Todavía no hay conexión de escritura.',
      pendiente: 'Probando desde la Pi…',
      correcta: 'Conexión correcta',
      fallida: 'No se puede usar esta conexión',
      tablas: 'Tablas que puede tocar',
      writerConectado: 'Writer conectado',
      writerDesconectado: 'El writer de la Pi no está conectado',
      ipSalida: 'Sale a internet con la IP {ip}',
      interruptor: 'Escrituras encendidas',
      interruptorAyuda: 'Apagadas no se puede ensayar ni aplicar nada. Cambiar la conexión las apaga.',
      encender: 'Encender',
      apagar: 'Apagar',
      encendidas: 'Encendidas por {name}',
      apagadas: 'Apagadas',
      registro: 'Registro reciente',
      sinRegistro: 'Todavía no hay movimientos.',
      quitar: 'Quitar conexión',
      quitarConfirmar: '¿Seguro? Se borra la contraseña y las escrituras se apagan.',
      eventos: {
        rehearsal_requested: 'Pidió un ensayo',
        rehearsed: 'Ensayo correcto',
        rehearsal_failed: 'El ensayo falló',
        step_confirmed: 'Confirmó un paso',
        approval_cancelled: 'Canceló la aprobación',
        execution_requested: 'Pidió aplicarlo',
        executed: 'Aplicado en producción',
        aborted: 'No se aplicó',
        unknown: 'Resultado desconocido',
        switch_changed: 'Cambió el interruptor',
        reversal_proposed: 'Preparó una reversa',
      },
    },
    backlog: {
      titulo: 'Backlog en Notion',
      subtitulo: 'Adonde van los bugs que encuentra una investigación',
      tablero: 'Enlace del tablero',
      token: 'Token de la integración',
      tokenGuardado: 'Guardado. Dejalo vacío para no cambiarlo.',
      aviso: 'En Notion, conectá la integración al tablero desde el menú de conexiones. Necesita leer e insertar contenido.',
      sinPrueba: 'Todavía no hay un tablero conectado. Mientras tanto, las investigaciones no ofrecen agregar el bug.',
      correcta: 'Tablero conectado',
      fallida: 'No se pudo usar este tablero',
      quitar: 'Quitar tablero',
      quitarConfirmar: '¿Seguro? Las investigaciones dejan de ofrecer agregar el bug.',
    },
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
      sinPrueba: 'Guardá la conexión para probar que se pueda entrar.',
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
          'Va a crear sus propios usuarios y carpetas en /opt, /var/lib y /etc, y tres servicios. No toca nada más de la máquina. ¿Comparaste la huella con la de tu Pi?',
        confirmarSi: 'Sí, instalar',
        corriendo: 'Instalando…',
        listo: 'Instalación terminada',
        fallo: 'La instalación no terminó',
        version: 'Versión',
        detalle: 'Ver detalle',
        bloqueado: 'Se puede instalar cuando la Pi responda.',
        sinInstalar: 'Todavía no se ha instalado.',
        noResponde: 'El analizador no responde en la Pi',
        ultima: 'Última instalación',
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
      tables: 'Tablas',
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
    aviso: 'Use a read-only user on this database. A user with broader permissions is rejected.',
    guardar: 'Save and test',
    guardando: 'Saving…',
    probar: 'Test again',
    quitar: 'Remove connection',
    quitarConfirmar: 'Are you sure? The database stops being queried until it is set up again.',
    quitarSi: 'Yes, remove',
    cancelar: 'Cancel',
    error: "Couldn't save. Try again.",
    pendiente: 'Testing from the Pi…',
    correcta: 'Connection OK',
    fallida: "The connection failed the test and won't be used",
    piOnline: 'The analyzer is running on the Pi',
    ipFirewall: 'MySQL must allow connections from',
    sinPrueba: 'No connection saved yet.',
    piApagada: "The analyzer isn't responding on the Pi, so the test runs when it returns.",
    escrituras: {
      titulo: 'Production writes',
      subtitulo: 'This connection applies the changes an admin approves in an investigation',
      aviso: 'Create this user with the per-table GRANTs in create-write-user.sql: those tables are all it can touch. It is refused if it has anything beyond SELECT, INSERT or UPDATE per table.',
      contrasenaGuardada: 'Saved. Type it again if you change the host, the user or the certificate.',
      host: 'Host',
      ca: 'Server certificate (PEM)',
      caGuardado: 'Saved. Leave it empty to keep it.',
      caAyuda: 'It will not connect without this certificate. Use the name on the certificate as the host, not an IP.',
      sinPrueba: 'There is no write connection yet.',
      pendiente: 'Testing from the Pi…',
      correcta: 'Connection works',
      fallida: 'This connection cannot be used',
      tablas: 'Tables it can touch',
      writerConectado: 'Writer connected',
      writerDesconectado: 'The writer on the Pi is not connected',
      ipSalida: 'It reaches the internet from {ip}',
      interruptor: 'Writes on',
      interruptorAyuda: 'While off, nothing can be rehearsed or applied. Changing the connection turns them off.',
      encender: 'Turn on',
      apagar: 'Turn off',
      encendidas: 'Turned on by {name}',
      apagadas: 'Off',
      registro: 'Recent log',
      sinRegistro: 'Nothing yet.',
      quitar: 'Remove connection',
      quitarConfirmar: 'Sure? The password is deleted and writes turn off.',
      eventos: {
        rehearsal_requested: 'Requested a rehearsal',
        rehearsed: 'Rehearsal passed',
        rehearsal_failed: 'Rehearsal failed',
        step_confirmed: 'Confirmed a step',
        approval_cancelled: 'Cancelled the approval',
        execution_requested: 'Requested applying it',
        executed: 'Applied in production',
        aborted: 'Not applied',
        unknown: 'Unknown outcome',
        switch_changed: 'Changed the switch',
        reversal_proposed: 'Prepared a reversal',
      },
    },
    backlog: {
      titulo: 'Backlog in Notion',
      subtitulo: 'Where the bugs an investigation finds go',
      tablero: 'Board link',
      token: 'Integration token',
      tokenGuardado: 'Saved. Leave it empty to keep it.',
      aviso: 'In Notion, connect the integration to the board from its connections menu. It needs to read and insert content.',
      sinPrueba: "No board connected yet. Until then, investigations won't offer to add the bug.",
      correcta: 'Board connected',
      fallida: "This board can't be used",
      quitar: 'Remove board',
      quitarConfirmar: "Are you sure? Investigations will stop offering to add the bug.",
    },
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
      sinPrueba: 'Save the connection to test the login.',
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
          'It creates its own users and folders in /opt, /var/lib and /etc, and three services. Nothing else on the machine changes. Did you compare the fingerprint with your Pi?',
        confirmarSi: 'Yes, install',
        corriendo: 'Installing…',
        listo: 'Install finished',
        fallo: "The install didn't finish",
        version: 'Version',
        detalle: 'Show details',
        bloqueado: 'You can install it once the Pi responds.',
        sinInstalar: "It hasn't been installed yet.",
        noResponde: "The analyzer isn't responding on the Pi",
        ultima: 'Last install',
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
      tables: 'Tables',
      read: 'Read',
    },
  },
} as const;

const inputClass = 'w-full rounded-lg border border-warm-border px-2.5 py-2 text-[13px] outline-none focus:border-navy';
const primaryButton =
  'rounded-lg bg-navy px-3.5 py-2 text-[12.5px] font-semibold text-white hover:brightness-110 disabled:opacity-40';
const secondaryButton =
  'rounded-lg border border-warm-border px-3.5 py-2 text-[12.5px] font-semibold hover:border-navy disabled:opacity-40';

type Tone = 'ok' | 'bad' | 'pending';

const TONE_TEXT: Record<Tone, string> = { ok: 'text-ok-dark', bad: 'text-warn-dark', pending: 'text-ink-2' };
const TONE_DOT: Record<Tone, string> = { ok: 'bg-ok', bad: 'bg-warn', pending: 'bg-warm-gray-3 motion-safe:animate-pulse' };

const toneOf = (status: 'ok' | 'failed' | string): Tone => (status === 'ok' ? 'ok' : status === 'failed' ? 'bad' : 'pending');

/** What to set up on the left, and what came of it on the right. */
function Section({
  icon,
  title,
  subtitle,
  status,
  children,
  testId,
}: {
  icon: string;
  title: string;
  subtitle: string;
  status: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      className="overflow-hidden rounded-lg border border-warm-border bg-white shadow-card lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
    >
      <div className="min-w-0 p-5">
        <header className="mb-4 flex items-start gap-2.5">
          <span className="msr mt-0.5 text-[19px] text-navy">{icon}</span>
          <div>
            <h3 className="text-[14px] font-bold text-ink">{title}</h3>
            <p className="mt-0.5 text-[12px] text-warm-gray">{subtitle}</p>
          </div>
        </header>
        {children}
      </div>
      <div className="min-w-0 border-t border-cream-3 bg-cream-1 p-5 lg:border-l lg:border-t-0">{status}</div>
    </section>
  );
}

function StatusTitle({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <p className={`flex items-start gap-2 text-[13px] font-bold leading-snug ${TONE_TEXT[tone]}`}>
      <span aria-hidden className={`mt-[5px] h-2 w-2 flex-none rounded-full ${TONE_DOT[tone]}`} />
      {children}
    </p>
  );
}

function StatusEmpty({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] leading-relaxed text-warm-gray">{children}</p>;
}

function CheckList({ children }: { children: React.ReactNode }) {
  return <ul className="mt-3 space-y-2">{children}</ul>;
}

function Meta({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-[11.5px] leading-relaxed text-warm-gray">{children}</p>;
}

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

function ConfirmBar({
  text,
  cancel,
  confirm,
  onCancel,
  onConfirm,
}: {
  text: string;
  cancel: string;
  confirm: string;
  onCancel(): void;
  onConfirm(): void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-warn-bg px-3 py-2 text-[12px] text-warn-dark">
      <span className="min-w-0 flex-1 basis-64">{text}</span>
      <button type="button" onClick={onCancel} className="font-semibold hover:underline">
        {cancel}
      </button>
      <button type="button" onClick={onConfirm} className="font-bold hover:underline">
        {confirm}
      </button>
    </div>
  );
}

/** Text with `code` in backticks. */
function WithCode({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, i) =>
        i % 2 ? (
          <code key={i} className="rounded bg-cream-2 px-1 font-mono text-[11px] text-ink-2">
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

function PiStatus({ idioma, config }: { idioma: Idioma; config: InvestigatorPiConfig | null }) {
  const m = M[idioma];
  const test = config?.test;
  if (!test) return <StatusEmpty>{m.pi.sinPrueba}</StatusEmpty>;
  return (
    <div data-testid="pi-status">
      <StatusTitle tone={toneOf(test.status)}>
        {test.status === 'ok' ? m.pi.correcta : test.status === 'failed' ? m.pi.fallida : m.pi.pendiente}
      </StatusTitle>
      {test.status !== 'pending' && (
        <>
          <CheckList>
            {(test.checks ?? []).map((check) => (
              <CheckRow key={check.id} check={check} label={m.pi.checks[check.id]} />
            ))}
          </CheckList>
          <div className="mt-3">
            {config?.hostKeyFingerprint && (
              <Meta>
                {m.pi.huella}: <span className="break-all font-mono text-[11px]">{config.hostKeyFingerprint}</span>
              </Meta>
            )}
            {test.finishedAt != null && <Meta>{fmtFecha(test.finishedAt, true)}</Meta>}
          </div>
        </>
      )}
    </div>
  );
}

function AnalyzerStatus({
  idioma,
  config,
  gatewayOnline,
}: {
  idioma: Idioma;
  config: InvestigatorPiConfig | null;
  gatewayOnline: boolean;
}) {
  const m = M[idioma];
  const steps = m.pi.instalar;
  const install = config?.install;
  const step = install ? steps.pasos[install.step as InvestigatorPiInstallStep] : '';
  return (
    <div data-testid="pi-install-status">
      {install?.status === 'running' ? (
        <StatusTitle tone="pending">{step}…</StatusTitle>
      ) : install?.status === 'failed' ? (
        <>
          <StatusTitle tone="bad">{steps.fallo}</StatusTitle>
          <p className="mt-1.5 pl-4 text-[12.5px] text-ink-2">
            {step}
            {install.detail ? `: ${install.detail}` : ''}
          </p>
          {gatewayOnline && <p className="mt-1.5 pl-4 text-[12.5px] text-ink-2">{m.piOnline}</p>}
        </>
      ) : gatewayOnline ? (
        <StatusTitle tone="ok">{m.piOnline}</StatusTitle>
      ) : install ? (
        <StatusTitle tone="bad">{steps.noResponde}</StatusTitle>
      ) : (
        <StatusEmpty>{steps.sinInstalar}</StatusEmpty>
      )}
      {install && (
        <div className="mt-3">
          {install.commit && (
            <Meta>
              {steps.version}: <span className="font-mono text-[11px]">{install.commit.slice(0, 8)}</span>
            </Meta>
          )}
          {install.finishedAt != null && (
            <Meta>
              {steps.ultima}: {fmtFecha(install.finishedAt, true)}
            </Meta>
          )}
          {install.log.length > 0 && (
            <details className="mt-2" open={install.status === 'failed'}>
              <summary className="cursor-pointer text-[12px] font-semibold text-ink-2">{steps.detalle}</summary>
              <pre className="mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-cream-3 bg-white p-2 font-mono text-[11px] text-ink-2">
                {install.log.join('\n')}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function DbStatus({
  idioma,
  test,
  gatewayOnline,
  publicIp,
}: {
  idioma: Idioma;
  test?: InvestigatorDbConfig['test'];
  gatewayOnline: boolean;
  publicIp?: string | null;
}) {
  const m = M[idioma];
  return (
    <div>
      {!test ? (
        <StatusEmpty>{m.sinPrueba}</StatusEmpty>
      ) : (
        <>
          <StatusTitle tone={toneOf(test.status)}>
            {test.status === 'ok' ? m.correcta : test.status === 'failed' ? m.fallida : m.pendiente}
          </StatusTitle>
          {test.status !== 'pending' && (
            <CheckList>
              {(test.checks ?? []).map((check) => (
                <CheckRow key={check.id} check={check} label={m.checks[check.id]} />
              ))}
            </CheckList>
          )}
        </>
      )}
      <div className="mt-3">
        {!gatewayOnline && <p className="text-[12.5px] text-warn-dark">{m.piApagada}</p>}
        {gatewayOnline && publicIp && (
          <Meta>
            {m.ipFirewall} <span className="font-mono text-[11px] font-semibold text-ink-2">{publicIp}</span>
          </Meta>
        )}
        {test && test.status !== 'pending' && test.finishedAt != null && <Meta>{fmtFecha(test.finishedAt, true)}</Meta>}
      </div>
    </div>
  );
}

function AnalyzerSection({
  idioma,
  config,
  gatewayOnline,
}: {
  idioma: Idioma;
  config: InvestigatorPiConfig | null;
  gatewayOnline: boolean;
}) {
  const m = M[idioma].pi.instalar;
  const [token, setToken] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const install = config?.install;
  const running = calling || install?.status === 'running';
  const canInstall = (token.trim() || config?.hasClaudeToken) && !running;
  const piReady = Boolean(config?.hostKeyFingerprint) && config?.test?.status === 'ok';

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
    <Section
      icon="deployed_code"
      title={m.titulo}
      subtitle={m.descripcion}
      testId="pi-install"
      status={<AnalyzerStatus idioma={idioma} config={config} gatewayOnline={gatewayOnline} />}
    >
      {!piReady ? (
        <StatusEmpty>{m.bloqueado}</StatusEmpty>
      ) : (
        <div className="space-y-3">
          <Campo label={m.token}>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="new-password"
              placeholder={config?.hasClaudeToken ? m.tokenGuardado : ''}
              className={inputClass}
            />
          </Campo>
          <p className="text-[11.5px] text-warm-gray">
            <WithCode text={m.tokenAyuda} />
          </p>
          {error && <p className="text-[12px] text-warn-dark">{error}</p>}
          {confirming ? (
            <ConfirmBar
              text={m.confirmar}
              cancel={M[idioma].cancelar}
              confirm={m.confirmarSi}
              onCancel={() => setConfirming(false)}
              onConfirm={() => void start()}
            />
          ) : (
            <button type="button" disabled={!canInstall} onClick={() => setConfirming(true)} className={primaryButton}>
              {running ? m.corriendo : install?.status === 'ok' ? m.actualizar : m.boton}
            </button>
          )}
        </div>
      )}
    </Section>
  );
}

function PiSection({ idioma, config }: { idioma: Idioma; config: InvestigatorPiConfig | null }) {
  const m = M[idioma];
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [loadedVersion, setLoadedVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Carga lo guardado una vez por versión, para no pisar lo que se está escribiendo.
  const version = config?.version ?? null;
  useEffect(() => {
    if (!config || version === loadedVersion) return;
    setHost(config.host);
    setPort(String(config.port));
    setUser(config.user);
    setPassword('');
    setLoadedVersion(version);
  }, [config, version, loadedVersion]);

  const hasSaved = Boolean(config);
  const canSave = host.trim() && user.trim() && (password || hasSaved) && !busy;

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
    <Section icon="developer_board" title={m.pi.titulo} subtitle={m.pi.subtitulo} status={<PiStatus idioma={idioma} config={config} />}>
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
          <button type="submit" disabled={!canSave} className={primaryButton}>
            {busy ? m.pi.pendiente : m.guardar}
          </button>
          {hasSaved && (
            <button type="button" disabled={busy} onClick={() => void run(testInvestigatorPi)} className={secondaryButton}>
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
          <ConfirmBar
            text={m.pi.quitarConfirmar}
            cancel={m.cancelar}
            confirm={m.quitarSi}
            onCancel={() => setConfirmRemove(false)}
            onConfirm={() => {
              setConfirmRemove(false);
              setLoadedVersion(null);
              setHost('');
              setPort('22');
              setUser('');
              setPassword('');
              void run(removeInvestigatorPi);
            }}
          />
        )}
      </form>
    </Section>
  );
}

const WRITER_OFFLINE_MS = 90_000;

function WriterSection({ idioma }: { idioma: Idioma }) {
  const m = M[idioma];
  const e = m.escrituras;
  const saved = useDoc<InvestigatorWriterConfig>('investigator/writer');
  const state = useDoc<InvestigatorWriterState>('investigator/writerState');
  const writes = useDoc<InvestigatorWritesSwitch>('investigator/writes');
  const audit = useWriteAudit(true);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('3306');
  const [user, setUser] = useState('');
  const [database, setDatabase] = useState('');
  const [password, setPassword] = useState('');
  const [ca, setCa] = useState('');
  const [loadedVersion, setLoadedVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const version = saved?.data.version ?? null;
  useEffect(() => {
    if (!saved || version === loadedVersion) return;
    setHost(saved.data.host);
    setPort(String(saved.data.port));
    setUser(saved.data.user);
    setDatabase(saved.data.database);
    setPassword('');
    setCa('');
    setLoadedVersion(version);
  }, [saved, version, loadedVersion]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError((err as { message?: string }).message || m.error);
    } finally {
      setBusy(false);
    }
  }

  const test = saved?.data.test;
  const hasSaved = Boolean(saved);
  const seen = (state?.data.lastSeenAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
  const online = now - seen < WRITER_OFFLINE_MS;
  const enabled = writes?.data.enabled === true;
  return (
    <Section
      icon="edit_note"
      title={e.titulo}
      subtitle={e.subtitulo}
      testId="writer-section"
      status={
        <>
          {!test ? (
            <StatusEmpty>{e.sinPrueba}</StatusEmpty>
          ) : (
            <>
              <StatusTitle tone={toneOf(test.status)}>{test.status === 'pending' ? e.pendiente : test.status === 'ok' ? e.correcta : e.fallida}</StatusTitle>
              {test.checks && (
                <ul className="mt-2 space-y-1 text-[12.5px] leading-snug text-ink-2">
                  {test.checks.map((check) => (
                    <li key={check.id} className={`break-words ${check.ok ? '' : 'text-warn-dark'}`}>{check.detail}</li>
                  ))}
                </ul>
              )}
              {(test.tables?.length ?? 0) > 0 && (
                <div className="mt-2.5">
                  <p className="text-[12px] font-semibold text-warm-gray">{e.tablas}</p>
                  <ul className="mt-0.5 space-y-0.5 text-[12px] leading-snug">
                    {test.tables!.map((table) => (
                      <li key={table.name} className="break-words"><span className="font-mono">{table.name}</span> <span className="text-warm-gray">{table.privileges.join(', ')}</span></li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          <p className={`mt-3 flex items-center gap-1.5 text-[12.5px] font-semibold ${online ? 'text-ok-dark' : 'text-warn-dark'}`}>
            {online ? e.writerConectado : e.writerDesconectado}
          </p>
          {state?.data.publicIp && <Meta>{e.ipSalida.replace('{ip}', state.data.publicIp)}</Meta>}
          <div className="mt-3 border-t border-cream-3 pt-3">
            <p className="text-[13px] font-bold text-ink">{enabled ? e.encendidas.replace('{name}', writes!.data.by) : e.apagadas}</p>
            <p className="mt-0.5 text-[12px] leading-snug text-warm-gray">{e.interruptorAyuda}</p>
            <button
              type="button"
              disabled={busy || (!enabled && test?.status !== 'ok')}
              onClick={() => void run(() => setWritesEnabled(!enabled))}
              className={`${enabled ? secondaryButton : primaryButton} mt-2`}
            >
              {enabled ? e.apagar : e.encender}
            </button>
          </div>
        </>
      }
    >
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          void run(async () => {
            await saveInvestigatorWriter({ host: host.trim(), port: Number(port), user: user.trim(), database: database.trim(), password, ca: ca.trim() });
            setPassword('');
            setCa('');
          });
        }}
        className="space-y-3"
        autoComplete="off"
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_100px]">
          <Campo label={e.host}>
            <input value={host} onChange={(ev) => setHost(ev.target.value)} spellCheck={false} className={inputClass} />
          </Campo>
          <Campo label={m.puerto}>
            <input value={port} onChange={(ev) => setPort(ev.target.value)} inputMode="numeric" className={inputClass} />
          </Campo>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo label={m.usuario}>
            <input value={user} onChange={(ev) => setUser(ev.target.value)} spellCheck={false} autoComplete="off" className={inputClass} />
          </Campo>
          <Campo label={m.base}>
            <input value={database} onChange={(ev) => setDatabase(ev.target.value)} spellCheck={false} className={inputClass} />
          </Campo>
        </div>
        <Campo label={m.contrasena}>
          <input
            type="password"
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
            autoComplete="new-password"
            placeholder={hasSaved ? e.contrasenaGuardada : ''}
            className={inputClass}
          />
        </Campo>
        <Campo label={e.ca}>
          <textarea
            value={ca}
            onChange={(ev) => setCa(ev.target.value)}
            rows={3}
            spellCheck={false}
            placeholder={saved?.data.hasCa ? e.caGuardado : '-----BEGIN CERTIFICATE-----'}
            className={`${inputClass} font-mono text-[11.5px]`}
          />
        </Campo>
        <p className="text-[11.5px] leading-snug text-warm-gray">{e.caAyuda}</p>
        <p className="text-[11.5px] leading-snug text-warm-gray">{e.aviso}</p>
        {error && <p className="text-[12px] text-warn-dark">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={!host.trim() || !user.trim() || !database.trim() || (!password && !hasSaved) || (!ca.trim() && !saved?.data.hasCa) || busy} className={primaryButton}>
            {busy ? m.guardando : m.guardar}
          </button>
          {hasSaved && (
            <button type="button" disabled={busy} onClick={() => void run(testInvestigatorWriter)} className={secondaryButton}>
              {m.probar}
            </button>
          )}
          {hasSaved && !confirmRemove && (
            <button type="button" onClick={() => setConfirmRemove(true)} className="ml-auto text-[12px] font-semibold text-warn-dark hover:underline">
              {e.quitar}
            </button>
          )}
        </div>
        {confirmRemove && (
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink">
            <span>{e.quitarConfirmar}</span>
            <button
              type="button"
              onClick={() => {
                setConfirmRemove(false);
                setLoadedVersion(null);
                setHost('');
                setUser('');
                setDatabase('');
                setPassword('');
                void run(removeInvestigatorWriter);
              }}
              className="font-semibold text-warn-dark hover:underline"
            >
              {e.quitar}
            </button>
            <button type="button" onClick={() => setConfirmRemove(false)} className="font-semibold text-warm-gray hover:underline">
              {m.cancelar}
            </button>
          </div>
        )}
      </form>
      <div className="mt-5 border-t border-cream-3 pt-3">
        <p className="text-[12.5px] font-semibold text-warm-gray">{e.registro}</p>
        {audit.length === 0 ? (
          <p className="mt-1 text-[12.5px] text-warm-gray">{e.sinRegistro}</p>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {audit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] leading-snug">
                <span className="font-semibold text-ink">{e.eventos[entry.data.event]}</span>
                {entry.data.by && <span className="text-ink-2">{entry.data.by.nombre}</span>}
                <span className="text-warm-gray">{fmtFecha(entry.data.at, true)}</span>
                {entry.data.detail && <span className="w-full break-words text-[12px] text-ink-2">{entry.data.detail}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

function BacklogSection({ idioma }: { idioma: Idioma }) {
  const m = M[idioma];
  const b = m.backlog;
  const saved = useDoc<InvestigatorBacklogConfig>('investigator/backlog');
  const [database, setDatabase] = useState('');
  const [token, setToken] = useState('');
  const [loadedVersion, setLoadedVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const version = saved?.data.version ?? null;
  useEffect(() => {
    if (!saved || version === loadedVersion) return;
    setDatabase(saved.data.databaseId);
    setToken('');
    setLoadedVersion(version);
  }, [saved, version, loadedVersion]);

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
  const hasSaved = Boolean(saved);
  return (
    <Section
      icon="view_kanban"
      title={b.titulo}
      subtitle={b.subtitulo}
      testId="backlog-section"
      status={
        !test ? (
          <StatusEmpty>{b.sinPrueba}</StatusEmpty>
        ) : (
          <>
            <StatusTitle tone={toneOf(test.status)}>{test.status === 'ok' ? b.correcta : b.fallida}</StatusTitle>
            {test.title && <Meta>{test.title}</Meta>}
            {test.problems.length > 0 && (
              <ul className="mt-2 space-y-1 text-[12.5px] leading-snug text-ink-2">
                {test.problems.map((problem) => <li key={problem} className="break-words">{problem}</li>)}
              </ul>
            )}
            <Meta>
              {saved!.data.updatedBy} · {fmtFecha(test.finishedAt, true)}
            </Meta>
          </>
        )
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await saveInvestigatorBacklog({ database: database.trim(), token: token.trim() });
            setToken('');
          });
        }}
        className="space-y-3"
        autoComplete="off"
      >
        <Campo label={b.tablero}>
          <input value={database} onChange={(e) => setDatabase(e.target.value)} spellCheck={false} className={inputClass} />
        </Campo>
        <Campo label={b.token}>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="new-password"
            placeholder={hasSaved ? b.tokenGuardado : ''}
            className={inputClass}
          />
        </Campo>
        <p className="text-[11.5px] text-warm-gray">{b.aviso}</p>
        {error && <p className="text-[12px] text-warn-dark">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={!database.trim() || (!token.trim() && !hasSaved) || busy} className={primaryButton}>
            {busy ? m.guardando : m.guardar}
          </button>
          {hasSaved && (
            <button type="button" disabled={busy} onClick={() => void run(testInvestigatorBacklog)} className={secondaryButton}>
              {m.probar}
            </button>
          )}
          {hasSaved && !confirmRemove && (
            <button type="button" onClick={() => setConfirmRemove(true)} className="ml-auto text-[12px] font-semibold text-warn-dark hover:underline">
              {b.quitar}
            </button>
          )}
        </div>
        {confirmRemove && (
          <ConfirmBar
            text={b.quitarConfirmar}
            cancel={m.cancelar}
            confirm={m.quitarSi}
            onCancel={() => setConfirmRemove(false)}
            onConfirm={() => {
              setConfirmRemove(false);
              setLoadedVersion(null);
              setDatabase('');
              setToken('');
              void run(removeInvestigatorBacklog);
            }}
          />
        )}
      </form>
    </Section>
  );
}

export function AnalizadorTab() {
  const { agent } = useAuth();
  const idioma: Idioma = agent?.idioma ?? 'es';
  const m = M[idioma];
  const saved = useDoc<InvestigatorDbConfig>('investigator/db');
  const pi = useDoc<InvestigatorPiConfig>('investigator/pi');
  const gatewayDoc = useDoc<InvestigatorGatewayState>('investigator/gateway');
  const gatewayOnline = useGatewayOnline(gatewayDoc?.data ?? null);

  const [host, setHost] = useState('');
  const [port, setPort] = useState('3306');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [database, setDatabase] = useState('');
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
  const piConfig = pi?.data ?? null;

  return (
    <div className="space-y-4">
      <PiSection idioma={idioma} config={piConfig} />
      <AnalyzerSection idioma={idioma} config={piConfig} gatewayOnline={gatewayOnline} />
      <Section
        icon="database"
        title={m.titulo}
        subtitle={m.subtitulo}
        status={<DbStatus idioma={idioma} test={test} gatewayOnline={gatewayOnline} publicIp={gatewayDoc?.data.publicIp} />}
      >
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
            <Campo label={m.base}>
              <input value={database} onChange={(e) => setDatabase(e.target.value)} spellCheck={false} className={inputClass} />
            </Campo>
            <Campo label={m.usuario}>
              <input
                value={user}
                onChange={(e) => setUser(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className={inputClass}
              />
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
            <button type="submit" disabled={!canSave} className={primaryButton}>
              {busy ? m.guardando : m.guardar}
            </button>
            {hasSaved && (
              <button
                type="button"
                disabled={busy || test?.status === 'pending'}
                onClick={() => void run(testInvestigatorDb)}
                className={secondaryButton}
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
            <ConfirmBar
              text={m.quitarConfirmar}
              cancel={m.cancelar}
              confirm={m.quitarSi}
              onCancel={() => setConfirmRemove(false)}
              onConfirm={() => {
                setConfirmRemove(false);
                setLoadedVersion(null);
                setHost('');
                setUser('');
                setPassword('');
                void run(removeInvestigatorDb);
              }}
            />
          )}
        </form>
      </Section>
      <BacklogSection idioma={idioma} />
      <WriterSection idioma={idioma} />
    </div>
  );
}
