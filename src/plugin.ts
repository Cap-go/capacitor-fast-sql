import { registerPlugin } from '@capacitor/core';

import type { CapgoCapacitorFastSqlPlugin } from './definitions';

export const CapgoCapacitorFastSql =
  registerPlugin<CapgoCapacitorFastSqlPlugin>('CapgoCapacitorFastSql', {
    web: () => import('./web').then((m) => new m.CapgoCapacitorFastSqlWeb()),
  });
