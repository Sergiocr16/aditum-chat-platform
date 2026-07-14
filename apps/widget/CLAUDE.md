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
                Chat.tsx (main chat surface), Visor.tsx (fullscreen image/PDF lightbox),
                Tickets.tsx.
src/data.ts     Firestore/RTDB/Storage access via the modular firebase SDK.
src/session.ts  Host handshake; src/firebase.ts; src/sound.ts.
demo/           Host-simulator page. scripts/verify-*.mjs headless checks.
```

## Key facts

- **Shadow DOM isolation:** CSS is imported inline (`styles.css?inline`) and injected into the
  shadow root so host styles never leak in/out. `@font-face` doesn't work inside Shadow DOM, so
  fonts (Material Symbols Rounded, Instrument Sans) are injected into the host `<head>` instead.
- **Host handshake:** the host encrypts the user identity (AES-256-GCM, 5-min payload) and sets
  `window.AditumChatSettings = { siteId, payload, payloadUrl? }` (with `payloadUrl` the widget
  fetches a FRESH payload at session time — the embedded one expires in 5 min). `widgetSession` (a Cloud Function) decrypts
  it, upserts the contact/client, and mints a Firebase custom token. See `README.md` for the
  payload format and Node/Java snippets.
- **Continuous thread (two layers, segmented):** `subscribeMyConversations` (last ~20 directas) or
  `subscribeMyGroupConversations` (grupos via `participantes array-contains`) + `subscribeLatestMessages`
  + `fetchOlderMessages` (paginated) render all of a contact's segments as one thread. Two
  sub-channels per contact (`bot` / `agente`) via `ensureDirectConversation` / `convSubcanal`; the
  group via `ensureGroupConversation`. Escalation is server-driven: the widget jumps to the agent
  channel when the bot conversation's `escaladoAt` grows (baseline = first loaded snapshot). The
  chat is unique
  per (contact, subcanal) / (client, group) but **segmented** — `ensure*Conversation` reuses the
  active segment and opens a NEW one when the last is resolved (never reopens, never duplicates).
- **Other data.ts APIs:** `sendMessage` (with `replyTo`), `editMessage` (stores `textoAnterior` for
  the "edited" hover), `sendAttachment` (Storage `adjuntos/{convId}/…`, persists the tokened
  download URL), `submitCsat` (`csat/{id}`, 1–5), `subscribeMyCsat` (so a rated conversation never
  re-prompts), `toggleReaction` (`👍❤️😂😮🙏`), `setTyping`/`subscribeTyping` (**RTDB**,
  `onDisconnect().remove()`, degrades gracefully), `setViewing` (**RTDB presence**
  `presence/{contactId}` — Chat heartbeats it every 45 s while visible so `pushNotify` doesn't
  push a conversation the user is looking at), `markRead`, `toggleMute`, ticket subscriptions.
- **Touch UX (`hover: none`):** the message-actions menu opens by tapping the bubble (the hover
  chevron is hidden); **swiping a bubble right quotes it** (WhatsApp-style; threshold 56px raw,
  0.55 damping, vertical drags stay scrolls) — the reply path for media messages, whose tap opens
  the viewer; Enter inserts a newline (send = button) while desktop keeps Enter=send; the
  composer textarea auto-grows up to 120px. Image/PDF attachments open in the in-app `Visor`
  (arrows, keys, swipe); videos stay inline; other files keep the download tile. Quotes of
  attachment-only messages use `messagePreview` ("📷 Foto").
- **Welcome / auto-reply** is server-side (`functions/welcome.ts`); the widget just renders those
  first messages. Launcher button text/icon and the AI chip come from `session.widgetConfig`.
- **Branding from config:** `--ac-primary` (color), `--ac-accent`, and `--ac-bubble`
  (`colorBurbuja`, falls back to color) are set in App.tsx. The home greeting uses
  `cfg.saludo` with `{nombre}` templating (empty = i18n default). The FAB's default icon is
  `ui/LauncherIcon.tsx` (`launcher-icon.png` inlined as data URI; the console preview mirrors
  `apps/dashboard/public/launcher-icon.png` — keep in sync).

## Notes

- Guard Firestore listeners against permission-denied on locally-pending writes (see the existing
  `subscribeMyConversations`).
- Dev: `npx vite --port 5174 --host 127.0.0.1` → `http://127.0.0.1:5174/demo/index.html`
  (emulators + seed must be running).
- Typecheck: `pnpm --filter @aditum-chat/widget typecheck`.
