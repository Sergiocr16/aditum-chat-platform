// Default launcher (FAB) icon: chat bubble with typing dots + support
// headset (white glyph on transparent, extracted from the brand artwork).
// Inlined as a data URI so the widget stays a single self-contained bundle.
// The console's widget-config preview uses the same asset
// (apps/dashboard/public/launcher-icon.png); keep them in sync.
import icono from './launcher-icon.png?inline';

export function LauncherIcon({ size = 38 }: { size?: number }) {
  return <img src={icono} width={size} height={size} alt="" style="display:block" />;
}
