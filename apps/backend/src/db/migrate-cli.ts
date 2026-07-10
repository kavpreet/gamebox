import { getDb } from './index.js';
import { migrateAppTables } from './migrate.js';
import { migrateAuthTables } from '../auth.js';

const db = await getDb();
await migrateAppTables(db);
await migrateAuthTables();
console.log('Migrations complete');
process.exit(0);
