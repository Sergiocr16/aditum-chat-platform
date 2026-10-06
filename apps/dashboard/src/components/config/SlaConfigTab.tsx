'use client';

// Tab "SLA" de /configuracion — spec 1p. Edita el doc settings/sla (SlaPolicy).

import { useEffect, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import type { Idioma, SlaPolicy } from '@aditum-chat/shared';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { useDoc } from '@/lib/data';
import { Campo, Card, ToggleRow } from './ui';
import { CategoriasConfig } from './CategoriasConfig';

const DEFAULT_SLA: SlaPolicy = {
  primeraRespuestaMin: 15,
  pausarConBot: true,
  pausarFueraHorario: true,
  resolucionHoras: { alta: 8, media: 24, baja: 72 },
  avisoPorcentaje: 25,
  escalarAlAdminAlVencer: true,
  reasignarTrasMin: 30,
  autoResolveWaitingHours: 24,
};

const M = {
  es: {
    primeraRespuesta: 'Primera respuesta',
    primeraRespuestaSub: 'Tiempo objetivo para el primer mensaje de un agente',
    objetivoMin: 'Objetivo (minutos)',
    pausarConBot: 'Pausar con el bot',
    pausarConBotHint: 'El SLA se pausa cuando el bot responde primero',
    pausarFuera: 'Pausar fuera de horario',
    pausarFueraHint: 'El SLA se pausa fuera de horario hábil',
    resolucion: 'Tiempos de resolución por prioridad',
    resolucionSub: 'Horas objetivo para resolver un ticket según su prioridad',
    alta: 'Alta',
    media: 'Media',
    baja: 'Baja',
    horas: 'horas',
    alertas: 'Alertas',
    alertasSub: 'Avisos y escalamientos automáticos',
    aviso: 'Aviso al agente (% restante)',
    avisoHint: 'Avisar al agente cuando quede el {n}% del tiempo',
    escalar: 'Escalar al admin al vencer',
    escalarHint: 'El admin recibe un aviso cuando un SLA se vence',
    reasignar: 'Reasignación automática (minutos)',
    reasignarHint: 'Reasignación automática si el agente no responde en N min · 0 = desactivado',
    espera: 'Esperando respuesta',
    esperaSub: 'Conversaciones que un agente dejó en espera del cliente',
    esperaLabel: 'Resolver automáticamente tras (horas)',
    esperaHint:
      'Si el cliente no responde en ese tiempo, la conversación se resuelve sola con la categoría “Sin respuesta” · 0 = desactivado',
    guardar: 'Guardar cambios',
    guardando: 'Guardando…',
    sinGuardar: 'Cambios sin guardar',
    error: 'No se pudo guardar. Intentá de nuevo.',
  },
  en: {
    primeraRespuesta: 'First response',
    primeraRespuestaSub: 'Target time for the first agent message',
    objetivoMin: 'Target (minutes)',
    pausarConBot: 'Pause with the bot',
    pausarConBotHint: 'The SLA pauses when the bot answers first',
    pausarFuera: 'Pause outside business hours',
    pausarFueraHint: 'The SLA pauses outside business hours',
    resolucion: 'Resolution times by priority',
    resolucionSub: 'Target hours to resolve a ticket by priority',
    alta: 'High',
    media: 'Medium',
    baja: 'Low',
    horas: 'hours',
    alertas: 'Alerts',
    alertasSub: 'Automatic warnings and escalations',
    aviso: 'Agent warning (% remaining)',
    avisoHint: 'Warn the agent when {n}% of the time is left',
    escalar: 'Escalate to admin on breach',
    escalarHint: 'The admin is notified when an SLA is breached',
    reasignar: 'Automatic reassignment (minutes)',
    reasignarHint: 'Automatic reassignment if the agent does not reply within N min · 0 = off',
    espera: 'Waiting on customer',
    esperaSub: 'Conversations an agent parked until the customer replies',
    esperaLabel: 'Auto-resolve after (hours)',
    esperaHint:
      'If the customer does not reply within that time, the conversation resolves itself with the “No reply” category · 0 = off',
    guardar: 'Save changes',
    guardando: 'Saving…',
    sinGuardar: 'Unsaved changes',
    error: 'Could not save. Try again.',
  },
} as const;

export function SlaConfigTab() {
  const { agent } = useAuth();
  const idioma: Idioma = agent?.idioma ?? 'es';
  const m = M[idioma];

  const slaRow = useDoc<SlaPolicy>('settings/sla');
  const [policy, setPolicy] = useState<SlaPolicy>(DEFAULT_SLA);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (slaRow && !loaded) {
      setPolicy({ ...DEFAULT_SLA, ...slaRow.data });
      setLoaded(true);
    }
  }, [slaRow, loaded]);

  function set<K extends keyof SlaPolicy>(key: K, value: SlaPolicy[K]) {
    setPolicy((p) => ({ ...p, [key]: value }));
    setDirty(true);
  }

  async function guardar() {
    setBusy(true);
    setError(null);
    try {
      await setDoc(doc(db, 'settings', 'sla'), policy, { merge: true });
      setDirty(false);
    } catch {
      setError(m.error);
    } finally {
      setBusy(false);
    }
  }

  const numCls =
    'w-24 border border-warm-border rounded-lg px-3 py-2 text-[13px] text-ink outline-none focus:border-navy bg-white';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 justify-end">
        {dirty && (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-warn-dark bg-warn-bg px-2.5 py-1 rounded-full">
            <span className="msr text-[13px]">edit</span> {m.sinGuardar}
          </span>
        )}
        <button
          onClick={guardar}
          disabled={!dirty || busy}
          className="bg-navy text-white text-[12.5px] font-semibold px-4 py-2 rounded-lg hover:bg-navy-light disabled:opacity-50"
        >
          {busy ? m.guardando : m.guardar}
        </button>
      </div>
      {error && <div className="text-danger text-[12px]">{error}</div>}

      <Card icon="timer" title={m.primeraRespuesta} subtitle={m.primeraRespuestaSub}>
        <Campo label={m.objetivoMin}>
          <input
            type="number"
            min={1}
            value={policy.primeraRespuestaMin}
            onChange={(e) => set('primeraRespuestaMin', Number(e.target.value))}
            className={numCls}
          />
        </Campo>
        <div className="divide-y divide-cream-3 mt-2">
          <ToggleRow
            label={m.pausarConBot}
            hint={m.pausarConBotHint}
            on={policy.pausarConBot}
            onChange={(v) => set('pausarConBot', v)}
          />
          <ToggleRow
            label={m.pausarFuera}
            hint={m.pausarFueraHint}
            on={policy.pausarFueraHorario}
            onChange={(v) => set('pausarFueraHorario', v)}
          />
        </div>
      </Card>

      <Card icon="flag" title={m.resolucion} subtitle={m.resolucionSub}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {(
            [
              ['alta', m.alta, 'bg-danger-bg text-danger'],
              ['media', m.media, 'bg-warn-bg text-warn-dark'],
              ['baja', m.baja, 'bg-cream-2 text-warm-gray'],
            ] as const
          ).map(([key, label, chip]) => (
            <div key={key} className="flex flex-col gap-2">
              <span className={`self-start text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full ${chip}`}>
                {label.toUpperCase()}
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={policy.resolucionHoras[key]}
                  onChange={(e) =>
                    set('resolucionHoras', { ...policy.resolucionHoras, [key]: Number(e.target.value) })
                  }
                  className={numCls}
                />
                <span className="text-[11.5px] text-warm-gray">{m.horas}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card icon="notifications_active" title={m.alertas} subtitle={m.alertasSub}>
        <div className="flex flex-col gap-4">
          <Campo label={m.aviso}>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={0}
                max={100}
                value={policy.avisoPorcentaje}
                onChange={(e) => set('avisoPorcentaje', Number(e.target.value))}
                className={numCls}
              />
              <span className="text-[11px] text-warm-gray">
                {m.avisoHint.replace('{n}', String(policy.avisoPorcentaje))}
              </span>
            </div>
          </Campo>
          <div className="divide-y divide-cream-3">
            <ToggleRow
              label={m.escalar}
              hint={m.escalarHint}
              on={policy.escalarAlAdminAlVencer}
              onChange={(v) => set('escalarAlAdminAlVencer', v)}
            />
          </div>
          <Campo label={m.reasignar}>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={0}
                value={policy.reasignarTrasMin}
                onChange={(e) => set('reasignarTrasMin', Number(e.target.value))}
                className={numCls}
              />
              <span className="text-[11px] text-warm-gray">{m.reasignarHint}</span>
            </div>
          </Campo>
        </div>
      </Card>

      <Card icon="hourglass_empty" title={m.espera} subtitle={m.esperaSub}>
        <Campo label={m.esperaLabel}>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={0}
              value={policy.autoResolveWaitingHours}
              onChange={(e) => set('autoResolveWaitingHours', Number(e.target.value))}
              className={numCls}
            />
            <span className="text-[11px] text-warm-gray">{m.esperaHint}</span>
          </div>
        </Campo>
      </Card>

      <CategoriasConfig idioma={idioma} />
    </div>
  );
}
