'use client';

// Pantalla 1h — Reportes (solo Admin): SLA, primera respuesta y calificaciones.
// Todo con datos reales de metrics_daily + la colección csat; sin mocks.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Idioma, SlaPolicy } from '@aditum-chat/shared';
import { useAuth } from '@/lib/auth';
import { useSiteFilter } from '@/components/Shell';
import { iniciales, useDoc, useSites, useTeam } from '@/lib/data';
import { mediana, useCsatRatings, useDailyMetrics } from '@/lib/data-contactos';

// Colores de series validados (dataviz): una serie por gráfico.
const SERIE = '#7D4A82'; // morado de gráfico (tono de marca, aclarado para lectura)
const META = '#E3A93C'; // línea de meta (reservado)
const BOT = '#7A4FB3'; // exclusivo de lo relacionado al bot

const M = {
  es: {
    titulo: 'Reportes',
    soloAdmin: 'Solo visible para rol Admin',
    accesoTitulo: 'Acceso restringido',
    accesoTexto:
      'Esta sección solo está disponible para el rol Admin. Contactá a tu administrador si necesitás ver los reportes.',
    rango7: 'Últimos 7 días',
    rango30: 'Últimos 30 días',
    rango90: 'Últimos 90 días',
    todosAgentes: 'Todos los agentes',
    todosSitios: 'Todos los sitios',
    kpiPrimeraRespuesta: 'Primera respuesta (mediana)',
    kpiSla: 'Cumplimiento SLA',
    kpiBot: 'Resueltas por el bot',
    kpiCsat: 'CSAT promedio',
    kpiValoraciones: 'Valoraciones recibidas',
    kpiBotUtil: 'Respuestas útiles del bot',
    vsAnterior: 'vs período anterior',
    sinPrevio: 'sin período anterior',
    chartPr: 'Primera respuesta por semana',
    chartSla: 'Cumplimiento SLA por semana',
    chartDist: 'Distribución de calificaciones',
    chartCsat: 'CSAT promedio por semana',
    metaSla: 'Meta',
    min: 'min',
    sinDatos: 'Sin datos en el rango elegido.',
    tablaTitulo: 'Desempeño por agente',
    colResueltas: 'Resueltas',
    colCsat: 'CSAT',
    colCumplimiento: 'Cumplimiento SLA',
    botClaude: 'Bot (Claude)',
    botUtiles: 'útiles',
    votos: 'votos',
    editarConfig: 'editar en Configuración',
    valoracion: 'valoración',
    valoraciones: 'valoraciones',
  },
  en: {
    titulo: 'Reports',
    soloAdmin: 'Only visible to the Admin role',
    accesoTitulo: 'Restricted access',
    accesoTexto:
      'This section is only available for the Admin role. Contact your administrator if you need to see the reports.',
    rango7: 'Last 7 days',
    rango30: 'Last 30 days',
    rango90: 'Last 90 days',
    todosAgentes: 'All agents',
    todosSitios: 'All sites',
    kpiPrimeraRespuesta: 'First response (median)',
    kpiSla: 'SLA compliance',
    kpiBot: 'Resolved by the bot',
    kpiCsat: 'Average CSAT',
    kpiValoraciones: 'Ratings received',
    kpiBotUtil: 'Helpful bot answers',
    vsAnterior: 'vs previous period',
    sinPrevio: 'no previous period',
    chartPr: 'First response by week',
    chartSla: 'SLA compliance by week',
    chartDist: 'Rating distribution',
    chartCsat: 'Average CSAT by week',
    metaSla: 'Target',
    min: 'min',
    sinDatos: 'No data in the selected range.',
    tablaTitulo: 'Performance by agent',
    colResueltas: 'Resolved',
    colCsat: 'CSAT',
    colCumplimiento: 'SLA compliance',
    botClaude: 'Bot (Claude)',
    botUtiles: 'helpful',
    votos: 'votes',
    editarConfig: 'edit in Settings',
    valoracion: 'rating',
    valoraciones: 'ratings',
  },
} as const;

