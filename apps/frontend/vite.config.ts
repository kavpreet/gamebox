import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: Vite serves the SPA on :5173 and proxies API + WebSocket traffic to the
// backend on :3001, so cookies are same-origin and no CORS dance is needed.
// Prod: the backend serves the built dist/ itself (FRONTEND_DIST env).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // listen on all interfaces so phones on the LAN can reach it
    proxy: {
      '/api': 'http://localhost:3001',
      '/healthz': 'http://localhost:3001',
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
  },
});
