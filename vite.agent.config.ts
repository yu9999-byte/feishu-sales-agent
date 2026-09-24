import { resolve } from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig({
  root: resolve(process.cwd(), 'client'),
  resolve: {
    alias: {
      '@': resolve(process.cwd(), 'client/src'),
      '@client': resolve(process.cwd(), 'client'),
      '@shared': resolve(process.cwd(), 'shared'),
    },
  },
  build: {
    outDir: resolve(process.cwd(), 'dist/agent-web'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(process.cwd(), 'client/agent.html'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true,
      },
    },
  },
});
