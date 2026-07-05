import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import type {
  Conversation,
  Message,
  Site,
  SlaPolicy,
  TeamMember,
  Ticket,
} from '@aditum-chat/shared';
import { db, FieldValue, Timestamp } from './lib/admin.js';
import { isWithinSchedule, resolveSiteConfig } from './lib/config.js';

const DEFAULT_POLICY: SlaPolicy = {
  primeraRespuestaMin: 15,
  pausarConBot: true,
  pausarFueraHorario: true,
  resolucionHoras: { alta: 8, media: 24, baja: 72 },
  avisoPorcentaje: 25,
  escalarAlAdminAlVencer: true,
  reasignarTrasMin: 30,
};

async function getPolicy(): Promise<SlaPolicy> {
  const snap = await db.doc('settings/sla').get();
  return { ...DEFAULT_POLICY, ...(snap.data() as Partial<SlaPolicy> | undefined) };
}

/** Al crear un ticket: fija el vencimiento de resolución según prioridad. */
export const ticketSlaInit = onDocumentCreated(
  { document: 'tickets/{ticketId}', region: 'us-central1' },
  async (event) => {
    const ticket = event.data?.data() as Ticket | undefined;
    if (!ticket || ticket.sla?.dueAt) {
      if (ticket && !ticket.sla?.dueAt) {
        // continúa para fijarlo
      } else return;
    }
    const policy = await getPolicy();
    const horas = policy.resolucionHoras[ticket!.prioridad] ?? 24;
    await event.data!.ref.update({
      'sla.dueAt': Timestamp.fromMillis(Date.now() + horas * 3600_000),
      'sla.estado': 'en_sla',
    });
  },
);

/** Primera respuesta de agente en una conversación: registra el tiempo. */
export const firstResponseTracker = onDocumentCreated(
  { document: 'conversations/{convId}/messages/{msgId}', region: 'us-central1' },
  async (event) => {
    const msg = event.data?.data() as Message | undefined;
    if (!msg || msg.sender.tipo !== 'agent' || msg.interno) return;
    const convRef = db.doc(`conversations/${event.params.convId}`);
    const convSnap = await convRef.get();
    const conv = convSnap.data() as Conversation | undefined;
    if (!conv || conv.tipo !== 'directa' || conv.sla?.primeraRespuestaAt) return;

    const createdAt = conv.createdAt as Timestamp | undefined;
    const ms = createdAt ? Date.now() - createdAt.toMillis() : 0;
    await convRef.update({
      'sla.primeraRespuestaAt': FieldValue.serverTimestamp(),
      'sla.pausada': false,
    });

    // Métrica diaria: tiempos de primera respuesta + cumplimiento.
    const policy = await getPolicy();
    const cumplido = ms <= policy.primeraRespuestaMin * 60_000;
    const fecha = new Date().toISOString().slice(0, 10);
    await db.doc(`metrics_daily/${fecha}`).set(
      {
        fecha,
        primeraRespuestaMs: FieldValue.arrayUnion(ms),
        slaCumplidos: FieldValue.increment(cumplido ? 1 : 0),
        slaVencidos: FieldValue.increment(cumplido ? 0 : 1),
        [`porAgente.${msg.sender.id}.slaTotal`]: FieldValue.increment(1),
        [`porAgente.${msg.sender.id}.slaCumplidos`]: FieldValue.increment(cumplido ? 1 : 0),
      },
      { merge: true },
    );
  },
);

/**
 * Motor de SLA (cada minuto): actualiza chips de estado de tickets,
 * escala al admin al vencer y reasigna conversaciones sin respuesta.
 */
export const slaEngine = onSchedule(
  { schedule: 'every 1 minutes', region: 'us-central1', timeoutSeconds: 120 },
  async () => {
    const policy = await getPolicy();
    const now = Date.now();

    // --- Tickets abiertos: en_sla → por_vencer → vencido.
    const abiertos = await db
      .collection('tickets')
      .where('estado', 'in', ['abierto', 'en_progreso', 'en_desarrollo'])
      .limit(300)
      .get();

    for (const doc of abiertos.docs) {
      const t = doc.data() as Ticket;
      const dueAt = (t.sla?.dueAt as Timestamp | undefined)?.toMillis();
      if (!dueAt) continue;
      const createdAt = (t.createdAt as Timestamp | undefined)?.toMillis() ?? now;
      const total = dueAt - createdAt;
      const restante = dueAt - now;
      let estado: string;
      if (restante <= 0) estado = 'vencido';
      else if (restante <= (total * policy.avisoPorcentaje) / 100) estado = 'por_vencer';
      else estado = 'en_sla';

      if (t.sla?.estado !== estado) {
        await doc.ref.update({ 'sla.estado': estado });
        if (estado === 'vencido' && policy.escalarAlAdminAlVencer) {
          await db.collection('notifications').add({
            tipo: 'sla_vencido',
            ticketId: doc.id,
            numero: t.numero,
            asunto: t.asunto,
            para: 'admins',
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      }
    }

    // --- Conversaciones abiertas sin primera respuesta: pausas y reasignación.
    const convs = await db
      .collection('conversations')
      .where('estado', '==', 'open')
      .limit(200)
      .get();

    let equipoCache: { uid: string; nombre: string }[] | null = null;

    for (const doc of convs.docs) {
      const c = doc.data() as Conversation;
      if (c.tipo !== 'directa' || c.sla?.primeraRespuestaAt) continue;
      const createdAt = (c.createdAt as Timestamp | undefined)?.toMillis();
      if (!createdAt) continue;

      // Pausa fuera de horario.
      if (policy.pausarFueraHorario) {
        const siteSnap = await db.doc(`sites/${c.siteId}`).get();
        const config = await resolveSiteConfig((siteSnap.data() as Site) ?? null);
        if (!isWithinSchedule(config.schedule)) continue;
      }

      const espera = now - createdAt;
      if (policy.reasignarTrasMin > 0 && espera > policy.reasignarTrasMin * 60_000 && c.asignadoA) {
        if (!equipoCache) {
          const team = await db.collection('team').where('activo', '==', true).get();
          equipoCache = team.docs
            .filter((d) => (d.data() as TeamMember).rol === 'agente' || (d.data() as TeamMember).rol === 'admin')
            .map((d) => ({ uid: d.id, nombre: (d.data() as TeamMember).nombre }));
        }
        const otro = equipoCache.find((m) => m.uid !== c.asignadoA);
        if (otro) {
          await doc.ref.update({
            asignadoA: otro.uid,
            asignadoNombre: otro.nombre,
            updatedAt: FieldValue.serverTimestamp(),
          });
          await doc.ref.collection('messages').add({
            sender: { tipo: 'sistema', id: 'sistema', nombre: 'Sistema' },
            texto: `Reasignada automáticamente a ${otro.nombre} (SLA de primera respuesta)`,
            tipoContenido: 'sistema',
            interno: true,
            createdAt: FieldValue.serverTimestamp(),
          });
          logger.info('Conversación reasignada por SLA', { convId: doc.id, a: otro.uid });
        }
      }
    }
  },
);
