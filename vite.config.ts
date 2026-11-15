import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:4317', changeOrigin: true } },
  },
});
