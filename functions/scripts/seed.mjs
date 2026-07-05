// Seed con los datos del diseño.
//   Dev (emuladores):  pnpm --filter @aditum-chat/functions seed
//   Producción:        SEED_TARGET=prod GOOGLE_APPLICATION_CREDENTIALS=<sa.json> \
//                      node scripts/seed.mjs
// En prod usa el service account (Application Default Credentials) y NO toca
// los emuladores. Ojo: carga TODOS los datos, incluidos los de demo.

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const PROD = process.env.SEED_TARGET === 'prod';
const PROJECT_ID = PROD ? 'aditum-chat-1a5cd' : 'demo-aditum-chat';

if (!PROD) {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8181';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9101';
}
process.env.GCLOUD_PROJECT ??= PROJECT_ID;

initializeApp(PROD ? { projectId: PROJECT_ID, credential: applicationDefault() } : { projectId: PROJECT_ID });
const db = getFirestore();
const auth = getAuth();

const now = () => FieldValue.serverTimestamp();
const hoursAgo = (h) => Timestamp.fromMillis(Date.now() - h * 3600_000);
const daysAgo = (d) => hoursAgo(d * 24);

// Claves FIJAS de desarrollo (en producción se generan con rotateSiteKey).
const DEV_KEYS = {
  'app-aditum': 'a'.repeat(64),
  'portal-residentes': 'b'.repeat(64),
};

async function seedSites() {
  await db.doc('sites/app-aditum').set({
    nombre: 'App Aditum',
    dominio: 'app.aditumcr.com',
    icono: 'apartment',
    activo: true,
    widgetConfig: { botonChatEquipo: true },
    botConfig: null,
    scheduleConfig: null,
    stats: { conversaciones: 26, tickets: 148, usuarios: 172 },
    createdAt: now(),
  });
  await db.doc('sites/portal-residentes').set({
    nombre: 'Portal de residentes',
    dominio: 'residentes.aditumcr.com',
    icono: 'home_work',
    activo: true,
    widgetConfig: { botonChatEquipo: false },
    botConfig: null,
    scheduleConfig: null,
    stats: { conversaciones: 84, tickets: 1240, usuarios: 1240 },
    createdAt: now(),
  });
  for (const [siteId, keyHex] of Object.entries(DEV_KEYS)) {
    await db.doc(`sites/${siteId}/secrets/current`).set({ keyHex, createdAt: now() });
  }
}

async function seedClients() {
  const clients = {
    'vistas-del-este': {
      nombre: 'Condominio Vistas del Este',
      ubicacion: 'Curridabat, San José',
      filiales: 148,
      plan: 'Empresarial',
      clienteDesde: 2023,
      modulos: ['Cobros', 'Reservas', 'Mant.'],
      csatPromedio: 4.8,
      chatGlobalActivo: true,
    },
    'torres-de-sabana': {
      nombre: 'Torres de Sabana',
      ubicacion: 'Sabana, San José',
      filiales: 96,
      plan: 'Empresarial',
      clienteDesde: 2024,
      modulos: ['Cobros', 'Reservas'],
      csatPromedio: 4.5,
      chatGlobalActivo: true,
    },
    'hacienda-real-cariari': {
      nombre: 'Hacienda Real Cariari',
      ubicacion: 'Heredia',
      filiales: 210,
      plan: 'Empresarial',
      clienteDesde: 2022,
      modulos: ['Cobros', 'Reservas', 'Mant.'],
      csatPromedio: 4.6,
      chatGlobalActivo: true,
    },
    'lindora-park': {
      nombre: 'Residencial Lindora Park',
      ubicacion: 'Santa Ana',
      filiales: 64,
      plan: 'Pro',
      clienteDesde: 2025,
      modulos: ['Cobros'],
      csatPromedio: 4.2,
      chatGlobalActivo: false,
    },
  };
  for (const [id, data] of Object.entries(clients)) {
    await db.doc(`clients/${id}`).set({ ...data, createdAt: now() });
  }
}

async function ensureAuthUser(uid, email, password, displayName, claims) {
  try {
    await auth.getUser(uid);
  } catch {
    await auth.createUser({ uid, email, password, displayName });
  }
  await auth.setCustomUserClaims(uid, claims);
}

