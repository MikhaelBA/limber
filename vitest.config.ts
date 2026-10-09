import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests run against package SOURCES (no build step needed). The aliases below
// point the internal package names at their src entries so vitest never has
// to read the dist/ outputs.
export default defineConfig({
  resolve: {
    alias: {
      '@limber/mesh': fileURLToPath(new URL('./packages/mesh/src/index.ts', import.meta.url)),
      '@limber/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@limber/runtime': fileURLToPath(new URL('./packages/runtime/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/*/tests/**/*.test.ts'],
  },
});
