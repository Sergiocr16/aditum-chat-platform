import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // packages/shared is consumed as raw TS, the same way esbuild.mjs resolves it.
    alias: { '@aditum-chat/shared': fileURLToPath(new URL('../packages/shared/src/index.ts', import.meta.url)) },
  },
});
