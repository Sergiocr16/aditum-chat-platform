'use client';

// Tab "Widget" de /configuracion — spec 1k.
// Edita el override sites/{siteId}.widgetConfig / scheduleConfig; el efectivo
// es el merge defaults → settings/global → override del sitio.

import { useEffect, useMemo, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import type {
  GlobalSettings,
  Idioma,
  ScheduleConfig,
  ScheduleDay,
  Site,
  WidgetConfig,
} from '@aditum-chat/shared';
import { formatSchedule } from '@aditum-chat/shared';
import { db, storage } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { useDoc, useSites } from '@/lib/data';
import { Campo, Card, HerenciaTag, ToggleRow, inputCls } from './ui';

// Espejo de los defaults del server (functions/src/lib/config.ts) para el merge en cliente.
const DEFAULT_WIDGET: WidgetConfig = {
  color: '#123C68',
  accent: '#E8EEF5',
  posicion: 'bottom-left',
  titulo: 'Soporte Aditum',
  saludo: '¡Hola! ¿En qué podemos ayudarte?',
  botonBot: true,
  botonAgente: true,
  botonChatEquipo: false,
  ocultarBurbuja: false,
};

const DEFAULT_SCHEDULE: ScheduleConfig = {
  timezone: 'America/Costa_Rica',
  dias: [
    { dia: 0, abierto: false },
    { dia: 1, abierto: true, desde: '08:00', hasta: '17:00' },
    { dia: 2, abierto: true, desde: '08:00', hasta: '17:00' },
    { dia: 3, abierto: true, desde: '08:00', hasta: '17:00' },
    { dia: 4, abierto: true, desde: '08:00', hasta: '17:00' },
    { dia: 5, abierto: true, desde: '08:00', hasta: '17:00' },
    { dia: 6, abierto: true, desde: '08:00', hasta: '12:00' },
  ],
  textoHorario: {
    es: 'Lun–Vie 8:00–17:00 · Sáb 8:00–12:00',
    en: 'Mon–Fri 8:00–17:00 · Sat 8:00–12:00',
  },
};

const M = {
  es: {
    configurando: 'Configurando el widget de',
    apariencia: 'Apariencia',
    logo: 'Logo del widget',
    logoHint: 'PNG con fondo transparente · formato horizontal · se muestra en el header del widget',
    logoSubir: 'Subir logo',
    logoQuitar: 'Quitar',
    color: 'Color primario',
    accent: 'Color de acento (activo)',
    posicion: 'Posición de la burbuja',
    abajoDer: 'Abajo a la derecha',
    abajoIzq: 'Abajo a la izquierda',
    mensajes: 'Mensajes',
    titulo: 'Título del widget',
    saludo: 'Saludo inicial',
    botones: 'Botones de inicio',
    botonesSub: 'Qué opciones ve el usuario al abrir el chat',
    botonBot: 'Preguntas al bot',
    botonBotHint: 'El asistente con IA responde primero',
    botonAgente: 'Hablar con un agente',
    botonAgenteHint: 'Abre una conversación directa con el equipo',
    botonEquipo: 'Chat del equipo administrador',
    botonEquipoHint: 'El botón solo aparece si este toggle está activo',
    botonEquipoHint2: 'Chat del equipo administrador · Grupo con todos los administradores de {condominio}',
    botonTexto: 'Texto del botón (opcional)',
    botonIcono: 'Icono',
    iconoSubir: 'Subir imagen',
    iconoQuitar: 'Usar default',
    iconoHint: 'PNG/JPG/SVG · cuadrado · reemplaza el icono por defecto',
    bienvenida: 'Respuestas automáticas',
    bienvenidaSub: 'Saludo del bot y respuestas automáticas del canal de agente',
    bienvenidaAI: 'Bot · saludo inicial',
    bienvenidaAIHint: 'Se muestra al abrir. Vacío = saludo por defecto del bot',
    bienvenidaAgente: 'Agente · en horario',
    bienvenidaAgenteHint: 'Se envía después del primer mensaje del usuario',
    bienvenidaFuera: 'Agente · fuera de horario',
    bienvenidaFueraHint: 'Respuesta automática cuando escriben fuera del horario de atención',
    bienvenidaNombre: 'Podés usar {nombre} para el nombre del residente',
    horario: 'Horario de atención',
    horarioSub: 'Zona horaria: America/Costa_Rica',
    textoAuto: 'El texto que ve el usuario se genera solo del horario configurado:',
    textoAutoVacio: 'sin días abiertos',
    vistaPrevia: 'VISTA PREVIA',
    vistaPreviaSub: 'Así lo ve el usuario en el sitio',
    guardar: 'Guardar cambios',
    guardando: 'Guardando…',
    sinGuardar: 'Cambios sin guardar',
    previewInicio: 'Inicio',
    previewTickets: 'Tickets',
    previewBot: 'Preguntale al asistente',
    previewEnLinea: 'Estamos en línea',
    previewAgente: 'Hablar con un agente',
    previewEquipo: 'Chat del equipo',
    dias: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
    desde: 'Desde',
    hasta: 'Hasta',
    error: 'No se pudo guardar. Revisá la conexión e intentá de nuevo.',
  },
  en: {
    configurando: 'Configuring the widget for',
    apariencia: 'Appearance',
    logo: 'Widget logo',
    logoHint: 'Transparent PNG · horizontal format · shown in the widget header',
    logoSubir: 'Upload logo',
    logoQuitar: 'Remove',
    color: 'Primary color',
    accent: 'Accent color (active)',
    posicion: 'Bubble position',
    abajoDer: 'Bottom right',
    abajoIzq: 'Bottom left',
    mensajes: 'Messages',
    titulo: 'Widget title',
    saludo: 'Welcome message',
    botones: 'Start buttons',
    botonesSub: 'Options the user sees when opening the chat',
    botonBot: 'Ask the bot',
    botonBotHint: 'The AI assistant answers first',
    botonAgente: 'Talk to an agent',
    botonAgenteHint: 'Opens a direct conversation with the team',
    botonEquipo: 'Admin team chat',
    botonEquipoHint: 'The button only appears if this toggle is on',
    botonEquipoHint2: 'Admin team chat · Group with every administrator of {condominio}',
    botonTexto: 'Button label (optional)',
    botonIcono: 'Icon',
    iconoSubir: 'Upload image',
    iconoQuitar: 'Use default',
    iconoHint: 'PNG/JPG/SVG · square · replaces the default icon',
    bienvenida: 'Automatic replies',
    bienvenidaSub: 'Bot greeting and automatic replies for the agent channel',
    bienvenidaAI: 'Bot · initial greeting',
    bienvenidaAIHint: 'Shown on open. Empty = the bot default greeting',
    bienvenidaAgente: 'Agent · within hours',
    bienvenidaAgenteHint: 'Sent after the user’s first message',
    bienvenidaFuera: 'Agent · after hours',
    bienvenidaFueraHint: 'Automatic reply when they write outside business hours',
    bienvenidaNombre: 'You can use {nombre} for the resident’s name',
    horario: 'Business hours',
    horarioSub: 'Timezone: America/Costa_Rica',
    textoAuto: 'The text the user sees is generated from the configured hours:',
    textoAutoVacio: 'no open days',
    vistaPrevia: 'LIVE PREVIEW',
    vistaPreviaSub: 'What the user sees on the site',
    guardar: 'Save changes',
    guardando: 'Saving…',
    sinGuardar: 'Unsaved changes',
    previewInicio: 'Home',
    previewTickets: 'Tickets',
    previewBot: 'Ask the assistant',
    previewEnLinea: 'We are online',
    previewAgente: 'Talk to an agent',
    previewEquipo: 'Team chat',
    dias: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    desde: 'From',
    hasta: 'To',
    error: 'Could not save. Check your connection and try again.',
  },
} as const;

export function WidgetConfigTab() {
  const { agent } = useAuth();
  const idioma: Idioma = agent?.idioma ?? 'es';
  const m = M[idioma];

  const sites = useSites();
  const [siteId, setSiteId] = useState<string | null>(null);
  useEffect(() => {
    if (!siteId && sites.length) setSiteId(sites[0].id);
  }, [sites, siteId]);

  const siteRow = useDoc<Site>(siteId ? `sites/${siteId}` : null);
  const globalRow = useDoc<GlobalSettings>('settings/global');

  // Override editable (solo los campos con valor propio del sitio).
  const [override, setOverride] = useState<Partial<WidgetConfig>>({});
  // null = hereda el horario global.
  const [schedule, setSchedule] = useState<ScheduleConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    if (siteRow && siteRow.id !== loadedFor) {
      setOverride({ ...(siteRow.data.widgetConfig ?? {}) });
      setSchedule(siteRow.data.scheduleConfig ?? null);
      setDirty(false);
      setError(null);
      setLoadedFor(siteRow.id);
    }
  }, [siteRow, loadedFor]);

  const globalWidget = globalRow?.data.widgetConfig;
  const eff: WidgetConfig = useMemo(
    () => ({ ...DEFAULT_WIDGET, ...globalWidget, ...override }),
    [globalWidget, override],
  );
  const effSchedule: ScheduleConfig =
    schedule ?? globalRow?.data.scheduleConfig ?? DEFAULT_SCHEDULE;
  const horarioPorSitio = schedule !== null;

  function setW<K extends keyof WidgetConfig>(key: K, value: WidgetConfig[K]) {
    setOverride((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  const her = (key: keyof WidgetConfig) => (
    <HerenciaTag porSitio={override[key] !== undefined} idioma={idioma} />
  );

  /** Personalización por botón: texto e icono (imagen que reemplaza el default). */
  const botonPersonalizacion = (
    textoKey: 'botonBotTexto' | 'botonAgenteTexto' | 'botonEquipoTexto',
    iconoKey: 'botonBotIcono' | 'botonAgenteIcono' | 'botonEquipoIcono',
    iconoDefault: string,
    on: boolean,
  ) =>
    on ? (
      <div className="mt-2 flex flex-col gap-2 border-t border-cream-3 pt-2.5">
        <input
          value={eff[textoKey] ?? ''}
          onChange={(e) => setW(textoKey, e.target.value)}
          placeholder={m.botonTexto}
          className={inputCls}
        />
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10.5px] font-bold tracking-wide text-warm-gray uppercase">
            {m.botonIcono}
          </span>
          <div className="h-9 w-9 rounded-lg bg-cream-1 flex items-center justify-center overflow-hidden flex-none">
            {eff[iconoKey] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={eff[iconoKey]} alt="" className="h-6 w-6 object-contain" />
            ) : (
              <span className="msr text-[18px] text-navy">{iconoDefault}</span>
            )}
          </div>
          <label className="flex items-center gap-1.5 border border-warm-border text-ink text-[12px] font-semibold px-2.5 py-1.5 rounded-lg hover:border-navy cursor-pointer">
            <span className="msr text-[14px]">upload</span>
            {m.iconoSubir}
            <input
              type="file"
              accept="image/png,image/jpeg,image/svg+xml"
              hidden
              onChange={(e) => subirIcono(iconoKey, e)}
            />
          </label>
          {override[iconoKey] !== undefined && (
            <button
              onClick={() => quitarCampo(iconoKey)}
              className="text-warm-gray text-[12px] font-semibold px-2 py-1.5 rounded-lg hover:bg-cream-1"
            >
              {m.iconoQuitar}
            </button>
          )}
        </div>
        <span className="text-[10.5px] text-warm-gray-2">{m.iconoHint}</span>
      </div>
    ) : null;

  function diaConfig(dia: number): ScheduleDay {
    return effSchedule.dias.find((d) => d.dia === dia) ?? { dia, abierto: false };
  }

  function editSchedule(fn: (s: ScheduleConfig) => ScheduleConfig) {
    const base: ScheduleConfig = {
      timezone: 'America/Costa_Rica',
      dias: Array.from({ length: 7 }, (_, i) => ({ ...diaConfig(i) })),
      // El texto visible se genera con formatSchedule(); no se persiste manualmente.
    };
    setSchedule(fn(base));
    setDirty(true);
  }

  function setDia(dia: number, patch: Partial<ScheduleDay>) {
    editSchedule((s) => ({
      ...s,
      dias: s.dias.map((d) => (d.dia === dia ? { ...d, ...patch } : d)),
    }));
  }

  async function subirLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !siteId) return;
    e.target.value = '';
    setError(null);
    try {
      const ext = file.type === 'image/png' ? 'png' : 'jpg';
      const r = storageRef(storage, `perfiles/logo-${siteId}.${ext}`);
      await uploadBytes(r, file, { contentType: file.type });
      setW('logoUrl', await getDownloadURL(r));
    } catch {
      setError(m.error);
    }
  }

  function quitarLogo() {
    quitarCampo('logoUrl');
  }

  /** Quita un override puntual (vuelve a heredar / al default). */
  function quitarCampo(key: keyof WidgetConfig) {
    setOverride((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setDirty(true);
  }

  /** Sube una imagen de icono de botón y guarda su URL en el override indicado. */
  async function subirIcono(
    key: 'botonBotIcono' | 'botonAgenteIcono' | 'botonEquipoIcono',
    e: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = e.target.files?.[0];
    if (!file || !siteId) return;
    e.target.value = '';
    setError(null);
    try {
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/svg+xml' ? 'svg' : 'jpg';
      const r = storageRef(storage, `perfiles/${key}-${siteId}.${ext}`);
      await uploadBytes(r, file, { contentType: file.type });
      setW(key, await getDownloadURL(r));
    } catch {
      setError(m.error);
    }
  }

  async function guardar() {
    if (!siteId) return;
    setBusy(true);
    setError(null);
    try {
      await updateDoc(doc(db, 'sites', siteId), {
        widgetConfig: override,
        scheduleConfig: schedule,
      });
      setDirty(false);
    } catch {
      setError(m.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Selector de sitio + guardar */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12px] text-warm-gray font-medium">{m.configurando}</span>
        {sites.map((s) => (
          <button
            key={s.id}
            onClick={() => setSiteId(s.id)}
            className={`flex items-center gap-1.5 text-[11.5px] font-semibold px-3 py-1.5 rounded-full border transition-colors ${
              siteId === s.id
                ? 'bg-navy border-navy text-white'
                : 'bg-white border-warm-border text-warm-gray hover:border-navy'
            }`}
          >
            <span className="msr text-[14px]">{s.data.icono}</span>
            {s.data.nombre}
          </button>
        ))}
        <div className="flex-1" />
        {dirty && (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-warn-dark bg-warn-bg px-2.5 py-1 rounded-full">
            <span className="msr text-[13px]">edit</span> {m.sinGuardar}
          </span>
        )}
        <button
          onClick={guardar}
          disabled={!dirty || busy || !siteId}
          className="bg-navy text-white text-[12.5px] font-semibold px-4 py-2 rounded-lg hover:bg-navy-light disabled:opacity-50"
        >
          {busy ? m.guardando : m.guardar}
        </button>
      </div>
      {error && <div className="text-danger text-[12px]">{error}</div>}

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* Columna de edición */}
        <div className="flex-1 min-w-0 w-full flex flex-col gap-4">
          <Card icon="palette" title={m.apariencia}>
            <Campo label={m.logo} tag={her('logoUrl')}>
              <div className="flex items-center gap-3">
                <div
                  className="h-12 min-w-[48px] max-w-[160px] rounded-lg flex items-center justify-center overflow-hidden text-white font-bold text-[16px] px-2"
                  style={{ background: eff.color }}
                >
                  {eff.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={eff.logoUrl} alt="logo" className="h-8 w-auto object-contain" />
                  ) : (
                    (eff.titulo[0] ?? 'A').toUpperCase()
                  )}
                </div>
                <label className="flex items-center gap-1.5 border border-warm-border text-ink text-[12px] font-semibold px-3 py-2 rounded-lg hover:border-navy cursor-pointer">
                  <span className="msr text-[15px]">upload</span>
                  {m.logoSubir}
                  <input type="file" accept="image/png,image/jpeg" hidden onChange={subirLogo} />
                </label>
                {override.logoUrl !== undefined && (
                  <button
                    onClick={quitarLogo}
                    className="text-warm-gray text-[12px] font-semibold px-2 py-2 rounded-lg hover:bg-cream-1"
                  >
                    {m.logoQuitar}
                  </button>
                )}
                <span className="text-[10.5px] text-warm-gray-2">{m.logoHint}</span>
              </div>
            </Campo>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <Campo label={m.color} tag={her('color')}>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={eff.color}
                    onChange={(e) => setW('color', e.target.value)}
                    className="h-9 w-12 rounded-lg border border-warm-border cursor-pointer bg-white p-1"
                  />
                  <input
                    value={eff.color}
                    onChange={(e) => setW('color', e.target.value)}
                    className={`${inputCls} font-mono uppercase`}
                  />
                </div>
              </Campo>
              <Campo label={m.accent} tag={her('accent')}>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={eff.accent ?? '#E8EEF5'}
                    onChange={(e) => setW('accent', e.target.value)}
                    className="h-9 w-12 rounded-lg border border-warm-border cursor-pointer bg-white p-1"
                  />
                  <input
                    value={eff.accent ?? '#E8EEF5'}
                    onChange={(e) => setW('accent', e.target.value)}
                    className={`${inputCls} font-mono uppercase`}
                  />
                </div>
              </Campo>
              <Campo label={m.posicion} tag={her('posicion')}>
                <div className="flex gap-1.5">
                  {(
                    [
                      ['bottom-right', m.abajoDer],
                      ['bottom-left', m.abajoIzq],
                    ] as const
                  ).map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => setW('posicion', val)}
                      className={`flex-1 text-[11.5px] font-semibold px-2 py-2 rounded-lg border transition-colors ${
                        eff.posicion === val
                          ? 'bg-navy border-navy text-white'
                          : 'bg-white border-warm-border text-warm-gray hover:border-navy'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Campo>
            </div>
          </Card>

          <Card icon="chat" title={m.mensajes}>
            <div className="flex flex-col gap-4">
              <Campo label={m.titulo} tag={her('titulo')}>
                <input value={eff.titulo} onChange={(e) => setW('titulo', e.target.value)} className={inputCls} />
              </Campo>
              <Campo label={m.saludo} tag={her('saludo')}>
                <textarea
                  rows={2}
                  value={eff.saludo}
                  onChange={(e) => setW('saludo', e.target.value)}
                  className={`${inputCls} resize-none`}
                />
              </Campo>
            </div>
          </Card>

          <Card icon="apps" title={m.botones} subtitle={m.botonesSub}>
            <div className="divide-y divide-cream-3">
              <ToggleRow
                label={m.botonBot}
                hint={m.botonBotHint}
                on={eff.botonBot}
                onChange={(v) => setW('botonBot', v)}
                extra={
                  <>
                    <span className="inline-block mt-1"><HerenciaTag porSitio={override.botonBot !== undefined} idioma={idioma} /></span>
                    {botonPersonalizacion('botonBotTexto', 'botonBotIcono', 'smart_toy', eff.botonBot)}
                  </>
                }
              />
              <ToggleRow
                label={m.botonAgente}
                hint={m.botonAgenteHint}
                on={eff.botonAgente}
                onChange={(v) => setW('botonAgente', v)}
                extra={
                  <>
                    <span className="inline-block mt-1"><HerenciaTag porSitio={override.botonAgente !== undefined} idioma={idioma} /></span>
                    {botonPersonalizacion('botonAgenteTexto', 'botonAgenteIcono', 'support_agent', eff.botonAgente)}
                  </>
                }
              />
              <ToggleRow
                label={m.botonEquipo}
                hint={m.botonEquipoHint}
                on={eff.botonChatEquipo}
                onChange={(v) => setW('botonChatEquipo', v)}
                extra={
                  <div className="mt-1 flex flex-col gap-1">
                    <span className="text-[10.5px] text-warm-gray-2">{m.botonEquipoHint2}</span>
                    <span><HerenciaTag porSitio={override.botonChatEquipo !== undefined} idioma={idioma} /></span>
                    {botonPersonalizacion('botonEquipoTexto', 'botonEquipoIcono', 'groups', eff.botonChatEquipo)}
                  </div>
                }
              />
            </div>
          </Card>

          <Card icon="waving_hand" title={m.bienvenida} subtitle={m.bienvenidaSub}>
            <div className="flex flex-col gap-3">
              <Campo label={m.bienvenidaAI} tag={her('mensajeAI')}>
                <textarea
                  rows={2}
                  value={eff.mensajeAI ?? ''}
                  onChange={(e) => setW('mensajeAI', e.target.value)}
                  placeholder={m.bienvenidaAIHint}
                  className={`${inputCls} resize-none`}
                />
                <span className="text-[10.5px] text-warm-gray-2">{m.bienvenidaAIHint}</span>
              </Campo>
              <Campo label={m.bienvenidaAgente} tag={her('mensajeAgente')}>
                <textarea
                  rows={2}
                  value={eff.mensajeAgente ?? ''}
                  onChange={(e) => setW('mensajeAgente', e.target.value)}
                  className={`${inputCls} resize-none`}
                />
                <span className="text-[10.5px] text-warm-gray-2">{m.bienvenidaAgenteHint}</span>
              </Campo>
              <Campo label={m.bienvenidaFuera} tag={her('mensajeFueraHorario')}>
                <textarea
                  rows={2}
                  value={eff.mensajeFueraHorario ?? ''}
                  onChange={(e) => setW('mensajeFueraHorario', e.target.value)}
                  className={`${inputCls} resize-none`}
                />
                <span className="text-[10.5px] text-warm-gray-2">{m.bienvenidaFueraHint}</span>
              </Campo>
              <span className="text-[10.5px] text-warm-gray-2">{m.bienvenidaNombre}</span>
            </div>
          </Card>

          <Card icon="schedule" title={m.horario} subtitle={m.horarioSub}>
            <div className="flex items-center gap-1.5 mb-3">
              <HerenciaTag porSitio={horarioPorSitio} idioma={idioma} />
            </div>
            <div className="flex flex-col divide-y divide-cream-3">
              {Array.from({ length: 7 }, (_, dia) => {
                const d = diaConfig(dia);
                return (
                  <div key={dia} className="flex items-center gap-3 py-2">
                    <span className="w-9 text-[12px] font-semibold text-ink-2">{m.dias[dia]}</span>
                    <ToggleMini on={d.abierto} onChange={(v) => setDia(dia, { abierto: v })} />
                    {d.abierto ? (
                      <div className="flex items-center gap-2 text-[12px] text-warm-gray">
                        <span className="text-[10.5px] uppercase font-bold tracking-wide">{m.desde}</span>
                        <input
                          type="time"
                          value={d.desde ?? '08:00'}
                          onChange={(e) => setDia(dia, { desde: e.target.value })}
                          className="border border-warm-border rounded-lg px-2 py-1 text-[12px] outline-none focus:border-navy"
                        />
                        <span className="text-[10.5px] uppercase font-bold tracking-wide">{m.hasta}</span>
                        <input
                          type="time"
                          value={d.hasta ?? '17:00'}
                          onChange={(e) => setDia(dia, { hasta: e.target.value })}
                          className="border border-warm-border rounded-lg px-2 py-1 text-[12px] outline-none focus:border-navy"
                        />
                      </div>
                    ) : (
                      <span className="text-[11.5px] text-warm-gray-3">—</span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex items-center gap-2 bg-info-bg rounded-lg px-3 py-2.5 text-[11.5px] text-ink-2">
              <span className="msr text-[15px] text-navy">schedule</span>
              <span>
                {m.textoAuto}{' '}
                <strong>{formatSchedule(effSchedule, idioma) || m.textoAutoVacio}</strong>
              </span>
            </div>
          </Card>
        </div>

        {/* Vista previa en vivo */}
        <aside className="w-full lg:w-[320px] flex-none lg:sticky lg:top-0">
          <div className="text-[10.5px] font-bold tracking-wider text-warm-gray mb-0.5">{m.vistaPrevia}</div>
          <div className="text-[11px] text-warm-gray-2 mb-3">{m.vistaPreviaSub}</div>
          <WidgetPreview
            config={eff}
            horarioTexto={formatSchedule(effSchedule, idioma)}
            m={m}
          />
        </aside>
      </div>
    </div>
  );
}

/** Toggle chico para las filas de horario. */
function ToggleMini({ on, onChange }: { on: boolean; onChange(v: boolean): void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-[18px] w-[32px] flex-none cursor-pointer items-center rounded-full transition-colors ${
        on ? 'bg-ok' : 'bg-warm-gray-4'
      }`}
    >
      <span
        className={`inline-block h-[14px] w-[14px] rounded-full bg-white shadow-card transition-transform ${
          on ? 'translate-x-[16px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  );
}

/** Mock estático del widget (no iframe) — se actualiza en vivo con la config. */
function WidgetPreview({
  config,
  horarioTexto,
  m,
}: {
  config: WidgetConfig;
  horarioTexto: string;
  m: (typeof M)[Idioma];
}) {
  const derecha = config.posicion === 'bottom-right';
  const accent = config.accent ?? '#E8EEF5';
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-panel overflow-hidden border border-warm-border shadow-raised bg-white">
        {/* Header: logo horizontal en formato natural (fondo transparente) + cerrar */}
        <div
          className="h-[52px] px-4 text-white flex items-center gap-2.5"
          style={{ background: config.color }}
        >
          {config.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={config.logoUrl} alt="" className="h-7 w-auto max-w-[120px] object-contain flex-none" />
          ) : (
            <div className="h-7 w-7 rounded-full bg-white/20 flex-none flex items-center justify-center text-[12px] font-bold">
              {(config.titulo[0] ?? 'A').toUpperCase()}
            </div>
          )}
          <div className="text-[13.5px] font-semibold flex-1 truncate">{config.titulo}</div>
          <span className="msr text-[18px] opacity-80">close</span>
        </div>
        <div className="p-4 bg-cream-0 flex flex-col gap-1 min-h-[210px]">
          {/* Hero: saludo + estado + horario (como el Inicio real) */}
          <div className="text-[16px] font-bold text-ink">{config.saludo}</div>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-2">
            <span className="h-2 w-2 rounded-full bg-ok inline-block" />
            {m.previewEnLinea}
          </div>
          {horarioTexto && <div className="text-[10.5px] text-warm-gray">{horarioTexto}</div>}
          {/* Botones de inicio según toggles — el primero muestra el color de acento (activo) */}
          <div className="flex flex-col gap-1.5 mt-2.5">
            {config.botonBot && (
              <PreviewBoton
                icon="smart_toy"
                iconUrl={config.botonBotIcono}
                label={config.botonBotTexto || m.previewBot}
                color={config.color}
                accent={accent}
                activo
                ai
              />
            )}
            {config.botonAgente && (
              <PreviewBoton
                icon="support_agent"
                iconUrl={config.botonAgenteIcono}
                label={config.botonAgenteTexto || m.previewAgente}
                color={config.color}
                badge={2}
              />
            )}
            {config.botonChatEquipo && (
              <PreviewBoton
                icon="groups"
                iconUrl={config.botonEquipoIcono}
                label={config.botonEquipoTexto || m.previewEquipo}
                color={config.color}
              />
            )}
          </div>
        </div>
        {/* Tab bar Inicio / Tickets */}
        <div className="flex border-t border-cream-3 bg-white">
          <div
            className="flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold"
            style={{ color: config.color }}
          >
            <span className="msr msr-fill text-[18px]">home</span>
            {m.previewInicio}
          </div>
          <div className="flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold text-warm-gray-2">
            <span className="msr text-[18px]">confirmation_number</span>
            {m.previewTickets}
          </div>
        </div>
      </div>
      {/* Burbuja según posición (siempre el ícono de mensaje) */}
      {!config.ocultarBurbuja && (
        <div className={`flex ${derecha ? 'justify-end' : 'justify-start'}`}>
          <div
            className="h-12 w-12 rounded-full flex items-center justify-center text-white shadow-raised"
            style={{ background: config.color }}
          >
            <span className="msr msr-fill text-[22px]">chat</span>
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewBoton({
  icon,
  iconUrl,
  label,
  color,
  accent,
  activo,
  badge,
  ai,
}: {
  icon: string;
  iconUrl?: string;
  label: string;
  color: string;
  accent?: string;
  activo?: boolean;
  badge?: number;
  ai?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-2 border border-warm-border rounded-lg px-3 py-2 text-[12px] font-semibold text-ink shadow-card"
      style={{ background: activo ? accent : '#fff' }}
    >
      {iconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={iconUrl} alt="" className="h-[18px] w-[18px] object-contain rounded flex-none" />
      ) : (
        <span className="msr text-[16px] flex-none" style={{ color }}>
          {icon}
        </span>
      )}
      <span className="flex-1 truncate">{label}</span>
      {ai && (
        <span className="text-[8.5px] font-extrabold tracking-wide text-ai bg-ai-bg px-1.5 py-0.5 rounded-full flex-none">
          AI
        </span>
      )}
      {badge != null && (
        <span className="h-[17px] min-w-[17px] px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center flex-none">
          {badge}
        </span>
      )}
      <span className="msr text-[14px] text-warm-gray-2 flex-none">
        {activo ? 'chevron_left' : 'chevron_right'}
      </span>
    </div>
  );
}
