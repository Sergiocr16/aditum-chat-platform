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
Secrets in `functions/.secret.local` (gitignored): `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`,
`GITHUB_CODE_TOKEN`, `RUNNER_SHARED_SECRET`, `GATEWAY_SHARED_SECRET`, `CONFIG_KEK`. Bot models are fixed in code (`bot.ts`). `pnpm --filter
@aditum-chat/functions test` runs the unit tests (vitest).

## Exports (`src/index.ts`)

| Area | Exports / files |
|---|---|
| Widget session | `widgetSession` (decrypts host payload, mints custom token), `demoPayload` (emulator only) |
| Tickets | `createTicket` (agents; sequential numbering via `counters/tickets`), internal `crearTicketInterno` |
| Bot (Claude) | `botReply`, `testBot`, `aiAssist` — `bot.ts` |
| KB / RAG | `kbIngestPdf` (onObjectFinalized), `kbSyncHelpCenter` (scheduled), `kbSyncNow`, `kbReindexAll` — `kb.ts` |
| Code index | `codeSync` (every 30 min), `codeSyncNow` (admin), `searchCode` — `code/codeIndex.ts` |
| Investigations | `requestInvestigation`, `cancelInvestigation` (agents), `investigationRunner` (the Pi's outbound calls: claim, progress, complete, and `attachment`, which sends one of a running job's files by id; bearer `RUNNER_SHARED_SECRET`), `setInvestigatorDb`, `testInvestigatorDb` (admins), `setInvestigatorPi`, `testInvestigatorPi` (admins; log in to the Pi over SSH from here and pin its host key, `piCheck.ts`), `installInvestigatorOnPi` (admins; runs `services/investigator/deploy/install.sh` on the Pi, `piInstall.ts`), `investigationGateway` (gives the MySQL password to the Pi's gateway; bearer `GATEWAY_SHARED_SECRET`) — `investigations.ts` |
| Team / keys | `manageTeam`, `rotateSiteKey` (admin only) — `team.ts` |
| SLA | `ticketSlaInit`, `firstResponseTracker`, `slaEngine` (runs every 1 min) — `sla.ts` |
| Metrics | `metricsOnConversation`, `metricsOnResolve`, `metricsOnCsat` (also writes `csatRating` to the conversation), `metricsOnMessage` — `metrics.ts` |
| Waiting on customer | `reopenOnCustomerReply` (a `user` message on an `estado:'pending'` conversation sets it back to `open`); `autoResolveWaiting` (called by `slaEngine`: resolves `pending` conversations older than `settings/sla.autoResolveWaitingHours`) — `waiting.ts` |
| Auto replies | `welcomeOnConversation` (bot greeting on a new bot conversation), `agentAutoReply` (agent-channel reply after the user's first message; after-hours variant) — `welcome.ts` |
| Push | `pushNotify` (to end user, host project), `notifyAgentsOnMessage` (to console agents), `setSiteFcmCredentials` — see push conventions below |

Shared `src/lib/` provides `db`, `FieldValue`, `resolveSiteConfig`, schedule helpers, and the
AES/crypto helpers.

## Conventions

- **All privileged writes go through here** with the Admin SDK — the client SDKs are locked down by
  `firestore.rules`. When a feature needs a write the rules forbid, add/extend a function.
- **The bot** (`bot.ts`): `claude-haiku-5-5` for `botReply`/`testBot`, `claude-sonnet-5` for
  `aiAssist` (fixed in code), prompt caching via `buildSystemBlocks`. `botReply` fires on `user`
  messages in `directa` + `estado:'bot'` conversations, makes **one model call** (one more if the draft is rejected, with the rejection as feedback) with
  `answer_with_evidence`, `escalar_a_agente`, `crear_ticket` and `reply_without_evidence` (all terminal: side effects run
  afterwards with a fixed message, so the model can't announce an outcome that didn't happen), and
  auto-escalates after N failed attempts.
- **Evidence gate** (`evidence.ts`): the bot never answers without evidence. Retrieved KB and code
  fragments go in as numbered sources. Every reply is a tool call (`tool_choice: any`): a factual one
  is `answer_with_evidence {text, evidence[{source_id, quote}]}`, and only `text` reaches the user.
  Each quote must really be in the source it names, every figure must appear in a quote, a second
  Haiku pass (`VERIFIER_SYSTEM`) must confirm the claims against the cited sources, and if code was
  in context `leaksCode` must find no implementation detail. API citations were dropped because
  Haiku pasted cited fragments into the reply.
  A rejected draft gets one correction and goes through every check again; if that fails too, the
  user gets `fallbackReply` and it logs to `bot_gate_events`. Sources go to
  `bot_evidence/{messageId}` (refs only), never on the message, which the contact can read.
- **Code index** (`code/`): private RAG over `aditum-jh@production`. `code_chunks` and `code_files`
  are denied to every client in `firestore.rules`. `audience.ts` decides who may get answers from each
  file, following the host's own `authorities`/`@Secured`: the chat is open to administrators and
  accountants only (`AditumChatService` in aditum-jh), `searchCode` filters on `forManager`/
  `forAccountant`, an unknown contact role gets no code, and a file neither role can reach is not
  indexed. `allowlist.ts` is deny-by-default; `secretScan.ts`
  runs before anything reaches Voyage and skips the whole file on a hit. The sync diffs the repo tree
  against the `code_files` manifest, which makes it resumable across runs. Per-site switch:
  `BotConfig.codeRagEnabled` (off by default). **The bot has no MySQL credentials: production data is
  out of its reach by construction.** `onBotFeedbackWrite` (`botFeedback.ts`) processes the 👍/👎 votes: stamps
  `Message.feedback`, aggregates metrics, resolves the bot conversation and reuses
  `handoffAAgente` when the user asks for an agent.
- **Auto replies** (`welcome.ts`): `welcomeOnConversation` and `agentAutoReply` post idempotent
  messages (`_bienvenida` / `_autorespuesta`) using per-site config (`widget.mensajeAI` /
  `mensajeAgente` / `mensajeFueraHorario`, fallback `bot.saludo`). They set `bienvenida: true` so
  `firstResponseTracker` and `pushNotify` skip them — replicate that guard for any new auto message.
- **Tickets** (`tickets.ts`): `linkConversation` (used by `createTicket` with a `conversationId`)
  posts the "created a ticket" system message but does **not** bump the conversation's `updatedAt`,
  so the message stays in that conversation's segment instead of jumping the thread.
- **Embeddings** use **Voyage AI** (`embeddings.ts`): `voyage-3.5-lite` 1024-dim for the KB (the API rejects 768),
  `voyage-code-4` 1024-dim for code, searched per file type and then reranked (`rerank-2.5-lite`, score
  at least `MIN_RELEVANCE`), because a Spanish question otherwise retrieves almost only Java. Search via Firestore `findNearest` (COSINE); vector indexes are
  declared in `indexes[]` of `firestore.indexes.json`, since `fieldOverrides` doesn't apply them. A KB
  doc with no embeddings yet falls back to keywords, as does the whole KB when `VOYAGE_API_KEY` is unset.
- **Crypto:** host identity payloads and stored service accounts use AES-256-GCM; site keys rotate
  with a 24 h grace window; the KEK comes from `CONFIG_KEK`.
- Dual-project push: end-user push uses the **host's** Firebase project (per-site encrypted service
  account); agent desktop push uses **this** project's FCM Web Push.
- **Push conventions** (`push.ts`, `pushAgentes.ts`, `lib/markdown.ts`): bodies go through
  `markdownToPlain`; attachment-only messages fall back to `attachmentSummary` ("📷 Foto" /
  "📄 file.pdf", localized). `pushNotify` skips contacts whose RTDB presence
  (`presence/{contactId}`, <90 s, same convId) says they're viewing the conversation, and prunes
  dead device tokens. `messagingForSite` caches **only successful** inits (never cache a null
  credential). Agent push is data-only with tag `convId_msgId` so notifications stack.

## Notes

- **No automatic deploys.** Verify against emulators; production deploy is manual.
- Node **22** here (rest of the repo is Node 20).
