import { defineConfig } from 'vitest/config';
import path from 'path';

const rootDir = import.meta.dirname || process.cwd();

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    fileParallelism: false,
    include: ['tests/**/*.{test,spec}.ts'],
    alias: {
      '@': path.resolve(rootDir, './src'),
      '@frontend': path.resolve(rootDir, './src/frontend'),
      '@backend': path.resolve(rootDir, './src/backend'),
      '@server': path.resolve(rootDir, './src/backend'),
      '@core': path.resolve(rootDir, './src/backend/core'),
      '@modules': path.resolve(rootDir, './src/frontend/modules'),
    },
  },
});
