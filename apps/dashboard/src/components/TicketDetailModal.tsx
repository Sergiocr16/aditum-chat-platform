'use client';

// Modal de detalle de ticket — diseño 1n.
// Recibe `ticketId` o un `Row<Ticket>` ya cargado; siempre se suscribe al doc
// en vivo para reflejar los cambios que él mismo escribe.

import { useEffect, useMemo, useState } from 'react';
import { serverTimestamp } from 'firebase/firestore';
import type {
  Idioma,
  MessageSender,
  Ticket,
  TicketEventTipo,
  TicketPriority,
  TicketStatus,
} from '@aditum-chat/shared';
import {
  formatTicketNumber,
  makeT,
  ticketPriorityLabels,
  ticketStatusLabels,
} from '@aditum-chat/shared';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import {
  fmtFecha,
  fmtHora,
  iniciales,
  toDate,
  useDoc,
  useSites,
  useTeam,
  useTicketHistory,
  useTicketNotes,
  type Row,
} from '@/lib/data';
import { addTicketEvent, addTicketNote, updateTicket, updateTicketNote } from '@/lib/data-tickets';
import { PrioridadChip, SitioChip } from '@/components/chips';

// ---------------------------------------------------------------- i18n local

const M = {
  es: {
    slaVencido: 'SLA de resolución venció hace {tiempo}',
    sinAsignar: 'Sin asignar',
    devRef: 'Ref. desarrollo',
    devRefHint: 'Ticket del equipo de desarrollo',
    guardarResolucion: 'Guardar y marcar como resuelto',
    resueltoPor: 'Resuelto por {nombre} · {fecha}',
    agregar: 'Agregar',
    cerrar: 'Cerrar',
    sinEventos: 'Sin eventos todavía',
    sinNotas: 'Todavía no hay notas internas',
    descripcion: 'Descripción',
    tituloLabel: 'Título',
    guardarCambios: 'Guardar cambios',
    confTitulo: '¿Guardar los cambios?',
    confTexto: 'Se actualizará el título y/o la descripción del ticket.',
    confSi: 'Sí, guardar',
    editoTicket: 'Editó el ticket',
    editar: 'Editar',
    editada: 'editada',
  },
  en: {
    slaVencido: 'Resolution SLA breached {tiempo} ago',
    sinAsignar: 'Unassigned',
    devRef: 'Dev reference',
    devRefHint: 'Development team ticket',
    guardarResolucion: 'Save and mark as resolved',
    resueltoPor: 'Resolved by {nombre} · {fecha}',
    agregar: 'Add',
    cerrar: 'Close',
    sinEventos: 'No events yet',
    sinNotas: 'No internal notes yet',
    descripcion: 'Description',
    tituloLabel: 'Title',
    guardarCambios: 'Save changes',
    confTitulo: 'Save changes?',
    confTexto: 'The ticket title and/or description will be updated.',
    confSi: 'Yes, save',
    editoTicket: 'Edited the ticket',
    editar: 'Edit',
    editada: 'edited',
  },
} satisfies Record<Idioma, Record<string, string>>;

// El historial se persiste en español (idioma de los datos del seed y del widget).
const EVENT_ICONS: Record<TicketEventTipo, string> = {
  creado: 'confirmation_number',
  asignado: 'person',
  estado: 'swap_horiz',
  prioridad: 'flag',
  publico: 'public',
  desarrollo: 'code',
  resolucion: 'task_alt',
  edicion: 'edit',
  comentario: 'chat_bubble',
};

const ESTADOS_MODAL: TicketStatus[] = ['abierto', 'en_progreso', 'en_desarrollo', 'resuelto'];
const PRIORIDADES: TicketPriority[] = ['alta', 'media', 'baja'];

function tiempoRestante(dueAt: unknown): { ms: number; label: string } | null {
  const d = toDate(dueAt);
  if (!d) return null;
  const ms = d.getTime() - Date.now();
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3_600_000);
  const min = Math.floor((abs % 3_600_000) / 60_000);
  return { ms, label: h > 0 ? `${h} h ${min} m` : `${min} m` };
}

// ---------------------------------------------------------------- componente

