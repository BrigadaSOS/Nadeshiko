import { auth } from '@config/auth';
import type { RuntimeInitializer } from './types';

export const authInitializer: RuntimeInitializer = {
  name: 'auth',
  initialize: () => {
    // Eagerly touch auth singleton so misconfiguration fails during boot.
    if (!auth) {
      throw new Error('Auth runtime is not configured.');
    }
  },
};
