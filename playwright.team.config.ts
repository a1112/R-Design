import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const baseURL = 'http://127.0.0.1:4495';
const prefix = (process.env.RDESIGN_TEAM_E2E_BASE_PATH ?? '').replace(/\/$/, '');
const dataDirectory = mkdtempSync(path.join(os.tmpdir(), 'rdesign-team-e2e-'));
export default defineConfig({
  testDir: './tests/team-e2e', timeout: 60000, workers: 1, retries: 0,
  expect: { timeout: 10000 }, reporter: [['list']],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure',
    launchOptions: process.env.RDESIGN_BROWSER ? { executablePath: process.env.RDESIGN_BROWSER } : {} },
  projects: [{ name: 'team-chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node --import tsx apps/team-server/src/index.ts',
    url: `${baseURL}${prefix}/api/team/health`, timeout: 30000, reuseExistingServer: false,
    env: {
      RDESIGN_TEAM_PORT: '4495', RDESIGN_TEAM_HOST: '127.0.0.1',
      RDESIGN_TEAM_DATA_DIR: dataDirectory, RDESIGN_TEAM_PUBLIC_ORIGIN: baseURL,
      RDESIGN_TEAM_BASE_PATH: prefix,
      RDESIGN_TEAM_ADMIN_EMAIL: 'owner@rdesign.test',
      RDESIGN_TEAM_ADMIN_NAME: '设计负责人',
      RDESIGN_TEAM_ADMIN_PASSWORD: 'Isolated-E2E-Owner-Only-2026',
    },
  },
});
