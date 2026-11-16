/// <reference types="vite/client" />

// Vite exposes import.meta.env to the app. The F-03 production gate uses
// DEV/MODE to decide whether the Phaser game handle is exposed to the page.
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Build-time constant from vite.config.ts (true for dev / test, false for production). */
declare const __LAST_SIGNAL_DEV_TEST__: boolean;
