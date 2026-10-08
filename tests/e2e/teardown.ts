import { rm } from 'node:fs/promises';

export default async function teardown() {
  const isolatedRoot = process.env.RDESIGN_E2E_ROOT;
  if (isolatedRoot?.startsWith('/tmp/rdesign-e2e-') || isolatedRoot?.includes('/rdesign-e2e-')) {
    await rm(isolatedRoot, { recursive: true, force: true });
  }
}
