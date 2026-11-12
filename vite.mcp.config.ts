import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/** Builds the MCP stdio server to dist-mcp/mcpServer.mjs for a direct node command. */
export default defineConfig({
  build: {
    ssr: resolve(process.cwd(), 'src/ai-native/mcpServer.ts'),
    outDir: 'dist-mcp',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: { entryFileNames: 'mcpServer.mjs' },
    },
  },
});
