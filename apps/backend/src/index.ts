import { createServer } from 'node:http';
import { config } from './config.js';
import { getDb } from './db/index.js';
import { migrateAppTables } from './db/migrate.js';
import { getAuth, migrateAuthTables } from './auth.js';
import { GameService } from './services/game-service.js';
import { RoomService } from './services/room-service.js';
import { buildHttpApp } from './http.js';
import { setupSockets, getBroadcast, getNotifyRoom } from './sockets.js';

async function main() {
  const db = await getDb();
  await migrateAppTables(db);
  const auth = await getAuth();
  await migrateAuthTables();

  const games = new GameService(db);
  const rooms = new RoomService(db);

  const discontinued = await games.syncGameTypes();
  if (discontinued.length > 0) {
    console.log(`Rules changed — discontinued in-flight games for: ${discontinued.join(', ')}`);
  }

  const httpServer = createServer();
  const io = setupSockets(httpServer, auth, games, rooms);
  const app = buildHttpApp(auth, games, rooms, getNotifyRoom(io), getBroadcast(io));
  httpServer.on('request', app);

  // Daily retention job (plan §5.3): purge stale lobby/active/paused +
  // discontinued games; completed results are kept forever.
  const purge = async () => {
    try {
      const n = await games.purgeStaleGames(config.purgeAfterDays);
      if (n > 0) console.log(`Purged ${n} stale game(s)`);
    } catch (err) {
      console.error('Purge job failed', err);
    }
  };
  await purge();
  setInterval(purge, 24 * 60 * 60 * 1000);

  httpServer.listen(config.port, () => {
    console.log(`GameBox backend listening on :${config.port}`);
    console.log(`  auth: email/password=${config.emailPasswordEnabled}, google=${Boolean(config.googleClientId)}`);
    console.log(`  db: ${config.databaseUrl ? 'postgres' : `sqlite (${config.sqlitePath})`}`);
  });
}

main().catch((err) => {
  console.error('Fatal startup error', err);
  process.exit(1);
});
