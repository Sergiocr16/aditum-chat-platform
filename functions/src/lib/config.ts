import type {
  BotConfig,
  GlobalSettings,
  Idioma,
  ScheduleConfig,
  Site,
  WidgetConfig,
} from '@aditum-chat/shared';
import { formatSchedule } from '@aditum-chat/shared';
import { db } from './admin.js';

export const DEFAULT_WIDGET_CONFIG: WidgetConfig = {
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

export const DEFAULT_BOT_CONFIG: BotConfig = {
  activo: true,
  nombre: 'Asistente Aditum',
  instrucciones: '',
  tono: 'vos',
  escalarTrasIntentos: 2,
  responderFueraDeHorario: true,
  crearTicketsAutomaticamente: false,
  saludo: '¡Hola {nombre}! Soy el asistente de Aditum. ¿En qué puedo ayudarte?',
};

export const DEFAULT_SCHEDULE: ScheduleConfig = {
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

export interface ResolvedSiteConfig {
  widget: WidgetConfig;
  bot: BotConfig;
  schedule: ScheduleConfig;
}

/** Herencia: defaults → settings/global → override del sitio. */
export async function resolveSiteConfig(site: Site | null): Promise<ResolvedSiteConfig> {
  const globalSnap = await db.doc('settings/global').get();
  const global = (globalSnap.data() ?? {}) as Partial<GlobalSettings>;
  return {
    widget: { ...DEFAULT_WIDGET_CONFIG, ...global.widgetConfig, ...site?.widgetConfig },
    bot: { ...DEFAULT_BOT_CONFIG, ...global.botConfig, ...site?.botConfig },
    schedule: site?.scheduleConfig ?? global.scheduleConfig ?? DEFAULT_SCHEDULE,
  };
}

/** ¿Estamos dentro del horario de atención del sitio? */
export function isWithinSchedule(schedule: ScheduleConfig, now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: schedule.timezone || 'America/Costa_Rica',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = map[parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'] ?? 0;
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const day = schedule.dias.find((d) => d.dia === weekday);
  if (!day || !day.abierto || !day.desde || !day.hasta) return false;
  const cur = hour * 60 + minute;
  const [dh, dm] = day.desde.split(':').map(Number);
  const [hh, hm] = day.hasta.split(':').map(Number);
  return cur >= dh * 60 + dm && cur < hh * 60 + hm;
}

/** El texto se deriva SIEMPRE de los días/horas configurados. */
export function scheduleText(schedule: ScheduleConfig, idioma: Idioma): string {
  return formatSchedule(schedule, idioma);
}
