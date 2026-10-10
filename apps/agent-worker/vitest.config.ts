import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['apps/agent-worker/tests/**/*.test.ts','packages/mcp-server/tests/**/*.test.ts'],testTimeout:30000}});
