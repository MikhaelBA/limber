import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The first owned SVG worker must not trigger optimizer discovery and reload its host page.
  optimizeDeps: { include: ['@resvg/resvg-wasm'] },
  resolve: {
    alias: {
      '@limber/atlas': fileURLToPath(new URL('../atlas/src/index.ts', import.meta.url)),
      '@limber/runtime-web': fileURLToPath(new URL('../runtime-web/src/index.ts', import.meta.url)),
      '@limber/runtime': fileURLToPath(new URL('../runtime/src/index.ts', import.meta.url)),
      '@limber/mesh/triangulate': fileURLToPath(new URL('../mesh/src/triangulate.ts', import.meta.url)),
      '@limber/mesh': fileURLToPath(new URL('../mesh/src/index.ts', import.meta.url)),
      // Dev-time source alias: edit @limber/core with HMR, no dist rebuild needed.
      '@limber/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  server: { port: 5173, strictPort: true },
});