async function seedTeam() {
  const members = [
    ['agente-laura', 'laura@aditumcr.com', 'Laura Campos', 'agente', 'Laura de Aditum'],
    ['agente-rebeca', 'rebeca@aditumcr.com', 'Rebeca Quirós', 'agente', 'Rebeca de Aditum'],
    ['agente-diego', 'diego@aditumcr.com', 'Diego Paniagua', 'agente', 'Diego de Aditum'],
    ['admin-sergio', 'partners@aditumcr.com', 'Sergio Castro', 'admin', 'Sergio de Aditum'],
  ];
  for (const [uid, email, nombre, rol, nombreChat] of members) {
    await ensureAuthUser(uid, email, 'aditum123', nombre, { kind: 'agent', rol });
    await db.doc(`team/${uid}`).set({
      nombre,
      email,
      rol,
      nombreChat,
      sitios: [],
      activo: true,
      idioma: 'es',
      presencia: uid === 'agente-laura' ? 'en_linea' : 'desconectado',
      carga: { chats: uid === 'agente-laura' ? 5 : 2, tickets: uid === 'agente-laura' ? 8 : 3 },
      createdAt: now(),
    });
  }
}

async function seedContacts() {
  const contacts = [
    ['app-aditum_usr_1001', 'usr_1001', 'app-aditum', 'vistas-del-este', 'Juan Rodríguez', 'jrodriguez@vistasdeleste.cr', 'Administrador', 'es'],
    ['app-aditum_usr_1002', 'usr_1002', 'app-aditum', 'vistas-del-este', 'Roberto Jiménez', 'rjimenez@vistasdeleste.cr', 'Administrador', 'es'],
    ['app-aditum_usr_1003', 'usr_1003', 'app-aditum', 'vistas-del-este', 'Silvia Mora', 'smora@vistasdeleste.cr', 'Administradora', 'es'],
    ['app-aditum_usr_3001', 'usr_3001', 'app-aditum', 'hacienda-real-cariari', 'Carlos Vega', 'cvega@cariari.cr', 'Administrador', 'es'],
    ['portal-residentes_usr_2001', 'usr_2001', 'portal-residentes', 'torres-de-sabana', 'Ana Brenes', 'ana.brenes@gmail.com', 'Residente (filial B-14)', 'en'],
  ];
  for (const [id, externalId, siteId, clientId, nombre, email, rol, idioma] of contacts) {
    await db.doc(`contacts/${id}`).set({
      externalId, siteId, clientId, nombre, email, rol, idioma,
      deviceTokens: [],
      conversacionesCount: 3,
      ticketsCount: 5,
      csatPromedio: 4.8,
      lastActivity: hoursAgo(1),
      createdAt: daysAgo(120),
    });
  }
}

async function seedTags() {
  // Catálogo de etiquetas por sitio (Configuración → Etiquetas).
  const tags = [
    ['tag-vip', 'app-aditum', 'VIP', '#123C68', 0],
    ['tag-junta', 'app-aditum', 'Junta directiva', '#2E9E5B', 1],
    ['tag-moroso', 'app-aditum', 'Moroso', '#B3261E', 2],
    ['tag-nuevo', 'app-aditum', 'Cliente nuevo', '#E3A93C', 3],
    ['tag-portal-piloto', 'portal-residentes', 'Piloto', '#7A4FB3', 0],
  ];
  for (const [id, siteId, nombre, color, orden] of tags) {
    await db.doc(`tags/${id}`).set({ siteId, nombre, color, orden, createdAt: now() });
  }
  // Asignación demo: Juan lleva VIP + Junta directiva.
  await db.doc('contacts/app-aditum_usr_1001').update({ tags: ['tag-vip', 'tag-junta'] });
  // El condominio (para la conversación de equipo) lleva VIP.
  await db.doc('clients/vistas-del-este').update({ tags: ['tag-vip'] });
}

