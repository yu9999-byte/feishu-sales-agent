import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@server': resolve(process.cwd(), 'server'),
      '@shared': resolve(process.cwd(), 'shared'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.integration.ts'],
    clearMocks: true,
    restoreMocks: true,
    fileParallelism: false,
  },
});
