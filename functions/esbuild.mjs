import { build, context } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Bundle: inlinea @aditum-chat/shared (resuelto por path al source, sin depender
// del protocolo workspace: que Cloud Build no entiende) y deja externas las deps
// reales de package.json, que Cloud Functions instala en el deploy.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const sharedEntry = fileURLToPath(new URL('../packages/shared/src/index.ts', import.meta.url));

const options = {
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  alias: { '@aditum-chat/shared': sharedEntry },
  external: Object.keys(pkg.dependencies),
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
