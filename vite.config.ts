import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  resolve: {
    // The game uses its own collision system. This official build omits Matter.
    alias: [{ find: /^phaser$/, replacement: 'phaser/dist/phaser-arcade-physics.min.js' }]
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2020',
    rollupOptions: {
      output: { manualChunks: { phaser: ['phaser'] } },
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
});