async function seedConversations() {
  // Conversación VIEJA y RESUELTA de Juan (hilo continuo + infinite scroll):
  // ~40 mensajes para que la paginación de 30 tenga que traer más.
  const vieja = db.doc('conversations/conv-juan-reservas-vieja');
  await vieja.set({
    tipo: 'directa',
    subcanal: 'agente',
    siteId: 'app-aditum',
    clientId: 'vistas-del-este',
    clientNombre: 'Condominio Vistas del Este',
    contactId: 'app-aditum_usr_1001',
    contactNombre: 'Juan Rodríguez',
    estado: 'resolved',
    categoria: 'reservas',
    resueltaPor: 'agente-rebeca',
    resueltaNombre: 'Rebeca Quirós',
    resueltaAt: daysAgo(12),
    asignadoA: 'agente-rebeca',
    asignadoNombre: 'Rebeca Quirós',
    idioma: 'es',
    lastMessage: {
      texto: 'Conversación resuelta · Reservas',
      senderTipo: 'sistema',
      senderNombre: 'Sistema',
      at: daysAgo(12),
    },
    unread: {},
    createdAt: daysAgo(13),
    updatedAt: daysAgo(12),
  });
  const temas = [
    '¿Cómo bloqueo el rancho los domingos?',
    'Necesito ver el calendario de la piscina',
    '¿Puedo cobrar depósito por el salón?',
    'El gimnasio aparece ocupado todo el día',
  ];
  for (let i = 0; i < 40; i++) {
    const deUsuario = i % 2 === 0;
    await vieja.collection('messages').doc(`m${String(i).padStart(3, '0')}`).set({
      sender: deUsuario
        ? { tipo: 'user', id: 'app-aditum_usr_1001', nombre: 'Juan Rodríguez' }
        : { tipo: 'agent', id: 'agente-rebeca', nombre: 'Rebeca Quirós' },
      texto: deUsuario
        ? `${temas[i % temas.length]} (msj ${i + 1})`
        : `Claro Juan, te explico el paso ${i + 1} en el módulo de Reservas.`,
      tipoContenido: 'texto',
      createdAt: Timestamp.fromMillis(Date.now() - 13 * 86400_000 + i * 600_000),
    });
  }
  await vieja.collection('messages').doc('m040').set({
    sender: { tipo: 'sistema', id: 'sistema', nombre: 'Sistema' },
    texto: 'Conversación resuelta · Reservas',
    tipoContenido: 'sistema',
    createdAt: daysAgo(12),
  });

  // Conversación directa de Juan (la del diseño: error de cobros julio).
  const conv = db.doc('conversations/conv-juan-cobros');
  await conv.set({
    tipo: 'directa',
    subcanal: 'agente',
    siteId: 'app-aditum',
    clientId: 'vistas-del-este',
    clientNombre: 'Condominio Vistas del Este',
    contactId: 'app-aditum_usr_1001',
    contactNombre: 'Juan Rodríguez',
    estado: 'open',
    asignadoA: 'agente-laura',
    asignadoNombre: 'Laura Campos',
    botIntentos: 1,
    idioma: 'es',
    lastMessage: {
      texto: 'Revisá este campo en tu módulo de Cobros 👆',
      senderTipo: 'agent',
      senderNombre: 'Laura Campos',
      at: hoursAgo(1),
    },
    unread: { 'app-aditum_usr_1001': 1 },
    createdAt: hoursAgo(3),
    updatedAt: hoursAgo(1),
  });
  const msgs = [
    { sender: { tipo: 'bot', id: 'bot', nombre: 'Asistente Aditum' }, texto: '¡Hola Juan! Soy el asistente de Aditum. ¿En qué puedo ayudarte?', tipoContenido: 'texto', createdAt: hoursAgo(3) },
    { sender: { tipo: 'user', id: 'app-aditum_usr_1001', nombre: 'Juan Rodríguez' }, texto: 'Al generar el cobro de cuotas de julio me da error en 12 filiales.', tipoContenido: 'texto', createdAt: hoursAgo(2.9) },
    { sender: { tipo: 'sistema', id: 'sistema', nombre: 'Sistema' }, texto: 'Conversación escalada a un agente', tipoContenido: 'sistema', createdAt: hoursAgo(2.8) },
    { sender: { tipo: 'agent', id: 'agente-laura', nombre: 'Laura Campos' }, texto: 'Hola Juan, ya lo estoy revisando. ¿Me confirmás si las 12 filiales tienen cargos especiales?', tipoContenido: 'texto', createdAt: hoursAgo(2.5) },
    { sender: { tipo: 'agent', id: 'agente-laura', nombre: 'Laura Campos' }, texto: 'Revisá este campo en tu módulo de Cobros 👆', tipoContenido: 'texto', createdAt: hoursAgo(1) },
  ];
  for (const [i, m] of msgs.entries()) {
    await conv.collection('messages').doc(`m${String(i).padStart(3, '0')}`).set(m);
  }

  // Chat global de Vistas del Este (diseño 1s).
  const grupo = db.doc('conversations/grupo_app-aditum_vistas-del-este');
  await grupo.set({
    tipo: 'grupo',
    siteId: 'app-aditum',
    clientId: 'vistas-del-este',
    clientNombre: 'Vistas del Este · Equipo administrador',
    participantes: ['app-aditum_usr_1001', 'app-aditum_usr_1002', 'app-aditum_usr_1003', 'agente-laura'],
    participantesInfo: {
      'app-aditum_usr_1001': { nombre: 'Juan Rodríguez', tipo: 'user', rol: 'Administrador' },
      'app-aditum_usr_1002': { nombre: 'Roberto Jiménez', tipo: 'user', rol: 'Administrador' },
      'app-aditum_usr_1003': { nombre: 'Silvia Mora', tipo: 'user', rol: 'Administradora' },
      'agente-laura': { nombre: 'Laura Campos', tipo: 'agent', rol: 'SOPORTE ADITUM' },
    },
    estado: 'open',
    unread: {},
    idioma: 'es',
    lastMessage: { texto: 'Ya lo reporté a soporte, quedó el ticket #TK-0042', senderTipo: 'user', senderNombre: 'Roberto Jiménez', at: hoursAgo(2) },
    createdAt: daysAgo(30),
    updatedAt: hoursAgo(2),
  });
  const grupoMsgs = [
    { sender: { tipo: 'user', id: 'app-aditum_usr_1002', nombre: 'Roberto Jiménez' }, texto: '¿Alguien más vio el error al generar los cobros de julio?', tipoContenido: 'texto', createdAt: hoursAgo(4) },
    { sender: { tipo: 'user', id: 'app-aditum_usr_1003', nombre: 'Silvia Mora' }, texto: 'Sí, a mí me pasó con las filiales que tienen cargos de mantenimiento.', tipoContenido: 'texto', createdAt: hoursAgo(3.5) },
    { sender: { tipo: 'user', id: 'app-aditum_usr_1002', nombre: 'Roberto Jiménez' }, texto: 'Ya lo reporté a soporte, quedó el ticket #TK-0042', tipoContenido: 'texto', ticketRef: { ticketId: 'tk-0042', numero: 42 }, createdAt: hoursAgo(2) },
  ];
  for (const [i, m] of grupoMsgs.entries()) {
    await grupo.collection('messages').doc(`m${String(i).padStart(3, '0')}`).set(m);
  }

  // Una conversación atendida por el bot (para el filtro Bot del inbox).
  await db.doc('conversations/conv-ana-reservas').set({
    tipo: 'directa',
    subcanal: 'agente',
    siteId: 'portal-residentes',
    clientId: 'torres-de-sabana',
    clientNombre: 'Torres de Sabana',
    contactId: 'portal-residentes_usr_2001',
    contactNombre: 'Ana Brenes',
    estado: 'bot',
    asignadoA: null,
    botIntentos: 0,
    idioma: 'en',
    lastMessage: { texto: 'How do I book the tennis court?', senderTipo: 'user', senderNombre: 'Ana Brenes', at: hoursAgo(0.2) },
    unread: {},
    createdAt: hoursAgo(0.3),
    updatedAt: hoursAgo(0.2),
  });
}

