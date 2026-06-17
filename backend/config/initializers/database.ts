import { config } from '@config/config';
import { AppDataSource, initializeDatabase, runMigrations } from '@config/database';
import type { RuntimeInitializer } from './types';

export const databaseInitializer: RuntimeInitializer = {
  name: 'database',
  initialize: async () => {
    await initializeDatabase();
    if (config.RUN_MIGRATIONS_ON_BOOT) {
      await runMigrations();
    }
  },
  shutdown: async () => {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  },
};
