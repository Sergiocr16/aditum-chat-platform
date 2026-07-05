'use client';

// Pantalla 1i — Configuración del bot con Claude (/bot). Solo Admin.
// La config editada es el override del sitio (sites/{siteId}.botConfig);
// los valores efectivos son el merge de settings/global.botConfig + override.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { BotConfig, Idioma, KbDoc, KbDocEstado } from '@aditum-chat/shared';
import { useAuth } from '@/lib/auth';
import { useSiteFilter } from '@/components/Shell';
import { useSites, type Row } from '@/lib/data';
import {
  agregarUrlKb,
  guardarBotOverride,
  subirAvatarBot,
  subirPdfKb,
  testBotPregunta,
  useGlobalSettings,
  useKbDocs,
  useSite,
} from '@/lib/data-bot';
import { Toggle } from '@/components/bot/Toggle';

// ---------------------------------------------------------------- i18n local

const M = {
  es: {
    titulo: 'Configuración del bot',
    powered: 'POWERED BY CLAUDE',
    restringido: 'Acceso restringido',
    restringidoDesc: 'Esta sección solo está disponible para administradores.',
    configurando: 'Configurando:',
    notaSitios: 'Cada sitio tiene su propio bot, mensajes y widget',
    botActivo: 'Bot activo',
    sinGuardar: 'Cambios sin guardar',
    guardar: 'Guardar cambios',
    guardando: 'Guardando…',
    global: 'GLOBAL',
    globalHint: 'Valor heredado de la configuración global (settings/global)',
    instrucciones: 'Instrucciones y contexto del bot',
    instruccionesHint: 'Se incluye en cada llamada al modelo',
    caracteres: 'caracteres',
    kb: 'Base de conocimiento',
    subirPdf: 'Subir PDF',
    agregarUrl: 'Agregar URL',
    ambitoSitio: 'Este sitio',
    ambitoTodos: 'Todos los sitios',
    todos: 'TODOS',
    pags: 'págs',
    articulos: 'artículos',
    kbVacia: 'Todavía no hay documentos. Subí un PDF o agregá una URL.',
    estadoIndexado: 'Indexado',
    estadoSincronizando: 'Sincronizando',
    estadoError: 'Error',
    urlPrompt: 'URL del artículo o centro de ayuda:',
    nombrePrompt: 'Nombre para mostrar:',
    kbError: 'No se pudo agregar el documento. Probá de nuevo.',
    identidad: 'Identidad del bot',
    identidadTitulo: 'Imagen del bot en el chat',
    identidadDesc: 'Aparece junto a cada mensaje del asistente',
    cambiar: 'Cambiar',
    subiendo: 'Subiendo…',
    comportamiento: 'Comportamiento',
    escalar: 'Escalar a agente si no puede resolver',
    escalarPre: 'Tras',
    escalarPost: 'intentos sin resolver',
    fueraHorario: 'Responder fuera de horario',
    fueraHorarioHint: 'El bot cubre noches y fines de semana',
    ticketsAuto: 'Crear tickets automáticamente',
    ticketsAutoHint: 'Cuando detecta un error del sistema',
    tono: 'Tono de respuesta',
    tonoCercano: 'Cercano (vos)',
    tonoFormal: 'Formal (usted)',
    probar: 'Probar el bot',
    asiLoVe: 'ASÍ LO VE EL ADMINISTRADOR',
    probarPlaceholder: '¿Cómo configuro una multa del 2% por pago tardío?',
    probarVacio: 'Escribí una pregunta para probar la configuración actual (sin guardar).',
    enviar: 'Enviar',
    testError:
      'No se pudo obtener respuesta del bot. Revisá que la API key de Anthropic esté configurada en el servidor.',
  },
  en: {
    titulo: 'Bot configuration',
    powered: 'POWERED BY CLAUDE',
    restringido: 'Restricted access',
    restringidoDesc: 'This section is only available to administrators.',
    configurando: 'Configuring:',
    notaSitios: 'Each site has its own bot, messages and widget',
    botActivo: 'Bot active',
    sinGuardar: 'Unsaved changes',
    guardar: 'Save changes',
    guardando: 'Saving…',
    global: 'GLOBAL',
    globalHint: 'Value inherited from global settings (settings/global)',
    instrucciones: 'Bot instructions and context',
    instruccionesHint: 'Included in every model call',
    caracteres: 'characters',
    kb: 'Knowledge base',
    subirPdf: 'Upload PDF',
    agregarUrl: 'Add URL',
    ambitoSitio: 'This site',
    ambitoTodos: 'All sites',
    todos: 'ALL',
    pags: 'pages',
    articulos: 'articles',
    kbVacia: 'No documents yet. Upload a PDF or add a URL.',
    estadoIndexado: 'Indexed',
    estadoSincronizando: 'Syncing',
    estadoError: 'Error',
    urlPrompt: 'Article or help center URL:',
    nombrePrompt: 'Display name:',
    kbError: 'The document could not be added. Try again.',
    identidad: 'Bot identity',
    identidadTitulo: 'Bot image in the chat',
    identidadDesc: 'Shown next to each assistant message',
    cambiar: 'Change',
    subiendo: 'Uploading…',
    comportamiento: 'Behavior',
    escalar: 'Escalate to an agent when it cannot resolve',
    escalarPre: 'After',
    escalarPost: 'unresolved attempts',
    fueraHorario: 'Reply outside business hours',
    fueraHorarioHint: 'The bot covers nights and weekends',
    ticketsAuto: 'Create tickets automatically',
    ticketsAutoHint: 'When it detects a system error',
    tono: 'Response tone',
    tonoCercano: 'Friendly (informal)',
    tonoFormal: 'Formal',
    probar: 'Test the bot',
    asiLoVe: 'THIS IS HOW THE ADMIN SEES IT',
    probarPlaceholder: 'How do I set up a 2% late-payment fine?',
    probarVacio: 'Type a question to test the current (unsaved) configuration.',
    enviar: 'Send',
    testError:
      'Could not get a reply from the bot. Check that the Anthropic API key is configured on the server.',
  },
} satisfies Record<Idioma, Record<string, string>>;

