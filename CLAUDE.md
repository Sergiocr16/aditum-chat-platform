# CLAUDE.md — Aditum Chat

Guidance for Claude Code when working in this repository. Nested `CLAUDE.md` files under
`apps/dashboard`, `apps/widget`, `functions`, and `packages/shared` add area-specific detail and
load automatically when you work in those directories.

## What this is

Self-hosted, Freshchat-style support platform for condominium management: an embeddable Preact
**widget**, a Next.js agent **console**, Cloud Functions v2 (v2, Node 22) with a **Claude bot**,
and a shared package of types/tokens/i18n. Multitenant: **sites → clients → contacts**, isolated
by Firebase custom claims + Firestore rules. See `README.md` for the full picture.

## Monorepo layout

```
apps/widget      Embeddable widget (Preact + Vite → IIFE widget.js, Shadow DOM)
apps/dashboard   Agent console (Next.js 15 App Router + Tailwind 4, static export)
functions        Cloud Functions v2 (bot, tickets, SLA, KB/RAG, push, team, widgetSession, investigations)
services/investigator  Runs on the Raspberry Pi: investigations over production code and read-only data, and the writer for approved changes
packages/shared  Types (source of truth), design tokens, i18n (es/en) — consumed as raw TS
```

pnpm 9 workspaces + Turborepo. `packages/shared` is imported as **raw TypeScript** (`workspace:*`,
no build) — editing it affects every consumer, so typecheck the consumers after changes.

## Commands

Node is managed with nvm. **Prefix Bash calls that run node/pnpm** with the nvm path:

```sh
export PATH=/Users/sergiocastro/.nvm/versions/node/v20.20.2/bin:$PATH
```

```sh
pnpm install
pnpm --filter @aditum-chat/dashboard dev        # console → http://localhost:3000
pnpm --filter @aditum-chat/dashboard typecheck  # tsc --noEmit (run after edits)
pnpm --filter @aditum-chat/functions build      # esbuild bundle (Node 22 target)
pnpm --filter @aditum-chat/functions seed       # seed emulator demo data
pnpm build | pnpm typecheck                      # turbo across all workspaces
```

**Emulators** — start WITHOUT hosting (hosting targets are prod-configured and will break dev):

```sh
npx firebase emulators:start --project demo-aditum-chat \
  --only auth,firestore,functions,storage,database
```

Ports: Auth `9101`, Functions `5201`, Firestore `8181`, RTDB `9102`, Storage `9103`, UI `4100`.

## Deploy (manual, production)

Production is `aditum-chat-1a5cd` (`.firebaserc`). Deploys are deliberate and manual — never
automatic; confirm the prod target with the maintainer first. Verified procedure:

1. Land the change on `main` (committed + pushed) with `pnpm typecheck` clean.
2. **Build the hosting artifacts first** — `firebase deploy` does NOT build hosting (only
   `functions` has a predeploy `tsc + esbuild` hook):
   ```sh
   pnpm --filter @aditum-chat/widget build                                    # → apps/widget/dist (gitignored)
   rm -rf apps/dashboard/.next
   NEXT_PUBLIC_USE_EMULATORS=false pnpm --filter @aditum-chat/dashboard build  # → apps/dashboard/out (committed)
   ```
   `NEXT_PUBLIC_USE_EMULATORS=false` is **mandatory** (compile-time inlined) — a build without it
   ships an emulator-connected console. Don't build while `next dev` (:3000) is up (`rm -rf .next`
   corrupts it).
3. Deploy only the changed targets — no `--force` (with explicit `--only` targets Firebase neither
   prompts nor deletes other functions):
   ```sh
   npx firebase deploy --project aditum-chat-1a5cd \
     --only firestore:rules,firestore:indexes,storage,functions:<changed>,hosting:dashboard,hosting:widget
   ```

