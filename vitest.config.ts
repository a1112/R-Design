import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/unit/**/*.test.ts', 'tests/protocol/**/*.test.ts', 'tests/security/**/*.test.ts', 'apps/agent-worker/tests/**/*.test.ts', 'packages/mcp-server/tests/**/*.test.ts'], testTimeout: 30000 } });
