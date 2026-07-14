import { HttpsError, onCall } from 'firebase-functions/v2/https';
import type { TeamRole } from '@aditum-chat/shared';
import { auth, db, FieldValue, Timestamp } from './lib/admin.js';
import { formatSiteKey, generateSiteKeyHex, generateTempPassword } from './lib/crypto.js';

/** Horas que la clave anterior sigue siendo válida tras rotar. */
const GRACIA_ROTACION_HORAS = 24;

interface ManageTeamInput {
  accion: 'crear' | 'actualizar' | 'desactivar' | 'eliminar' | 'resetPassword';
  uid?: string;
  email?: string;
  password?: string;
  nombre?: string;
  nombreChat?: string;
  rol?: TeamRole;
  sitios?: string[];
  activo?: boolean;
  fotoUrl?: string;
}

/** Alta/edición de agentes con claims — solo admins (pantallas 1j/1m). */
export const manageTeam = onCall({ region: 'us-central1' }, async (req) => {
  if (req.auth?.token.kind !== 'agent' || req.auth.token.rol !== 'admin') {
    throw new HttpsError('permission-denied', 'Solo admins pueden gestionar el equipo.');
  }
  const input = req.data as ManageTeamInput;

  if (input.accion === 'crear') {
    if (!input.email || !input.password || !input.nombre) {
      throw new HttpsError('invalid-argument', 'email, password y nombre son requeridos.');
    }
    const user = await auth.createUser({
      email: input.email,
      password: input.password,
      displayName: input.nombre,
    });
    const rol: TeamRole = input.rol ?? 'agente';
    await auth.setCustomUserClaims(user.uid, { kind: 'agent', rol });
    await db.doc(`team/${user.uid}`).set({
      nombre: input.nombre,
      email: input.email,
      rol,
      nombreChat: input.nombreChat ?? input.nombre,
      sitios: input.sitios ?? [],
      activo: true,
      idioma: 'es',
      presencia: 'desconectado',
      carga: { chats: 0, tickets: 0 },
      ...(input.fotoUrl ? { fotoUrl: input.fotoUrl } : {}),
      createdAt: FieldValue.serverTimestamp(),
    });
    return { uid: user.uid };
  }

  if (!input.uid) throw new HttpsError('invalid-argument', 'uid requerido.');

  if (input.accion === 'desactivar') {
    await auth.updateUser(input.uid, { disabled: true });
    await db.doc(`team/${input.uid}`).update({ activo: false });
    return { uid: input.uid };
  }

  if (input.accion === 'eliminar') {
    if (input.uid === req.auth.uid) {
      throw new HttpsError('failed-precondition', 'No podés eliminar tu propia cuenta.');
    }
    // Assigned conversations/tickets keep the denormalized asignadoNombre.
    await auth.deleteUser(input.uid);
    await db.doc(`team/${input.uid}`).delete();
    return { uid: input.uid };
  }

  if (input.accion === 'resetPassword') {
    // The plaintext only exists in this response — it is never persisted.
    const password = generateTempPassword();
    await auth.updateUser(input.uid, { password });
    return { uid: input.uid, password };
  }

  // actualizar
  const update: Record<string, unknown> = {};
  for (const k of ['nombre', 'nombreChat', 'sitios', 'fotoUrl'] as const) {
    if (input[k] !== undefined) update[k] = input[k];
  }
  if (input.activo !== undefined) {
    update.activo = input.activo;
    await auth.updateUser(input.uid, { disabled: !input.activo });
  }
  if (input.rol) {
    update.rol = input.rol;
    await auth.setCustomUserClaims(input.uid, { kind: 'agent', rol: input.rol });
  }
  if (input.email) {
    update.email = input.email;
    await auth.updateUser(input.uid, { email: input.email });
  }
  if (input.nombre) await auth.updateUser(input.uid, { displayName: input.nombre });
  if (Object.keys(update).length) await db.doc(`team/${input.uid}`).update(update);
  return { uid: input.uid };
});

/**
 * Rota la clave de cifrado de un sitio (pantalla 1o). La clave anterior sigue
 * válida durante el período de gracia. Devuelve la clave nueva UNA sola vez.
 */
export const rotateSiteKey = onCall({ region: 'us-central1' }, async (req) => {
  if (req.auth?.token.kind !== 'agent' || req.auth.token.rol !== 'admin') {
    throw new HttpsError('permission-denied', 'Solo admins pueden rotar claves.');
  }
  const { siteId } = req.data as { siteId: string };
  const siteRef = db.doc(`sites/${siteId}`);
  if (!(await siteRef.get()).exists) throw new HttpsError('not-found', 'Sitio no encontrado.');

  const currentRef = siteRef.collection('secrets').doc('current');
  const currentSnap = await currentRef.get();
  const nuevaHex = generateSiteKeyHex();

  const batch = db.batch();
  if (currentSnap.exists) {
    batch.set(siteRef.collection('secrets').doc('previous'), {
      ...currentSnap.data(),
      validaHasta: Timestamp.fromMillis(Date.now() + GRACIA_ROTACION_HORAS * 3600_000),
    });
  }
  batch.set(currentRef, { keyHex: nuevaHex, createdAt: FieldValue.serverTimestamp() });
  await batch.commit();

  return {
    clave: formatSiteKey(siteId, nuevaHex),
    graciaHoras: GRACIA_ROTACION_HORAS,
  };
});
