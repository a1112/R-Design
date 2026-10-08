import { defineConfig, devices } from '@playwright/test';
import { cpSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.dirname(fileURLToPath(import.meta.url));
// Source acceptance/revert tests use an isolated copy; never the user's active fixture.
if (!process.env.RDESIGN_E2E_ROOT) {
  const isolatedRoot = mkdtempSync(path.join(os.tmpdir(), 'rdesign-e2e-'));
  const fixtureRoot = path.join(isolatedRoot, 'fixtures', 'react-monitor');
  mkdirSync(path.dirname(fixtureRoot), { recursive: true });
  cpSync(path.join(repository, 'fixtures', 'react-monitor'), fixtureRoot, { recursive: true });
  symlinkSync(path.join(repository, 'node_modules'), path.join(isolatedRoot, 'node_modules'), 'dir');
  symlinkSync(path.join(repository, 'packages'), path.join(isolatedRoot, 'packages'), 'dir');
  process.env.RDESIGN_E2E_ROOT = isolatedRoot;
  process.env.RDESIGN_E2E_WORKSPACE = fixtureRoot;
}
const isolatedRoot = process.env.RDESIGN_E2E_ROOT!;
const workspace = process.env.RDESIGN_E2E_WORKSPACE!;
const baseURL = 'http://127.0.0.1:4410';
process.env.RDESIGN_E2E_URL = baseURL;

export default defineConfig({
  testDir: './tests/e2e',
  globalTeardown: './tests/e2e/teardown.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: `${baseURL}/api/bootstrap`,
    env: {
      RDESIGN_PORT: '4410', RDESIGN_FIXTURE_PORT: '4411',
      RDESIGN_DATA_DIR: path.join(isolatedRoot, 'data'), RDESIGN_WORKSPACE: workspace,
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
