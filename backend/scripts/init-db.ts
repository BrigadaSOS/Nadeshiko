import 'dotenv/config';
import connection from '../database/db_posgres';
import { addBasicData, readAnimeDirectories } from '../database/db_initial';
import { logger } from '../utils/log';

const mediaDirectory: string = process.env.MEDIA_DIRECTORY || './media';

async function initializeDatabase() {
  try {
    logger.info('Starting database initialization...');

    // Step 1: Sync database schema (creates all tables)
    logger.info('Creating database tables...');
    await connection.sync({ force: true });
    logger.info('Database tables created successfully.');

    // Step 2: Add basic data (roles, permissions, admin user)
    logger.info('Adding basic data (roles, permissions, admin user)...');
    const db = connection.models;
    await addBasicData(db);
    logger.info('Basic data added successfully.');

    // Step 3: Import media directories
    logger.info('Importing media directories...');
    await readAnimeDirectories(mediaDirectory, 'jdrama');
    await readAnimeDirectories(mediaDirectory, 'anime');
    await readAnimeDirectories(mediaDirectory, 'audiobook');
    logger.info('Media directories imported successfully.');

    logger.info('====================================');
    logger.info('Database initialization complete!');
    logger.info('====================================');
    logger.info('Default admin credentials:');
    logger.info('  Email: admin@admin.com');
    logger.info('  Password: admin');
    logger.info('  API Key: master-api-key');
    logger.info('====================================');

    process.exit(0);
  } catch (error) {
    logger.error(error, 'Database initialization failed');
    process.exit(1);
  }
}

initializeDatabase();
