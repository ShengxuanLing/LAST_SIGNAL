import { defineConfig } from 'vitest/config';

// GAMEPLAY-01 CI hermeticity — the two artifact-dependent gates.
//
// They are not skipped: the CI stage selects exactly one file with the CLI
// positional filter, after its prerequisite exists:
//   vitest run -c vitest.integration.config.ts src/ai-native/companionSurface.test.ts
//     (after `npm run game:mcp:build`, done by `npm run test:mcp-surface`)
//   vitest run -c vitest.integration.config.ts src/ai-native/signalRenderedHeadlessParity.test.ts
//     (after the real Playwright Rendered export, done by `npm run test:parity`)
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/ai-native/companionSurface.test.ts',
      'src/ai-native/signalRenderedHeadlessParity.test.ts'
    ]
  }
});
