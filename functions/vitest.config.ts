import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // packages/shared is consumed as raw TS, the same way esbuild.mjs resolves it.
    alias: { '@aditum-chat/shared': fileURLToPath(new URL('../packages/shared/src/index.ts', import.meta.url)) },
  },
  // Stand-ins for functions/.env: the real repository and package aren't named in this repo.
  test: { env: { CODE_REPO: 'example/app@production', CODE_JAVA_PACKAGE: 'com/example/app' } },
});