`apps/dashboard/out/` is committed; `apps/widget/dist/` + `functions/lib/` are gitignored. The
trailing "cleaning up build images" warning is harmless (minor GCR cost, self-corrects next deploy).
Functions need their prod secrets already set (`ANTHROPIC_API_KEY`, `CONFIG_KEK`, `VOYAGE_API_KEY`,
`GITHUB_CODE_TOKEN`, `RUNNER_SHARED_SECRET`, `GATEWAY_SHARED_SECRET`, `WRITER_SHARED_SECRET`); a deploy fails if a declared secret doesn't exist.
They also need `functions/.env` (gitignored, copy `functions/.env.example`) with `CODE_REPO` and `CODE_JAVA_PACKAGE`:
which repository is production's. Without it the code index stops syncing and the Pi can't be installed.

## Hard rules

- **No automatic commits or pushes.** Leave changes in the working tree; the maintainer decides.
- **No automatic deploys.** Test locally against the emulators; a production deploy follows **Deploy
  (manual, production)** above and is confirmed with the maintainer first.
- Copy is **Costa Rican Spanish (voseo)** + English via `packages/shared/src/i18n.ts`. Default to
  Spanish when talking to the maintainer.
- **Do not use teal.** Two brand palettes since the Jul 2026 rebrand: the **console** is plum
  (`#2C1C2C` family — the `navy*` tokens in `apps/dashboard/src/app/globals.css` keep their
  historic NAME but hold plum values); the **widget** (resident-facing) keeps Aditum corporate
  navy `#123C68` from `packages/shared/src/tokens.ts`. Don't "fix" one to match the other.
- Timezone: **America/Costa_Rica** (UTC-6).

## Gotchas

- **Node version split:** everyday work on Node 20 (`.nvmrc`); `functions` targets Node **22**.
- **Prod builds corrupt a running dev server:** `next build` writes to the same `.next` the dev
  server uses. To regenerate the hosting export: kill `next dev` → `rm -rf apps/dashboard/.next` →
  `NEXT_PUBLIC_USE_EMULATORS=false pnpm --filter @aditum-chat/dashboard build` → `rm -rf .next`
  again → restart dev. The flag is **compile-time inlined** — a build without it ships an
  emulator-connected console.
- **Touch vs desktop UX is gated on `(hover: none)`** (message-menu tap targets, Enter=newline in
  composers) — test touch behavior with that media query, not by narrowing the window.
- **React StrictMode** double-invokes effects in dev — expect transient states in the console.
- **Secrets** live in `functions/.secret.local` (gitignored): `ANTHROPIC_API_KEY`,
  `VOYAGE_API_KEY`, `GITHUB_CODE_TOKEN`, `RUNNER_SHARED_SECRET`, `GATEWAY_SHARED_SECRET`, `WRITER_SHARED_SECRET`, `CONFIG_KEK`. Never commit them. Bot models are **fixed in
  code** (`bot.ts`): `claude-haiku-5-5` (widget bot + testBot), `claude-sonnet-5` (aiAssist).
- **The bot answers only with evidence** (`functions/src/evidence.ts`): a reply without a valid
  quoted source, or one exposing code, is replaced by a fixed "couldn't confirm" message. It can use a
  private index of the production repo but has no access to the production database.
- All privileged writes (tickets, keys, team, KB chunks, metrics, bot feedback stamping/handoff)
  go through Cloud Functions with the Admin SDK — client SDK writes are constrained by
  `firestore.rules`.
- **Segmented conversation model.** A "chat" is unique per (contact, `subcanal` bot|agente) and per
  (group) for the group chat, but holds **multiple conversation docs (segments)**; the active one
  is the most recent with estado in `[bot,open,pending]`. Writing after a conversation is resolved
  opens a **new** conversation — never reopen, never duplicate. The console stitches segments with
  `useContactThread`/`useGroupThread`; the widget with `subscribeMy(Group)Conversations`.
- **Bot feedback closes the cycle.** Each bot reply asks "¿te sirvió?" (👍/👎, collection
  `bot_feedback`, one vote per message). 👍 resolves the bot conversation (`resueltaPor: 'bot'`);
  👎 + "sí, un agente" resolves it AND hands off to the agent conversation via `handoffAAgente`
  (context system message + `escaladoA`/`escaladoAt`). The widget jumps on a **growing
  `escaladoAt`**, baselined on the first loaded snapshot — don't "fix" that baseline to mount time
  or historical escalations will redirect users. The bot channel never shows the star CSAT survey.
