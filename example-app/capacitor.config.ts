import type { CapacitorConfig } from '@capacitor/cli';

import pkg from './package.json';

const config: CapacitorConfig = {
  appId: 'com.capgo.fastsql.example',
  appName: '@capgo/capacitor-fast-sql',
  webDir: 'dist',
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
    },
    CapacitorUpdater: {
      appId: 'com.capgo.fastsql.example',
      // Benchmark startup also verifies builtin assets; this does not reset an existing OTA bundle.
      autoUpdate: false,
      autoSplashscreen: true,
      directUpdate: 'always',
      version: pkg.version,
    },
  },
};

export default config;
