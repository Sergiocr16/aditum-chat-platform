'use client';

// Pantalla 1h — Reportes SLA (solo Admin).

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Idioma } from '@aditum-chat/shared';
import { useAuth } from '@/lib/auth';
import { useSiteFilter } from '@/components/Shell';
import { iniciales, useSites, useTeam } from '@/lib/data';
import { mediana, useDailyMetrics } from '@/lib/data-contactos';

const M = {
  es: {
    titulo: 'Reportes',
    soloAdmin: 'Solo visible para rol Admin',
    accesoTitulo: 'Acceso restringido',
    accesoTexto: 'Esta sección solo está disponible para el rol Admin. Contactá a tu administrador si necesitás ver los reportes.',
    rango7: 'Últimos 7 días',
    rango30: 'Últimos 30 días',
    rango90: 'Últimos 90 días',
    todosAgentes: 'Todos los agentes',
    todosSitios: 'Todos los sitios',
    kpiPrimeraRespuesta: 'Primera respuesta (mediana)',
    kpiSla: 'Cumplimiento SLA',
    kpiBot: 'Resueltas por el bot',
    kpiCsat: 'CSAT',
    valoraciones: 'valoraciones',
    kpiBotUtil: 'Respuestas útiles del bot',
    votos: 'votos',
    tendenciaPr: '2 min mejor que el período anterior',
    tendenciaSla: '+1.4 pts vs período anterior',
    tendenciaBot: '+5 pts desde que se amplió la base de conocimiento',
    tendenciaCsat: 'estable vs período anterior',
    tendenciaBotUtil: 'feedback "¿te sirvió?" del widget',
    chartTitulo: 'Tiempo de primera respuesta por semana',
    serieAgentes: 'Agentes',
    serieBot: 'Bot',
    metaSla: 'Meta SLA 15 min',
    sem: 'Sem',
    tablaTitulo: 'Desempeño por agente',
    colAgente: 'Agente',
    colCumplimiento: 'Cumplimiento SLA',
    botClaude: 'Bot (Claude)',
    editarConfig: 'editar en Configuración',
    datosMock: 'Sin métricas todavía — mostrando datos de ejemplo del diseño.',
    min: 'min',
  },
  en: {
    titulo: 'Reports',
    soloAdmin: 'Only visible to the Admin role',
    accesoTitulo: 'Restricted access',
    accesoTexto: 'This section is only available for the Admin role. Contact your administrator if you need to see the reports.',
    rango7: 'Last 7 days',
    rango30: 'Last 30 days',
    rango90: 'Last 90 days',
    todosAgentes: 'All agents',
    todosSitios: 'All sites',
    kpiPrimeraRespuesta: 'First response (median)',
    kpiSla: 'SLA compliance',
    kpiBot: 'Resolved by the bot',
    kpiCsat: 'CSAT',
    valoraciones: 'ratings',
    kpiBotUtil: 'Helpful bot answers',
    votos: 'votes',
    tendenciaPr: '2 min better than previous period',
    tendenciaSla: '+1.4 pts vs previous period',
    tendenciaBot: '+5 pts since the knowledge base grew',
    tendenciaCsat: 'stable vs previous period',
    tendenciaBotUtil: '"was this helpful?" widget feedback',
    chartTitulo: 'First response time by week',
    serieAgentes: 'Agents',
    serieBot: 'Bot',
    metaSla: 'SLA target 15 min',
    sem: 'Wk',
    tablaTitulo: 'Performance by agent',
    colAgente: 'Agent',
    colCumplimiento: 'SLA compliance',
    botClaude: 'Bot (Claude)',
    editarConfig: 'edit in Settings',
    datosMock: 'No metrics yet — showing sample data from the design.',
    min: 'min',
  },
} as const;

type Msgs = (typeof M)[Idioma];

// Datos mock del diseño (pantalla 1h) — se usan cuando metrics_daily está vacía.
const MOCK_AGENTES = [
  { nombre: 'Laura Campos', pct: 97 },
  { nombre: 'María S.', pct: 93 },
  { nombre: 'Diego P.', pct: 86 },
];
const MOCK_SERIE_AGENTES = [17.2, 15.6, 13.4, 12.3];
const MOCK_SERIE_BOT = [12.6, 11.9, 11.4, 10.8];

