import { render } from 'preact';
import type { AditumChatSettings } from '@aditum-chat/shared';
import { App } from './ui/App.js';
import baseCss from './ui/styles.css?inline';

// API pública estilo Freshchat: window.AditumChat.init(settings) / .open() / …
// El host normalmente solo define window.AditumChatSettings y carga widget.js.

type EventName = 'opened' | 'closed' | 'unreadCount';
type Listener = (data?: unknown) => void;

const listeners = new Map<EventName, Set<Listener>>();
let host: HTMLDivElement | null = null;
let controls: { open(view?: string): void; close(): void } | null = null;

export function emit(event: EventName, data?: unknown): void {
  listeners.get(event)?.forEach((fn) => fn(data));
}

function init(settings: AditumChatSettings): void {
  if (host) destroy();
  if (!settings?.siteId || !settings?.payload) {
    console.error('[AditumChat] Falta siteId o payload en AditumChatSettings.');
    return;
  }
  host = document.createElement('div');
  host.id = 'aditum-chat-root';
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  // Material Symbols + Instrument Sans deben cargarse en el documento host
  // (las @font-face no funcionan dentro de Shadow DOM).
  ensureFonts();

  const style = document.createElement('style');
  style.textContent = baseCss;
  shadow.appendChild(style);
  const mount = document.createElement('div');
  shadow.appendChild(mount);

  render(
    <App
      settings={settings}
      onReady={(c) => {
        controls = c;
      }}
      emit={emit}
    />,
    mount,
  );
}

function ensureFonts(): void {
  const links = [
    'https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400..700;1,400..700&display=swap',
    'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap',
  ];
  for (const href of links) {
    if (!document.querySelector(`link[href="${href}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      document.head.appendChild(link);
    }
  }
}

function destroy(): void {
  if (host) {
    render(null, host.shadowRoot?.lastElementChild as Element);
    host.remove();
    host = null;
    controls = null;
  }
}

const AditumChat = {
  init,
  destroy,
  open(view?: string) {
    controls?.open(view);
  },
  close() {
    controls?.close();
  },
  on(event: EventName, fn: Listener) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(fn);
    return () => listeners.get(event)!.delete(fn);
  },
};

declare global {
  interface Window {
    AditumChat: typeof AditumChat;
    AditumChatSettings?: AditumChatSettings;
  }
}

window.AditumChat = AditumChat;
if (window.AditumChatSettings) init(window.AditumChatSettings);

export default AditumChat;
