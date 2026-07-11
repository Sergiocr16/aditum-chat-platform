# Aditum Chat — especificación de diseño y convenciones

Fuente de verdad: proyecto de Claude Design "Aditum Chat: Sistema de Soporte" (18 pantallas).
Este documento resume lo necesario para implementar cada pantalla con fidelidad.

## Convenciones del código (dashboard)

- Next.js App Router en `apps/dashboard`, páginas client (`'use client'`).
- Tailwind 4 con tokens en `src/app/globals.css` (`@theme`). Clases disponibles:
  `bg-navy`, `bg-navy-deep`, `bg-navy-light`, `text-blue-muted`, `text-ink`, `text-ink-2`,
  `text-warm-gray`, `text-warm-gray-2`, `text-warm-gray-3`, `bg-cream-0..3`, `border-warm-border`,
  `bg-ok / ok-dark / ok-bg`, `bg-warn / warn-dark / warn-bg`, `bg-gold / gold-bg`,
  `bg-danger / danger-bright / danger-bg`, `bg-ai / ai-light / ai-bg`, `bg-tag-blue-bg`, `bg-info-bg`,
  `shadow-card`, `shadow-raised`, `shadow-modal`, `rounded-card` (8px), `rounded-panel` (14px).
- Iconos: Material Symbols Rounded → `<span className="msr">nombre_icono</span>` (`msr-fill` para relleno).
- Datos: hooks en `src/lib/data.ts` (`useTickets`, `useTicketHistory`, `useTicketNotes`, `useContact`,
  `useContactTickets`, `useSites`, `useTeam`, `useDoc`, `useConversations`, `useMessages`,
  `fmtFecha`, `fmtHora`, `fmtRelativo`, `iniciales`). Firestore vía `src/lib/firebase.ts` (emuladores).
- Auth: `useAuth()` de `src/lib/auth.tsx` → `agent.uid`, `agent.perfil` (TeamMember), `agent.idioma`.
- Filtro global de sitio: `useSiteFilter()` de `src/components/Shell.tsx` → `{ siteId | null }`.
- i18n: catálogo global en `@aditum-chat/shared` (`useT()` de `src/lib/i18n.ts`).
  **Los agentes de pantallas NUEVAS no editan `packages/shared`**: definan un catálogo local
  `const M = { es: {...}, en: {...} }` en su archivo y resuelvan con `agent.idioma`.
- Tipos del modelo: importar de `@aditum-chat/shared` (Ticket, Contact, Site, TeamMember, SlaPolicy,
  BotConfig, WidgetConfig, KbDoc, labels `ticketStatusLabels`, `ticketPriorityLabels`, `slaEstadoLabels`,
  `formatTicketNumber`).
- Callables: `httpsCallable(fns, 'createTicket')` etc. (`fns` en `src/lib/firebase.ts`).
- Copy en español CR con voseo ("Escribí", "Revisá"). Todo texto visible en es + en.
- No commitear. Verificar con `pnpm --filter @aditum-chat/dashboard typecheck`.

## Tokens visuales

Instrument Sans; primario navy `#123C68`; sombras sobre `rgba(10,29,49,…)`; chips pill 99px;
cards 8px; paneles/modales 14px con `shadow-modal`. Chips de estado de ticket:
- Abierto `bg-gold-bg text-warn-dark` · En progreso `bg-tag-blue-bg text-navy` ·
  En desarrollo `bg-ai-bg text-ai` · Resuelto `bg-ok-bg text-ok-dark` · Pendiente `bg-warn-bg text-warn-dark`.
- Prioridad: Alta `bg-danger-bg text-danger` · Media `bg-warn-bg text-warn-dark` · Baja `bg-cream-2 text-warm-gray`.
- SLA: En SLA `bg-ok-bg text-ok-dark` · por vencer `bg-warn-bg text-warn-dark` con icono `schedule` ·
  vencido `bg-danger-bg text-danger` · cumplido icono `check_circle`.

## Modelo de datos (Firestore, colecciones planas)