async function seedTickets() {
  const tickets = [
    ['tk-0042', 42, 'Error al generar cobro de cuotas de julio — 12 filiales', 'en_progreso', 'alta', 'cliente', false, 'app-aditum', 'vistas-del-este', 'app-aditum_usr_1001', 'Juan Rodríguez', 'agente-laura', 'Laura Campos', 'conv-juan-cobros', 0.1],
    ['tk-0041', 41, 'No puedo aprobar reservas del salón de eventos', 'abierto', 'media', 'cliente', false, 'app-aditum', 'vistas-del-este', 'app-aditum_usr_1002', 'Roberto Jiménez', 'agente-rebeca', 'Rebeca Quirós', null, 5],
    ['tk-0040', 40, 'Fotos no cargan en reportes', 'pendiente', 'alta', 'sistema', true, 'app-aditum', null, null, null, 'agente-diego', 'Diego Paniagua', null, 26],
    ['tk-0039', 39, 'Solicitud: recordatorios de cuota por WhatsApp', 'abierto', 'baja', 'cliente', false, 'portal-residentes', 'torres-de-sabana', 'portal-residentes_usr_2001', 'Ana Brenes', null, null, null, 48],
    ['tk-0038', 38, 'Estado de cuenta con saldo incorrecto', 'resuelto', 'media', 'cliente', false, 'app-aditum', 'vistas-del-este', 'app-aditum_usr_1001', 'Juan Rodríguez', 'agente-laura', 'Laura Campos', null, 120],
    ['tk-0037', 37, 'Lentitud en estados de cuenta', 'resuelto', 'media', 'sistema', true, 'app-aditum', null, null, null, 'agente-diego', 'Diego Paniagua', null, 130],
    ['tk-0031', 31, 'Acceso denegado al módulo de mantenimiento', 'resuelto', 'baja', 'cliente', false, 'app-aditum', 'vistas-del-este', 'app-aditum_usr_1001', 'Juan Rodríguez', 'agente-rebeca', 'Rebeca Quirós', null, 400],
  ];
  for (const [id, numero, asunto, estado, prioridad, ambito, publico, siteId, clientId, contactId, contactNombre, asignadoA, asignadoNombre, conversationId, horas] of tickets) {
    const doc = {
      numero, asunto,
      descripcion: asunto,
      estado, prioridad, ambito, publico,
      siteId,
      asignadoA, asignadoNombre,
      conversationId,
      devRef: id === 'tk-0040' ? 'DEV-318' : null,
      sla: { estado: estado === 'resuelto' ? 'cumplido' : 'en_sla', dueAt: hoursAgo(-8), pausas: [] },
      resolucion: null,
      createdAt: hoursAgo(horas + 2),
      updatedAt: hoursAgo(horas),
    };
    if (clientId) { doc.clientId = clientId; doc.clientNombre = (await db.doc(`clients/${clientId}`).get()).data()?.nombre ?? clientId; }
    if (contactId) { doc.contactId = contactId; doc.contactNombre = contactNombre; }
    await db.doc(`tickets/${id}`).set(doc);
  }

  // Historial del TK-0042 (diseño 1n).
  const h = db.doc('tickets/tk-0042').collection('historial');
  await h.doc('e001').set({ tipo: 'creado', descripcion: 'Creado desde el chat por Laura Campos', por: { tipo: 'agent', id: 'agente-laura', nombre: 'Laura Campos' }, createdAt: hoursAgo(2) });
  await h.doc('e002').set({ tipo: 'asignado', descripcion: 'Asignado a Laura Campos', por: { tipo: 'agent', id: 'agente-laura', nombre: 'Laura Campos' }, createdAt: hoursAgo(2) });
  await h.doc('e003').set({ tipo: 'estado', descripcion: 'Estado cambió a En progreso', de: 'abierto', a: 'en_progreso', por: { tipo: 'agent', id: 'agente-laura', nombre: 'Laura Campos' }, createdAt: hoursAgo(1.5) });
  await db.doc('tickets/tk-0042').collection('notas').doc('n001').set({
    autor: { tipo: 'agent', id: 'agente-rebeca', nombre: 'Rebeca Quirós' },
    texto: 'Parece relacionado con los cargos especiales de mantenimiento. Revisar módulo de Cobros.',
    createdAt: hoursAgo(1.2),
  });

  await db.doc('counters/tickets').set({ next: 43 });
}

