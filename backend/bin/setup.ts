import 'dotenv/config';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { isLocalEnvironment } from '@lib/environment';
import { logger } from '@lib/utils/log';

interface EnvConfig {
  EMAIL_API_NADEDB: string;
  API_KEY_MASTER: string;
  PORT: string;
}

function printHeader() {
  console.log('');
  console.log('====================================');
  console.log('  Nadeshiko Backend Setup');
  console.log('====================================');
  console.log('');
}

function printSuccess(message: string) {
  console.log(`✓ ${message}`);
}

function printWarning(message: string) {
  console.log(`⚠ ${message}`);
}

function printInfo(message: string) {
  console.log(`  ${message}`);
}

function printSection(title: string) {
  console.log('');
  console.log(title);
}

function checkEnvFile(): void {
  if (!isLocalEnvironment()) {
    return;
  }

  if (!existsSync('.env')) {
    printWarning('.env file not found, creating from .env.example...');
    execFileSync('cp', ['.env.example', '.env'], { stdio: 'inherit' });
    printSuccess('Created .env file');
    printInfo('Review .env values before running in shared environments.');
  } else {
    printSuccess('.env file already exists');
  }
}

function runDbSetup(): void {
  const passthroughArgs = process.argv.slice(2);
  printSection('Initializing infrastructure...');
  printInfo('- PostgreSQL bootstrap');
  printInfo('- Recreate PostgreSQL app role + database');
  printInfo('- Destructive database recreation');
  printInfo('- Migrations + seed');
  printInfo('- pg-boss schema setup');
  printInfo('- Recreate Elasticsearch role/user + index reset');
  console.log('');

  execFileSync('bun', ['run', 'bin/db.ts', 'setup', ...passthroughArgs], { stdio: 'inherit' });
  printSuccess('Infrastructure ready');
}

function printFinalSummary(): void {
  const env = process.env as NodeJS.ProcessEnv & EnvConfig;

  console.log('');
  console.log('====================================');
  console.log('  Setup Complete! 🎉');
  console.log('====================================');
  console.log('');
  console.log('To start the backend server:');
  console.log('  bun run dev');
  console.log('');
  console.log('Admin credentials:');
  console.log(`  Email:    ${env.EMAIL_API_NADEDB}`);
  console.log(`  API Key:  ${env.API_KEY_MASTER}`);
  console.log('');
  console.log(`API will be available at: http://localhost:${env.PORT}`);
  console.log('');
}

function main() {
  try {
    printHeader();

    checkEnvFile();
    runDbSetup();

    printFinalSummary();

    process.exit(0);
  } catch (error) {
    logger.error(error, 'Setup failed');
    process.exit(1);
  }
}

main();
