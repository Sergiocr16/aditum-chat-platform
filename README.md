# Aditum Chat

A self-hosted, Freshchat-style customer support platform for condominium / property
management. It bundles an embeddable multitenant chat **widget**, an agent **console**, a native
**ticketing** system, per-client **group chat**, and an **AI bot powered by Claude** with a
retrieval-augmented knowledge base.

Reference design: the "Aditum Chat: Sistema de Soporte" Claude Design project (18 screens) —
see [`docs/design-spec.md`](docs/design-spec.md).

---

## Features

**Widget (what your users see)**
- One embeddable `widget.js` — Preact in a **Shadow DOM**, so host styles never collide.
- Continuous, WhatsApp-style thread that merges all of a contact's conversations. The thread is a
  single **chat** per (contact, channel), but **segmented** into multiple conversations: resolving
  one closes it into the resolved history, and writing again opens a fresh conversation (see
  [Conversation model](#conversation-model-segmented-history)).
- Two sub-channels per contact: **ask the bot** and **talk to an agent** (seamless escalation),
  plus a per-client **group chat** — all segmented.
- Configurable **welcome / auto-reply** messages per channel: bot greeting on open, agent
  auto-reply after the first message, and a separate after-hours reply.
- Message actions: **reply** (quote + jump-to-message), **react**, **copy**, and **edit** (marks
  "edited" and shows the previous version on hover). URLs are auto-linkified.
- Native tickets, CSAT rating (persistent, one-time), attachments (image/video/file), typing
  indicators, read receipts, per-user mute.
- Launcher buttons with **configurable text and icon** per button (upload an image), an "AI" chip
  on the bot button, and open/close chevrons.

**Console (what your agents use)**
- **Inbox** — live conversations with continuous segmented thread, resizable columns, and context
  panel; same message actions as the widget (reply, react, copy, edit).
- **Tickets** — sequential numbering, priorities, SLA tracking, internal notes, timeline. The
  ticket detail is **fully editable** (title, description, status, assignee, priority, visibility)
  and applied only on **Save** with a confirmation modal; every change is logged to the timeline.
  Internal notes are editable by their author.
- **Context panel** — a resident/team sidebar with the **resolved-conversation history** (filter by
  category, CSAT stars, and a kebab menu to create a ticket from a conversation or open the
  ticket(s) already linked to it) and client tickets as compact cards.
- **Contactos** — auto-populated contact directory with tags.
- **Bot** — configure the bot, upload knowledge-base PDFs/URLs, and test it live.
- **Reportes** — CSAT, SLA, and daily activity metrics.
- **Configuración** — sites, widget appearance (including per-button text/icon and welcome/auto-reply
  messages), SLA policy, team, tags, closing categories.
- Desktop push (FCM Web Push) so agents get notified even with the tab closed.

**Bot (Claude)**
- First-line answers with an agentic tool loop: `escalar_a_agente` and `crear_ticket`.
- RAG grounding over your knowledge base (PDFs + help-center URLs).

---

## Architecture

```
Host app (JHipster/etc.)                 This project
┌───────────────────────┐
│  server encrypts the   │  window.AditumChatSettings   ┌───────────────────────────┐
│  user identity (AES)   │ ───────────────────────────▶ │  widget.js (Preact,        │
└───────────────────────┘                               │  Shadow DOM)               │
                                                         └────────────┬──────────────┘
                                                                      │ Firebase Web SDK
                                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │  Firebase: Auth · Firestore · Realtime DB (typing) · Storage · Hosting        │
   └───────────────┬──────────────────────────────────────────────┬───────────────┘
                   │ triggers / callables                          │ Web SDK
                   ▼                                               ▼
   ┌───────────────────────────────┐                ┌──────────────────────────────┐
   │  Cloud Functions v2 (Node 22) │   Anthropic    │  Next.js console (agents)     │
   │  bot · tickets · SLA · KB ·   │ ─────────────▶ │  static export → Hosting       │
   │  metrics · push · team        │  Claude API    └──────────────────────────────┘
   └───────────────────────────────┘   Voyage AI (embeddings)
```

Multitenancy is two levels deep: **sites** (connected host apps) → **clients/condominiums** →
**contacts**. Isolation is enforced by Firebase custom claims plus Firestore security rules; every
sensitive write (tickets, keys, team, KB, metrics) goes through Cloud Functions with the Admin SDK.

---

## Monorepo layout

```
apps/widget      Embeddable widget — Preact + Vite → dist/widget.js (IIFE, Shadow DOM) + demo/
apps/dashboard   Agent console — Next.js 15 App Router + Tailwind 4 (static export)
functions        Cloud Functions v2 — widgetSession, botReply, createTicket, SLA, KB, push…
packages/shared  Data-model types, design tokens, i18n catalogs (es/en), helpers
```

Managed with **pnpm 9 workspaces + Turborepo**. `packages/shared` is consumed as **raw
TypeScript** via `workspace:*` (no build step), so a change there type-checks against every
consumer.

## Tech stack

| Area | Stack |
|---|---|
| Package manager | pnpm `9.15.9` (workspaces) + Turborepo `^2.5` |
| Runtime | Node **20** (root, `.nvmrc` `v20.20.2`) · Node **22** (functions) |
| Widget | Preact `^10.26`, Vite `^6.3` (IIFE build) |
| Console | Next.js `^15.3`, React `^19.1`, Tailwind CSS `^4.1` |
| Functions | firebase-functions `^6.4`, firebase-admin `^13.4`, `@anthropic-ai/sdk` `^0.110`, pdf-parse |
| Client SDK | firebase `^11.10` |
| Language | TypeScript `^5.8` |

> **Note:** `functions` pins Node **22** while the rest targets Node **20**. Use Node 20 for
> everyday work; the functions build/deploy runs on Node 22.

---

## Getting started

Prerequisites: Node 20 (`nvm use`), pnpm 9, Java 17+ (for the Firebase emulators).

```sh
pnpm install
```

**1. Build functions and start the emulators**
Ports: Auth `9101`, Functions `5201`, Firestore `8181`, Realtime DB `9102`, Storage `9103`,
Emulator UI `4100`.

```sh
pnpm --filter @aditum-chat/functions build
npx firebase emulators:start --project demo-aditum-chat \
  --only auth,firestore,functions,storage,database
```

**2. Seed demo data** (sites + dev keys, clients, groups, agents, conversations, tickets)

```sh
pnpm --filter @aditum-chat/functions seed    # load full demo data
pnpm --filter @aditum-chat/functions clean   # wipe demo CONTENT, keep sites/keys/agents/settings
```

**3. Widget + demo host page**

```sh
cd apps/widget && npx vite --port 5174 --host 127.0.0.1
# → http://127.0.0.1:5174/demo/index.html
```

**4. Console**

```sh
pnpm --filter @aditum-chat/dashboard dev
# → http://localhost:3000
# logins: laura@aditumcr.com / aditum123 · admin: partners@aditumcr.com
```

**Headless checks** (with emulators + seed running):

```sh
cd apps/widget
node scripts/verify-widget-flow.mjs    # encrypted session + multitenant widget rules
node scripts/verify-console-flow.mjs   # agent flow + createTicket
```

### Scripts reference

```sh
pnpm dev            # turbo run dev across workspaces
pnpm build          # turbo run build
pnpm typecheck      # turbo run typecheck
pnpm emulators      # firebase emulators:start --project demo-aditum-chat
```

Per workspace: `pnpm --filter @aditum-chat/<dashboard|widget|functions|shared> <script>`.
(`turbo run lint` is wired but currently a no-op — no ESLint config is present.)

---

## Environment & secrets

No `.env` files are committed. Production Firebase **web** config is baked in as defaults in
`apps/dashboard/src/lib/firebase.ts` (web API keys are not secrets by Firebase design).

**Console / widget** (all `NEXT_PUBLIC_*`, optional overrides):
`NEXT_PUBLIC_USE_EMULATORS` (`false` in prod), `NEXT_PUBLIC_FB_API_KEY`, `NEXT_PUBLIC_FB_APP_ID`,
`NEXT_PUBLIC_FB_AUTH_DOMAIN`, `NEXT_PUBLIC_FB_DATABASE_URL`, `NEXT_PUBLIC_FB_PROJECT_ID`,
`NEXT_PUBLIC_FB_SENDER_ID`, `NEXT_PUBLIC_FB_STORAGE_BUCKET`, `NEXT_PUBLIC_FB_VAPID_KEY`.

**Functions (real secrets).** Locally, create `functions/.secret.local`:

```
ANTHROPIC_API_KEY=sk-ant-...
VOYAGE_API_KEY=pa-...          # optional: without it the KB falls back to keyword search
CONFIG_KEK=<hex-64>            # AES-256-GCM KEK; generate with: openssl rand -hex 32
```

Models are fixed in code (`functions/src/bot.ts`): `claude-haiku-4-5` for the widget bot and
"Probar el bot", `claude-sonnet-5` for the agent AI assist — no env override.

In production: `firebase functions:secrets:set ANTHROPIC_API_KEY` (and `VOYAGE_API_KEY`,
`CONFIG_KEK`).

---

## Host integration (how a host app embeds the widget)

The host server encrypts the user identity with the site key
(AES-256-GCM, format `base64(iv(12) ‖ ciphertext ‖ tag(16))`, max 5-minute expiry) and the page
embeds it:

```html
<!-- In the <head>: required for the widget's fullscreen mode on phones
     (safe-area insets are inert without viewport-fit=cover). -->
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />

<script>
  window.AditumChatSettings = {
    siteId: 'app-aditum',
    payload: 'ENCRYPTED_PAYLOAD_GENERATED_ON_YOUR_SERVER',
    // Recommended for SPAs: an authenticated host endpoint returning a fresh
    // { payload }. The embedded payload expires after 5 minutes; with this URL
    // the widget fetches a new one at session time (embedded stays as fallback).
    payloadUrl: '/api/aditum-chat/payload',
  };
</script>
<script src="https://chat.aditumcr.com/widget.js" async></script>
```

Payload claims: `userId, name, email?, role?, clientId?, clientName?, clientInfo?, groupId?,
groupName?, groupChatEnabled?, groupClients?, deviceToken?, language? ('es'|'en'), iat, exp`.

- `clientId`/`clientName` — the user's client/condo (tenancy for direct chats and tickets).
- `clientInfo` — optional context-panel data shown to agents next to the chat:
  `{ location?, units?, plan?, customerSince?, modules? }`. Upserted into `clients/{clientId}`
  on every session (only the provided fields, last-write-wins).
- `groupId`/`groupName` — the organization an admin belongs to (e.g. a management company). The
  group — not the admin — owns the list of managed units, sent as
  `groupClients: [{ id, name }]` (max 300; upserted to `groups/{groupId}` on every session,
  last-write-wins).
- `groupChatEnabled` — the host declares whether the group has the group chat feature; combined
  with a `role` containing "admin", it provisions the group conversation and shows the tab in the
  widget. The site-level `botonChatEquipo` toggle remains as a platform kill-switch.

### Node (reference)

```js
const crypto = require('node:crypto');

function encryptPayload(keyHex, claims) {
  const key = Buffer.from(keyHex, 'hex'); // hex of the pk_<siteId>_<hex> key
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(claims), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, ct, cipher.getAuthTag()]).toString('base64');
}

const now = Math.floor(Date.now() / 1000);
const payload = encryptPayload(SITE_KEY_HEX, {
  userId: 'usr_123', name: 'Juan Rodríguez', email: 'juan@x.com',
  role: 'Administrador',
  clientId: 'vistas-del-este', clientName: 'Condominio Vistas del Este',
  clientInfo: {
    location: 'Curridabat, San José', units: 148, plan: 'Empresarial',
    customerSince: 2023, modules: ['Cobros', 'Reservas', 'Mant.'],
  },
  groupId: 'adm-horizonte', groupName: 'Administradora Horizonte',
  groupChatEnabled: true,
  groupClients: [
    { id: 'vistas-del-este', name: 'Condominio Vistas del Este' },
    { id: 'hacienda-real-cariari', name: 'Hacienda Real Cariari' },
  ],
  language: 'es', iat: now, exp: now + 300,
});
```

### Java (for Aditum's JHipster backend)

```java
public static String encryptPayload(String keyHex, String claimsJson) throws Exception {
    byte[] key = HexFormat.of().parseHex(keyHex);
    byte[] iv = new byte[12];
    SecureRandom.getInstanceStrong().nextBytes(iv);
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
    byte[] ct = cipher.doFinal(claimsJson.getBytes(StandardCharsets.UTF_8)); // tag appended
    ByteBuffer out = ByteBuffer.allocate(iv.length + ct.length).put(iv).put(ct);
    return Base64.getEncoder().encodeToString(out.array());
}
```

Site keys are generated/rotated from the console (Configuración → Sitios conectados → Rotar
clave); the previous key stays valid for 24 h. In dev, the seed installs fixed keys and the
emulator-only `demoPayload` function mints test payloads.

---

## Notifications

**Mobile push to the end user** — the payload's `deviceToken` belongs to the **host app's**
Firebase project (not this one). In Configuración → Sitios conectados → Notificaciones push you
upload that project's **service account** (Firebase Console → Service accounts → Generate private
key). It is stored **AES-256-GCM encrypted** in `sites/{siteId}/secrets/fcm` (unreadable by
clients) under the `CONFIG_KEK` secret. `pushNotify` sends through that project and respects
per-user mute.

**Desktop push to agents (console)** — agents receive system notifications even with the console
tab closed (FCM Web Push). The prod project config and VAPID public key ship as defaults; in prod
just set `NEXT_PUBLIC_USE_EMULATORS=false`. Each agent enables notifications with the bell next to
their profile; the token is stored in `team/{uid}.fcmTokens`. `notifyAgentsOnMessage` sends the
push when a user writes (to the assigned agent, or all site agents if unassigned); the click opens
`/inbox?c=<convId>`. In the emulator, sending is skipped with a log warning (no local FCM).

---

## Conversation model (segmented history)

A **chat** (the continuous thread) is unique per **(contact, subcanal)** for directas and per
**(group)** for the group chat — the inbox never shows a duplicate chat. Inside it lives a
**sequence of conversation docs (segments)**:

- Resolving a conversation (`estado: 'resolved'`) closes that segment; it stays resolved and shows
  up in the console's **resolved-conversation history**.
- Writing after the active conversation is resolved opens a **new** conversation (segment) in the
  same chat — never reopens, never duplicates. At most one open segment per (contact, subcanal).
- The console stitches all of a contact's segments into one scroll with `useContactThread` (directa)
  and `useGroupThread` (grupo), both built on the shared `useConvThread`; rows dedup by `convId+msgId`.
- The group chat is segmented the same way: multiple `tipo:'grupo'` docs per client, discovered via
  `participantes array-contains contactId` (widget) or `tipo+clientId` (console).

## Data model (Firestore)

- **`sites/{siteId}`** — connected host app; per-site widget/bot/schedule overrides + push config.
  `sites/{id}/secrets/{current|previous|fcm}` hold AES keys / encrypted service account (rules-denied).
- **`clients/{clientId}`** — condominium (plan, modules, tags, CSAT average, group-chat toggle).
- **`contacts/{siteId_externalId}`** — auto-populated directory (role, filial, device tokens, tags,
  `csatRating`/`csatPromedio`).
- **`conversations/{id}`** — `tipo` directa|grupo, `estado` bot|open|pending|resolved, `subcanal`
  bot|agente; assignment, per-participant unread/mute, SLA, category, `csatRating` (written by
  `metricsOnCsat`). Segmented per the model above.
  Subcollection **`messages/{id}`** — sender user|agent|bot|sistema; content texto|imagen|video|
  archivo|sistema|csat; attachments, reactions, `replyTo`, `ticketRef`, `interno` (internal notes
  never leave the console), `editadoAt`/`textoAnterior` (edits, with the previous version), and
  `bienvenida` (auto welcome/auto-reply, skipped by SLA/push). Fixed message ids `_bienvenida` and
  `_autorespuesta` make the auto messages idempotent.
- **`tickets/{id}`** — sequential `numero`, estado, prioridad, scope cliente|sistema, SLA,
  `conversationId` (source conversation), resolution. Subcollections **`historial`** (timeline;
  event types include `edicion`) and **`notas`** (internal, editable — `editadoAt`).
- **`csat/{id}`** — 1–5 rating tied to conversation/ticket/contact/agent. The widget reads its own
  ratings (`subscribeMyCsat`) so it never re-prompts.
- **`kb/{docId}` + `kb/{docId}/chunks/{id}`** — RAG docs and embedded chunks (`FieldValue.vector`).
- **`team/{uid}`** — agents (rol admin|agente, sites, FCM tokens, presence).
- **`settings/global`**, **`settings/sla`** — global defaults and SLA policy.
- **`metrics_daily/{date}`**, **`notifications/{id}`**, **`counters/tickets`** — functions-only.

### Security model

Two identities via custom claims: **contact** (`kind:'contact', siteId, clientId?, contactId` —
from the widget) and **agent** (`kind:'agent', rol:'admin'|'agente'` — the console). Contacts can
only read/participate in their own conversations and tickets; internal notes are never readable
from the widget. All privileged writes go through Cloud Functions with the Admin SDK. See
`firestore.rules`, `storage.rules`, and `database.rules.json`.

---

## The Claude bot

- Models are **fixed in code** (`functions/src/bot.ts`): `claude-haiku-4-5` for the widget bot and
  "Probar el bot" (cheapest functional tier), `claude-sonnet-5` for `aiAssist` (low volume,
  writing quality matters). Via `@anthropic-ai/sdk`, key `ANTHROPIC_API_KEY`.
- **Prompt caching**: the system prompt is split into a stable block (identity + instructions +
  tone, marked `cache_control: ephemeral`) and a variable block (user context, open tickets, KB
  context) — the repeated part bills at ~10% under sustained traffic (`buildSystemBlocks`).
- `botReply` fires on new `user` messages in `directa` conversations still in `estado: 'bot'`. It
  gathers context (contact, open tickets, and **RAG context from the KB**), builds a bilingual
  (es/en) system prompt, and runs an agentic **tool loop (up to 3 turns)**:
  - `escalar_a_agente(motivo)` — hands off to a human agent sub-channel.
  - `crear_ticket(asunto, descripcion, prioridad)` — when auto-ticket creation is enabled.
  - Auto-escalates after N failed attempts.
- Replies may use **light markdown** (`**bold**`, `-`/`1.` lists, inline `code`) — the widget and
  console render it safely (node-based mini-markdown, no raw HTML); headings/tables are not
  interpreted.
- `testBot` ("Probar el bot" in `/bot`) is a **replica of the widget chat**: bot header + greeting,
  WhatsApp-style bubbles, **multi-turn history** and **image attachments** the model analyzes via
  vision (JPG/PNG/GIF/WebP ≤ 4 MB). `aiAssist` drafts replies / ticket descriptions. Both are
  agent-only callables.
- **Knowledge base** (`/bot`): accepts **PDF, TXT and MD** — file picker or **drag & drop** (multi
  file), with a search box over the document list. `kbIngestPdf` (storage trigger) parses PDFs with
  `pdf-parse` and ingests text files as UTF-8; URLs re-sync daily.
- **Embeddings** use **Voyage AI** (`voyage-3.5-lite`, 768-dim) with a keyword-search fallback
  when `VOYAGE_API_KEY` is unset; semantic search uses Firestore `findNearest` (COSINE).

---

## Bot answer feedback ("was this helpful?") & escalation

Every bot reply in the widget shows **"¿Te sirvió esta respuesta? 👍 Sí / 👎 No"**. The vote
closes the bot cycle:

- **👍 helpful** → the bot conversation is **resolved** (`resueltaPor: 'bot'`) + a thank-you. The
  next question opens a fresh segment. No star survey in the bot channel (the vote already
  captured satisfaction).
- **👎 not helpful** → inline offer **"¿Querés hablar con un agente?"**:
  - **Yes** → the bot conversation is resolved and the contact's **agent conversation** is
    created/reused with a system context message ("Escalado desde el bot · motivo · consulta",
    linked back via `botConvRef`); the widget jumps to the agent channel automatically. One active
    inbox row per contact.
  - **No, thanks** → the conversation stays open to keep asking.

Mechanics: votes live in **`bot_feedback/{convId}_{messageId}`** (deterministic id = one vote per
reply; create-only, with a narrow `escalate: true` update allowed only after a negative vote). The
`onBotFeedbackWrite` trigger stamps `feedback` on the message, aggregates
`botHelpfulCount/botNotHelpfulCount` into `metrics_daily`, and performs the handoff (same
`handoffAAgente` the bot tool uses). The widget jump is driven by **`escaladoAt`** (a growing
timestamp — re-escalations to the same agent conversation still trigger it; baseline is taken from
the first loaded snapshot so historical escalations never redirect).

Console: bot bubbles show a **"Le sirvió" / "No le sirvió"** chip; escalation messages show
**"Ver conversación del bot"** (opens the bot thread); the contact's history panel lists bot
cycles with a **BOT** chip, differentiated from agent conversations; Reportes has the
**"Respuestas útiles del bot"** KPI (% helpful + vote count, admin-only). Escalated bot
resolutions count neither `resueltasBot` nor `resueltasAgente` (the agent conversation counts
when it resolves).

---

## Automatic replies (welcome / after-hours)

The **bot's initial greeting** (`widget.mensajeAI`) is edited in **/bot → "Saludo inicial"**; the
**agent-channel** auto-replies (in/after hours) live in **Configuración → Widget → "Respuestas
automáticas"**. Both are per-site overrides applied by Cloud Functions
(`functions/src/welcome.ts`):

- `welcomeOnConversation` — on a new **bot** conversation, posts the greeting (`widget.mensajeAI`,
  fallback `bot.saludo`) as the first message. Idempotent (`_bienvenida`, timestamped at the
  conversation's `createdAt` so it stays first).
- `agentAutoReply` — on the user's **first message** in an **agente** conversation, posts an
  automatic reply: `widget.mensajeAgente` in business hours, `widget.mensajeFueraHorario` after
  hours (via `isWithinSchedule`). Idempotent (`_autorespuesta`).

Both are marked `bienvenida: true`, so `firstResponseTracker` (SLA) and `pushNotify` ignore them.
All texts support `{nombre}`.

---

## Deployment

Firebase Hosting targets (`.firebaserc` project `aditum-chat-1a5cd`):

| Target | Public dir | Notes |
|---|---|---|
| `dashboard` | `apps/dashboard/out` | Next.js static export, `cleanUrls` |
| `widget` | `apps/widget/dist` | `widget.js` served with `Access-Control-Allow-Origin: *`, `max-age=300` |

Functions deploy on `nodejs22`, region `us-central1`.

> **No automatic deploys.** Build and test locally against the emulators. Production deploys are a
> deliberate, manual step.

---

## Repo conventions

- **No automatic commits or pushes** — changes stay in the working tree; the maintainer decides
  when to commit/push.
- Copy is Costa Rican Spanish (voseo) + English; the widget language comes from the payload.
- Design system tokens live in `packages/shared/src/tokens.ts`. **Do not use teal.**
- Timezone: America/Costa_Rica.