export function TicketDetailModal({
  ticketId,
  ticket,
  onClose,
}: {
  ticketId?: string;
  ticket?: Row<Ticket>;
  onClose(): void;
}) {
  const { agent } = useAuth();
  const t = useT();
  const id = ticketId ?? ticket?.id ?? null;
  const live = useDoc<Ticket>(id ? `tickets/${id}` : null);
  const eventos = useTicketHistory(id);
  const notas = useTicketNotes(id);
  const team = useTeam();
  const sites = useSites();

  const idioma: Idioma = agent?.idioma ?? 'es';
  const m = useMemo(() => makeT(M, idioma), [idioma]);

  const row = live ?? ticket ?? null;
  const tk = row?.data ?? null;

  const [devRef, setDevRef] = useState('');
  const [resDraft, setResDraft] = useState('');
  const [notaDraft, setNotaDraft] = useState('');
  const [notaEditId, setNotaEditId] = useState<string | null>(null);
  const [notaEditDraft, setNotaEditDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [asuntoDraft, setAsuntoDraft] = useState('');
  const [descDraft, setDescDraft] = useState('');
  const [estadoDraft, setEstadoDraft] = useState<TicketStatus>('abierto');
  const [asignadoDraft, setAsignadoDraft] = useState('');
  const [prioridadDraft, setPrioridadDraft] = useState<TicketPriority>('media');
  const [publicoDraft, setPublicoDraft] = useState(false);
  const [confirmarGuardar, setConfirmarGuardar] = useState(false);

  // Sincroniza el input devRef con el doc en vivo (llega async si solo hay ticketId).
  useEffect(() => {
    setDevRef(tk?.devRef ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id, tk?.devRef]);

  // Sincroniza TODOS los borradores editables con el doc en vivo (se aplican al Guardar).
  useEffect(() => {
    setAsuntoDraft(tk?.asunto ?? '');
    setDescDraft(tk?.descripcion ?? '');
    setEstadoDraft(tk?.estado ?? 'abierto');
    setAsignadoDraft(tk?.asignadoA ?? '');
    setPrioridadDraft(tk?.prioridad ?? 'media');
    setPublicoDraft(tk?.publico ?? false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id, tk?.asunto, tk?.descripcion, tk?.estado, tk?.asignadoA, tk?.prioridad, tk?.publico]);

  if (!id || !tk || !agent) return null;

  const por: MessageSender = {
    tipo: 'agent',
    id: agent.uid,
    nombre: agent.perfil?.nombre ?? agent.user.email ?? '',
  };
  const siteNombre = sites.find((s) => s.id === tk.siteId)?.data.nombre ?? tk.siteId;
  const resuelto = tk.estado === 'resuelto';
  const sla = !resuelto && tk.sla?.dueAt ? tiempoRestante(tk.sla.dueAt) : null;

  // ------------------------------------------------------------- escrituras

  /** Aplica TODOS los cambios pendientes (título, descripción, estado, asignado,
   *  prioridad, visibilidad) en un solo guardado y registra cada evento. */
  async function guardarEdicion() {
    if (!tk || busy) return;
    const asunto = asuntoDraft.trim();
    const desc = descDraft.trim();
    if (!asunto) return;
    setBusy(true);
    try {
      const patch: Record<string, unknown> = {};
      const eventos: { tipo: TicketEventTipo; descripcion: string; de?: string; a?: string }[] = [];

      if (asunto !== tk.asunto || desc !== (tk.descripcion ?? '')) {
        patch.asunto = asunto;
        patch.descripcion = desc;
        eventos.push({ tipo: 'edicion', descripcion: m('editoTicket') });
      }
      if (estadoDraft !== tk.estado) {
        patch.estado = estadoDraft;
        if (estadoDraft === 'resuelto') patch.resueltoAt = serverTimestamp();
        eventos.push({
          tipo: 'estado',
          descripcion: `Estado cambió a ${ticketStatusLabels.es[estadoDraft]}`,
          de: tk.estado,
          a: estadoDraft,
        });
      }
      if (asignadoDraft !== (tk.asignadoA ?? '')) {
        const miembro = team.find((x) => x.id === asignadoDraft);
        patch.asignadoA = asignadoDraft || null;
        patch.asignadoNombre = miembro?.data.nombre ?? null;
        eventos.push({
          tipo: 'asignado',
          descripcion: miembro ? `Asignado a ${miembro.data.nombre}` : 'Ticket sin asignar',
        });
      }
      if (prioridadDraft !== tk.prioridad) {
        patch.prioridad = prioridadDraft;
        eventos.push({
          tipo: 'prioridad',
          descripcion: `Prioridad cambió a ${ticketPriorityLabels.es[prioridadDraft]}`,
          de: tk.prioridad,
          a: prioridadDraft,
        });
      }
      if (publicoDraft !== tk.publico) {
        patch.publico = publicoDraft;
        eventos.push({
          tipo: 'publico',
          descripcion: publicoDraft ? 'Ticket marcado como público' : 'Ticket marcado como privado',
        });
      }

      if (Object.keys(patch).length > 0) {
        await updateTicket(id!, patch);
        for (const ev of eventos) await addTicketEvent(id!, { ...ev, por });
      }
      setConfirmarGuardar(false);
    } finally {
      setBusy(false);
    }
  }

  async function guardarDevRef() {
    if (!tk) return;
    const valor = devRef.trim();
    if (valor === (tk.devRef ?? '')) return;
    await updateTicket(id!, { devRef: valor || null });
    await addTicketEvent(id!, {
      tipo: 'desarrollo',
      descripcion: valor
        ? `Vinculado a desarrollo ${valor}`
        : 'Referencia de desarrollo removida',
      por,
    });
  }

  async function guardarResolucion() {
    const texto = resDraft.trim();
    if (!texto || busy) return;
    setBusy(true);
    try {
      await updateTicket(id!, {
        resolucion: { texto, por: agent!.uid, porNombre: por.nombre, at: serverTimestamp() },
        estado: 'resuelto',
        resueltoAt: serverTimestamp(),
      });
      await addTicketEvent(id!, {
        tipo: 'resolucion',
        descripcion: `Resolución final: ${texto}`,
        por,
      });
      setResDraft('');
    } finally {
      setBusy(false);
    }
  }

  async function agregarNota() {
    const texto = notaDraft.trim();
    if (!texto) return;
    setNotaDraft('');
    await addTicketNote(id!, por, texto);
  }

  async function guardarNotaEdit(notaId: string) {
    const texto = notaEditDraft.trim();
    if (!texto) return;
    await updateTicketNote(id!, notaId, texto);
    setNotaEditId(null);
    setNotaEditDraft('');
  }

  const hayCambios =
    asuntoDraft.trim().length > 0 &&
    (asuntoDraft.trim() !== tk.asunto ||
      descDraft.trim() !== (tk.descripcion ?? '') ||
      estadoDraft !== tk.estado ||
      asignadoDraft !== (tk.asignadoA ?? '') ||
      prioridadDraft !== tk.prioridad ||
      publicoDraft !== tk.publico);

  // ------------------------------------------------------------- render

  return (
    <div
      className="fixed inset-0 z-50 bg-navy-deep/50 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-panel shadow-modal w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header (sticky al hacer scroll) */}
        <div className="sticky top-0 z-10 bg-white px-6 py-5 border-b border-cream-3 flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[13px] font-bold text-navy">
                {formatTicketNumber(tk.numero)}
              </span>
              {publicoDraft && (
                <span className="msr text-[16px] text-warm-gray" title={t('ticket.publico')}>
                  public
                </span>
              )}
              <PrioridadChip prioridad={prioridadDraft} idioma={idioma} />
            </div>
            <input
              value={asuntoDraft}
              onChange={(e) => setAsuntoDraft(e.target.value)}
              title={m('tituloLabel')}
              className="w-full text-[17px] font-bold mt-1.5 leading-snug bg-transparent outline-none rounded border border-transparent px-1 -mx-1 hover:border-warm-border focus:border-navy focus:bg-cream-0"
            />
            <div className="flex items-center gap-2 mt-1.5 text-[11.5px] text-warm-gray">
              {t('ticket.reportadoPor', { nombre: tk.contactNombre ?? '—' })}
              <span>·</span>
              <SitioChip nombre={siteNombre} />
            </div>
          </div>
          {hayCambios && (
            <button
              onClick={() => setConfirmarGuardar(true)}
              disabled={busy}
              className="flex-none flex items-center gap-1.5 bg-navy text-white text-[12px] font-semibold px-3.5 py-2 rounded-lg hover:bg-navy-light disabled:opacity-40"
            >
              <span className="msr text-[15px]">save</span>
              {m('guardarCambios')}
            </button>
          )}
          <button
            onClick={onClose}
            title={m('cerrar')}
            className="h-8 w-8 flex-none rounded-lg flex items-center justify-center text-warm-gray hover:bg-cream-1 hover:text-ink"
          >
            <span className="msr text-[20px]">close</span>
          </button>
        </div>

        {/* Aviso SLA */}
        {sla && (
          <div
            className={`px-6 py-2.5 flex items-center gap-2 text-[12px] font-semibold border-b border-cream-3 ${
              sla.ms > 0 ? 'bg-warn-bg text-warn-dark' : 'bg-danger-bg text-danger'
            }`}
          >
            <span className="msr text-[16px]">schedule</span>
            {sla.ms > 0
              ? t('ticket.slaVence', { tiempo: sla.label })
              : m('slaVencido', { tiempo: sla.label })}
          </div>
        )}

        {/* Cuerpo: historial + sidebar */}
        <div className="grid grid-cols-[1fr_240px] gap-6 p-6">
          {/* Columna izquierda — descripción + historial */}
          <div className="min-w-0">
            {/* Descripción editable */}
            <div className="mb-5">
              <div className="text-[10.5px] font-bold tracking-wider text-warm-gray-2 mb-2">
                {m('descripcion')}
              </div>
              <textarea
                rows={4}
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                className="w-full border border-warm-border rounded-lg bg-cream-0 px-3 py-2 text-[12.5px] text-ink-2 leading-relaxed outline-none focus:border-navy focus:bg-white resize-y"
              />
            </div>

            <div className="text-[10.5px] font-bold tracking-wider text-warm-gray-2 mb-3">
              {t('ticket.historial')}
            </div>
            <div className="flex flex-col gap-3.5">
              {eventos.map((ev) => (
                <div key={ev.id} className="flex gap-3">
                  <div className="h-7 w-7 flex-none rounded-full bg-cream-2 text-ink-2 flex items-center justify-center">
                    <span className="msr text-[15px]">
                      {EVENT_ICONS[ev.data.tipo] ?? 'circle'}
                    </span>
                  </div>
                  <div className="min-w-0 pt-0.5">
                    <div className="text-[12.5px] text-ink-2">{ev.data.descripcion}</div>
                    <div className="text-[10.5px] text-warm-gray-2 mt-0.5">
                      {fmtFecha(ev.data.createdAt, true)}
                      {ev.data.por?.nombre ? ` · ${ev.data.por.nombre}` : ''}
                    </div>
                  </div>
                </div>
              ))}
              {eventos.length === 0 && (
                <div className="text-[12px] text-warm-gray-2">{m('sinEventos')}</div>
              )}
            </div>

            {/* Resolución final */}
            {!resuelto ? (
              <div className="mt-5 border border-warm-border rounded-lg p-3.5 bg-cream-0">
                <div className="flex items-center gap-1.5 text-[12px] font-bold text-ink-2 mb-2">
                  <span className="msr text-[15px] text-ok-dark">task_alt</span>
                  {t('ticket.resolucionFinal')}
                </div>
                <textarea
                  rows={3}
                  value={resDraft}
                  onChange={(e) => setResDraft(e.target.value)}
                  placeholder={t('ticket.resolucionHint')}
                  className="w-full border border-warm-border rounded-lg bg-white px-3 py-2 text-[12.5px] outline-none focus:border-navy resize-none"
                />
                <button
                  onClick={guardarResolucion}
                  disabled={busy || !resDraft.trim()}
                  className="mt-2 bg-ok-dark text-white text-[12px] font-semibold px-3.5 py-2 rounded-lg hover:bg-ok disabled:opacity-40 flex items-center gap-1.5"
                >
                  <span className="msr text-[15px]">check_circle</span>
                  {busy ? '…' : m('guardarResolucion')}
                </button>
              </div>
            ) : (
              tk.resolucion && (
                <div className="mt-5 border border-ok/30 bg-ok-bg rounded-lg p-3.5">
                  <div className="flex items-center gap-1.5 text-[12px] font-bold text-ok-dark mb-1.5">
                    <span className="msr text-[15px]">task_alt</span>
                    {t('ticket.resolucionFinal')}
                  </div>
                  <div className="text-[12.5px] text-ink-2 whitespace-pre-wrap">
                    {tk.resolucion.texto}
                  </div>
                  <div className="text-[10.5px] text-warm-gray mt-1.5">
                    {m('resueltoPor', {
                      nombre: tk.resolucion.porNombre,
                      fecha: fmtFecha(tk.resolucion.at, true),
                    })}
                  </div>
                </div>
              )
            )}
          </div>

          {/* Columna derecha — sidebar de propiedades */}
          <div className="flex flex-col gap-4">
            <SidebarCampo label={t('ticket.estado')} hint={t('ticket.estadoHint')}>
              <select
                value={estadoDraft}
                onChange={(e) => setEstadoDraft(e.target.value as TicketStatus)}
                className="w-full border border-warm-border rounded-lg bg-white px-2.5 py-2 text-[12.5px] outline-none focus:border-navy cursor-pointer"
              >
                {(ESTADOS_MODAL.includes(estadoDraft)
                  ? ESTADOS_MODAL
                  : [...ESTADOS_MODAL, estadoDraft]
                ).map((es) => (
                  <option key={es} value={es}>
                    {ticketStatusLabels[idioma][es]}
                  </option>
                ))}
              </select>
            </SidebarCampo>

            <SidebarCampo label={t('ticket.asignadoA')}>
              <select
                value={asignadoDraft}
                onChange={(e) => setAsignadoDraft(e.target.value)}
                className="w-full border border-warm-border rounded-lg bg-white px-2.5 py-2 text-[12.5px] outline-none focus:border-navy cursor-pointer"
              >
                <option value="">{m('sinAsignar')}</option>
                {team
                  .filter((x) => x.data.activo)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.data.nombre}
                    </option>
                  ))}
              </select>
            </SidebarCampo>

            <SidebarCampo label={t('ticket.prioridad')}>
              <select
                value={prioridadDraft}
                onChange={(e) => setPrioridadDraft(e.target.value as TicketPriority)}
                className="w-full border border-warm-border rounded-lg bg-white px-2.5 py-2 text-[12.5px] outline-none focus:border-navy cursor-pointer"
              >
                {PRIORIDADES.map((p) => (
                  <option key={p} value={p}>
                    {ticketPriorityLabels[idioma][p]}
                  </option>
                ))}
              </select>
            </SidebarCampo>

            <SidebarCampo label={t('ticket.visibilidad')}>
              <button
                onClick={() => setPublicoDraft((v) => !v)}
                className="flex items-center gap-2.5 text-[12.5px] text-ink-2"
              >
                <span
                  className={`relative inline-block h-5 w-9 rounded-full transition-colors ${
                    publicoDraft ? 'bg-navy' : 'bg-warm-gray-4'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-card transition-all ${
                      publicoDraft ? 'left-[18px]' : 'left-0.5'
                    }`}
                  />
                </span>
                <span className="msr text-[15px] text-warm-gray">public</span>
                {t('ticket.publico')}
              </button>
            </SidebarCampo>

            <SidebarCampo label={m('devRef')} hint={m('devRefHint')}>
              <input
                value={devRef}
                onChange={(e) => setDevRef(e.target.value)}
                onBlur={guardarDevRef}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                placeholder="DEV-318"
                className="w-full border border-warm-border rounded-lg bg-white px-2.5 py-2 text-[12.5px] font-mono outline-none focus:border-navy"
              />
            </SidebarCampo>
          </div>
        </div>

        {/* Notas internas */}
        <div className="border-t border-cream-3 px-6 py-5">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="msr text-[14px] text-warn-dark">lock</span>
            <span className="text-[10.5px] font-bold tracking-wider text-warm-gray-2">
              {t('ticket.notasInternas')}
            </span>
          </div>
          <div className="text-[11px] text-warm-gray-2 mb-3">{t('ticket.notasHint')}</div>

          <div className="flex flex-col gap-2">
            {notas.map((n) => {
              const propia = n.data.autor.id === agent.uid;
              const editando = notaEditId === n.id;
              return (
                <div key={n.id} className="group bg-gold-bg rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="h-5 w-5 rounded-full bg-gold text-white text-[8px] font-bold flex items-center justify-center">
                      {iniciales(n.data.autor.nombre)}
                    </span>
                    <span className="text-[11px] font-bold text-warn-dark flex-1">
                      {n.data.autor.nombre}
                    </span>
                    {!!n.data.editadoAt && (
                      <span className="text-[10px] text-warm-gray-2">{m('editada')} ·</span>
                    )}
                    <span className="text-[10px] text-warm-gray-2">{fmtHora(n.data.createdAt)}</span>
                    {propia && !editando && (
                      <button
                        onClick={() => {
                          setNotaEditId(n.id);
                          setNotaEditDraft(n.data.texto);
                        }}
                        title={m('editar')}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-warm-gray hover:text-warn-dark"
                      >
                        <span className="msr text-[14px]">edit</span>
                      </button>
                    )}
                  </div>
                  {editando ? (
                    <div className="mt-1">
                      <textarea
                        rows={2}
                        value={notaEditDraft}
                        onChange={(e) => setNotaEditDraft(e.target.value)}
                        autoFocus
                        className="w-full border border-gold/50 rounded-lg bg-white px-2.5 py-1.5 text-[12.5px] outline-none focus:border-warn-dark resize-y"
                      />
                      <div className="flex justify-end gap-2 mt-1.5">
                        <button
                          onClick={() => setNotaEditId(null)}
                          className="text-[11.5px] font-semibold text-warm-gray px-2 py-1 rounded hover:bg-gold/20"
                        >
                          {m('cerrar')}
                        </button>
                        <button
                          onClick={() => guardarNotaEdit(n.id)}
                          disabled={!notaEditDraft.trim()}
                          className="bg-warn-dark text-white text-[11.5px] font-semibold px-3 py-1 rounded disabled:opacity-40"
                        >
                          {m('guardarCambios')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[12.5px] text-ink-2 whitespace-pre-wrap">{n.data.texto}</div>
                  )}
                </div>
              );
            })}
            {notas.length === 0 && (
              <div className="text-[12px] text-warm-gray-2">{m('sinNotas')}</div>
            )}
          </div>

          <div className="flex items-end gap-2 mt-3 bg-cream-0 border border-warm-border rounded-xl p-2">
            <textarea
              rows={1}
              value={notaDraft}
              onChange={(e) => setNotaDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  agregarNota();
                }
              }}
              placeholder={t('inbox.placeholderNota')}
              className="flex-1 bg-transparent resize-none outline-none text-[12.5px] px-1.5 py-1"
            />
            <button
              onClick={agregarNota}
              disabled={!notaDraft.trim()}
              title={m('agregar')}
              className="bg-navy text-white h-8 w-8 rounded-lg flex items-center justify-center disabled:opacity-40 hover:bg-navy-light"
            >
              <span className="msr text-[16px]">send</span>
            </button>
          </div>
        </div>
      </div>

      {/* Confirmación antes de guardar título/descripción */}
      {confirmarGuardar && (
        <div
          className="fixed inset-0 z-[60] bg-navy-deep/40 flex items-center justify-center p-6"
          onClick={(e) => {
            e.stopPropagation();
            setConfirmarGuardar(false);
          }}
        >
          <div
            className="bg-white rounded-xl shadow-raised w-full max-w-sm p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <span className="msr text-[20px] text-navy">save</span>
              <div className="text-[14px] font-bold text-ink">{m('confTitulo')}</div>
            </div>
            <div className="text-[12.5px] text-warm-gray mt-2 leading-relaxed">{m('confTexto')}</div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setConfirmarGuardar(false)}
                className="text-[12.5px] font-semibold text-warm-gray px-3 py-2 rounded-lg hover:bg-cream-1"
              >
                {m('cerrar')}
              </button>
              <button
                onClick={guardarEdicion}
                disabled={busy}
                className="bg-navy text-white text-[12.5px] font-semibold px-4 py-2 rounded-lg hover:bg-navy-light disabled:opacity-40"
              >
                {m('confSi')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SidebarCampo({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] font-bold tracking-wider text-warm-gray-2 uppercase mb-1.5">
        {label}
      </div>
      {children}
      {hint && <div className="text-[10px] text-warm-gray-2 mt-1">{hint}</div>}
    </div>
  );
}
