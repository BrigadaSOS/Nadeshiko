import { PgBoss } from 'pg-boss';

let bossInstance: PgBoss | null = null;

export function setBossInstance(boss: PgBoss): void {
  bossInstance = boss;
}

export function getPgBoss(): PgBoss {
  if (!bossInstance) {
    throw new Error('PgBoss not initialized.');
  }

  return bossInstance;
}
