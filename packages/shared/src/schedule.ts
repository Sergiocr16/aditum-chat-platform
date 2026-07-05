import type { Idioma, ScheduleConfig, ScheduleDay } from './types';

// El texto de horario del widget se genera SIEMPRE a partir de los días/horas
// configurados — no se escribe a mano. Ej: "Lun–Vie 8:00–17:00 · Sáb 8:00–12:00".

const DIAS: Record<Idioma, string[]> = {
  es: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

function hora(h?: string): string {
  if (!h) return '';
  const [hh, mm] = h.split(':');
  return `${String(Number(hh))}:${mm ?? '00'}`;
}

/** Agrupa días consecutivos (Lun→Dom) con el mismo horario. */
export function formatSchedule(schedule: ScheduleConfig, idioma: Idioma): string {
  const nombres = DIAS[idioma] ?? DIAS.es;
  // Semana en orden Lun..Sáb, Dom al final.
  const orden = [1, 2, 3, 4, 5, 6, 0];
  const dias: ScheduleDay[] = orden.map(
    (d) => schedule.dias.find((x) => x.dia === d) ?? { dia: d, abierto: false },
  );

  const grupos: { desde: number; hasta: number; horario: string }[] = [];
  for (const d of dias) {
    if (!d.abierto || !d.desde || !d.hasta) continue;
    const horario = `${hora(d.desde)}–${hora(d.hasta)}`;
    const ultimo = grupos[grupos.length - 1];
    // Consecutivo en el orden de la semana y con el mismo horario → extiende el grupo.
    if (
      ultimo &&
      ultimo.horario === horario &&
      orden.indexOf(d.dia) === orden.indexOf(ultimo.hasta) + 1
    ) {
      ultimo.hasta = d.dia;
    } else {
      grupos.push({ desde: d.dia, hasta: d.dia, horario });
    }
  }

  if (grupos.length === 0) return '';
  return grupos
    .map((g) =>
      g.desde === g.hasta
        ? `${nombres[g.desde]} ${g.horario}`
        : `${nombres[g.desde]}–${nombres[g.hasta]} ${g.horario}`,
    )
    .join(' · ');
}
