import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    // welcome.html: the desktop app's first-start page (choose the workspace folder).
    rollupOptions: { input: { main: 'index.html', welcome: 'welcome.html' } },
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:4317', changeOrigin: true } },
  },
});
