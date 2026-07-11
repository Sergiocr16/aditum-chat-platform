'use client';

// Tab "Sitios conectados" de /configuracion — spec 1o.

import { useEffect, useState } from 'react';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { Idioma, Site } from '@aditum-chat/shared';
import { db, fns } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { useSites, type Row } from '@/lib/data';
import { Campo, Card, Toggle, inputCls } from './ui';

const M = {
  es: {
    activo: 'Activo',
    inactivo: 'Inactivo',
    stats: (c: number, t: number, u: number) => `${c} conversaciones · ${t} tickets · ${u} usuarios`,
    conectarOtro: '+ Conectar otro servicio',
    conectarOtroSub: 'Sitio web, app móvil o cualquier producto con HTML',
    nuevoNombre: 'Nombre del servicio',
    nuevoDominio: 'Dominio',
    nuevoIcono: 'Ícono (Material Symbols)',
    conectar: 'Conectar',
    conectando: 'Conectando…',
    cancelar: 'Cancelar',
    codigo: 'Código de instalación',
    codigoSub: 'Pegá este snippet antes de </body> en el HTML del sitio',
    copiar: 'Copiar',
    copiado: '¡Copiado!',
    payload: 'Payload cifrado',
    payloadSub: 'Cómo generarlo y enviarlo al widget',
    payloadPasos: [
      'Tu servidor arma el JSON del usuario y lo cifra con la clave del sitio: AES-256-GCM → base64(iv ‖ ciphertext ‖ tag). iat/exp en epoch seconds, con vigencia máxima de 5 minutos.',
      'Pasáselo al widget en window.AditumChatSettings: embebido en payload, o mejor con payloadUrl — un endpoint autenticado tuyo que devuelve { payload } fresco. Así nunca vence aunque la página quede abierta.',
      'El widget lo intercambia por una sesión llamando a widgetSession. El payload nunca se descifra en el navegador.',
    ],
    payloadEjemplo: 'Ejemplo de payload (antes de cifrar)',
    payloadCamposTitulo: 'CAMPOS',
    snippetComment: 'recomendado: tu endpoint que devuelve { payload } fresco',
    payloadCampos: [
      ['userId', 'ID del usuario en tu sistema'],
      ['name', 'Nombre para mostrar'],
      ['email', 'Correo del usuario'],
      ['role', 'Rol del usuario — "admin" habilita el chat grupal'],
      ['clientId · clientName', 'Cliente/condominio del usuario'],
      ['clientInfo', 'Datos del panel: { location, units, plan, customerSince, modules }'],
      ['groupId · groupName', 'Organización (grupo) a la que pertenece un admin'],
      ['groupChatEnabled', 'Si el grupo tiene chat grupal contratado'],
      ['groupClients', 'Unidades que administra el grupo: [{ id, name }]'],
      ['deviceToken', 'Push'],
      ['language', 'es / en'],
      ['iat / exp', '5 min'],
    ],
    payloadNota:
      'Se descifra solo en nuestro servidor con la clave privada del sitio. AES-256-GCM: base64(iv ‖ ciphertext ‖ tag)',
    clave: 'Clave de cifrado del sitio',
    claveSub: 'Con esta clave tu servidor cifra el payload de cada usuario',
    rotar: 'Rotar clave',
    rotando: 'Rotando…',
    claveNueva: 'Clave nueva del sitio',
    claveWarning: 'Guardala ahora — no se vuelve a mostrar',
    claveGracia: (h: number) => `La clave anterior sigue válida por ${h} h`,
    cerrar: 'Cerrar',
    herencia: 'Herencia de configuración',
    herenciaSub: 'Qué se define por sitio y qué es compartido',
    porSitio: 'Por sitio',
    global: 'Global',
    herenciaFilas: [
      ['Color y posición de burbuja', true],
      ['Mensajes y encabezados', true],
      ['Bot y horario', true],
      ['Base de conocimiento del bot', false],
      ['Equipo de agentes y SLA', false],
    ],
    error: 'Algo falló. Intentá de nuevo.',
    seleccionado: 'Seleccionado',
    push: 'Notificaciones push',
    pushSub: 'Avisar al teléfono cuando un agente responde',
    pushHint:
      'El deviceToken del payload pertenece al proyecto Firebase de TU app (no a Aditum Chat). Para poder enviar la notificación, subí el service account de ese proyecto: Consola de Firebase → Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada.',
    pushConfigurado: (proyecto: string, cuenta: string) =>
      `Enviando con el proyecto ${proyecto} (${cuenta})`,
    pushSinConfigurar: 'Sin credenciales del proyecto destino — el push no va a llegar',
    pushGuardadoCifrado: 'La clave se guarda cifrada (AES-256-GCM) y nunca es visible desde la consola.',
    pushPegar: 'Pegá acá el contenido del service account JSON…',
    pushSubirArchivo: 'Subir archivo JSON',
    pushGuardar: 'Guardar credenciales',
    pushGuardando: 'Guardando…',
    pushEliminar: 'Quitar credenciales',
    pushOk: 'Credenciales guardadas.',
  },
  en: {
    activo: 'Active',
    inactivo: 'Inactive',
    stats: (c: number, t: number, u: number) => `${c} conversations · ${t} tickets · ${u} users`,
    conectarOtro: '+ Connect another service',
    conectarOtroSub: 'Website, mobile app or any product with HTML',
    nuevoNombre: 'Service name',
    nuevoDominio: 'Domain',
    nuevoIcono: 'Icon (Material Symbols)',
    conectar: 'Connect',
    conectando: 'Connecting…',
    cancelar: 'Cancel',
    codigo: 'Installation code',
    codigoSub: 'Paste this snippet before </body> in the site HTML',
    copiar: 'Copy',
    copiado: 'Copied!',
    payload: 'Encrypted payload',
    payloadSub: 'How to generate it and send it to the widget',
    payloadPasos: [
      'Your server builds the user JSON and encrypts it with the site key: AES-256-GCM → base64(iv ‖ ciphertext ‖ tag). iat/exp in epoch seconds, valid for at most 5 minutes.',
      'Hand it to the widget in window.AditumChatSettings: embedded as payload, or better via payloadUrl — an authenticated endpoint of yours returning a fresh { payload }. That way it never expires while the page stays open.',
      'The widget exchanges it for a session by calling widgetSession. The payload is never decrypted in the browser.',
    ],
    payloadEjemplo: 'Sample payload (before encryption)',
    payloadCamposTitulo: 'FIELDS',
    snippetComment: 'recommended: your endpoint returning a fresh { payload }',
    payloadCampos: [
      ['userId', 'User ID in your system'],
      ['name', 'Display name'],
      ['email', 'User email'],
      ['role', 'User role — "admin" enables the group chat'],
      ['clientId · clientName', "The user's client/condo"],
      ['clientInfo', 'Context panel data: { location, units, plan, customerSince, modules }'],
      ['groupId · groupName', 'Organization (group) an admin belongs to'],
      ['groupChatEnabled', 'Whether the group has group chat'],
      ['groupClients', 'Units the group manages: [{ id, name }]'],
      ['deviceToken', 'Push'],
      ['language', 'es / en'],
      ['iat / exp', '5 min'],
    ],
    payloadNota:
      'Decrypted only on our server with the site private key. AES-256-GCM: base64(iv ‖ ciphertext ‖ tag)',
    clave: 'Site encryption key',
    claveSub: 'Your server encrypts each user payload with this key',
    rotar: 'Rotate key',
    rotando: 'Rotating…',
    claveNueva: 'New site key',
    claveWarning: 'Save it now — it will not be shown again',
    claveGracia: (h: number) => `The previous key remains valid for ${h} h`,
    cerrar: 'Close',
    herencia: 'Configuration inheritance',
    herenciaSub: 'What is defined per site vs shared',
    porSitio: 'Per site',
    global: 'Global',
    herenciaFilas: [
      ['Bubble color and position', true],
      ['Messages and headers', true],
      ['Bot and schedule', true],
      ['Bot knowledge base', false],
      ['Agent team and SLA', false],
    ],
    error: 'Something failed. Try again.',
    seleccionado: 'Selected',
    push: 'Push notifications',
    pushSub: 'Notify the phone when an agent replies',
    pushHint:
      'The deviceToken in the payload belongs to YOUR app’s Firebase project (not Aditum Chat). To deliver the notification, upload that project’s service account: Firebase Console → Project settings → Service accounts → Generate new private key.',
    pushConfigurado: (proyecto: string, cuenta: string) =>
      `Sending through project ${proyecto} (${cuenta})`,
    pushSinConfigurar: 'No destination project credentials — pushes will not arrive',
    pushGuardadoCifrado: 'The key is stored encrypted (AES-256-GCM) and is never visible from the console.',
    pushPegar: 'Paste the service account JSON here…',
    pushSubirArchivo: 'Upload JSON file',
    pushGuardar: 'Save credentials',
    pushGuardando: 'Saving…',
    pushEliminar: 'Remove credentials',
    pushOk: 'Credentials saved.',
  },
} as const;

