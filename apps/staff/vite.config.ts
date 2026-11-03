import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { designSystem } from '../../packages/shared/vite-plugin-design';

export default defineConfig({
  base: '/app/',
  plugins: [react(), designSystem()],
  resolve: {
    alias: [
      // Exact match only: subpaths such as /design/tokens.css resolve through package exports.
      {
        find: /^@vote-kidigit\/shared$/,
        replacement: fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
      },
    ],
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