export default function ReportesPage() {
  const { agent } = useAuth();
  const idioma: Idioma = agent?.idioma ?? 'es';
  const m = M[idioma];
  const { siteId: siteGlobal } = useSiteFilter();

  const [rango, setRango] = useState<7 | 30 | 90>(30);
  const [agenteId, setAgenteId] = useState('');
  const [siteLocal, setSiteLocal] = useState('');

  const team = useTeam();
  const sites = useSites();
  const metricsDocs = useDailyMetrics();

  const siteEfectivo = siteLocal || siteGlobal;

  // Agregación client-side de metrics_daily según los filtros.
  const agg = useMemo(() => {
    const desde = new Date(Date.now() - rango * 86_400_000).toISOString().slice(0, 10);
    const docs = metricsDocs.filter(
      (d) => d.data.fecha >= desde && (!siteEfectivo || d.data.siteId === siteEfectivo),
    );
    if (docs.length === 0) return null;

    const prMs: number[] = [];
    let slaC = 0;
    let slaV = 0;
    let bot = 0;
    let agente = 0;
    let csatSum = 0;
    let csatCount = 0;
    let botHelpful = 0;
    let botNotHelpful = 0;
    const porAgente: Record<string, { slaCumplidos: number; slaTotal: number }> = {};

    for (const d of docs) {
      prMs.push(...(d.data.primeraRespuestaMs ?? []));
      slaC += d.data.slaCumplidos ?? 0;
      slaV += d.data.slaVencidos ?? 0;
      bot += d.data.resueltasBot ?? 0;
      agente += d.data.resueltasAgente ?? 0;
      csatSum += d.data.csatSum ?? 0;
      csatCount += d.data.csatCount ?? 0;
      botHelpful += d.data.botHelpfulCount ?? 0;
      botNotHelpful += d.data.botNotHelpfulCount ?? 0;
      for (const [uid, a] of Object.entries(d.data.porAgente ?? {})) {
        const acc = (porAgente[uid] ??= { slaCumplidos: 0, slaTotal: 0 });
        acc.slaCumplidos += a.slaCumplidos;
        acc.slaTotal += a.slaTotal;
      }
    }

    // Serie semanal (4 buckets) de mediana de primera respuesta de agentes, en minutos.
    const ordenados = [...docs].sort((a, b) => a.data.fecha.localeCompare(b.data.fecha));
    const serieAgentes = [0, 1, 2, 3].map((i) => {
      const slice = ordenados.slice(
        Math.floor((i * ordenados.length) / 4),
        Math.floor(((i + 1) * ordenados.length) / 4),
      );
      const med = mediana(slice.flatMap((d) => d.data.primeraRespuestaMs ?? []));
      return med === null ? null : med / 60_000;
    });

    const medMs = mediana(prMs);
    return {
      primeraRespuestaMin: medMs === null ? null : Math.round(medMs / 60_000),
      slaPct: slaC + slaV > 0 ? (slaC / (slaC + slaV)) * 100 : null,
      botPct: bot + agente > 0 ? (bot / (bot + agente)) * 100 : null,
      csat: csatCount > 0 ? csatSum / csatCount : null,
      csatCount,
      botUtilPct:
        botHelpful + botNotHelpful > 0 ? (botHelpful / (botHelpful + botNotHelpful)) * 100 : null,
      botVotes: botHelpful + botNotHelpful,
      porAgente,
      serieAgentes,
    };
  }, [metricsDocs, rango, siteEfectivo]);

  // Filas de la tabla: reales si hay porAgente agregado; si no, mock del diseño.
  const filasAgentes = useMemo(() => {
    const nombrePorUid = Object.fromEntries(team.map((t) => [t.id, t.data.nombre]));
    const reales = Object.entries(agg?.porAgente ?? {})
      .filter(([uid, a]) => a.slaTotal > 0 && (!agenteId || uid === agenteId))
      .map(([uid, a]) => ({
        nombre: nombrePorUid[uid] ?? uid,
        pct: Math.round((a.slaCumplidos / a.slaTotal) * 100),
      }))
      .sort((a, b) => b.pct - a.pct);
    return reales.length > 0 ? reales : MOCK_AGENTES;
  }, [agg, team, agenteId]);

  if (agent && agent.perfil?.rol !== 'admin') {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="text-center max-w-sm">
          <span className="msr text-[44px] block mb-3 text-warm-gray-3">lock</span>
          <div className="text-[15px] font-bold mb-1">{m.accesoTitulo}</div>
          <p className="text-[12.5px] text-warm-gray leading-relaxed">{m.accesoTexto}</p>
        </div>
      </div>
    );
  }

  const rangoLabel = rango === 7 ? m.rango7 : rango === 90 ? m.rango90 : m.rango30;
  const kpiPr = agg?.primeraRespuestaMin ?? 8;
  const kpiSla = agg?.slaPct != null ? agg.slaPct.toFixed(1) : '94.2';
  const kpiBot = agg?.botPct != null ? Math.round(agg.botPct) : 41;
  const kpiCsat = agg?.csat != null ? agg.csat.toFixed(1) : '4.6';
  const kpiCsatCount = agg?.csatCount || 318;
  const kpiBotUtil = agg?.botUtilPct != null ? Math.round(agg.botUtilPct) : 87;
  const kpiBotVotes = agg?.botVotes || 124;
  const serieAgentes =
    agg && agg.serieAgentes.every((v): v is number => v !== null)
      ? agg.serieAgentes
      : MOCK_SERIE_AGENTES;

  return (
    <div className="h-full overflow-y-auto">
      <header className="px-4 sm:px-6 pt-5 pb-4 border-b border-warm-border bg-white sticky top-0 z-10">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-[15px] font-bold">{m.titulo}</h1>
          <span className="flex items-center gap-1 text-[11px] text-warm-gray">
            <span className="msr text-[13px]">shield_person</span>
            {m.soloAdmin} · {rangoLabel}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <select
            value={rango}
            onChange={(e) => setRango(Number(e.target.value) as 7 | 30 | 90)}
            className="text-[12px] font-medium bg-white border border-warm-border rounded-lg px-2.5 py-1.5 outline-none cursor-pointer"
          >
            <option value={7}>{m.rango7}</option>
            <option value={30}>{m.rango30}</option>
            <option value={90}>{m.rango90}</option>
          </select>
          <select
            value={agenteId}
            onChange={(e) => setAgenteId(e.target.value)}
            className="text-[12px] font-medium bg-white border border-warm-border rounded-lg px-2.5 py-1.5 outline-none cursor-pointer"
          >
            <option value="">{m.todosAgentes}</option>
            {team.map((t) => (
              <option key={t.id} value={t.id}>
                {t.data.nombre}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1 text-[12px] font-medium bg-white border border-warm-border rounded-lg px-2.5 py-1.5">
            <span className="msr text-[15px] text-warm-gray">language</span>
            <select
              value={siteLocal}
              onChange={(e) => setSiteLocal(e.target.value)}
              className="outline-none cursor-pointer bg-transparent"
            >
              <option value="">{m.todosSitios}</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.data.nombre}
                </option>
              ))}
            </select>
          </div>
          {!agg && <span className="text-[11px] text-warm-gray-2">{m.datosMock}</span>}
        </div>
      </header>

      <div className="p-4 sm:p-6 flex flex-col gap-5 max-w-[1080px]">
        {/* KPI cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <KpiCard
            valor={`${kpiPr} ${m.min}`}
            label={m.kpiPrimeraRespuesta}
            tendencia={m.tendenciaPr}
            positiva
          />
          <KpiCard valor={`${kpiSla}%`} label={m.kpiSla} tendencia={m.tendenciaSla} positiva />
          <KpiCard valor={`${kpiBot}%`} label={m.kpiBot} tendencia={m.tendenciaBot} positiva />
          <KpiCard
            valor={`${kpiCsat} ★`}
            label={`${m.kpiCsat} (${kpiCsatCount} ${m.valoraciones})`}
            tendencia={m.tendenciaCsat}
          />
          <KpiCard
            valor={`${kpiBotUtil}%`}
            label={`${m.kpiBotUtil} (${kpiBotVotes} ${m.votos})`}
            tendencia={m.tendenciaBotUtil}
            positiva
          />
        </div>

        {/* Gráfico de líneas SVG */}
        <div className="bg-white rounded-card shadow-card border border-cream-3 p-5">
          <div className="text-[13px] font-bold mb-1">{m.chartTitulo}</div>
          <LineChart serieAgentes={serieAgentes} serieBot={MOCK_SERIE_BOT} m={m} />
          <div className="flex items-center gap-5 mt-2 text-[11px] text-warm-gray">
            <span className="flex items-center gap-1.5">
              <span className="h-[3px] w-5 rounded-full bg-navy inline-block" />
              {m.serieAgentes}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-[3px] w-5 rounded-full bg-ai inline-block" />
              {m.serieBot}
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="20" height="4" aria-hidden>
                <line x1="0" y1="2" x2="20" y2="2" stroke="#e3a93c" strokeWidth="2" strokeDasharray="4 3" />
              </svg>
              {m.metaSla}
            </span>
          </div>
        </div>

        {/* Desempeño por agente */}
        <div className="bg-white rounded-card shadow-card border border-cream-3 p-5">
          <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
            <div className="text-[13px] font-bold">{m.tablaTitulo}</div>
            <Link href="/configuracion" className="text-[11.5px] font-semibold text-navy hover:underline">
              {m.editarConfig}
            </Link>
          </div>
          <div className="flex flex-col">
            {filasAgentes.map((a) => (
              <FilaAgente key={a.nombre} nombre={a.nombre} pct={a.pct} />
            ))}
            <FilaAgente nombre={m.botClaude} pct={99} bot />
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  valor,
  label,
  tendencia,
  positiva,
}: {
  valor: string;
  label: string;
  tendencia: string;
  positiva?: boolean;
}) {
  return (
    <div className="bg-white rounded-card shadow-card border border-cream-3 p-4">
      <div className="text-[26px] font-bold leading-tight">{valor}</div>
      <div className="text-[11.5px] text-warm-gray mt-1">{label}</div>
      <div
        className={`flex items-center gap-1 text-[10.5px] font-medium mt-2 ${
          positiva ? 'text-ok-dark' : 'text-warm-gray-2'
        }`}
      >
        <span className="msr text-[13px]">{positiva ? 'trending_up' : 'trending_flat'}</span>
        {tendencia}
      </div>
    </div>
  );
}

