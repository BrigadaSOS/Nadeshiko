// Nadeshiko Backend Setup Script
// One-command setup for first-time users

import 'dotenv/config';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { logger } from '../utils/log';
import connection from '../database/db_posgres';
import { addBasicData, readAnimeDirectories } from '../database/db_initial';

interface EnvConfig {
  USERNAME_API_NADEDB: string;
  PASSWORD_API_NADEDB: string;
  EMAIL_API_NADEDB: string;
  API_KEY_MASTER: string;
  PORT: string;
  MEDIA_DIRECTORY: string;
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

async function initializeDatabase(): Promise<void> {
  printSection('🗄️  Initializing database...');
  printInfo('- Creating tables');
  printInfo('- Adding roles and permissions');
  printInfo('- Creating admin user');
  printInfo('- Importing media directories');
  console.log('');

  const mediaDirectory: string = process.env.MEDIA_DIRECTORY || './media';

  await connection.sync({ force: true });
  printSuccess('Database tables created');

  const db = connection.models;
  await addBasicData(db);
  printSuccess('Basic data added (roles, permissions, admin user)');

  await readAnimeDirectories(mediaDirectory, 'jdrama');
  await readAnimeDirectories(mediaDirectory, 'anime');
  await readAnimeDirectories(mediaDirectory, 'audiobook');
  printSuccess('Media directories imported');
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

async function main() {
  try {
    printHeader();

    checkEnvFile();
    installDependencies();
    await initializeDatabase();

    printFinalSummary();

    process.exit(0);
  } catch (error) {
    logger.error(error, 'Setup failed');
    process.exit(1);
  }
}

main();
