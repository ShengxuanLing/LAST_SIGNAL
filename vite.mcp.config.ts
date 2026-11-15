import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Builds the official MCP stdio servers to dist-mcp/.
 *   mcpServer.mjs      — StationZero-compatible PLAYER / DEV harness (default, --dev)
 *   worldMcpServer.mjs — core-free C3-b WORLD agent surface (--world equivalent)
 */
export default defineConfig({
  build: {
    ssr: true,
    outDir: 'dist-mcp',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    sourcemap: false,
    rollupOptions: {
      input: {
        mcpServer: resolve(process.cwd(), 'src/ai-native/mcpServer.ts'),
        worldMcpServer: resolve(process.cwd(), 'src/ai-native/worldMcpServer.ts'),
        worldHeadlessMcpServer: resolve(process.cwd(), 'src/ai-native/worldHeadlessMcpServer.ts')
      },
      output: { entryFileNames: '[name].mjs', chunkFileNames: 'chunks/[name]-[hash].mjs' }
    }
  }
});
