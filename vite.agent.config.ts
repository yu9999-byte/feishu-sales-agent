import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { defineConfig, type ViteDevServer } from 'vite';

export default defineConfig({
  root: resolve(process.cwd(), 'client'),
  plugins: [{
    name: 'agent-web-html-entry',
    configureServer(server: ViteDevServer): void {
      server.middlewares.use((request: IncomingMessage, _response: ServerResponse, next: () => void): void => {
        const acceptsHtml: boolean = request.headers.accept?.includes('text/html') ?? false;
        if ((request.method !== 'GET' && request.method !== 'HEAD') || !acceptsHtml) {
          next();
          return;
        }
        const url: URL = new URL(request.url ?? '/', 'http://localhost');
        const reservedPath: boolean = url.pathname.startsWith('/@')
          || /^\/(?:api|openapi|__innerapi__|__runtime__|app|src|node_modules|assets|public)(?:\/|$)/u
            .test(url.pathname);
        if (!reservedPath && !url.pathname.includes('.')) {
          request.url = `/agent.html${url.search}`;
        }
        next();
      });
    },
  }],
  define: {
    'process.env.CLIENT_BASE_PATH': JSON.stringify(''),
  },
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
