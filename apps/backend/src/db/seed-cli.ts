/**
 * Development seeding: creates dummy email/password users for local testing.
 * Only meaningful while AUTH_EMAIL_PASSWORD_ENABLED=true (the dev setup);
 * once Google login is activated these accounts simply stop being reachable.
 */
import { getDb } from './index.js';
import { migrateAppTables } from './migrate.js';
import { getAuth, migrateAuthTables } from '../auth.js';

export const DUMMY_USERS = [
  { name: 'Alice (dev)', email: 'alice@dev.local', password: 'gamebox-dev-1' },
  { name: 'Bob (dev)', email: 'bob@dev.local', password: 'gamebox-dev-2' },
  { name: 'Carol (dev)', email: 'carol@dev.local', password: 'gamebox-dev-3' },
  { name: 'Dave (dev)', email: 'dave@dev.local', password: 'gamebox-dev-4' },
];

const db = await getDb();
await migrateAppTables(db);
await migrateAuthTables();
const auth = await getAuth();

for (const u of DUMMY_USERS) {
  try {
    await auth.api.signUpEmail({
      body: { name: u.name, email: u.email, password: u.password },
    });
    console.log(`Created ${u.email} (password: ${u.password})`);
  } catch (err: any) {
    if (String(err?.message ?? err).toLowerCase().includes('exist')) {
      console.log(`${u.email} already exists — skipped`);
    } else {
      console.error(`Failed to create ${u.email}:`, err?.message ?? err);
    }
  }
}
process.exit(0);
