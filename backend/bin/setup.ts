// Nadeshiko Backend Setup Script
// One-command setup for first-time users

import 'dotenv/config';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { logger } from '@lib/utils/log';

interface EnvConfig {
  USERNAME_API_NADEDB: string;
  PASSWORD_API_NADEDB: string;
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
  if (!existsSync('.env')) {
    printWarning('.env file not found, creating from .env.example...');
    execSync('cp .env.example .env', { stdio: 'inherit' });
    printSuccess('Created .env file');
    printWarning('Please review and update .env with your configuration');
    printInfo('Press Ctrl+C to exit and edit .env first, or wait to continue...');

    setTimeout(() => {
      printSuccess('Continuing with setup...');
    }, 5000);
  } else {
    printSuccess('.env file already exists');
  }
}

function installDependencies(): void {
  if (!existsSync('node_modules')) {
    printSection('📦 Installing npm dependencies...');
    execSync('npm install', { stdio: 'inherit' });
    printSuccess('Dependencies installed');
  } else {
    printSuccess('Dependencies already installed');
  }
}

function initializeDatabase(): void {
  printSection('Initializing database...');
  printInfo('- Running migrations');
  printInfo('- Adding roles and permissions');
  printInfo('- Creating admin user');
  printInfo('- Importing media directories');
  console.log('');

  execSync('bun run db:setup', { stdio: 'inherit' });
  printSuccess('Database initialized');
}

function printFinalSummary(): void {
  const env = process.env as NodeJS.ProcessEnv & EnvConfig;

  console.log('');
  console.log('====================================');
  console.log('  Setup Complete! 🎉');
  console.log('====================================');
  console.log('');
  console.log('To start the backend server:');
  console.log(`  npm run dev`);
  console.log('');
  console.log('Admin credentials:');
  console.log(`  Email:    ${env.EMAIL_API_NADEDB}`);
  console.log(`  Password: ${env.PASSWORD_API_NADEDB}`);
  console.log(`  API Key:  ${env.API_KEY_MASTER}`);
  console.log('');
  console.log(`API will be available at: http://localhost:${env.PORT}`);
  console.log('');
}

function main() {
  try {
    printHeader();

    checkEnvFile();
    installDependencies();
    initializeDatabase();

    printFinalSummary();

    process.exit(0);
  } catch (error) {
    logger.error(error, 'Setup failed');
    process.exit(1);
  }
}

main();
