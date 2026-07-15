'use client';

import { useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import type { Conversation, TicketPriority } from '@aditum-chat/shared';
import { formatTicketNumber, ticketPriorityLabels } from '@aditum-chat/shared';
import { fns } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { useMessages, useTeam, useTickets, type Row } from '@/lib/data';

export function ConvertTicketModal({
  conv,
  onClose,
  onCreado,
}: {
  conv: Row<Conversation>;
  onClose(): void;
  /** Se llama tras crear el ticket (para refrescar el hilo de esa conversación). */
  onCreado?(): void;
}) {
  const { agent } = useAuth();
  const t = useT();
  const team = useTeam();
  const msgs = useMessages(conv.id);
  const abiertos = useTickets({ estado: 'abierto' });
  const idioma = agent?.idioma ?? 'es';
  const c = conv.data;

  const descripcionInicial = useMemo(() => {
    const delUsuario = msgs
      .filter((m) => m.data.sender.tipo === 'user' && !m.data.interno)
      .map((m) => m.data.texto)
      .slice(-4);
    return delUsuario.join('\n');
  }, [msgs]);

  const [asunto, setAsunto] = useState(c.lastMessage?.texto?.slice(0, 90) ?? '');
  const [descripcion, setDescripcion] = useState('');
  const [prioridad, setPrioridad] = useState<TicketPriority>('media');
  const [asignadoA, setAsignadoA] = useState(agent?.uid ?? '');
  // Tickets de conversaciones grupales nacen públicos: los demás admins del
  // grupo los ven en "Mi grupo" del widget.
  const [publico, setPublico] = useState(conv.data.tipo === 'grupo');
  const [adjuntar, setAdjuntar] = useState(false);
  const [ticketExistente, setTicketExistente] = useState('');
  const [busy, setBusy] = useState(false);
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Genera título + descripción a partir de la conversación activa (conv.id).
  async function generarConIA() {
    setGenerando(true);
    setError(null);
    try {
      const call = httpsCallable(fns, 'aiAssist');
      const { data } = (await call({ conversationId: conv.id, modo: 'descripcion_ticket' })) as {
        data: { texto: string; asunto?: string };
      };
      if (data.asunto) setAsunto(data.asunto);
      setDescripcion(data.texto);
    } catch {
      setError('No se pudo generar el ticket con IA.');
    } finally {
      setGenerando(false);
    }
  }

  // Pre-carga la descripción desde los mensajes del usuario apenas llegan.
  const desc = descripcion || descripcionInicial;

  async function crear() {
    if (!agent) return;
    setBusy(true);
    setError(null);
    try {
      const asignado = team.find((m) => m.id === asignadoA);
      const call = httpsCallable(fns, 'createTicket');
      await call({
        siteId: c.siteId,
        clientId: c.clientId,
        clientNombre: c.clientNombre,
        ...(c.groupId ? { groupId: c.groupId, groupName: c.groupName } : {}),
        contactId: c.contactId,
        contactNombre: c.contactNombre,
        conversationId: conv.id,
        asunto,
        descripcion: desc,
        prioridad,
        publico,
        ambito: c.tipo === 'grupo' ? 'grupo' : 'cliente',
        asignadoA: asignado?.id ?? null,
        asignadoNombre: asignado?.data.nombre ?? null,
        ...(adjuntar && ticketExistente ? { adjuntarA: ticketExistente } : {}),
      });
      onCreado?.();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-navy-deep/50 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="bg-white rounded-panel shadow-modal w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-cream-3">
          <div className="text-[15px] font-bold">{t('convertir.titulo')}</div>
          <div className="text-[11.5px] text-warm-gray mt-0.5">
            {[c.contactNombre, c.groupName ?? c.clientNombre].filter(Boolean).join(' · ')}
          </div>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <label className="flex items-center gap-2 text-[12px] text-ink-2">
            <input type="checkbox" checked={adjuntar} onChange={(e) => setAdjuntar(e.target.checked)} />
            {t('convertir.adjuntarExistente')}
          </label>

          {adjuntar ? (
            <select
              value={ticketExistente}
              onChange={(e) => setTicketExistente(e.target.value)}
              className="border border-warm-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-navy"
            >
              <option value="">—</option>
              {abiertos.map((tk) => (
                <option key={tk.id} value={tk.id}>
                  {formatTicketNumber(tk.data.numero)} · {tk.data.asunto}
                </option>
              ))}
            </select>
          ) : (
            <>
              <Campo label={t('convertir.asunto')}>
                <input
                  value={asunto}
                  onChange={(e) => setAsunto(e.target.value)}
                  className="w-full border border-warm-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-navy"
                />
              </Campo>
              <Campo
                label={t('convertir.descripcion')}
                accion={
                  <button
                    type="button"
                    onClick={generarConIA}
                    disabled={generando}
                    className="flex items-center gap-1 text-[11px] font-semibold text-ai hover:underline disabled:opacity-50"
                  >
                    <span className="msr text-[14px]">auto_awesome</span>
                    {generando ? '…' : t('convertir.generarIA')}
                  </button>
                }
              >
                <textarea
                  rows={4}
                  value={desc}
                  onChange={(e) => setDescripcion(e.target.value)}
                  className="w-full border border-warm-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-navy resize-none"
                />
              </Campo>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Campo label={t('convertir.prioridad')}>
                  <select
                    value={prioridad}
                    onChange={(e) => setPrioridad(e.target.value as TicketPriority)}
                    className="w-full border border-warm-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-navy"
                  >
                    {(['alta', 'media', 'baja'] as TicketPriority[]).map((p) => (
                      <option key={p} value={p}>
                        {ticketPriorityLabels[idioma][p]}
                      </option>
                    ))}
                  </select>
                </Campo>
                <Campo label={t('convertir.asignadoA')}>
                  <select
                    value={asignadoA}
                    onChange={(e) => setAsignadoA(e.target.value)}
                    className="w-full border border-warm-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-navy"
                  >
                    {team
                      .filter((m) => m.data.activo)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.data.nombre}
                        </option>
                      ))}
                  </select>
                </Campo>
              </div>
              <label className="flex items-center gap-2 text-[12px] text-ink-2">
                <input type="checkbox" checked={publico} onChange={(e) => setPublico(e.target.checked)} />
                <span className="msr text-[14px] text-warm-gray">public</span>
                {t('convertir.ticketPublico')}
              </label>
            </>
          )}

          {error && <div className="text-danger text-xs">{error}</div>}
        </div>

        <div className="px-5 py-4 border-t border-cream-3 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="text-[12.5px] font-semibold text-warm-gray px-4 py-2 rounded-lg hover:bg-cream-1"
          >
            {t('convertir.cancelar')}
          </button>
          <button
            onClick={crear}
            disabled={busy || (adjuntar ? !ticketExistente : !asunto.trim())}
            className="bg-navy text-white text-[12.5px] font-semibold px-4 py-2 rounded-lg hover:bg-navy-light disabled:opacity-50"
          >
            {busy ? '…' : t('convertir.crear', { numero: '' }).trim()}
          </button>
        </div>
      </div>
    </div>
  );
}

function Campo({
  label,
  accion,
  children,
}: {
  label: string;
  accion?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between">
        <span className="text-[10.5px] font-bold tracking-wide text-warm-gray uppercase">{label}</span>
        {accion}
      </span>
      {children}
    </label>
  );
}