type Msgs = (typeof M)['es'];

// Fallback si settings/global aún no cargó — mismo shape que BotConfig.
const DEFAULT_BOT: BotConfig = {
  activo: true,
  nombre: 'Asistente Aditum',
  instrucciones: '',
  tono: 'vos',
  escalarTrasIntentos: 2,
  responderFueraDeHorario: true,
  crearTicketsAutomaticamente: true,
  saludo: '',
};

const MAX_INSTRUCCIONES = 10000;

// ---------------------------------------------------------------- página

export default function BotPage() {
  const { agent } = useAuth();
  const idioma: Idioma = agent?.idioma ?? 'es';
  const m: Msgs = M[idioma];
  const esAdmin = agent?.perfil?.rol === 'admin';

  const sites = useSites();
  const { siteId: filtroGlobal } = useSiteFilter();
  const [siteId, setSiteId] = useState<string | null>(null);

  const siteDoc = useSite(esAdmin ? siteId : null);
  const globalDoc = useGlobalSettings(esAdmin);
  const kbDocs = useKbDocs(esAdmin);

  // Draft del override por sitio + estado de guardado.
  const [override, setOverride] = useState<Partial<BotConfig>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const cargadoPara = useRef<string | null>(null);

  // Sitio inicial: el del filtro global si existe, si no el primero.
  useEffect(() => {
    if (!siteId && sites.length > 0) {
      const pre = filtroGlobal && sites.some((s) => s.id === filtroGlobal) ? filtroGlobal : sites[0].id;
      setSiteId(pre);
    }
  }, [sites, siteId, filtroGlobal]);

  // Carga el draft una vez por sitio (no pisar mientras se edita).
  useEffect(() => {
    if (siteDoc && siteDoc.id === siteId && cargadoPara.current !== siteId) {
      cargadoPara.current = siteId;
      setOverride(siteDoc.data.botConfig ?? {});
      setDirty(false);
    }
  }, [siteDoc, siteId]);

  const globalBot = globalDoc?.data.botConfig;
  const efectivo: BotConfig = useMemo(
    () => ({ ...DEFAULT_BOT, ...(globalBot ?? {}), ...override }),
    [globalBot, override],
  );

  const setCampo = <K extends keyof BotConfig>(k: K, v: BotConfig[K]) => {
    setOverride((o) => ({ ...o, [k]: v }));
    setDirty(true);
  };
  // Si el campo no está en el override, el valor viene del global.
  const esGlobal = (k: keyof BotConfig) => override[k] === undefined;

  const siteNombre = useMemo(
    () => Object.fromEntries(sites.map((s) => [s.id, s.data.nombre])),
    [sites],
  );

  if (!agent) return null;
  if (!esAdmin) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <span className="msr text-[44px] text-warm-gray-3 block mb-3">lock</span>
          <h1 className="text-[15px] font-bold mb-1">{m.restringido}</h1>
          <p className="text-[12.5px] text-warm-gray">{m.restringidoDesc}</p>
        </div>
      </div>
    );
  }

  const guardar = async () => {
    if (!siteId || saving) return;
    setSaving(true);
    try {
      await guardarBotOverride(siteId, override);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1080px] mx-auto p-4 sm:p-6">
        {/* Header */}
        <header className="flex items-center gap-3 flex-wrap">
          <h1 className="text-[17px] font-bold">{m.titulo}</h1>
          <span className="text-[8.5px] font-bold tracking-wider bg-ai text-white px-2 py-1 rounded-full">
            {m.powered}
          </span>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-semibold text-ink-2">{m.botActivo}</span>
            <GlobalTag show={esGlobal('activo')} m={m} />
            <Toggle checked={efectivo.activo} onChange={(v) => setCampo('activo', v)} label={m.botActivo} />
          </div>
          {dirty && (
            <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-warn-dark">
              <span className="h-1.5 w-1.5 rounded-full bg-warn inline-block" />
              {m.sinGuardar}
            </span>
          )}
          <button
            onClick={guardar}
            disabled={!dirty || saving || !siteId}
            className="text-[12px] font-semibold bg-navy text-white px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-navy-light transition-colors"
          >
            {saving ? m.guardando : m.guardar}
          </button>
        </header>

        {/* Selector de sitio */}
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <span className="text-[12px] font-semibold text-warm-gray">{m.configurando}</span>
          {sites.map((s) => (
            <button
              key={s.id}
              onClick={() => setSiteId(s.id)}
              className={`flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                siteId === s.id
                  ? 'bg-navy border-navy text-white'
                  : 'bg-white border-warm-border text-warm-gray hover:border-navy'
              }`}
            >
              <span className="msr text-[15px]">{s.data.icono || 'apartment'}</span>
              {s.data.nombre}
            </button>
          ))}
          <span className="text-[11px] text-warm-gray-2 flex items-center gap-1">
            <span className="msr text-[13px]">info</span>
            {m.notaSitios}
          </span>
        </div>

        {/* Cards */}
        <div className="mt-4 grid gap-4 xl:grid-cols-2 items-start">
          <div className="flex flex-col gap-4 min-w-0">
            <CardInstrucciones
              valor={efectivo.instrucciones}
              global={esGlobal('instrucciones')}
              onChange={(v) => setCampo('instrucciones', v)}
              idioma={idioma}
              m={m}
            />
            <CardKb kbDocs={kbDocs} siteId={siteId} siteNombre={siteNombre} m={m} />
          </div>

          <div className="flex flex-col gap-4 min-w-0">
            <CardIdentidad
              siteId={siteId}
              avatarUrl={efectivo.avatarUrl}
              global={esGlobal('avatarUrl')}
              onAvatar={(url) => setCampo('avatarUrl', url)}
              m={m}
            />
            <CardComportamiento efectivo={efectivo} esGlobal={esGlobal} setCampo={setCampo} m={m} />
            <CardProbar siteId={siteId} override={override} avatarUrl={efectivo.avatarUrl} m={m} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- piezas

function GlobalTag({ show, m }: { show: boolean; m: Msgs }) {
  if (!show) return null;
  return (
    <span
      title={m.globalHint}
      className="text-[8px] font-bold tracking-wider bg-cream-2 text-warm-gray-2 px-1.5 py-0.5 rounded-full cursor-help"
    >
      {m.global}
    </span>
  );
}

function Card({ titulo, extra, children }: { titulo: React.ReactNode; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-panel border border-warm-border shadow-card p-5">
      <header className="flex items-center gap-2 mb-3 flex-wrap">
        <h2 className="text-[13px] font-bold flex items-center gap-2">{titulo}</h2>
        {extra && <div className="ml-auto flex items-center gap-2">{extra}</div>}
      </header>
      {children}
    </section>
  );
}

// -- Instrucciones y contexto ------------------------------------------------

function CardInstrucciones({
  valor,
  global,
  onChange,
  idioma,
  m,
}: {
  valor: string;
  global: boolean;
  onChange(v: string): void;
  idioma: Idioma;
  m: Msgs;
}) {
  const cuenta = valor.length;
  return (
    <Card
      titulo={
        <>
          {m.instrucciones}
          <GlobalTag show={global} m={m} />
        </>
      }
    >
      <textarea
        value={valor}
        maxLength={MAX_INSTRUCCIONES}
        onChange={(e) => onChange(e.target.value)}
        rows={10}
        className="w-full border border-warm-border rounded-card p-3 text-[12.5px] leading-relaxed outline-none focus:border-navy resize-y bg-cream-0"
      />
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[11px] text-warm-gray-2 flex items-center gap-1">
          <span className="msr text-[13px]">info</span>
          {m.instruccionesHint}
        </span>
        <span className={`text-[11px] font-medium ${cuenta >= MAX_INSTRUCCIONES ? 'text-danger' : 'text-warm-gray-2'}`}>
          {cuenta.toLocaleString(idioma === 'es' ? 'es-CR' : 'en-US')} / 10 000 {m.caracteres}
        </span>
      </div>
    </Card>
  );
}

// -- Base de conocimiento ----------------------------------------------------

const KB_ESTADO_CLS: Record<KbDocEstado, string> = {
  indexado: 'bg-ok-bg text-ok-dark',
  sincronizando: 'bg-warn-bg text-warn-dark',
  error: 'bg-danger-bg text-danger',
};

function CardKb({
  kbDocs,
  siteId,
  siteNombre,
  m,
}: {
  kbDocs: Row<KbDoc>[];
  siteId: string | null;
  siteNombre: Record<string, string>;
  m: Msgs;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [ambito, setAmbito] = useState<'sitio' | 'TODOS'>('TODOS');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sitioDestino = () => (ambito === 'TODOS' ? 'TODOS' : (siteId ?? 'TODOS'));

  const estadoLabel: Record<KbDocEstado, string> = {
    indexado: m.estadoIndexado,
    sincronizando: m.estadoSincronizando,
    error: m.estadoError,
  };

  const onPdf = async (file: File | null) => {
    if (!file || ocupado) return;
    setOcupado(true);
    setError(null);
    try {
      await subirPdfKb(file, sitioDestino());
    } catch {
      setError(m.kbError);
    } finally {
      setOcupado(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onUrl = async () => {
    const url = window.prompt(m.urlPrompt)?.trim();
    if (!url) return;
    let sugerido = url;
    try {
      sugerido = new URL(url).hostname;
    } catch {
      /* URL inválida: se usa el texto tal cual como sugerencia */
    }
    const nombre = window.prompt(m.nombrePrompt, sugerido)?.trim();
    if (!nombre) return;
    setOcupado(true);
    setError(null);
    try {
      await agregarUrlKb(url, nombre, sitioDestino());
    } catch {
      setError(m.kbError);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Card
      titulo={m.kb}
      extra={
        <>
          <select
            value={ambito}
            onChange={(e) => setAmbito(e.target.value as 'sitio' | 'TODOS')}
            className="text-[11px] font-medium border border-warm-border rounded-lg px-2 py-1.5 bg-white text-warm-gray outline-none cursor-pointer"
          >
            <option value="TODOS">{m.ambitoTodos}</option>
            <option value="sitio">{m.ambitoSitio}</option>
          </select>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={ocupado}
            className="flex items-center gap-1 text-[11.5px] font-semibold border border-warm-border rounded-lg px-2.5 py-1.5 text-ink-2 hover:border-navy disabled:opacity-40 transition-colors"
          >
            <span className="msr text-[15px]">upload_file</span>
            {m.subirPdf}
          </button>
          <button
            onClick={onUrl}
            disabled={ocupado}
            className="flex items-center gap-1 text-[11.5px] font-semibold border border-warm-border rounded-lg px-2.5 py-1.5 text-ink-2 hover:border-navy disabled:opacity-40 transition-colors"
          >
            <span className="msr text-[15px]">add_link</span>
            {m.agregarUrl}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={(e) => onPdf(e.target.files?.[0] ?? null)}
          />
        </>
      }
    >
      {error && <div className="text-[11.5px] text-danger mb-2">{error}</div>}
      <div className="divide-y divide-cream-3">
        {kbDocs.map((d) => {
          const kd = d.data;
          const meta =
            kd.tipo === 'pdf'
              ? `${kd.paginas ?? '—'} ${m.pags}`
              : `${kd.articulos ?? kd.chunks ?? '—'} ${m.articulos}`;
          return (
            <div key={d.id} className="flex items-center gap-3 py-2.5">
              <div className="h-8 w-8 rounded-lg bg-cream-2 text-warm-gray flex-none flex items-center justify-center">
                <span className="msr text-[17px]">{kd.tipo === 'pdf' ? 'description' : 'link'}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-semibold truncate">{kd.nombre}</div>
                <div className="text-[11px] text-warm-gray-2">{meta}</div>
              </div>
              <span
                className={`text-[8.5px] font-bold tracking-wider px-1.5 py-0.5 rounded flex-none ${
                  kd.sitio === 'TODOS' ? 'bg-cream-2 text-warm-gray' : 'bg-tag-blue-bg text-navy'
                }`}
              >
                {kd.sitio === 'TODOS' ? m.todos : (siteNombre[kd.sitio] ?? kd.sitio).toUpperCase()}
              </span>
              <span
                className={`text-[8.5px] font-bold tracking-wider px-1.5 py-0.5 rounded-full flex-none ${KB_ESTADO_CLS[kd.estado]}`}
              >
                {estadoLabel[kd.estado].toUpperCase()}
              </span>
            </div>
          );
        })}
        {kbDocs.length === 0 && (
          <div className="py-5 text-center text-[12px] text-warm-gray-2">{m.kbVacia}</div>
        )}
      </div>
    </Card>
  );
}

// -- Identidad del bot -------------------------------------------------------

function CardIdentidad({
  siteId,
  avatarUrl,
  global,
  onAvatar,
  m,
}: {
  siteId: string | null;
  avatarUrl?: string;
  global: boolean;
  onAvatar(url: string): void;
  m: Msgs;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);

  const onFile = async (file: File | null) => {
    if (!file || !siteId || subiendo) return;
    setSubiendo(true);
    try {
      onAvatar(await subirAvatarBot(siteId, file));
    } finally {
      setSubiendo(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Card
      titulo={
        <>
          {m.identidad}
          <GlobalTag show={global} m={m} />
        </>
      }
    >
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-full flex-none overflow-hidden bg-ai-bg text-ai flex items-center justify-center">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="msr text-[24px]">smart_toy</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-semibold">{m.identidadTitulo}</div>
          <div className="text-[11px] text-warm-gray-2">{m.identidadDesc}</div>
        </div>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={!siteId || subiendo}
          className="text-[11.5px] font-semibold border border-warm-border rounded-lg px-3 py-1.5 text-ink-2 hover:border-navy disabled:opacity-40 transition-colors"
        >
          {subiendo ? m.subiendo : m.cambiar}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
      </div>
    </Card>
  );
}

// -- Comportamiento + tono ---------------------------------------------------

function CardComportamiento({
  efectivo,
  esGlobal,
  setCampo,
  m,
}: {
  efectivo: BotConfig;
  esGlobal(k: keyof BotConfig): boolean;
  setCampo<K extends keyof BotConfig>(k: K, v: BotConfig[K]): void;
  m: Msgs;
}) {
  // El toggle de escalamiento se modela con escalarTrasIntentos (0 = off).
  const escalarOn = efectivo.escalarTrasIntentos > 0;
  const intentos = efectivo.escalarTrasIntentos || 2;

  return (
    <Card titulo={m.comportamiento}>
      <div className="flex flex-col divide-y divide-cream-3">
        <FilaToggle
          label={m.escalar}
          hint={
            <span className="flex items-center gap-1.5">
              {m.escalarPre}
              <input
                type="number"
                min={1}
                max={10}
                value={intentos}
                disabled={!escalarOn}
                onChange={(e) => {
                  const n = Math.max(1, Math.min(10, Number(e.target.value) || 1));
                  setCampo('escalarTrasIntentos', n);
                }}
                className="w-12 border border-warm-border rounded px-1 py-0.5 text-center text-[11px] bg-white disabled:opacity-40 outline-none focus:border-navy"
              />
              {m.escalarPost}
            </span>
          }
          checked={escalarOn}
          global={esGlobal('escalarTrasIntentos')}
          onChange={(v) => setCampo('escalarTrasIntentos', v ? intentos : 0)}
          m={m}
        />
        <FilaToggle
          label={m.fueraHorario}
          hint={m.fueraHorarioHint}
          checked={efectivo.responderFueraDeHorario}
          global={esGlobal('responderFueraDeHorario')}
          onChange={(v) => setCampo('responderFueraDeHorario', v)}
          m={m}
        />
        <FilaToggle
          label={m.ticketsAuto}
          hint={m.ticketsAutoHint}
          checked={efectivo.crearTicketsAutomaticamente}
          global={esGlobal('crearTicketsAutomaticamente')}
          onChange={(v) => setCampo('crearTicketsAutomaticamente', v)}
          m={m}
        />
      </div>

      {/* Tono de respuesta */}
      <div className="mt-4 pt-3 border-t border-cream-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] font-bold tracking-wider text-warm-gray-2">
            {m.tono.toUpperCase()}
          </span>
          <GlobalTag show={esGlobal('tono')} m={m} />
        </div>
        <div className="flex gap-4">
          {(
            [
              { valor: 'vos', label: m.tonoCercano },
              { valor: 'usted', label: m.tonoFormal },
            ] as const
          ).map((op) => (
            <label key={op.valor} className="flex items-center gap-2 cursor-pointer text-[12.5px] font-medium">
              <input
                type="radio"
                name="tono"
                checked={efectivo.tono === op.valor}
                onChange={() => setCampo('tono', op.valor)}
                className="accent-[#123c68]"
              />
              {op.label}
            </label>
          ))}
        </div>
      </div>
    </Card>
  );
}

function FilaToggle({
  label,
  hint,
  checked,
  global,
  onChange,
  m,
}: {
  label: string;
  hint: React.ReactNode;
  checked: boolean;
  global: boolean;
  onChange(v: boolean): void;
  m: Msgs;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-semibold flex items-center gap-2">
          {label}
          <GlobalTag show={global} m={m} />
        </div>
        <div className="text-[11px] text-warm-gray-2 mt-0.5">{hint}</div>
      </div>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

// -- Probar el bot -------------------------------------------------------

interface TestMsg {
  rol: 'user' | 'bot' | 'error';
  texto: string;
}

function CardProbar({
  siteId,
  override,
  avatarUrl,
  m,
}: {
  siteId: string | null;
  override: Partial<BotConfig>;
  avatarUrl?: string;
  m: Msgs;
}) {
  const [msgs, setMsgs] = useState<TestMsg[]>([]);
  const [pregunta, setPregunta] = useState('');
  const [cargando, setCargando] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs, cargando]);

  const enviar = async () => {
    const q = pregunta.trim();
    if (!q || !siteId || cargando) return;
    setPregunta('');
    setMsgs((prev) => [...prev, { rol: 'user', texto: q }]);
    setCargando(true);
    try {
      const texto = await testBotPregunta(siteId, q, override);
      setMsgs((prev) => [...prev, { rol: 'bot', texto: texto || '…' }]);
    } catch {
      setMsgs((prev) => [...prev, { rol: 'error', texto: m.testError }]);
    } finally {
      setCargando(false);
    }
  };

  return (
    <Card
      titulo={m.probar}
      extra={
        <span className="text-[8.5px] font-bold tracking-wider text-warm-gray-2 bg-cream-2 px-2 py-1 rounded-full">
          {m.asiLoVe}
        </span>
      }
    >
      <div
        ref={scrollRef}
        className="h-56 overflow-y-auto bg-cream-1 rounded-card border border-cream-3 p-3 flex flex-col gap-2.5"
      >
        {msgs.length === 0 && !cargando && (
          <div className="m-auto text-center text-[11.5px] text-warm-gray-2 max-w-[240px]">
            <span className="msr text-[26px] block mb-1 text-ai-light">smart_toy</span>
            {m.probarVacio}
          </div>
        )}
        {msgs.map((msg, i) =>
          msg.rol === 'user' ? (
            <div
              key={i}
              className="self-end max-w-[80%] bg-navy text-white text-[12.5px] rounded-lg rounded-br-sm px-3 py-2"
            >
              {msg.texto}
            </div>
          ) : (
            <div key={i} className="flex items-start gap-2 max-w-[88%]">
              <BotAvatar avatarUrl={avatarUrl} />
              <div
                className={`text-[12.5px] rounded-lg rounded-tl-sm px-3 py-2 whitespace-pre-wrap ${
                  msg.rol === 'error'
                    ? 'bg-danger-bg text-danger'
                    : 'bg-white border border-warm-border text-ink'
                }`}
              >
                {msg.texto}
              </div>
            </div>
          ),
        )}
        {cargando && (
          <div className="flex items-start gap-2">
            <BotAvatar avatarUrl={avatarUrl} />
            <div className="bg-white border border-warm-border rounded-lg rounded-tl-sm px-3 py-2">
              <span className="msr text-[15px] text-ai animate-spin inline-block">progress_activity</span>
            </div>
          </div>
        )}
      </div>
      <div className="flex gap-2 mt-2.5">
        <input
          value={pregunta}
          onChange={(e) => setPregunta(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') enviar();
          }}
          placeholder={m.probarPlaceholder}
          disabled={cargando}
          className="flex-1 min-w-0 border border-warm-border rounded-full px-3.5 py-2 text-[12.5px] bg-white outline-none focus:border-navy disabled:opacity-60"
        />
        <button
          onClick={enviar}
          disabled={cargando || !pregunta.trim() || !siteId}
          aria-label={m.enviar}
          className="h-9 w-9 flex-none rounded-full bg-ai text-white flex items-center justify-center disabled:opacity-40 hover:bg-ai-light transition-colors"
        >
          <span className="msr text-[17px]">send</span>
        </button>
      </div>
    </Card>
  );
}

function BotAvatar({ avatarUrl }: { avatarUrl?: string }) {
  return (
    <div className="h-7 w-7 rounded-full flex-none overflow-hidden bg-ai text-white flex items-center justify-center">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="msr text-[15px]">smart_toy</span>
      )}
    </div>
  );
}
