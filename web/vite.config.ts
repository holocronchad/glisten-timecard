import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Local dev: forward API calls to the Express server on :3001
      '/kiosk':   { target: 'http://localhost:3001', changeOrigin: true },
      '/manage':  { target: 'http://localhost:3001', changeOrigin: true },
      '/health':  { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