`sites/{siteId}` (App Aditum `apartment`, Portal residentes `home_work`; widgetConfig/botConfig/scheduleConfig
override por sitio, herencia de `settings/global`) · `clients/{clientId}` · `groups/{groupId}`
(organización: `name`, `chatEnabled`, `clients[{id,name}]`) · `contacts/{contactId}`
(id = `${siteId}_${externalId}`) · `conversations/{id}` (+`messages`) · `tickets/{id}` (+`historial`, `notas`)
· `team/{uid}` · `settings/global|sla` · `kb/{docId}` (+`chunks`) · `csat/{id}` · `metrics/daily/{fecha}`.
Estados ticket: `abierto|en_progreso|en_desarrollo|resuelto|pendiente`. Prioridad: `alta|media|baja`.
Ámbito: `cliente|grupo|sistema` + `publico: bool`.

---

## Pantallas de consola pendientes (specs del diseño)

### 1g — Módulo Tickets (`/tickets`)
- Header: "Tickets" + filtros dropdown: Estado (Todos/…), Prioridad (Todas/…), Agente (Todos/…),
  selector sitio (`language` icon) + búsqueda (`search`).
- Tabla columnas: **N.º · ASUNTO · CLIENTE · SITIO · ESTADO · PRIORIDAD · AGENTE · SLA**.
  - N.º formato `#TK-0042` monoespaciado. Asunto en semibold. Cliente = clientNombre.
  - Sitio = chip pequeño (APP ADITUM / PORTAL RES.). Estado/prioridad = chips.
  - Agente: avatar iniciales + nombre. SLA: chip "En SLA" / `schedule` vence / `check_circle`.
  - Fila clickeable → abre modal detalle (1n).
- Footer: "Mostrando 1–10 de 34" + paginación `chevron_left/right` (client-side sobre los 100 cargados).

### 1n — Modal detalle de ticket
- Header: `#TK-0042` + icono `public` si público + chip prioridad + asunto grande +
  "Reportado por Juan Rodríguez · APP ADITUM" + botón `close`.
- Aviso SLA cuando abierto: `schedule` "SLA de resolución vence en 2 h 10 m" (fondo warn-bg).
- Layout 2 columnas: izquierda = HISTORIAL DEL TICKET (timeline con iconos por tipo:
  creado `confirmation_number`, asignado `person`, estado `swap_horiz`, desarrollo `code`,
  público `public`, resolución `task_alt`) + bloque "Resolución final" (textarea
  "Describí qué se hizo para resolver el ticket. El cliente lo verá como cierre…" + botón guardar
  que cambia estado a resuelto y agrega evento) cuando estado != resuelto.
- Columna derecha (sidebar): dropdown **ESTADO** (Abierto/En progreso/En desarrollo/Resuelto,
  hint "cada cambio queda registrado en el historial"), **ASIGNADO A** (dropdown team),
  **PRIORIDAD**, **VISIBILIDAD** (Público toggle), campo **devRef** (ej. DEV-318).
  Cada cambio escribe el update + evento en `historial` (los agentes tienen permiso directo de escritura).
- Abajo: **NOTAS INTERNAS** (`lock`, "Solo visibles para el equipo — el cliente nunca las ve"):
  lista de notas (autor + hora, fondo gold-bg) + input "Agregar nota interna…".

### 1r — Contactos (`/contactos`)
- Header: "Contactos · 1 412" + chip `sync` "Directorio automático" con hint
  "se guardan automáticamente al escribir por el chat".
- Filtros: Cliente (dropdown de clients), sitio (`language`), Rol + `search`.
- Tabla: **CONTACTO** (avatar iniciales + nombre + email) · **CLIENTE/CONDOMINIO** ·
  **SITIO** (chip) · **ÚLTIMA ACTIVIDAD** (relativo) + "N conversaciones · N tickets" +
  botón `chat` "Conversar" + `more_horiz`.
- Panel lateral derecho al seleccionar: nombre/email/rol, botón "Iniciar conversación",
  CONVERSACIONES RECIENTES (`forum`) y TICKETS del contacto.
- Roles vistos: Administrador, Administradora, Residente (filial B-14), Asistente administrativo.

### 1h — Reportes SLA (`/reportes`) — solo Admin
- Subheader: "Solo visible para rol Admin · Últimos 30 días". Filtros: rango, agente, sitio.
- 4 KPI cards: **Primera respuesta (mediana) 8 min** · **Cumplimiento SLA 94.2%** ·
  **Resueltas por el bot 41%** · **CSAT 4.6 ★ (318 valoraciones)**.
- Gráfico de líneas "Tiempo de primera respuesta por semana" (SVG simple):
  series Agentes / Bot + línea punteada "Meta SLA 15 min"; eje Y 12/15/18, X Sem 1-4.
