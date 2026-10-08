import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { rdesignSourceIds } from '../../packages/runtime-web/src/vite';
const repoRoot = process.env.RDESIGN_REPO_ROOT ?? fileURLToPath(new URL('../..', import.meta.url));
export default defineConfig({
  plugins: [rdesignSourceIds(), react()],
  resolve: { alias: { '@rdesign/runtime-web': resolve(repoRoot, 'packages/runtime-web/src/index.ts') } },
  server: { host: '127.0.0.1', port: 4311, fs: { allow: [repoRoot] } },
  build: { outDir: 'dist', emptyOutDir: true },
});
