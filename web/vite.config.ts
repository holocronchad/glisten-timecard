import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage } from 'http';

// Browser top-level navigations (Sec-Fetch-Dest: document) should land in
// the SPA, NOT get proxied to the Express API. fetch() calls and asset
// requests skip this branch and proxy normally.
function passThroughHtmlNav(req: IncomingMessage): string | undefined {
  const dest = req.headers['sec-fetch-dest'];
  const accept = req.headers.accept;
  if (dest === 'document' || (accept && accept.includes('text/html'))) {
    return req.url;
  }
  return undefined;
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // listen on 0.0.0.0 so phones on the LAN can connect
    proxy: {
      '/kiosk':   { target: 'http://localhost:3001', changeOrigin: true, bypass: passThroughHtmlNav },
      '/manage':  { target: 'http://localhost:3001', changeOrigin: true, bypass: passThroughHtmlNav },
      '/health':  { target: 'http://localhost:3001', changeOrigin: true, bypass: passThroughHtmlNav },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
