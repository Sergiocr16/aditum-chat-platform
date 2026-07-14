# CLAUDE.md — packages/shared

The shared source of truth for the data model, design system, and i18n. `"type": "module"`;
`main`/`exports` point at `./src/index.ts`, so it is consumed as **raw TypeScript** via
`workspace:*` (no build step).

## Contents (`src/`)

- **`types.ts`** — the full multitenant Firestore data model (sites, clients, contacts,
  conversations + messages, tickets, csat, kb, team, settings, metrics). The canonical shape for
  every collection. Recent additions: `Message.editadoAt`/`textoAnterior`/`bienvenida`;
  `Conversation.csatRating`; `WidgetConfig` per-button `boton*Texto`/`boton*Icono` + welcome texts
  `mensajeAI`/`mensajeAgente`/`mensajeFueraHorario`; `TicketEventTipo` `'edicion'`; `TicketNote.editadoAt`.
- **`i18n.ts`** — es/en catalogs (**Costa Rican voseo**), `CONVERSATION_CATEGORIES` + bilingual
  labels, `makeT`/`categoryLabel`, `widgetMessages`.
- **`tokens.ts`** — design tokens from the "Aditum Chat" Claude Design spec: corporate navy
  (`#123C68`), warm-paper neutrals, semantic colors, Claude-bot purple, WhatsApp-style bubbles.
  **These are the widget's (resident-facing) palette.** The console was rebranded to plum
  `#2C1C2C` — its palette lives in `apps/dashboard/src/app/globals.css` `@theme`, not here.
  **No teal.**
- **`schedule.ts`** — business-hours types/helpers.
- **`index.ts`** — barrel; also exports `formatTicketNumber` (`#TK-0042`),
  `contactIdFor(siteId, externalId)` = `${siteId}_${externalId}`,
  `groupConversationIdFor` = `grupo_${siteId}_${clientId}`, `TICKET_NUMBER_PREFIX`.

## Working here

- This package is imported by the dashboard, widget, and functions. A change here **type-checks
  against all of them** — after editing, run the consumers' `typecheck` (at least
  `@aditum-chat/dashboard` and `@aditum-chat/functions`).
- Keep `types.ts` in sync with `firestore.rules` and the seed (`functions/scripts/seed.mjs`).
- New user-facing strings go in `i18n.ts` (both es and en), not hardcoded in apps.
- Add colors as tokens here, never ad-hoc hex in components. **No teal.**
