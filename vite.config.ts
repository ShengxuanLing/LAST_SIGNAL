import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => ({
  // F-03 / C2 writer-boundary gate: an explicit build-time constant, not the
  // runtime import.meta.env object. Only a normal `production` build removes
  // the Phaser handle and the dev/test diagnostic facade.
  define: {
    __LAST_SIGNAL_DEV_TEST__: JSON.stringify(mode !== 'production')
  },
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2020',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        'station-zero': fileURLToPath(new URL('./station-zero.html', import.meta.url))
      }
    }
  },
  server: {
    port: 5173,
    open: false
  }
}));
