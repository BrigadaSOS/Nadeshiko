import { initTelemetry, shutdownTelemetry } from '@config/telemetry';
import type { RuntimeInitializer } from './types';

export const telemetryInitializer: RuntimeInitializer = {
  name: 'telemetry',
  initialize: () => {
    initTelemetry();
  },
  shutdown: async () => {
    await shutdownTelemetry();
  },
};
