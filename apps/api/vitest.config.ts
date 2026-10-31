import { defineConfig } from "vitest/config";

/**
 * Integration suites hit the LIVE Supabase project with clearly-marked
 * test identities (`emg_test_*` / telegram ids 91xxxxxxx) and clean up
 * after themselves. Run: source .secrets/env.sh && npm test
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } }, // shared state, ordered cleanup
    env: {
      NODE_ENV: "test",
      WORKER_ENABLED: "false",
      LOG_LEVEL: "warn",
      TG_WEBHOOK_SECRET: "emg-test-webhook-secret-0123456789",
      // integration suites legitimately exceed per-IP budgets
      RATE_LIMIT_MAX: "1000",
      AUTH_RATE_LIMIT_MAX: "1000",
      SEARCH_RATE_LIMIT_MAX: "1000",
    },
  },
});
