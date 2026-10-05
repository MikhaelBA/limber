import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Dev-time source alias: edit @sprine/core with HMR, no dist rebuild needed.
      '@sprine/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  server: { port: 5173, strictPort: true },
});