type Msgs = (typeof M)[Idioma];

const DIA_MS = 86_400_000;
const fechaISO = (t: number) => new Date(t).toISOString().slice(0, 10);

interface Agg {
  primeraRespuestaMin: number | null;
  slaPct: number | null;
  botPct: number | null;
  botUtilPct: number | null;
  botVotes: number;
  botResueltas: number;
  porAgente: Record<string, { slaCumplidos: number; slaTotal: number; resueltas: number }>;
  seriePr: (number | null)[];
  serieSla: (number | null)[];
}

interface CsatAgg {
  promedio: number | null;
  count: number;
  dist: [number, number, number, number, number]; // índice 0 = 1★ … 4 = 5★
  serie: (number | null)[];
  porAgente: Record<string, { sum: number; count: number }>;
}

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
  const csatDocs = useCsatRatings();
  const slaPolicy = useDoc<SlaPolicy>('settings/sla');
  const metaPrMin = slaPolicy?.data.primeraRespuestaMin ?? 15;

  const siteEfectivo = siteLocal || siteGlobal;
  const ahora = Date.now();
  const desdeActual = fechaISO(ahora - rango * DIA_MS);
  const desdePrevio = fechaISO(ahora - 2 * rango * DIA_MS);

  /** Agrega metrics_daily en una ventana [desde, hasta) con serie de 4 buckets. */
  function aggregar(desde: string, hasta: string | null): Agg | null {
    const docs = metricsDocs.filter(
      (d) =>
        d.data.fecha >= desde &&
        (!hasta || d.data.fecha < hasta) &&
        (!siteEfectivo || d.data.siteId === siteEfectivo),
    );
    if (docs.length === 0) return null;

    const prMs: number[] = [];
    let slaC = 0;
    let slaV = 0;
    let bot = 0;
    let agente = 0;
    let botHelpful = 0;
    let botNotHelpful = 0;
    const porAgente: Agg['porAgente'] = {};

    for (const d of docs) {
      prMs.push(...(d.data.primeraRespuestaMs ?? []));
      slaC += d.data.slaCumplidos ?? 0;
      slaV += d.data.slaVencidos ?? 0;
      bot += d.data.resueltasBot ?? 0;
      agente += d.data.resueltasAgente ?? 0;
      botHelpful += d.data.botHelpfulCount ?? 0;
      botNotHelpful += d.data.botNotHelpfulCount ?? 0;
      for (const [uid, a] of Object.entries(d.data.porAgente ?? {})) {
        const acc = (porAgente[uid] ??= { slaCumplidos: 0, slaTotal: 0, resueltas: 0 });
        acc.slaCumplidos += a.slaCumplidos ?? 0;
        acc.slaTotal += a.slaTotal ?? 0;
        acc.resueltas += a.resueltas ?? 0;
      }
    }

    // Buckets por FECHA (4 tramos iguales del rango), no por cantidad de docs.
    const bucketDe = (fecha: string) => {
      const t0 = new Date(`${desde}T00:00:00Z`).getTime();
      const t1 = hasta ? new Date(`${hasta}T00:00:00Z`).getTime() : ahora;
      const t = new Date(`${fecha}T00:00:00Z`).getTime();
      return Math.min(3, Math.max(0, Math.floor(((t - t0) / (t1 - t0)) * 4)));
    };
    const prBuckets: number[][] = [[], [], [], []];
    const slaBuckets = [0, 1, 2, 3].map(() => ({ c: 0, v: 0 }));
    for (const d of docs) {
      const b = bucketDe(d.data.fecha);
      prBuckets[b].push(...(d.data.primeraRespuestaMs ?? []));
      slaBuckets[b].c += d.data.slaCumplidos ?? 0;
      slaBuckets[b].v += d.data.slaVencidos ?? 0;
    }
    const seriePr = prBuckets.map((b) => {
      const med = mediana(b);
      return med === null ? null : med / 60_000;
    });
    const serieSla = slaBuckets.map((b) =>
      b.c + b.v > 0 ? (b.c / (b.c + b.v)) * 100 : null,
    );

    const medMs = mediana(prMs);
    return {
      primeraRespuestaMin: medMs === null ? null : Math.round(medMs / 60_000),
      slaPct: slaC + slaV > 0 ? (slaC / (slaC + slaV)) * 100 : null,
      botPct: bot + agente > 0 ? (bot / (bot + agente)) * 100 : null,
      botUtilPct:
        botHelpful + botNotHelpful > 0 ? (botHelpful / (botHelpful + botNotHelpful)) * 100 : null,
      botVotes: botHelpful + botNotHelpful,
      botResueltas: bot,
      porAgente,
      seriePr,
      serieSla,
    };
  }

  /** Agrega la colección csat en una ventana, con filtro de sitio y agente. */
  function aggregarCsat(desdeTs: number, hastaTs: number | null): CsatAgg {
    const dist: CsatAgg['dist'] = [0, 0, 0, 0, 0];
    const buckets = [0, 1, 2, 3].map(() => ({ sum: 0, count: 0 }));
    const porAgente: CsatAgg['porAgente'] = {};
    let sum = 0;
    let count = 0;
    const fin = hastaTs ?? ahora;
    for (const r of csatDocs) {
      const at = (r.data.createdAt as { toDate?: () => Date })?.toDate?.()?.getTime();
      if (!at || at < desdeTs || at >= fin) continue;
      if (siteEfectivo && r.data.siteId !== siteEfectivo) continue;
      if (agenteId && r.data.agenteId !== agenteId) continue;
      const rating = r.data.rating;
      dist[rating - 1] += 1;
      sum += rating;
      count += 1;
      const b = Math.min(3, Math.max(0, Math.floor(((at - desdeTs) / (fin - desdeTs)) * 4)));
      buckets[b].sum += rating;
      buckets[b].count += 1;
      if (r.data.agenteId) {
        const acc = (porAgente[r.data.agenteId] ??= { sum: 0, count: 0 });
        acc.sum += rating;
        acc.count += 1;
      }
    }
    return {
      promedio: count > 0 ? sum / count : null,
      count,
      dist,
      serie: buckets.map((b) => (b.count > 0 ? b.sum / b.count : null)),
      porAgente,
    };
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const agg = useMemo(() => aggregar(desdeActual, null), [metricsDocs, rango, siteEfectivo]);
  const aggPrev = useMemo(
    () => aggregar(desdePrevio, desdeActual),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [metricsDocs, rango, siteEfectivo],
  );
  const csat = useMemo(
    () => aggregarCsat(ahora - rango * DIA_MS, null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [csatDocs, rango, siteEfectivo, agenteId],
  );
  const csatPrev = useMemo(
    () => aggregarCsat(ahora - 2 * rango * DIA_MS, ahora - rango * DIA_MS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [csatDocs, rango, siteEfectivo, agenteId],
  );

  // Etiquetas de los 4 buckets: fecha de inicio de cada tramo.
  const etiquetas = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(idioma === 'es' ? 'es-CR' : 'en-US', {
      day: 'numeric',
      month: 'short',
    });
    return [0, 1, 2, 3].map((i) =>
      fmt.format(new Date(ahora - rango * DIA_MS + (i * rango * DIA_MS) / 4)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rango, idioma]);

  const filasAgentes = useMemo(() => {
    const nombrePorUid = Object.fromEntries(team.map((t) => [t.id, t.data.nombre]));
    return Object.entries(agg?.porAgente ?? {})
      .filter(([uid, a]) => a.slaTotal > 0 && (!agenteId || uid === agenteId))
      .map(([uid, a]) => ({
        uid,
        nombre: nombrePorUid[uid] ?? uid,
        resueltas: a.resueltas,
        csat: csat.porAgente[uid] ? csat.porAgente[uid].sum / csat.porAgente[uid].count : null,
        pct: Math.round((a.slaCumplidos / a.slaTotal) * 100),
      }))
      .sort((a, b) => b.pct - a.pct);
  }, [agg, team, agenteId, csat.porAgente]);

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

  // Deltas reales contra el período anterior (null = sin datos previos).
  const deltaPr =
    agg?.primeraRespuestaMin != null && aggPrev?.primeraRespuestaMin != null
      ? agg.primeraRespuestaMin - aggPrev.primeraRespuestaMin
      : null;
  const deltaSla =
    agg?.slaPct != null && aggPrev?.slaPct != null ? agg.slaPct - aggPrev.slaPct : null;
  const deltaBot =
    agg?.botPct != null && aggPrev?.botPct != null ? agg.botPct - aggPrev.botPct : null;
  const deltaCsat =
    csat.promedio != null && csatPrev.promedio != null ? csat.promedio - csatPrev.promedio : null;
  const deltaVal = csatPrev.count > 0 || csat.count > 0 ? csat.count - csatPrev.count : null;
  const deltaBotUtil =
    agg?.botUtilPct != null && aggPrev?.botUtilPct != null
      ? agg.botUtilPct - aggPrev.botUtilPct
      : null;

  const totalDist = csat.dist.reduce((a, b) => a + b, 0);

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
        </div>
      </header>

      <div className="p-4 sm:p-6 flex flex-col gap-5">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-6 gap-4">
          <KpiCard
            valor={agg?.primeraRespuestaMin != null ? `${agg.primeraRespuestaMin} ${m.min}` : '—'}
            label={m.kpiPrimeraRespuesta}
            delta={deltaPr}
            unidad={` ${m.min}`}
            mejorAbajo
            m={m}
          />
          <KpiCard
            valor={agg?.slaPct != null ? `${agg.slaPct.toFixed(1)}%` : '—'}
            label={m.kpiSla}
            delta={deltaSla}
            unidad=" pts"
            m={m}
          />
          <KpiCard
            valor={agg?.botPct != null ? `${Math.round(agg.botPct)}%` : '—'}
            label={m.kpiBot}
            delta={deltaBot}
            unidad=" pts"
            m={m}
          />
          <KpiCard
            valor={csat.promedio != null ? `${csat.promedio.toFixed(1)} ★` : '—'}
            label={m.kpiCsat}
            delta={deltaCsat}
            unidad=""
            decimales={1}
            m={m}
          />
          <KpiCard
            valor={csat.count > 0 ? String(csat.count) : '—'}
            label={m.kpiValoraciones}
            delta={deltaVal}
            unidad=""
            m={m}
          />
          <KpiCard
            valor={agg?.botUtilPct != null ? `${Math.round(agg.botUtilPct)}%` : '—'}
            label={`${m.kpiBotUtil}${agg?.botVotes ? ` (${agg.botVotes} ${m.votos})` : ''}`}
            delta={deltaBotUtil}
            unidad=" pts"
            m={m}
          />
        </div>

        {/* Gráficos: SLA / primera respuesta y calificaciones */}
        <div className="grid xl:grid-cols-2 gap-5">
          <ChartCard titulo={m.chartPr}>
            {agg && agg.seriePr.some((v) => v !== null) ? (
              <>
                <LineChart
                  serie={agg.seriePr}
                  etiquetas={etiquetas}
                  color={SERIE}
                  meta={metaPrMin}
                  sufijo={` ${m.min}`}
                />
                <Leyenda
                  items={[
                    { color: SERIE, label: m.kpiPrimeraRespuesta },
                    { color: META, label: `${m.metaSla} ${metaPrMin} ${m.min}`, dash: true },
                  ]}
                />
              </>
            ) : (
              <SinDatos m={m} />
            )}
          </ChartCard>

          <ChartCard titulo={m.chartSla}>
            {agg && agg.serieSla.some((v) => v !== null) ? (
              <LineChart
                serie={agg.serieSla}
                etiquetas={etiquetas}
                color={SERIE}
                dominio={[0, 100]}
                sufijo="%"
              />
            ) : (
              <SinDatos m={m} />
            )}
          </ChartCard>

          <ChartCard titulo={m.chartDist}>
            {totalDist > 0 ? (
              <div className="flex flex-col gap-2 py-1">
                {[5, 4, 3, 2, 1].map((estrellas) => {
                  const count = csat.dist[estrellas - 1];
                  const pct = totalDist > 0 ? (count / totalDist) * 100 : 0;
                  return (
                    <div key={estrellas} className="flex items-center gap-3">
                      <span className="w-9 flex-none text-[12px] font-semibold text-ink-2 flex items-center gap-0.5 justify-end">
                        {estrellas}
                        <span className="msr msr-fill text-[13px] text-[#E3A93C]">star</span>
                      </span>
                      <div
                        className="flex-1 h-4 rounded bg-cream-2 overflow-hidden"
                        title={`${count} ${count === 1 ? m.valoracion : m.valoraciones}`}
                      >
                        <div
                          className="h-full rounded"
                          style={{ width: `${pct}%`, background: SERIE }}
                        />
                      </div>
                      <span className="w-20 flex-none text-[11.5px] text-warm-gray tabular-nums">
                        {count} · {Math.round(pct)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <SinDatos m={m} />
            )}
          </ChartCard>

          <ChartCard titulo={m.chartCsat}>
            {csat.serie.some((v) => v !== null) ? (
              <LineChart
                serie={csat.serie}
                etiquetas={etiquetas}
                color={SERIE}
                dominio={[1, 5]}
                sufijo=" ★"
              />
            ) : (
              <SinDatos m={m} />
            )}
          </ChartCard>
        </div>

        {/* Desempeño por agente */}
        <div className="bg-white rounded-card shadow-card border border-cream-3 p-5">
          <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
            <div className="text-[13px] font-bold">{m.tablaTitulo}</div>
            <Link
              href="/configuracion"
              className="text-[11.5px] font-semibold text-navy hover:underline"
            >
              {m.editarConfig}
            </Link>
          </div>
          {filasAgentes.length > 0 || (agg?.botResueltas ?? 0) > 0 ? (
            <div className="flex flex-col">
              <div className="hidden sm:flex items-center gap-3 pb-2 text-[10px] font-bold tracking-wider text-warm-gray-2 uppercase">
                <span className="w-8" />
                <span className="w-[150px] flex-none" />
                <span className="w-16 flex-none text-right">{m.colResueltas}</span>
                <span className="w-14 flex-none text-right">{m.colCsat}</span>
                <span className="flex-1 pl-3">{m.colCumplimiento}</span>
                <span className="w-11" />
              </div>
              {filasAgentes.map((a) => (
                <FilaAgente
                  key={a.uid}
                  nombre={a.nombre}
                  resueltas={a.resueltas}
                  csat={a.csat}
                  pct={a.pct}
                />
              ))}
              {(agg?.botResueltas ?? 0) > 0 && (
                <FilaBot
                  nombre={m.botClaude}
                  resueltas={agg!.botResueltas}
                  utilPct={agg!.botUtilPct}
                  votos={agg!.botVotes}
                  etiquetaUtil={m.botUtiles}
                />
              )}
            </div>
          ) : (
            <SinDatos m={m} />
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  valor,
  label,
  delta,
  unidad,
  decimales = 0,
  mejorAbajo,
  m,
}: {
  valor: string;
  label: string;
  delta: number | null;
  unidad: string;
  decimales?: number;
  /** true cuando bajar es bueno (tiempos). */
  mejorAbajo?: boolean;
  m: Msgs;
}) {
  const redondeado = delta != null ? Number(delta.toFixed(decimales)) : null;
  const neutro = redondeado === null || redondeado === 0;
  const positiva = !neutro && (mejorAbajo ? redondeado! < 0 : redondeado! > 0);
  const icono = neutro ? 'trending_flat' : redondeado! > 0 ? 'trending_up' : 'trending_down';
  const texto =
    redondeado === null
      ? m.sinPrevio
      : `${redondeado > 0 ? '+' : ''}${redondeado.toFixed(decimales)}${unidad} ${m.vsAnterior}`;
  return (
    <div className="bg-white rounded-card shadow-card border border-cream-3 p-4">
      <div className="text-[26px] font-bold leading-tight">{valor}</div>
      <div className="text-[11.5px] text-warm-gray mt-1">{label}</div>
      <div
        className={`flex items-center gap-1 text-[10.5px] font-medium mt-2 ${
          redondeado === null ? 'text-warm-gray-3' : positiva ? 'text-ok-dark' : 'text-warm-gray-2'
        }`}
      >
        <span className="msr text-[13px]">{redondeado === null ? 'remove' : icono}</span>
        {texto}
      </div>
    </div>
  );
}

function ChartCard({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-card shadow-card border border-cream-3 p-5">
      <div className="text-[13px] font-bold mb-2">{titulo}</div>
      {children}
    </div>
  );
}

function SinDatos({ m }: { m: Msgs }) {
  return (
    <div className="h-[180px] flex items-center justify-center text-[12px] text-warm-gray-2">
      {m.sinDatos}
    </div>
  );
}

function Leyenda({ items }: { items: { color: string; label: string; dash?: boolean }[] }) {
  return (
    <div className="flex items-center gap-5 mt-2 text-[11px] text-warm-gray flex-wrap">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          {it.dash ? (
            <svg width="20" height="4" aria-hidden>
              <line x1="0" y1="2" x2="20" y2="2" stroke={it.color} strokeWidth="2" strokeDasharray="4 3" />
            </svg>
          ) : (
            <span className="h-[3px] w-5 rounded-full inline-block" style={{ background: it.color }} />
          )}
          {it.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Línea SVG de una serie (4 buckets) con dominio automático o fijo, meta
 * opcional (punteada) y tooltips nativos por punto. Los buckets sin datos se
 * saltan (la línea se corta, no se inventa).
 */
function LineChart({
  serie,
  etiquetas,
  color,
  dominio,
  meta,
  sufijo,
}: {
  serie: (number | null)[];
  etiquetas: string[];
  color: string;
  dominio?: [number, number];
  meta?: number;
  sufijo?: string;
}) {
  const W = 640;
  const H = 200;
  const PAD = { top: 14, right: 16, bottom: 26, left: 38 };
  const valores = serie.filter((v): v is number => v !== null);
  const base = dominio ?? [
    Math.floor(Math.min(...valores, meta ?? Infinity) * 0.9),
    Math.ceil(Math.max(...valores, meta ?? -Infinity) * 1.1) || 1,
  ];
  const [yMin, yMax] = base[0] === base[1] ? [base[0] - 1, base[1] + 1] : base;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / 3) * plotW;
  const y = (v: number) =>
    PAD.top + ((yMax - Math.min(yMax, Math.max(yMin, v))) / (yMax - yMin)) * plotH;

  // Gridlines: 3 valores intermedios redondeados.
  const grid = [0.25, 0.5, 0.75].map((f) => Math.round(yMin + (yMax - yMin) * f));

  // Segmentos de línea saltando nulls.
  let path = '';
  serie.forEach((v, i) => {
    if (v === null) return;
    const anterior = i > 0 ? serie[i - 1] : null;
    path += anterior === null ? ` M ${x(i)} ${y(v)}` : ` L ${x(i)} ${y(v)}`;
  });

  const ultimoIdx = serie.reduce<number>((acc, v, i) => (v !== null ? i : acc), -1);
  const fmt = (v: number) => `${Number.isInteger(v) ? v : v.toFixed(1)}${sufijo ?? ''}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img">
      {grid.map((v) => (
        <g key={v}>
          <line x1={PAD.left} y1={y(v)} x2={W - PAD.right} y2={y(v)} stroke="#ece8e1" strokeWidth="1" />
          <text x={PAD.left - 8} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="#8a8375">
            {v}
          </text>
        </g>
      ))}

      {meta != null && meta >= yMin && meta <= yMax && (
        <line
          x1={PAD.left}
          y1={y(meta)}
          x2={W - PAD.right}
          y2={y(meta)}
          stroke={META}
          strokeWidth="1.5"
          strokeDasharray="5 4"
        />
      )}

      <path d={path.trim()} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {serie.map((v, i) =>
        v === null ? null : (
          <circle key={i} cx={x(i)} cy={y(v)} r="4" fill={color} stroke="#fff" strokeWidth="1.5">
            <title>{`${etiquetas[i]}: ${fmt(v)}`}</title>
          </circle>
        ),
      )}
      {ultimoIdx >= 0 && serie[ultimoIdx] !== null && (
        <text
          x={Math.min(x(ultimoIdx), W - PAD.right - 4)}
          y={Math.max(11, y(serie[ultimoIdx]!) - 9)}
          textAnchor={ultimoIdx === 3 ? 'end' : 'middle'}
          fontSize="11"
          fontWeight="700"
          fill="#3d3a33"
        >
          {fmt(serie[ultimoIdx]!)}
        </text>
      )}

      {etiquetas.map((e, i) => (
        <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="#8a8375">
          {e}
        </text>
      ))}
    </svg>
  );
}

function FilaAgente({
  nombre,
  resueltas,
  csat,
  pct,
}: {
  nombre: string;
  resueltas: number;
  csat: number | null;
  pct: number;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-cream-3 last:border-b-0">
      <div className="h-8 w-8 rounded-full flex-none flex items-center justify-center text-[10.5px] font-bold bg-cream-3 text-ink-2">
        {iniciales(nombre)}
      </div>
      <div className="w-[150px] flex-none text-[12.5px] font-semibold truncate">{nombre}</div>
      <div className="w-16 flex-none text-right text-[12px] text-ink-2 tabular-nums hidden sm:block">
        {resueltas}
      </div>
      <div className="w-14 flex-none text-right text-[12px] text-ink-2 tabular-nums hidden sm:block">
        {csat != null ? `${csat.toFixed(1)} ★` : '—'}
      </div>
      <div className="flex-1 h-2 rounded-full bg-cream-2 overflow-hidden sm:ml-3">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: SERIE }} />
      </div>
      <div className="w-11 flex-none text-right text-[12.5px] font-bold">{pct}%</div>
    </div>
  );
}

/** El bot no tiene SLA: su barra muestra el % de respuestas útiles (👍). */
function FilaBot({
  nombre,
  resueltas,
  utilPct,
  votos,
  etiquetaUtil,
}: {
  nombre: string;
  resueltas: number;
  utilPct: number | null;
  votos: number;
  etiquetaUtil: string;
}) {
  const pct = utilPct != null ? Math.round(utilPct) : null;
  return (
    <div className="flex items-center gap-3 py-2.5 bg-ai-bg/40 -mx-2 px-2 rounded-card mt-1">
      <div className="h-8 w-8 rounded-full flex-none flex items-center justify-center bg-ai-bg text-ai">
        <span className="msr text-[17px]">smart_toy</span>
      </div>
      <div className="w-[150px] flex-none text-[12.5px] font-semibold truncate">{nombre}</div>
      <div className="w-16 flex-none text-right text-[12px] text-ink-2 tabular-nums hidden sm:block">
        {resueltas}
      </div>
      <div className="w-14 flex-none text-right text-[12px] text-warm-gray-3 hidden sm:block">—</div>
      <div className="flex-1 h-2 rounded-full bg-cream-2 overflow-hidden sm:ml-3">
        {pct != null && (
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: BOT }} />
        )}
      </div>
      <div className="w-11 flex-none text-right text-[12.5px] font-bold" title={`${votos} votos`}>
        {pct != null ? `${pct}%` : '—'}
      </div>
      <span className="text-[10px] text-ai font-semibold flex-none hidden md:block">
        {etiquetaUtil}
      </span>
    </div>
  );
}
