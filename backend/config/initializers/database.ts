import { AppDataSource, initializeDatabase } from '@config/database';
import type { RuntimeInitializer } from './types';

export const databaseInitializer: RuntimeInitializer = {
  name: 'database',
  initialize: async () => {
    await initializeDatabase();
  },
  shutdown: async () => {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  },
};