async function seedSettings() {
  // Logo demo: la marca horizontal de Aditum (formato natural), como data URL.
  let logoUrl;
  try {
    const { readFileSync } = await import('node:fs');
    const png = readFileSync(new URL('../../apps/widget/demo/aditum-logo.png', import.meta.url));
    logoUrl = `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    logoUrl = undefined;
  }
  await db.doc('settings/global').set({
    categorias: [
      'cobros',
      'reservas',
      'mantenimiento',
      'accesos',
      'estados_cuenta',
      'facturacion',
      'consulta_general',
      'otro',
    ],
    widgetConfig: {
      color: '#123C68',
      posicion: 'bottom-left',
      titulo: 'Soporte Aditum',
      ...(logoUrl ? { logoUrl } : {}),
      saludo: '¡Hola! ¿En qué podemos ayudarte?',
      botonBot: true,
      botonAgente: true,
      botonChatEquipo: false,
      ocultarBurbuja: false,
    },
    botConfig: {
      activo: true,
      nombre: 'Asistente Aditum',
      instrucciones:
        'Sos el asistente de soporte de Aditum, un software de administración de condominios en Costa Rica. Ayudás a administradores y residentes con cobros, cuotas, reservas de amenidades, reportes de mantenimiento y estados de cuenta. Sé breve, claro y práctico.',
      tono: 'vos',
      escalarTrasIntentos: 2,
      responderFueraDeHorario: true,
      crearTicketsAutomaticamente: false,
      saludo: '¡Hola {nombre}! Soy el asistente de Aditum. ¿En qué puedo ayudarte?',
    },
    scheduleConfig: {
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
    },
  });
  await db.doc('settings/sla').set({
    primeraRespuestaMin: 15,
    pausarConBot: true,
    pausarFueraHorario: true,
    resolucionHoras: { alta: 8, media: 24, baja: 72 },
    avisoPorcentaje: 25,
    escalarAlAdminAlVencer: true,
    reasignarTrasMin: 30,
  });
}

console.log('Sembrando datos de desarrollo…');
await seedSites();
await seedClients();
await seedTeam();
await seedContacts();
await seedTags();
await seedConversations();
await seedTickets();
await seedSettings();
console.log('✔ Seed completo.');
console.log('  Agentes: laura@aditumcr.com / rebeca@ / diego@ / partners@aditumcr.com — clave: aditum123');
process.exit(0);
