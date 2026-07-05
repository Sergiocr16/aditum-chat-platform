# CLAUDE.md — apps/widget (embeddable chat widget)

**Preact + Vite**, built as an **IIFE library** (`vite.config.ts`: `formats: ['iife']`,
`fileName: 'widget.js'`, `inlineDynamicImports`, `target: es2019`, minified). Ships one script the
host page loads. `"type": "module"`.

## Structure

```
src/main.tsx    Entry. Mounts into #aditum-chat-root inside a SHADOW DOM. Exposes the public API
                on window.AditumChat: init, destroy, open(view?), close(), on(event, fn)
                (opened|closed|unreadCount). Auto-inits if window.AditumChatSettings is present.
src/ui/         App.tsx (root/controls), Home.tsx (launcher: bot / agent / team chat),
                Chat.tsx (main chat surface), Tickets.tsx.
src/data.ts     Firestore/RTDB/Storage access via the modular firebase SDK.
src/session.ts  Host handshake; src/firebase.ts; src/sound.ts.
demo/           Host-simulator page. scripts/verify-*.mjs headless checks.
```

## Key facts

- **Shadow DOM isolation:** CSS is imported inline (`styles.css?inline`) and injected into the
  shadow root so host styles never leak in/out. `@font-face` doesn't work inside Shadow DOM, so
  fonts (Material Symbols Rounded, Instrument Sans) are injected into the host `<head>` instead.
- **Host handshake:** the host encrypts the user identity (AES-256-GCM, 5-min payload) and sets
  `window.AditumChatSettings = { siteId, payload }`. `widgetSession` (a Cloud Function) decrypts
  it, upserts the contact/client, and mints a Firebase custom token. See `README.md` for the
  payload format and Node/Java snippets.
- **Continuous thread (two layers):** `subscribeMyConversations` (last ~20 directas) +
  `subscribeLatestMessages` + `fetchOlderMessages` (paginated) render all of a contact's direct
  conversations as one thread. Two sub-channels per contact (`bot` / `agente`) via
  `ensureDirectConversation` / `convSubcanal`; `escalateToAgent` flips state to `open`.
- **Other data.ts APIs:** `sendMessage` (with `replyTo`), `editMessage`, `sendAttachment`
  (Storage `adjuntos/{convId}/…`), `submitCsat` (`csat/{id}`, 1–5), `toggleReaction`
  (`👍❤️😂😮🙏`), `setTyping`/`subscribeTyping` (**RTDB**, `onDisconnect().remove()`, degrades
  gracefully), `markRead`, `toggleMute`, ticket subscriptions.

## Notes

- Guard Firestore listeners against permission-denied on locally-pending writes (see the existing
  `subscribeMyConversations`).
- Dev: `npx vite --port 5174 --host 127.0.0.1` → `http://127.0.0.1:5174/demo/index.html`
  (emulators + seed must be running).
- Typecheck: `pnpm --filter @aditum-chat/widget typecheck`.
