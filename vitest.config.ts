import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  test: {
    // Compiled output under any package's dist/ must never be collected.
    exclude: [...configDefaults.exclude, '**/dist/**'],
    projects: [
      {
        // Server: node env. Includes both the relocated unit tests under
        // tests/ and the in-flight UAT tests still under src/uat/.
        test: {
          name: 'server',
          environment: 'node',
          include: ['packages/server/tests/**/*.test.ts', 'packages/server/src/**/*.test.ts'],
          // The beta smoke suite (tests/beta/**/*.beta.test.ts) also ends in `.test.ts`, but it
          // belongs to the `beta` project alone — it throws without QB_BETA_BASE_URL, so it must
          // never be collected here (it would fail every default `npm test`).
          exclude: [...configDefaults.exclude, '**/dist/**', 'packages/server/tests/beta/**'],
          // Sets QB_ALLOW_DEFAULT_CUSTOMER so route tests resolve to the
          // "local" customer without each wiring identity headers.
          setupFiles: ['packages/server/src/test-setup.ts'],
        },
        resolve: {
          alias: { '@': r('./packages/server/src') },
        },
      },
      {
        // Client: jsdom env so the DOM-building html helper's tests can run.
        test: {
          name: 'client',
          environment: 'jsdom',
          include: ['packages/client/tests/**/*.test.ts'],
          exclude: [...configDefaults.exclude, '**/dist/**'],
        },
        resolve: {
          alias: { '@': r('./packages/client/src') },
        },
      },
      {
        // Beta: black-box HTTP smoke against a LIVE deployed instance. Invoked ONLY by
        // name (`npm run test:beta` → --project beta), never by the default `npm test`
        // (which lists `server` + `client` explicitly). The suite itself throws at import
        // unless QB_BETA_BASE_URL is set, so it can never run in a normal local/PR run.
        // No `@` alias and no test-setup: it imports nothing from src and must not inherit
        // the QB_ALLOW_DEFAULT_CUSTOMER=1 default (it sends a real identity header instead).
        test: {
          name: 'beta',
          environment: 'node',
          include: ['packages/server/tests/beta/**/*.beta.test.ts'],
          exclude: [...configDefaults.exclude, '**/dist/**'],
        },
      },
    ],
  },
});
