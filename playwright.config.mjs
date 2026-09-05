import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: 'tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 20000,
  use: {
    baseURL: 'http://127.0.0.1:4179',
    headless: true,
    channel: process.env.FLPCM_BROWSER_CHANNEL || 'msedge'
  },
  webServer: {
    command: 'node tests/server.mjs',
    url: 'http://127.0.0.1:4179/tests/browser/fixture.html',
    reuseExistingServer: false
  },
  reporter: 'list'
})
