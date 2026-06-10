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
          exclude: [...configDefaults.exclude, '**/dist/**'],
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
    ],
  },
});
