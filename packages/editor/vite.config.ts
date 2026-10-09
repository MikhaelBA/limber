import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@limber/mesh/triangulate': fileURLToPath(new URL('../mesh/src/triangulate.ts', import.meta.url)),
      '@limber/mesh': fileURLToPath(new URL('../mesh/src/index.ts', import.meta.url)),
      // Dev-time source alias: edit @limber/core with HMR, no dist rebuild needed.
      '@limber/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  server: { port: 5173, strictPort: true },
});