- Tabla "Desempeño por agente": avatar, nombre, % cumplimiento (LC 97%, MS 93%, DP 86%),
  fila especial **Bot (Claude)** con `smart_toy` 99%. Link "editar en Configuración".
- Datos: leer `metrics/daily/*` y agregarlos client-side; si no hay datos, mostrar los del seed/mock.

### 1i — Config Bot (`/bot`) — solo Admin
- Selector de sitio arriba ("Configurando: App Aditum / Portal residentes",
  nota "Cada sitio tiene su propio bot, mensajes y widget"), toggle **Bot activo**,
  estado "Cambios sin guardar" + botón **Guardar cambios** (escribe al override
  `sites/{siteId}.botConfig` o a `settings/global.botConfig` si se edita el global).
- Card "Instrucciones y contexto del bot": textarea con contador "1 240 / 10 000 caracteres",
  hint "Se incluye en cada llamada al modelo".
- Card "Base de conocimiento": lista de `kb/` docs (icono `description` PDF / `link` URL,
  nombre, páginas/artículos, sitio TODOS/APP ADITUM, chip estado Indexado/Sincronizando)
  + botón subir PDF (Storage `kb/`) + agregar URL.
- Card "Identidad del bot": avatar + "Imagen del bot en el chat · Aparece junto a cada mensaje" + Cambiar.
- Card "Comportamiento" (toggles): Escalar a agente si no puede resolver ("Tras 2 intentos sin resolver"),
  Responder fuera de horario ("El bot cubre noches y fines de semana"),
  Crear tickets automáticamente ("Cuando detecta un error del sistema").
- "Tono de respuesta": radio Cercano (vos) / Formal (usted).
- Card "Probar el bot": panel de chat de prueba "ASÍ LO VE EL ADMINISTRADOR" (llama al callable `testBot`).

### 1k — Config widget por sitio (`/configuracion` tab Widget)
- Selector de sitio. Campos: color primario (color picker), posición burbuja,
  título, saludo, toggles de botones de inicio (bot/agente/**chat de equipo** con hint
  "El botón solo aparece si este toggle está activo"), horario (por día desde/hasta)
  + `textoHorario` es/en. Vista previa en vivo del widget (mock estático del panel, no iframe).
- Indica herencia: "(Por sitio)" vs "(Global)".

### 1p — Config SLA (`/configuracion` tab SLA) — doc `settings/sla`
- Primera respuesta: 15 min + toggles "pausa cuando el bot responde primero",
  "pausa fuera de horario hábil".
- Tiempos de resolución por prioridad: Alta 8 h / Media 24 h / Baja 72 h.
- Alertas: avisar al agente al 25% restante, escalar al admin al vencer,
  reasignación automática si el agente no responde en 30 min.

### 1o — Sitios conectados (`/configuracion` tab Sitios)
- Cards por sitio: icono, nombre, dominio, chip Activo, stats (conversaciones/tickets/usuarios),
  y "+ Conectar otro servicio" ("Sitio web, app móvil o cualquier producto con HTML").
- Card "Código de instalación": snippet `<script>` con `content_copy`.
- Card "Payload cifrado": lista de campos `userId, name, email, role, clientId · clientName,
  groupId · groupName, groupChatEnabled, groupClients [{id,name}], deviceToken · push, language,
  exp · 5 min` + nota "Se descifra solo en nuestro servidor con la clave privada del sitio."
- Card "Clave de cifrado del sitio" (`key`): muestra `pk_app-aditum_••••••3f8a`, botones
  **Rotar clave** (callable `rotateSiteKey` → muestra la nueva UNA vez) y copiar.
- Tabla de herencia de config: qué es Por sitio vs Global.

### 1j + 1m — Equipo y roles (`/configuracion` tab Equipo) — solo Admin
- Tabla de miembros: foto/iniciales, nombre, correo, rol (Admin/Agente), estado
  (En línea/Ausente), carga ("5 chats · 8 tickets"), activo, `more_horiz` → editar.
- Matriz de permisos (estática informativa): Atender conversaciones y tickets (ambos),
  Configurar el bot y su conocimiento (Admin), Ver reportes de SLA (Admin),
  Definir políticas de SLA e invitar usuarios (Admin, `shield_person`).
- Modal editar usuario (1m): foto (PNG/JPG ≥128×128), nombre, correo, rol,
  "nombre visible en el chat", sitios asignados (checkboxes), toggle activo.
  Alta/edición vía callable `manageTeam`.
