import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Two artifact-dependent gates live in vitest.integration.config.ts (exact
    // include + CLI file filter). They are NOT skipped: npm run test:mcp-surface
    // and npm run test:parity execute them in their correct CI stage.
    exclude: [
      '**/node_modules/**',
      'src/ai-native/companionSurface.test.ts',
      'src/ai-native/signalRenderedHeadlessParity.test.ts'
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/main.ts']
    }
  }
});