- **Waiting on customer = `estado:'pending'`.** The agent parks a conversation from the console
  header (`setWaitingOnCustomer`, stamps `waitingSince`); it stays ACTIVE (same segment, still in
  the thread/widget `[bot,open,pending]` queries) but leaves the inbox working filters (Todas/Mías/
  Sin asignar/Equipos only list `[bot,open]`) — it shows only under "En espera" until the customer
  replies. The customer's next message reopens it via the
  `reopenOnCustomerReply` trigger (`functions/waiting.ts`) — contacts can't write `estado`. With no
  reply, `slaEngine` auto-resolves it after `settings/sla.autoResolveWaitingHours` (default 24,
  0 = off; category `sin_respuesta`, `resueltaPor:'sistema'`); an agent message restarts the window.
- **Auto replies** live server-side (`functions/welcome.ts`): `welcomeOnConversation` (bot greeting)
  and `agentAutoReply` (agent channel, after the first user message, with an after-hours variant),
  both idempotent and marked `bienvenida:true` so SLA/push skip them.
- **Client-write invariants (`firestore.rules`/`storage.rules`).** A contact may update only
  `lastMessage`/`unread`/`updatedAt`/`silenciado` on a conversation — **never `estado` or
  `botIntentos`** (they gate bot escalation/cost; `botReply` also hard-caps turns per conversation).
  Chat attachment paths carry a random token (`adjuntos/{convId}/{rand}_{file}`) because Storage
  rules can't check Firestore membership; `botReply` only downloads attachments under its own
  `adjuntos/{convId}/`. `widgetSession` stamps the owning `siteId` on `clients`/`groups` and rejects
  a host asserting another site's `clientId`/`groupId`. Agents are global Aditum staff by design —
  the per-agent `sitios` field only routes push, not data access.
- **`aiAssist`** (console AI ticket draft) is scoped to the **current conversation only** (that doc's
  messages, never the contact's stitched history) and returns a structured title+description, shown
  in an **editable review modal**, never auto-inserted. Its `sugerir_respuesta` mode has no console
  caller anymore: suggested replies now come from investigations.
- **This repo is public.** Don't commit anything that describes production's internals. The production
  repository's name and Java package are settings (`functions/.env`; on the Pi, `REPO_URL`/`REPO_BRANCH`,
  which the install fills in).
- **Investigations** (`services/investigator`, `functions/investigations.ts`, `InvestigationPanel`) are
  separate from the bot: the bot never touches production data, and Claude only reads production with
  a read-only user, after showing code evidence. It can also propose a change (`write_proposal`,
  `packages/shared/src/writeProposal.ts`): structured operations, one row each by primary key. Only
  the writer on the Pi applies it, after an admin rehearses it and confirms 3 steps (`functions/writes.ts`,
  `WriteProposal.tsx`); writes start off, and nothing retries by itself. A confirmed bug or an improvement can go to the Notion backlog with one click
  (`functions/backlog.ts`), which can also open the client's ticket in the chat for it; an agent can ask Claude to define an improvement for a case that isn't a bug. And an agent can keep asking (`requestFollowUp`), each round resuming Claude's session on the same commit, or starting from the history otherwise. See `services/investigator/README.md`.
  In the console they open from the "Investigar" button next to "Enviar", as a resizable side panel next to the chat, which each chat remembers: every
  investigation stays in its list, and while one runs the agent sees only a rough phase taken from its
  latest progress event (`useInvestigationPhase`), with Claude's mascot acting out the phase.
  They can read files: the attachments of the selected messages (only under that conversation's own
  `adjuntos/{convId}/`, same check as `botReply`) and what the agent uploads, with the first question or with a later one. The Pi fetches each by id,
  turns Excel and Word into text in a separate process as Claude's user, and deletes them after the job.
