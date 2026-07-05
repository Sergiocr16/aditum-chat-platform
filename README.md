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
- Continuous, WhatsApp-style thread that merges all of a contact's conversations.
- Two sub-channels per contact: **ask the bot** and **talk to an agent** (seamless escalation).
- Native tickets, CSAT rating, attachments (image/video/file), emoji reactions, typing
  indicators, read receipts, per-user mute, and per-client group chat.

**Console (what your agents use)**
- **Inbox** — live conversations with continuous thread, resizable columns, and context panel.
- **Tickets** — sequential numbering, priorities, SLA tracking, internal notes, timeline.
- **Contactos** — auto-populated contact directory with tags.
- **Bot** — configure the bot, upload knowledge-base PDFs/URLs, and test it live.
- **Reportes** — CSAT, SLA, and daily activity metrics.
- **Configuración** — sites, widget appearance, SLA policy, team, tags, closing categories.
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

**2. Seed demo data** (sites + dev keys, clients, agents, conversations, tickets)

```sh
pnpm --filter @aditum-chat/functions seed
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
BOT_MODEL=claude-sonnet-5      # optional override
```

In production: `firebase functions:secrets:set ANTHROPIC_API_KEY` (and `VOYAGE_API_KEY`,
`CONFIG_KEK`).

---

## Host integration (how a host app embeds the widget)

The host server encrypts the user identity with the site key
(AES-256-GCM, format `base64(iv(12) ‖ ciphertext ‖ tag(16))`, max 5-minute expiry) and the page
embeds it:

```html
<script>
  window.AditumChatSettings = {
    siteId: 'app-aditum',
    payload: 'ENCRYPTED_PAYLOAD_GENERATED_ON_YOUR_SERVER',
  };
</script>
<script src="https://chat.aditumcr.com/widget.js" async></script>
```

Payload claims: `userId, nombre, email?, rol?, condominio?, clientId?, deviceToken?,
idioma? ('es'|'en'), iat, exp`. `idioma` sets the widget language; `clientId` enables the
client's group chat; `rol` of "admin" adds the user to that group.

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
  userId: 'usr_123', nombre: 'Juan Rodríguez', email: 'juan@x.com',
  rol: 'Administrador', condominio: 'Condominio Vistas del Este',
  clientId: 'vistas-del-este', idioma: 'es', iat: now, exp: now + 300,
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

## Data model (Firestore)

- **`sites/{siteId}`** — connected host app; per-site widget/bot/schedule overrides + push config.
  `sites/{id}/secrets/{current|previous|fcm}` hold AES keys / encrypted service account (rules-denied).
- **`clients/{clientId}`** — condominium (plan, modules, tags, CSAT average, group-chat toggle).
- **`contacts/{siteId_externalId}`** — auto-populated directory (role, filial, device tokens, tags).
- **`conversations/{id}`** — `tipo` directa|grupo, `estado` bot|open|pending|resolved, `subcanal`
  bot|agente; assignment, per-participant unread/mute, SLA, category.
  Subcollection **`messages/{id}`** — sender user|agent|bot|sistema; content texto|imagen|video|
  archivo|sistema|csat; attachments, reactions, `replyTo`, `interno` (internal notes never leave the console).
- **`tickets/{id}`** — sequential `numero`, estado, prioridad, scope cliente|sistema, SLA,
  resolution. Subcollections **`historial`** (timeline) and **`notas`** (internal).
- **`csat/{id}`** — 1–5 rating tied to conversation/ticket/contact/agent.
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

- Model: `claude-sonnet-5` (override with `BOT_MODEL`), via `@anthropic-ai/sdk`, key
  `ANTHROPIC_API_KEY`.
- `botReply` fires on new `user` messages in `directa` conversations still in `estado: 'bot'`. It
  gathers context (contact, open tickets, and **RAG context from the KB**), builds a bilingual
  (es/en) system prompt, and runs an agentic **tool loop (up to 3 turns)**:
  - `escalar_a_agente(motivo)` — hands off to a human agent sub-channel.
  - `crear_ticket(asunto, descripcion, prioridad)` — when auto-ticket creation is enabled.
  - Auto-escalates after N failed attempts.
- `testBot` (console "Probar el bot") and `aiAssist` (draft a reply / ticket description) are
  agent-only callables.
- **Embeddings** use **Voyage AI** (`voyage-3.5-lite`, 768-dim) with a keyword-search fallback
  when `VOYAGE_API_KEY` is unset; semantic search uses Firestore `findNearest` (COSINE).

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
