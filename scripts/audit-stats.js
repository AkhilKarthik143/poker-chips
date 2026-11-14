import { createStore } from '../src/store/index.js';

// Read-only health check for persisted night/statistics data. Output contains
// counts only: never names, emails, account IDs, or database credentials.
const store = createStore();

if (!store.enabled) {
  process.stderr.write(
    'Stats audit unavailable: configure TABLEMATE_DB_PATH for local SQLite or TURSO_DATABASE_URL/TURSO_AUTH_TOKEN for Turso.\n'
  );
  process.exitCode = 2;
} else {
  try {
    await store.init();
    const count = async (sql) => Number((await store.db.prepare(sql).get())?.count ?? 0);
    const report = {
      nights: await count('SELECT COUNT(*) AS count FROM nights'),
      finalizedNights: await count(`SELECT COUNT(*) AS count FROM nights
        WHERE ended_at IS NOT NULL AND COALESCE(counts, 1) = 1`),
      openNightsWithHands: await count(`SELECT COUNT(*) AS count FROM nights
        WHERE ended_at IS NULL AND hands > 0 AND COALESCE(counts, 1) = 1`),
      emptyNights: await count(`SELECT COUNT(*) AS count FROM nights n
        WHERE NOT EXISTS (SELECT 1 FROM night_players p WHERE p.night_id = n.id)`),
      duplicateAccountSeats: await count(`SELECT COUNT(*) AS count FROM (
        SELECT night_id, account_id FROM night_players
        WHERE account_id IS NOT NULL GROUP BY night_id, account_id HAVING COUNT(*) > 1
      )`),
      orphanedAccountReferences: await count(`SELECT COUNT(*) AS count FROM night_players p
        LEFT JOIN accounts a ON a.id = p.account_id
        WHERE p.account_id IS NOT NULL AND a.id IS NULL`),
      nonZeroSumFinalizedNights: await count(`SELECT COUNT(*) AS count FROM (
        SELECT n.id FROM nights n
        JOIN night_players p ON p.night_id = n.id
        WHERE n.ended_at IS NOT NULL AND COALESCE(n.counts, 1) = 1
        GROUP BY n.id HAVING SUM(p.net) <> 0
      )`),
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Stats audit failed: ${error.message}\n`);
    process.exitCode = 1;
  } finally {
    await store.close?.();
  }
}
