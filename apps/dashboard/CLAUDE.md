# CLAUDE.md — apps/dashboard (agent console)

Next.js 15 **App Router** + React 19 + **Tailwind CSS 4**. Deployed as a **static export**
(`out/`) to Firebase Hosting; developed with `next dev -p 3000`.

## Structure

```
src/app/            Routes. Route group (console)/ is wrapped by <Shell>; login/ sits outside it.
                    Console pages: inbox, tickets, contactos, bot, reportes, configuracion.
src/components/     Shell, ConversationView, ContextPanel/GroupContextPanel, ResolveModal,
                    ConvertTicketModal, TicketDetailModal, TagAssign, chips, ResizeHandle,
                    config/* (SitiosTab, WidgetConfigTab, SlaConfigTab, EquipoTab, EtiquetasTab,
                    CategoriasConfig, …), bot/*.
src/lib/            firebase.ts (SDK + emulator wiring), auth.tsx, i18n.ts, sound.ts,
                    messaging.ts (FCM Web Push), and data hooks: data.ts, data-tickets.ts,
                    data-bot.ts, data-contactos.ts, data-tags.ts.
```

## Conventions

- **Data hooks** live in `src/lib/data*.ts`. They wrap Firestore `onSnapshot` and return the
  `Row<T> = { id, data }` shape. Reuse `useCollection` / `useDoc` and the existing hooks
  (`useConversations`, `useContactThread` / `useGroupThread` — both on `useConvThread`,
  `useResolvedConversations` / `useResolvedGroupConversations`, `useTickets`, `useContactTickets` /
  `useClientTickets`, `useTeam`, `useSites`, `useCsat`) instead of hand-rolling listeners.
  Mutations: `resolveConversation`, `agentSendMessage`, `agentSendAttachment`, `agentEditMessage`,
  `toggleReaction`, `ensureAgentConversation` / `ensureAgentGroupConversation`, `updateConversation`.
- **Auth** (`lib/auth.tsx`): Firebase email/password; `AuthProvider` subscribes to `team/{uid}`
  for the agent profile. Agents carry custom claims `{ kind:'agent', rol:'admin'|'agente' }` set
  server-side by the `manageTeam` function. Language is `team/{uid}.idioma`.
- **i18n** via `lib/i18n.ts` — `useT()`; every user-facing string goes through it (es/en, voseo).
- **Styling:** Tailwind 4 with the design tokens from `packages/shared/src/tokens.ts`. **No teal.**
  Prefer the existing token classes (navy/cream/warm-gray/ok/warn/ai). Material Symbols via `.msr`.
- **Continuous thread (segmented):** the inbox stitches all of a contact's `directa` segments
  (`useContactThread`) or a client's `grupo` segments (`useGroupThread`) into one scroll — a live
  listener on the most-recent conversation + static paginated history, deduped by `convId+msgId`.
  **Do not reopen resolved conversations** — writing (agent or contact) opens a NEW conversation;
  resolved ones stay in the history. `refrescarConversacion(convId)` re-reads a non-active segment's
  block (used after creating a ticket from an old conversation, via `ConversationView.refrescarYVer`).
- **Message actions** (`ConversationView` `Burbuja`): the ⋮ menu has react / reply (quote +
  `irAMensaje` jump) / copy / **edit** (own messages; `agentEditMessage` stores `textoAnterior`,
  shown on hover). Ticket detail (`TicketDetailModal`) stages ALL edits (title, description, estado,
  assignee, priority, visibility) and applies them only on **Save** behind a confirm modal, logging
  each as a `historial` event; internal notes are editable (`updateTicketNote`). The context panels
  (`ContextPanel` / `GroupContextPanel`) use `PanelLista` + `ConvHistorialRow` + `TicketCard`.

## Notes

- Static export means **no server runtime** — everything is client-side Firebase.
- StrictMode double-invokes effects in dev.
- Desktop push: `messaging.ts` + service worker at `public/firebase-messaging-sw.js`; disabled
  under emulators.
- Run `pnpm --filter @aditum-chat/dashboard typecheck` after edits (prefix the nvm PATH).
