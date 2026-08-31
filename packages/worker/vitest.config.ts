import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          compatibilityFlags: ['nodejs_compat'],
          // Real clocks would make these tests take 30s and 24h.
          bindings: { TURN_MS: '400', IDLE_MS: '600', ALLOWED_ORIGINS: 'http://localhost:5173,http://127.0.0.1:5173' },
        },
      },
    },
  },
})
