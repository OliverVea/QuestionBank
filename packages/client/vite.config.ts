import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    // Listen on all interfaces so the app is reachable from other devices
    // (e.g. a phone) on the same local network, not just localhost.
    host: true,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
