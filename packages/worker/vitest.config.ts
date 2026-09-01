import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        // Each test uses its own table code, so tests never share Durable Object
        // state and do not need per-test isolation. Leaving it on is actively
        // harmful here: a table's DO stays alive between tests via its
        // hibernatable WebSockets and its armed alarm, so storage it touches
        // after its test ends lands outside that test's frame and the pool
        // fails the pop with "Isolated storage failed", blaming whichever test
        // happened to be running. That made CI fail non-deterministically.
        isolatedStorage: false,
        // Required alongside isolatedStorage: false -- with storage shared,
        // parallel test files collide registering the same Durable Object
        // service and the runtime fails to start.
        singleWorker: true,
        miniflare: {
          compatibilityFlags: ['nodejs_compat'],
          // Real clocks would make these tests take 30s and 24h.
          bindings: { TURN_MS: '400', IDLE_MS: '600', ALLOWED_ORIGINS: 'http://localhost:5173,http://127.0.0.1:5173' },
        },
      },
    },
  },
})