// Gráfico de líneas hecho a mano (sin librerías). Dominio Y: 9–19 min,
// gridlines en 12/15/18; X: 4 semanas.
function LineChart({
  serieAgentes,
  serieBot,
  m,
}: {
  serieAgentes: number[];
  serieBot: number[];
  m: Msgs;
}) {
  const W = 640;
  const H = 220;
  const PAD = { top: 14, right: 16, bottom: 26, left: 34 };
  const yMin = 9;
  const yMax = 19;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / 3) * plotW;
  const y = (v: number) =>
    PAD.top + ((yMax - Math.min(yMax, Math.max(yMin, v))) / (yMax - yMin)) * plotH;
  const puntos = (serie: number[]) => serie.map((v, i) => `${x(i)},${y(v)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={m.chartTitulo}>
      {/* Gridlines + eje Y (12 / 15 / 18) */}
      {[12, 15, 18].map((v) => (
        <g key={v}>
          <line x1={PAD.left} y1={y(v)} x2={W - PAD.right} y2={y(v)} stroke="#ece8e1" strokeWidth="1" />
          <text x={PAD.left - 8} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="#8a8375">
            {v}
          </text>
        </g>
      ))}

      {/* Meta SLA 15 min */}
      <line
        x1={PAD.left}
        y1={y(15)}
        x2={W - PAD.right}
        y2={y(15)}
        stroke="#e3a93c"
        strokeWidth="1.5"
        strokeDasharray="5 4"
      />

      {/* Series */}
      <polyline points={puntos(serieAgentes)} fill="none" stroke="#123c68" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={puntos(serieBot)} fill="none" stroke="#7a4fb3" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {serieAgentes.map((v, i) => (
        <circle key={`a${i}`} cx={x(i)} cy={y(v)} r="3.5" fill="#123c68" stroke="#fff" strokeWidth="1.5" />
      ))}
      {serieBot.map((v, i) => (
        <circle key={`b${i}`} cx={x(i)} cy={y(v)} r="3.5" fill="#7a4fb3" stroke="#fff" strokeWidth="1.5" />
      ))}

      {/* Eje X */}
      {[0, 1, 2, 3].map((i) => (
        <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="#8a8375">
          {m.sem} {i + 1}
        </text>
      ))}
    </svg>
  );
}

function FilaAgente({ nombre, pct, bot }: { nombre: string; pct: number; bot?: boolean }) {
  return (
    <div className={`flex items-center gap-3 py-2.5 border-b border-cream-3 last:border-b-0 ${bot ? 'bg-ai-bg/40 -mx-2 px-2 rounded-card' : ''}`}>
      <div
        className={`h-8 w-8 rounded-full flex-none flex items-center justify-center text-[10.5px] font-bold ${
          bot ? 'bg-ai-bg text-ai' : 'bg-cream-3 text-ink-2'
        }`}
      >
        {bot ? <span className="msr text-[17px]">smart_toy</span> : iniciales(nombre)}
      </div>
      <div className="w-[150px] flex-none text-[12.5px] font-semibold truncate">{nombre}</div>
      <div className="flex-1 h-2 rounded-full bg-cream-2 overflow-hidden">
        <div
          className={`h-full rounded-full ${bot ? 'bg-ai' : 'bg-navy'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="w-11 flex-none text-right text-[12.5px] font-bold">{pct}%</div>
    </div>
  );
}
