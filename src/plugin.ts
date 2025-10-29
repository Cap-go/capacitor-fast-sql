import { registerPlugin } from '@capacitor/core';

import type { CapgoCapacitorNativeSqlPlugin } from './definitions';

export const CapgoCapacitorNativeSql =
  registerPlugin<CapgoCapacitorNativeSqlPlugin>('CapgoCapacitorNativeSql', {
    web: () => import('./web').then((m) => new m.CapgoCapacitorNativeSqlWeb()),
  });
