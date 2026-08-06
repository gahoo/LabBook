import { db } from './connection.js';
import { initializeSchema } from './schema.js';
import { runMigrations } from './migrations.js';

// Initialize the database structure and run migrations
initializeSchema(db);
runMigrations(db);

export { db };
