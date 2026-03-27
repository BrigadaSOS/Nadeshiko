import { existsSync, copyFileSync } from 'fs';

function printSuccess(message: string) {
  console.log(`\x1b[32m✓\x1b[0m ${message}`);
}

function printSection(title: string) {
  console.log('');
  console.log(`\x1b[1m${title}\x1b[0m`);
}

function main() {
  printSection('Frontend setup');

  if (existsSync('.env')) {
    printSuccess('.env file already exists');
  } else if (existsSync('.env.example')) {
    copyFileSync('.env.example', '.env');
    printSuccess('Created .env from .env.example');
  } else {
    throw new Error('.env.example not found. Are you running from the frontend directory?');
  }

  printSuccess('Frontend setup complete');
}

main();
