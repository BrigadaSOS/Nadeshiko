import type { Application } from 'express';
import type { Server } from 'node:http';

export interface RuntimeContext {
  app: Application;
  server: Server | null;
}

export interface RuntimeInitializer {
  name: string;
  initialize: (context: RuntimeContext) => Promise<void> | void;
  shutdown?: (context: RuntimeContext) => Promise<void> | void;
}
