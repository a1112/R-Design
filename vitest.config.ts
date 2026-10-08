import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/unit/**/*.test.ts', 'tests/protocol/**/*.test.ts', 'tests/security/**/*.test.ts'], testTimeout: 30000 } });
