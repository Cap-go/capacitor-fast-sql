import type { CapacitorConfig } from '@capacitor/cli';

import pkg from './package.json';

const config: CapacitorConfig = {
  "appId": "com.capgo.fastsql.example",
  "appName": "FastSQL Example",
  "webDir": "dist",
  "plugins": {
    "CapacitorUpdater": {
      "appId": "com.capgo.fastsql.example",
      "autoUpdate": true,
      "autoSplashscreen": true,
      "directUpdate": "always",
      "defaultChannel": "production",
      "version": pkg.version
    }
  }
};

export default config;
