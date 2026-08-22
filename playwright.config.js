// Config for the smoke suite only — a live-site check, deliberately outside the
// build/lint pipeline. See tests/smoke/smoke.spec.js for why it lives here and
// where it actually runs.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/smoke',
  timeout: 45_000,
  // One retry in CI: the target is a real deployment over a real network, and a
  // single transient timeout is not a regression. A second failure is.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: { screenshot: 'only-on-failure' },
});
