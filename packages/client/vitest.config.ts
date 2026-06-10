import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // html.ts builds real DOM nodes, so its tests need a browser-like
    // environment. jsdom is already a root devDependency.
    environment: 'jsdom',
  },
});