function slugify(nombre: string): string {
  return nombre
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function SitiosTab() {
  const { agent } = useAuth();
  const idioma: Idioma = agent?.idioma ?? 'es';
  const m = M[idioma];

  const sites = useSites();
  const [selId, setSelId] = useState<string | null>(null);
  useEffect(() => {
    if (!selId && sites.length) setSelId(sites[0].id);
  }, [sites, selId]);

  // Mini form "+ Conectar otro servicio".
  const [formAbierto, setFormAbierto] = useState(false);
  const [nombre, setNombre] = useState('');
  const [dominio, setDominio] = useState('');
  const [icono, setIcono] = useState('language');
  const [creando, setCreando] = useState(false);

  // Modal de clave nueva (creación o rotación).
  const [claveNueva, setClaveNueva] = useState<{ clave: string; graciaHoras: number } | null>(null);
  const [rotando, setRotando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  const siteId = selId ?? 'app-aditum';

  const snippet = `<script>
  window.AditumChatSettings = {
    siteId: '${siteId}',
    payload: 'PAYLOAD_CIFRADO_GENERADO_EN_TU_SERVIDOR',
    payloadUrl: '/api/aditum-chat/payload', // ${m.snippetComment}
  };
</script>
<script src="https://chat.aditumcr.com/widget.js" async></script>`;

  const payloadEjemplo = `{
  "userId": "usr_123",
  "name": "Juan Rodríguez",
  "email": "juan@condominio.cr",
  "role": "Administrador",
  "clientId": "vistas-del-este",
  "clientName": "Condominio Vistas del Este",
  "clientInfo": {
    "location": "Curridabat, San José",
    "units": 148,
    "plan": "Empresarial",
    "customerSince": 2023,
    "modules": ["Cobros", "Reservas", "Mant."]
  },
  "groupId": "adm-horizonte",
  "groupName": "Administradora Horizonte",
  "groupChatEnabled": true,
  "groupClients": [
    { "id": "vistas-del-este", "name": "Condominio Vistas del Este" },
    { "id": "hacienda-real-cariari", "name": "Hacienda Real Cariari" }
  ],
  "deviceToken": "FCM_TOKEN_OPCIONAL",
  "language": "es",
  "iat": 1752264000,
  "exp": 1752264300
}`;

  function copiar(texto: string, key: string) {
    navigator.clipboard.writeText(texto).then(() => {
      setCopiado(key);
      setTimeout(() => setCopiado(null), 1500);
    });
  }

  async function conectarServicio() {
    const slug = slugify(nombre);
    if (!slug || !dominio.trim()) return;
    setCreando(true);
    setError(null);
    try {
      await setDoc(doc(db, 'sites', slug), {
        nombre: nombre.trim(),
        dominio: dominio.trim(),
        icono: icono.trim() || 'language',
        activo: true,
        widgetConfig: null,
        botConfig: null,
        scheduleConfig: null,
        createdAt: serverTimestamp(),
      });
      const rotate = httpsCallable<{ siteId: string }, { clave: string; graciaHoras: number }>(
        fns,
        'rotateSiteKey',
      );
      const res = await rotate({ siteId: slug });
      setClaveNueva(res.data);
      setSelId(slug);
      setFormAbierto(false);
      setNombre('');
      setDominio('');
      setIcono('language');
    } catch (e) {
      setError((e as Error).message || m.error);
    } finally {
      setCreando(false);
    }
  }

  async function rotarClave() {
    setRotando(true);
    setError(null);
    try {
      const rotate = httpsCallable<{ siteId: string }, { clave: string; graciaHoras: number }>(
        fns,
        'rotateSiteKey',
      );
      const res = await rotate({ siteId });
      setClaveNueva(res.data);
    } catch (e) {
      setError((e as Error).message || m.error);
    } finally {
      setRotando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <div className="text-danger text-[12px]">{error}</div>}

      {/* Cards de sitios */}
      <div className="grid grid-cols-2 gap-4">
        {sites.map((s) => {
          const st = s.data.stats;
          const sel = s.id === selId;
          return (
            <button
              key={s.id}
              onClick={() => setSelId(s.id)}
              className={`text-left bg-white border shadow-card rounded-lg p-4 transition-colors ${
                sel ? 'border-navy ring-1 ring-navy' : 'border-warm-border hover:border-navy'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-tag-blue-bg text-navy flex items-center justify-center">
                  <span className="msr text-[22px]">{s.data.icono}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-bold text-ink truncate">{s.data.nombre}</div>
                  <div className="text-[11.5px] text-warm-gray truncate">{s.data.dominio}</div>
                </div>
                <span
                  className={`text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full ${
                    s.data.activo ? 'bg-ok-bg text-ok-dark' : 'bg-cream-2 text-warm-gray'
                  }`}
                >
                  {(s.data.activo ? m.activo : m.inactivo).toUpperCase()}
                </span>
              </div>
              <div className="text-[11px] text-warm-gray-2 mt-3">
                {m.stats(st?.conversaciones ?? 0, st?.tickets ?? 0, st?.usuarios ?? 0)}
              </div>
            </button>
          );
        })}

        {/* + Conectar otro servicio */}
        <div className="border-2 border-dashed border-warm-border rounded-lg p-4 flex flex-col justify-center">
          {formAbierto ? (
            <div className="flex flex-col gap-3">
              <Campo label={m.nuevoNombre}>
                <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputCls} />
              </Campo>
              <Campo label={m.nuevoDominio}>
                <input
                  value={dominio}
                  onChange={(e) => setDominio(e.target.value)}
                  placeholder="app.ejemplo.com"
                  className={inputCls}
                />
              </Campo>
              <Campo label={m.nuevoIcono}>
                <div className="flex items-center gap-2">
                  <span className="msr text-[20px] text-navy">{icono.trim() || 'language'}</span>
                  <input value={icono} onChange={(e) => setIcono(e.target.value)} className={inputCls} />
                </div>
              </Campo>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setFormAbierto(false)}
                  className="text-[12px] font-semibold text-warm-gray px-3 py-1.5 rounded-lg hover:bg-cream-1"
                >
                  {m.cancelar}
                </button>
                <button
                  onClick={conectarServicio}
                  disabled={creando || !slugify(nombre) || !dominio.trim()}
                  className="bg-navy text-white text-[12px] font-semibold px-3 py-1.5 rounded-lg hover:bg-navy-light disabled:opacity-50"
                >
                  {creando ? m.conectando : m.conectar}
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setFormAbierto(true)} className="text-center py-4">
              <div className="text-[13px] font-bold text-navy">{m.conectarOtro}</div>
              <div className="text-[11px] text-warm-gray mt-1">{m.conectarOtroSub}</div>
            </button>
          )}
        </div>
      </div>

      {/* Código de instalación */}
      <Card icon="code" title={m.codigo} subtitle={m.codigoSub}>
        <div className="relative">
          <pre className="bg-navy-deep text-white rounded-lg p-4 text-[11.5px] font-mono leading-relaxed overflow-x-auto whitespace-pre">
            {snippet}
          </pre>
          <button
            onClick={() => copiar(snippet, 'snippet')}
            className="absolute top-2.5 right-2.5 flex items-center gap-1 bg-white/10 hover:bg-white/20 text-white text-[11px] font-semibold px-2.5 py-1.5 rounded-lg"
          >
            <span className="msr text-[14px]">{copiado === 'snippet' ? 'check' : 'content_copy'}</span>
            {copiado === 'snippet' ? m.copiado : m.copiar}
          </button>
        </div>
      </Card>

      {/* Payload cifrado: cómo se genera, ejemplo y campos */}
      <Card icon="lock" title={m.payload} subtitle={m.payloadSub}>
        <ol className="flex flex-col gap-2.5">
          {m.payloadPasos.map((paso, i) => (
            <li key={i} className="flex gap-2.5 text-[12px] text-ink-2 leading-relaxed">
              <span className="flex-none h-5 w-5 rounded-full bg-tag-blue-bg text-navy text-[11px] font-bold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <span>{paso}</span>
            </li>
          ))}
        </ol>

        <div className="mt-4">
          <div className="text-[10px] font-bold tracking-wider text-warm-gray-2 mb-1.5">
            {m.payloadEjemplo.toUpperCase()}
          </div>
          <div className="relative">
            <pre className="bg-navy-deep text-white rounded-lg p-4 text-[11.5px] font-mono leading-relaxed overflow-x-auto whitespace-pre max-h-[320px] overflow-y-auto">
              {payloadEjemplo}
            </pre>
            <button
              onClick={() => copiar(payloadEjemplo, 'payload-ejemplo')}
              className="absolute top-2.5 right-2.5 flex items-center gap-1 bg-white/10 hover:bg-white/20 text-white text-[11px] font-semibold px-2.5 py-1.5 rounded-lg"
            >
              <span className="msr text-[14px]">
                {copiado === 'payload-ejemplo' ? 'check' : 'content_copy'}
              </span>
              {copiado === 'payload-ejemplo' ? m.copiado : m.copiar}
            </button>
          </div>
        </div>

        <div className="mt-4">
          <div className="text-[10px] font-bold tracking-wider text-warm-gray-2 mb-1.5">
            {m.payloadCamposTitulo}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2">
            {m.payloadCampos.map(([campo, desc]) => (
              <div key={campo} className="flex items-baseline gap-1.5 text-[12px]">
                <span className="font-mono font-semibold text-ink">{campo}</span>
                <span className="text-[10.5px] text-warm-gray-2">· {desc}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2 bg-info-bg rounded-lg px-3 py-2.5 text-[11.5px] text-ink-2">
          <span className="msr text-[15px] text-navy mt-0.5">shield</span>
          {m.payloadNota}
        </div>
      </Card>

      {/* Clave de cifrado */}
      <Card icon="key" title={m.clave} subtitle={m.claveSub}>
        <div className="flex items-center gap-3">
          <code className="flex-1 bg-cream-1 border border-warm-border rounded-lg px-3 py-2.5 text-[12.5px] font-mono text-ink">
            pk_{siteId}_••••••••••••
          </code>
          <button
            onClick={rotarClave}
            disabled={rotando}
            className="flex items-center gap-1.5 border border-warm-border text-ink text-[12.5px] font-semibold px-4 py-2.5 rounded-lg hover:border-navy disabled:opacity-50"
          >
            <span className="msr text-[16px]">autorenew</span>
            {rotando ? m.rotando : m.rotar}
          </button>
        </div>
      </Card>

      {/* Notificaciones push (proyecto Firebase del host) */}
      <PushCard m={m} site={sites.find((s) => s.id === siteId) ?? null} siteId={siteId} />

      {/* Tabla de herencia */}
      <Card icon="account_tree" title={m.herencia} subtitle={m.herenciaSub}>
        <div className="divide-y divide-cream-3">
          {m.herenciaFilas.map(([label, porSitio]) => (
            <div key={label as string} className="flex items-center justify-between py-2.5">
              <span className="text-[12.5px] text-ink-2">{label}</span>
              <span
                className={`text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full ${
                  porSitio ? 'bg-tag-blue-bg text-navy' : 'bg-cream-2 text-warm-gray'
                }`}
              >
                {((porSitio ? m.porSitio : m.global) as string).toUpperCase()}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* Modal: clave nueva (una sola vez) */}
      {claveNueva && (
        <div
          className="fixed inset-0 z-50 bg-navy-deep/50 flex items-center justify-center p-6"
          onClick={() => setClaveNueva(null)}
        >
          <div
            className="bg-white rounded-panel shadow-modal w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 mb-3">
              <span className="msr text-[22px] text-navy">key</span>
              <h3 className="text-[15px] font-bold">{m.claveNueva}</h3>
            </div>
            <div className="flex items-center gap-2 bg-warn-bg text-warn-dark text-[12px] font-semibold rounded-lg px-3 py-2.5 mb-4">
              <span className="msr text-[16px]">warning</span>
              {m.claveWarning}
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-cream-1 border border-warm-border rounded-lg px-3 py-2.5 text-[11.5px] font-mono break-all">
                {claveNueva.clave}
              </code>
              <button
                onClick={() => copiar(claveNueva.clave, 'clave')}
                className="flex-none border border-warm-border rounded-lg p-2.5 hover:border-navy"
                title={m.copiar}
              >
                <span className="msr text-[16px]">{copiado === 'clave' ? 'check' : 'content_copy'}</span>
              </button>
            </div>
            <p className="text-[11.5px] text-warm-gray mt-3">{m.claveGracia(claveNueva.graciaHoras)}</p>
            <div className="flex justify-end mt-5">
              <button
                onClick={() => setClaveNueva(null)}
                className="bg-navy text-white text-[12.5px] font-semibold px-4 py-2 rounded-lg hover:bg-navy-light"
              >
                {m.cerrar}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PushCard({
  m,
  site,
  siteId,
}: {
  m: (typeof M)['es'] | (typeof M)['en'];
  site: Row<Site> | null;
  siteId: string;
}) {
  const [json, setJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  const pushInfo = site?.data.pushInfo ?? null;
  const pushActivo = site?.data.pushActivo ?? false;

  async function guardar(eliminar = false) {
    setBusy(true);
    setMsg(null);
    try {
      const call = httpsCallable(fns, 'setSiteFcmCredentials');
      await call(eliminar ? { siteId, eliminar: true } : { siteId, serviceAccountJson: json });
      if (!eliminar) setJson('');
      setMsg(eliminar ? null : { tipo: 'ok', texto: m.pushOk });
    } catch (e) {
      setMsg({ tipo: 'error', texto: (e as Error).message || m.error });
    } finally {
      setBusy(false);
    }
  }

  function subirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    void file.text().then(setJson);
  }

  return (
    <Card icon="notifications_active" title={m.push} subtitle={m.pushSub}>
      <div className="flex items-center justify-between gap-4 pb-3 border-b border-cream-3">
        <div
          className={`flex items-center gap-2 text-[12px] font-medium ${
            pushInfo ? 'text-ok-dark' : 'text-warn-dark'
          }`}
        >
          <span className="msr text-[16px]">{pushInfo ? 'check_circle' : 'warning'}</span>
          {pushInfo ? m.pushConfigurado(pushInfo.projectId, pushInfo.clientEmail) : m.pushSinConfigurar}
        </div>
        <Toggle
          on={pushActivo}
          onChange={(v: boolean) => void updateDoc(doc(db, 'sites', siteId), { pushActivo: v })}
        />
      </div>

      <p className="text-[11.5px] text-warm-gray leading-relaxed mt-3">{m.pushHint}</p>

      <textarea
        rows={4}
        value={json}
        onChange={(e) => setJson(e.target.value)}
        placeholder={m.pushPegar}
        className={`${inputCls} mt-3 w-full font-mono text-[11px] resize-none`}
        spellCheck={false}
      />
      <div className="flex items-center gap-2 mt-2">
        <label className="flex items-center gap-1.5 border border-warm-border text-ink text-[12px] font-semibold px-3 py-2 rounded-lg hover:border-navy cursor-pointer">
          <span className="msr text-[15px]">upload_file</span>
          {m.pushSubirArchivo}
          <input type="file" accept=".json,application/json" hidden onChange={subirArchivo} />
        </label>
        <button
          onClick={() => guardar(false)}
          disabled={busy || !json.trim()}
          className="bg-navy text-white text-[12px] font-semibold px-4 py-2 rounded-lg hover:bg-navy-light disabled:opacity-50"
        >
          {busy ? m.pushGuardando : m.pushGuardar}
        </button>
        {pushInfo && (
          <button
            onClick={() => guardar(true)}
            disabled={busy}
            className="text-danger text-[12px] font-semibold px-3 py-2 rounded-lg hover:bg-danger-bg disabled:opacity-50"
          >
            {m.pushEliminar}
          </button>
        )}
        <span className="flex items-center gap-1 text-[10.5px] text-warm-gray-2 ml-auto">
          <span className="msr text-[13px]">lock</span>
          {m.pushGuardadoCifrado}
        </span>
      </div>
      {msg && (
        <div
          className={`mt-2 text-[12px] font-medium ${msg.tipo === 'ok' ? 'text-ok-dark' : 'text-danger'}`}
        >
          {msg.texto}
        </div>
      )}
    </Card>
  );
}
