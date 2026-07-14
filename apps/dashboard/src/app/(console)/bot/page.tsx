'use client';

// Pantalla 1i — Configuración del bot con Claude (/bot). Solo Admin.
// La config editada es el override del sitio (sites/{siteId}.botConfig);
// los valores efectivos son el merge de settings/global.botConfig + override.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { BotConfig, Idioma, KbDoc, KbDocEstado, WidgetConfig } from '@aditum-chat/shared';
import { EMOJI_CATEGORIES, makeT, widgetMessages } from '@aditum-chat/shared';
import { renderMarkdown } from '@/components/ConversationView';
// The test chat reuses the REAL widget stylesheet so it always looks identical.
import '@aditum-chat/widget/src/ui/styles.css';
import './probar-widget.css';
import { useAuth } from '@/lib/auth';
import { useSiteFilter } from '@/components/Shell';
import { useSites, type Row } from '@/lib/data';
import {
  agregarUrlKb,
  guardarBotOverride,
  guardarWidgetMensajes,
  isKbFile,
  subirAvatarBot,
  testBotPregunta,
  uploadKbFile,
  useGlobalSettings,
  useKbDocs,
  useSite,
  type WidgetMessageKey,
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
    subirArchivo: 'Subir archivo',
    agregarUrl: 'Agregar URL',
    ambitoSitio: 'Este sitio',
    ambitoTodos: 'Todos los sitios',
    todos: 'TODOS',
    pags: 'págs',
    articulos: 'artículos',
    fragmentos: 'fragmentos',
    kbVacia: 'Todavía no hay documentos. Arrastrá un PDF, TXT o MD acá, o agregá una URL.',
    kbBuscar: 'Buscar archivo…',
    kbSinResultados: 'Ningún documento coincide con la búsqueda.',
    kbSoltar: 'Soltá los archivos acá',
    kbSoltarSub: 'PDF, TXT o MD · máx 50 MB',
    kbFormatoInvalido: 'Formato no soportado (solo PDF, TXT o MD):',
    estadoIndexado: 'Indexado',
    estadoSincronizando: 'Sincronizando',
    estadoError: 'Error',
    urlPrompt: 'URL del artículo o centro de ayuda:',
    nombrePrompt: 'Nombre para mostrar:',
    kbError: 'No se pudo agregar el documento. Probá de nuevo.',
    identidad: 'Identidad del bot',
    identidadNombre: 'Nombre del bot',
    identidadNombreHint: 'Aparece en el encabezado del chat y junto a cada mensaje',
    identidadTitulo: 'Imagen del bot en el chat',
    identidadDesc: 'Se muestra en el encabezado y en cada mensaje del asistente',
    cambiar: 'Cambiar',
    subiendo: 'Subiendo…',
    comportamiento: 'Comportamiento',
    escalar: 'Escalar a agente si no puede resolver',
    escalarPre: 'Tras',
    escalarPost: 'intentos sin resolver',
    adjuntos: 'Permitir adjuntar archivos',
    adjuntosHint:
      'El usuario puede mandar imágenes, PDF y Excel/CSV en el chat del bot; el asistente los analiza',
    saludoBot: 'Saludo inicial',
    saludoBotSub: 'Se muestra al abrir el chat del asistente',
    saludoBotHint: 'Vacío = saludo por defecto del bot',
    saludoBotNombre: 'Podés usar {nombre} para el nombre del residente',
    tono: 'Tono de respuesta',
    tonoCercano: 'Cercano (vos)',
    tonoFormal: 'Formal (usted)',
    probar: 'Probar el bot',
    asiLoVe: 'ASÍ LO VE EL ADMINISTRADOR',
    probarPlaceholder: '¿Cómo configuro una multa del 2% por pago tardío?',
    probarEnLinea: 'En línea',
    probarAdjuntar: 'Adjuntar imagen',
    probarSaludoDefault: '¡Hola! Soy {nombre} 👋 ¿En qué te puedo ayudar?',
    probarImgGrande: 'La imagen supera 4 MB.',
    probarImgFormato: 'Formato no soportado (JPG/PNG/GIF/WebP).',
    probarImagen: 'imagen',
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
    subirArchivo: 'Upload file',
    agregarUrl: 'Add URL',
    ambitoSitio: 'This site',
    ambitoTodos: 'All sites',
    todos: 'ALL',
    pags: 'pages',
    articulos: 'articles',
    fragmentos: 'chunks',
    kbVacia: 'No documents yet. Drag a PDF, TXT or MD here, or add a URL.',
    kbBuscar: 'Search files…',
    kbSinResultados: 'No documents match your search.',
    kbSoltar: 'Drop files here',
    kbSoltarSub: 'PDF, TXT or MD · max 50 MB',
    kbFormatoInvalido: 'Unsupported format (only PDF, TXT or MD):',
    estadoIndexado: 'Indexed',
    estadoSincronizando: 'Syncing',
    estadoError: 'Error',
    urlPrompt: 'Article or help center URL:',
    nombrePrompt: 'Display name:',
    kbError: 'The document could not be added. Try again.',
    identidad: 'Bot identity',
    identidadNombre: 'Bot name',
    identidadNombreHint: 'Shown in the chat header and next to each message',
    identidadTitulo: 'Bot image in the chat',
    identidadDesc: 'Shown in the header and next to each assistant message',
    cambiar: 'Change',
    subiendo: 'Uploading…',
    comportamiento: 'Behavior',
    escalar: 'Escalate to an agent when it cannot resolve',
    escalarPre: 'After',
    escalarPost: 'unresolved attempts',
    adjuntos: 'Allow file attachments',
    adjuntosHint:
      'Users can send images, PDFs and Excel/CSV files in the bot chat; the assistant analyzes them',
    saludoBot: 'Initial greeting',
    saludoBotSub: 'Shown when the assistant chat opens',
    saludoBotHint: "Empty = the bot's default greeting",
    saludoBotNombre: "You can use {nombre} for the resident's name",
    tono: 'Response tone',
    tonoCercano: 'Friendly (informal)',
    tonoFormal: 'Formal',
    probar: 'Test the bot',
    asiLoVe: 'THIS IS HOW THE ADMIN SEES IT',
    probarPlaceholder: 'How do I set up a 2% late-payment fine?',
    probarEnLinea: 'Online',
    probarAdjuntar: 'Attach image',
    probarSaludoDefault: "Hi! I'm {nombre} 👋 How can I help?",
    probarImgGrande: 'The image exceeds 4 MB.',
    probarImgFormato: 'Unsupported format (JPG/PNG/GIF/WebP).',
    probarImagen: 'image',
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
  adjuntos: true,
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
  // Saludo inicial del bot (widgetConfig.mensajeAI) — se edita acá pero vive
  // en el override del widget del sitio.
  const [mensajes, setMensajes] = useState<Partial<Pick<WidgetConfig, WidgetMessageKey>>>({});
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
      const w = siteDoc.data.widgetConfig ?? {};
      setMensajes(w.mensajeAI !== undefined ? { mensajeAI: w.mensajeAI } : {});
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

  const globalWidget = globalDoc?.data.widgetConfig;
  const setMensaje = (k: WidgetMessageKey, v: string) => {
    setMensajes((o) => ({ ...o, [k]: v }));
    setDirty(true);
  };
  const mensajeEfectivo = (k: WidgetMessageKey) => mensajes[k] ?? globalWidget?.[k] ?? '';
  const mensajeEsGlobal = (k: WidgetMessageKey) => mensajes[k] === undefined;

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
      // Un nombre vacío rompería el prompt y el header del widget: se descarta
      // el override y el sitio vuelve a heredar el nombre global.
      const limpio = { ...override };
      if (limpio.nombre !== undefined && !limpio.nombre.trim()) delete limpio.nombre;
      await guardarBotOverride(siteId, limpio);
      await guardarWidgetMensajes(siteId, mensajes);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 sm:p-6">
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
              nombre={efectivo.nombre}
              nombreGlobal={esGlobal('nombre')}
              onNombre={(v) => setCampo('nombre', v)}
              avatarUrl={efectivo.avatarUrl}
              global={esGlobal('avatarUrl')}
              onAvatar={(url) => setCampo('avatarUrl', url)}
              m={m}
            />
            <CardSaludoBot
              valor={mensajeEfectivo('mensajeAI')}
              global={mensajeEsGlobal('mensajeAI')}
              onChange={(v) => setMensaje('mensajeAI', v)}
              m={m}
            />
            <CardComportamiento efectivo={efectivo} esGlobal={esGlobal} setCampo={setCampo} m={m} />
            <CardProbar
              siteId={siteId}
              override={override}
              avatarUrl={efectivo.avatarUrl}
              nombre={efectivo.nombre}
              saludo={(
                mensajeEfectivo('mensajeAI') ||
                efectivo.saludo ||
                m.probarSaludoDefault.replace('{nombre}', efectivo.nombre)
              ).replace('{nombre}', agent?.perfil?.nombre?.split(' ')[0] ?? 'admin')}
              idioma={idioma}
              m={m}
            />
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

/** Normaliza para búsqueda: minúsculas y sin tildes. */
function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

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
  const [busqueda, setBusqueda] = useState('');
  const [arrastrando, setArrastrando] = useState(false);

  const sitioDestino = () => (ambito === 'TODOS' ? 'TODOS' : (siteId ?? 'TODOS'));

  const estadoLabel: Record<KbDocEstado, string> = {
    indexado: m.estadoIndexado,
    sincronizando: m.estadoSincronizando,
    error: m.estadoError,
  };

  const filtrados = busqueda.trim()
    ? kbDocs.filter((d) => normalizar(d.data.nombre).includes(normalizar(busqueda)))
    : kbDocs;

  const onFiles = async (files: File[]) => {
    if (files.length === 0 || ocupado) return;
    const validos = files.filter(isKbFile);
    const invalidos = files.filter((f) => !isKbFile(f));
    setError(
      invalidos.length > 0
        ? `${m.kbFormatoInvalido} ${invalidos.map((f) => f.name).join(', ')}`
        : null,
    );
    if (validos.length === 0) return;
    setOcupado(true);
    try {
      for (const file of validos) await uploadKbFile(file, sitioDestino());
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

  const KB_ICONO: Record<KbDoc['tipo'], string> = {
    pdf: 'description',
    text: 'article',
    url: 'link',
  };

  const metaDe = (kd: KbDoc) =>
    kd.tipo === 'pdf'
      ? `${kd.paginas ?? '—'} ${m.pags}`
      : kd.tipo === 'url'
        ? `${kd.articulos ?? kd.chunks ?? '—'} ${m.articulos}`
        : `${kd.chunks ?? '—'} ${m.fragmentos}`;

  return (
    <div
      className="relative"
      onDragOver={(e) => {
        e.preventDefault();
        setArrastrando(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setArrastrando(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setArrastrando(false);
        void onFiles(Array.from(e.dataTransfer.files));
      }}
    >
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
              title={m.kbSoltarSub}
              className="flex items-center gap-1 text-[11.5px] font-semibold border border-warm-border rounded-lg px-2.5 py-1.5 text-ink-2 hover:border-navy disabled:opacity-40 transition-colors"
            >
              <span className="msr text-[15px]">upload_file</span>
              {m.subirArchivo}
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
              multiple
              accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
              className="hidden"
              onChange={(e) => onFiles(Array.from(e.target.files ?? []))}
            />
          </>
        }
      >
        {error && <div className="text-[11.5px] text-danger mb-2">{error}</div>}

        {/* Buscador de archivos */}
        {kbDocs.length > 0 && (
          <div className="relative mb-2">
            <span className="msr absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-warm-gray-3">
              search
            </span>
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={m.kbBuscar}
              className="w-full border border-warm-border rounded-lg bg-cream-0 pl-8 pr-3 py-2 text-[12px] outline-none focus:border-navy focus:bg-white transition-colors"
            />
          </div>
        )}

        <div className="divide-y divide-cream-3">
          {filtrados.map((d) => {
            const kd = d.data;
            return (
              <div key={d.id} className="flex items-center gap-3 py-2.5">
                <div className="h-8 w-8 rounded-lg bg-cream-2 text-warm-gray flex-none flex items-center justify-center">
                  <span className="msr text-[17px]">{KB_ICONO[kd.tipo] ?? 'description'}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-semibold truncate">{kd.nombre}</div>
                  <div className="text-[11px] text-warm-gray-2">{metaDe(kd)}</div>
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
          {kbDocs.length > 0 && filtrados.length === 0 && (
            <div className="py-5 text-center text-[12px] text-warm-gray-2">{m.kbSinResultados}</div>
          )}
        </div>
      </Card>

      {/* Overlay de drag & drop */}
      {arrastrando && (
        <div className="absolute inset-0 z-10 rounded-panel border-2 border-dashed border-navy bg-info-bg/90 flex flex-col items-center justify-center gap-1 pointer-events-none">
          <span className="msr text-[32px] text-navy">upload_file</span>
          <div className="text-[13px] font-bold text-navy">{m.kbSoltar}</div>
          <div className="text-[11.5px] text-ink-2">{m.kbSoltarSub}</div>
        </div>
      )}
    </div>
  );
}

// -- Identidad del bot -------------------------------------------------------

function CardIdentidad({
  siteId,
  nombre,
  nombreGlobal,
  onNombre,
  avatarUrl,
  global,
  onAvatar,
  m,
}: {
  siteId: string | null;
  nombre: string;
  nombreGlobal: boolean;
  onNombre(v: string): void;
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
    <Card titulo={m.identidad}>
      {/* Nombre del bot */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[10px] font-bold tracking-wider text-warm-gray-2">
            {m.identidadNombre.toUpperCase()}
          </span>
          <GlobalTag show={nombreGlobal} m={m} />
        </div>
        <input
          value={nombre}
          onChange={(e) => onNombre(e.target.value)}
          maxLength={40}
          className="w-full border border-warm-border rounded-lg bg-cream-0 px-3 py-2 text-[12.5px] outline-none focus:border-navy focus:bg-white transition-colors"
        />
        <div className="text-[10.5px] text-warm-gray-2 mt-1">{m.identidadNombreHint}</div>
      </div>

      {/* Imagen del bot */}
      <div className="flex items-center gap-3 pt-3 border-t border-cream-3">
        <div className="h-12 w-12 rounded-full flex-none overflow-hidden bg-ai-bg text-ai flex items-center justify-center">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="msr text-[24px]">smart_toy</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-semibold flex items-center gap-2">
            {m.identidadTitulo}
            <GlobalTag show={global} m={m} />
          </div>
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

// -- Saludo inicial del bot ---------------------------------------------------

function CardSaludoBot({
  valor,
  global,
  onChange,
  m,
}: {
  valor: string;
  global: boolean;
  onChange(v: string): void;
  m: Msgs;
}) {
  return (
    <Card
      titulo={
        <>
          <span className="msr text-[16px] text-ai">waving_hand</span>
          {m.saludoBot}
          <GlobalTag show={global} m={m} />
        </>
      }
      extra={<span className="text-[10.5px] text-warm-gray-2">{m.saludoBotSub}</span>}
    >
      <textarea
        rows={2}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder={m.saludoBotHint}
        className="w-full border border-warm-border rounded-card p-2.5 text-[12.5px] leading-relaxed outline-none focus:border-navy resize-none bg-cream-0"
      />
      <div className="flex flex-col gap-0.5 mt-1">
        <span className="text-[10.5px] text-warm-gray-2">{m.saludoBotHint}</span>
        <span className="text-[10.5px] text-warm-gray-2">{m.saludoBotNombre}</span>
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
          label={m.adjuntos}
          hint={m.adjuntosHint}
          checked={efectivo.adjuntos !== false}
          global={esGlobal('adjuntos')}
          onChange={(v) => setCampo('adjuntos', v)}
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
                className="accent-[#5d3a5f]"
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
  /** Object URL de la imagen adjunta (solo para mostrarla en la burbuja). */
  imgUrl?: string;
  hora: string;
}

const TEST_IMG_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const TEST_IMG_MAX_BYTES = 4 * 1024 * 1024;

function horaAhora(): string {
  // Mismo formato 24h que usa el widget (formatTime).
  return new Date().toLocaleTimeString('es-CR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Réplica exacta del chat del widget: mismo CSS (importado del widget) y mismo markup. */
function CardProbar({
  siteId,
  override,
  avatarUrl,
  nombre,
  saludo,
  idioma,
  m,
}: {
  siteId: string | null;
  override: Partial<BotConfig>;
  avatarUrl?: string;
  nombre: string;
  saludo: string;
  idioma: Idioma;
  m: Msgs;
}) {
  const t = makeT(widgetMessages, idioma);
  const [msgs, setMsgs] = useState<TestMsg[]>([]);
  const [pregunta, setPregunta] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  // Feedback "¿te sirvió?" local (solo visual, como en el widget real).
  const [votos, setVotos] = useState<Record<number, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pendingFileUrl = useMemo(
    () => (pendingFile ? URL.createObjectURL(pendingFile) : null),
    [pendingFile],
  );
  useEffect(
    () => () => {
      if (pendingFileUrl) URL.revokeObjectURL(pendingFileUrl);
    },
    [pendingFileUrl],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs, cargando]);

  const elegirAdjunto = (file: File | null) => {
    setAviso(null);
    if (!file) return;
    if (!TEST_IMG_TYPES.includes(file.type)) {
      setAviso(m.probarImgFormato);
      return;
    }
    if (file.size > TEST_IMG_MAX_BYTES) {
      setAviso(m.probarImgGrande);
      return;
    }
    setPendingFile(file);
    inputRef.current?.focus();
  };

  const insertEmoji = (emoji: string) => {
    const el = inputRef.current;
    const focused = el && document.activeElement === el;
    const start = focused ? (el.selectionStart ?? pregunta.length) : pregunta.length;
    const end = focused ? (el.selectionEnd ?? pregunta.length) : pregunta.length;
    setPregunta(pregunta.slice(0, start) + emoji + pregunta.slice(end));
    el?.focus();
    requestAnimationFrame(() => {
      if (!el) return;
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const enviar = async () => {
    setShowEmoji(false);
    const q = pregunta.trim();
    if ((!q && !pendingFile) || !siteId || cargando) return;
    // Historial para el modelo: la conversación de prueba hasta acá, sin errores.
    const historial = msgs
      .filter((x): x is TestMsg & { rol: 'user' | 'bot' } => x.rol !== 'error')
      .map((x) => ({ rol: x.rol, texto: x.texto || `[${m.probarImagen}]` }));
    const file = pendingFile;
    setPregunta('');
    setPendingFile(null);
    setMsgs((prev) => [
      ...prev,
      { rol: 'user', texto: q, imgUrl: file ? URL.createObjectURL(file) : undefined, hora: horaAhora() },
    ]);
    setCargando(true);
    try {
      const imagen = file ? { data: await fileToBase64(file), mimeType: file.type } : undefined;
      const texto = await testBotPregunta(siteId, q, override, { historial, imagen });
      setMsgs((prev) => [...prev, { rol: 'bot', texto: texto || '…', hora: horaAhora() }]);
    } catch {
      setMsgs((prev) => [...prev, { rol: 'error', texto: m.testError, hora: horaAhora() }]);
    } finally {
      setCargando(false);
    }
  };

  const avatarBot = avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="ac-avatar-img" src={avatarUrl} alt="" />
  ) : (
    <span className="ac-icon">smart_toy</span>
  );

  const burbujaBot = (texto: string, error: boolean, hora: string, key: React.Key) => (
    <div key={key} className="ac-msg ac-msg-other">
      <div className="ac-msg-avatar" data-tipo="bot">
        {avatarBot}
      </div>
      <div className="ac-burbuja">
        <div className="ac-msg-texto" style={error ? { color: 'var(--ac-red)' } : undefined}>
          {renderMarkdown(texto)}
        </div>
        {hora && <div className="ac-msg-meta">{hora}</div>}
      </div>
    </div>
  );

  const feedbackRow = (i: number) =>
    votos[i] !== undefined ? (
      <div key={`fb${i}`} className="ac-feedback ac-feedback-enviado">
        <span className="ac-icon">{votos[i] ? 'thumb_up' : 'thumb_down'}</span>
        {t('bot.feedbackGracias')}
      </div>
    ) : (
      <div key={`fb${i}`} className="ac-feedback">
        <span className="ac-feedback-pregunta">{t('bot.feedbackPregunta')}</span>
        <button
          type="button"
          className="ac-feedback-btn"
          onClick={() => setVotos((v) => ({ ...v, [i]: true }))}
        >
          <span className="ac-icon">thumb_up</span>
          {t('bot.feedbackSi')}
        </button>
        <button
          type="button"
          className="ac-feedback-btn"
          onClick={() => setVotos((v) => ({ ...v, [i]: false }))}
        >
          <span className="ac-icon">thumb_down</span>
          {t('bot.feedbackNo')}
        </button>
      </div>
    );

  return (
    <Card
      titulo={m.probar}
      extra={
        <span className="text-[8.5px] font-bold tracking-wider text-warm-gray-2 bg-cream-2 px-2 py-1 rounded-full">
          {m.asiLoVe}
        </span>
      }
    >
      <div className="rounded-card border border-warm-border overflow-hidden">
        <div className="ac-root ac-probar">
          <div className="ac-chat">
            {/* Header idéntico al widget: avatar + nombre + chip AI + estado. */}
            <div className="ac-chat-header">
              <div className="ac-chat-avatar">{avatarBot}</div>
              <div className="ac-chat-htxt">
                <div className="ac-chat-htitle">
                  {nombre}
                  <span className="ac-chip-ai">AI</span>
                </div>
                <div className="ac-chat-hsub">
                  {cargando ? `${nombre} ${t('chat.escribiendo')}` : m.probarEnLinea}
                </div>
              </div>
            </div>

            <div className="ac-chat-body" ref={scrollRef}>
              {burbujaBot(saludo, false, '', 'saludo')}
              {msgs.map((msg, i) =>
                msg.rol === 'user' ? (
                  <div key={i} className="ac-msg ac-msg-own">
                    <div className="ac-burbuja ac-burbuja-own">
                      {msg.imgUrl && (
                        <div className="ac-adjuntos">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img className="ac-adj-img" src={msg.imgUrl} alt="" />
                        </div>
                      )}
                      {msg.texto && <div className="ac-msg-texto">{msg.texto}</div>}
                      <div className="ac-msg-meta">
                        {msg.hora}
                        <span className="ac-icon ac-check">done_all</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div key={i}>
                    {burbujaBot(msg.texto, msg.rol === 'error', msg.hora, `b${i}`)}
                    {msg.rol === 'bot' && feedbackRow(i)}
                  </div>
                ),
              )}
              {cargando && (
                <div className="ac-msg ac-msg-other">
                  <div className="ac-msg-avatar" data-tipo="bot">
                    {avatarBot}
                  </div>
                  <div className="ac-burbuja ac-typing">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              )}
            </div>

            {pendingFile && (
              <div className="ac-attach-preview">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {pendingFileUrl && <img className="ac-attach-thumb" src={pendingFileUrl} alt="" />}
                <div className="ac-attach-meta">
                  <span className="ac-attach-name">{pendingFile.name}</span>
                  <span className="ac-attach-size">{formatTestBytes(pendingFile.size)}</span>
                </div>
                <button
                  className="ac-icon-btn-dark"
                  aria-label="Quitar adjunto"
                  onClick={() => setPendingFile(null)}
                >
                  <span className="ac-icon">close</span>
                </button>
              </div>
            )}
            {aviso && <div className="ac-attach-error">{aviso}</div>}

            {showEmoji && (
              <div className="ac-emoji-panel">
                {EMOJI_CATEGORIES.map((cat) => (
                  <div key={cat.label.es}>
                    <div className="ac-emoji-cat">{cat.label[idioma]}</div>
                    <div className="ac-emoji-grid">
                      {cat.emojis.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          className="ac-emoji-btn"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => insertEmoji(emoji)}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="ac-composer">
              <input
                ref={fileRef}
                type="file"
                accept={TEST_IMG_TYPES.join(',')}
                hidden
                onChange={(e) => {
                  elegirAdjunto(e.target.files?.[0] ?? null);
                  e.target.value = '';
                }}
              />
              <button
                className={`ac-comp-btn${showEmoji ? ' ac-comp-btn-activo' : ''}`}
                aria-label="Emoji"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setShowEmoji((v) => !v)}
              >
                <span className="ac-icon">{showEmoji ? 'keyboard' : 'mood'}</span>
              </button>
              <button
                className="ac-comp-btn"
                aria-label={m.probarAdjuntar}
                title={m.probarAdjuntar}
                onClick={() => fileRef.current?.click()}
              >
                <span className="ac-icon">attach_file</span>
              </button>
              <textarea
                ref={inputRef}
                className="ac-input"
                rows={1}
                value={pregunta}
                onChange={(e) => setPregunta(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    enviar();
                  }
                }}
                placeholder={
                  pendingFile
                    ? idioma === 'es'
                      ? 'Agregá un comentario…'
                      : 'Add a caption…'
                    : t('chat.placeholder')
                }
              />
              <button
                className="ac-send"
                aria-label={m.enviar}
                onClick={enviar}
                disabled={cargando || (!pregunta.trim() && !pendingFile) || !siteId}
              >
                <span className="ac-icon">send</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function formatTestBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
