import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2020'
  },
  server: {
    port: 5173,
    open: false
  }
});
