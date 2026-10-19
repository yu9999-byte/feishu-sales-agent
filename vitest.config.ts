import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@server': resolve(process.cwd(), 'server'),
      '@shared': resolve(process.cwd(), 'shared'),
      '@': resolve(process.cwd(), 'client/src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    clearMocks: true,
    restoreMocks: true,
    pool: 'threads',
  },
});
