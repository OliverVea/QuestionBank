import { configDefaults, defineConfig } from 'vitest/config';

// Root Vitest config for the whole workspace. We only test TypeScript sources;
// compiled output under any package's `dist/` (emitted by `tsc -b` / `vite build`)
// must never be collected, or every test would run twice (once from source, once
// from a stale compiled copy that could mask source changes).
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/dist/**'],
  },
});
