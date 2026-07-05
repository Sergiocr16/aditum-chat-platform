# CLAUDE.md — functions (Cloud Functions v2)

Firebase **Cloud Functions v2**, runtime **Node 22**, region `us-central1`. Bundled with
**esbuild** (`node esbuild.mjs`), not tsc emit. Deps: `@anthropic-ai/sdk`, `firebase-admin`,
`firebase-functions`, `pdf-parse`.

## Build & run

```sh
pnpm --filter @aditum-chat/functions build      # typecheck + esbuild bundle → lib/
pnpm --filter @aditum-chat/functions dev        # esbuild --watch
pnpm --filter @aditum-chat/functions seed       # node scripts/seed.mjs (emulator demo data)
```

Functions run inside the emulator suite (see root `CLAUDE.md` for the start command/ports).
Secrets in `functions/.secret.local` (gitignored): `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`
(optional), `CONFIG_KEK`, `BOT_MODEL`.

## Exports (`src/index.ts`)

| Area | Exports / files |
|---|---|
| Widget session | `widgetSession` (decrypts host payload, mints custom token), `demoPayload` (emulator only) |
| Tickets | `createTicket` (agents; sequential numbering via `counters/tickets`), internal `crearTicketInterno` |
| Bot (Claude) | `botReply`, `testBot`, `aiAssist` — `bot.ts` |
| KB / RAG | `kbIngestPdf` (onObjectFinalized), `kbSyncHelpCenter` (scheduled), `kbSyncNow` — `kb.ts` |
| Team / keys | `manageTeam`, `rotateSiteKey` (admin only) — `team.ts` |
| SLA | `ticketSlaInit`, `firstResponseTracker`, `slaEngine` (runs every 1 min) — `sla.ts` |
| Metrics | `metricsOnConversation`, `metricsOnResolve`, `metricsOnCsat`, `metricsOnMessage` — `metrics.ts` |
| Push | `pushNotify` (to end user, host project), `notifyAgentsOnMessage` (to console agents), `setSiteFcmCredentials` |

Shared `src/lib/` provides `db`, `FieldValue`, `resolveSiteConfig`, schedule helpers, and the
AES/crypto helpers.

## Conventions

- **All privileged writes go through here** with the Admin SDK — the client SDKs are locked down by
  `firestore.rules`. When a feature needs a write the rules forbid, add/extend a function.
- **The bot** (`bot.ts`): model `claude-sonnet-5` (override `BOT_MODEL`), `max_tokens` 512–1024.
  `botReply` fires on `user` messages in `directa` + `estado:'bot'` conversations; it runs an
  agentic **tool loop (≤3 turns)** with `escalar_a_agente` and `crear_ticket`, grounded on KB RAG
  context, and auto-escalates after N failed attempts.
- **KB embeddings** use **Voyage AI** (`voyage-3.5-lite`, 768-dim) with a keyword fallback when
  `VOYAGE_API_KEY` is unset; search via Firestore `findNearest` (COSINE, vector index on
  `chunks.embedding`).
- **Crypto:** host identity payloads and stored service accounts use AES-256-GCM; site keys rotate
  with a 24 h grace window; the KEK comes from `CONFIG_KEK`.
- Dual-project push: end-user push uses the **host's** Firebase project (per-site encrypted service
  account); agent desktop push uses **this** project's FCM Web Push.

## Notes

- **No automatic deploys.** Verify against emulators; production deploy is manual.
- Node **22** here (rest of the repo is Node 20).
