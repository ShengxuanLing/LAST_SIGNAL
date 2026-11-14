import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => ({
  // F-03 / C2 writer-boundary gate: an explicit build-time constant, not the
  // runtime import.meta.env object. ONLY the dev server (development) and the
  // frozen evidence build (--mode test) expose the Phaser handle and the
  // dev/test diagnostic facade. Any other custom mode is treated as a
  // production deployment and must NOT expose debug/owner capabilities.
  define: {
    __LAST_SIGNAL_DEV_TEST__: JSON.stringify(mode === 'development' || mode === 'test')
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
