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
functions        Cloud Functions v2 (bot, tickets, SLA, KB/RAG, push, team, widgetSession)
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

## Hard rules

- **No automatic commits or pushes.** Leave changes in the working tree; the maintainer decides.
- **No automatic deploys.** Test locally against the emulators only.
- Copy is **Costa Rican Spanish (voseo)** + English via `packages/shared/src/i18n.ts`. Default to
  Spanish when talking to the maintainer.
- **Do not use teal.** Use the design tokens in `packages/shared/src/tokens.ts` (brand navy
  `#123C68`, warm-paper neutrals, Claude-bot purple).
- Timezone: **America/Costa_Rica** (UTC-6).

## Gotchas

- **Node version split:** everyday work on Node 20 (`.nvmrc`); `functions` targets Node **22**.
- **React StrictMode** double-invokes effects in dev — expect transient states in the console.
- **Secrets** live in `functions/.secret.local` (gitignored): `ANTHROPIC_API_KEY`,
  `VOYAGE_API_KEY` (optional), `CONFIG_KEK`. Never commit them. Bot models are **fixed in code**
  (`bot.ts`): `claude-haiku-4-5` (widget bot + testBot), `claude-sonnet-5` (aiAssist).
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
- **Auto replies** live server-side (`functions/welcome.ts`): `welcomeOnConversation` (bot greeting)
  and `agentAutoReply` (agent channel, after the first user message, with an after-hours variant),
  both idempotent and marked `bienvenida:true` so SLA/push skip them.
