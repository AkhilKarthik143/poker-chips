import { SqliteStore } from './sqlite.js';

export function createStore(path = process.env.TABLEMATE_DB_PATH, tursoUrl = process.env.TURSO_DATABASE_URL,
  tursoToken = process.env.TURSO_AUTH_TOKEN) {
  if (Boolean(tursoUrl) !== Boolean(tursoToken)) {
    throw new Error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set together.');
  }
  if (tursoUrl) {
    if (!/^libsql:\/\/[A-Za-z0-9.-]+$/.test(tursoUrl)) {
      throw new Error('TURSO_DATABASE_URL must be a libsql:// URL.');
    }
    return new SqliteStore(tursoUrl, tursoToken);
  }
  if (path && process.env.NODE_ENV === 'production') {
    throw new Error('Production account storage requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.');
  }
  if (!path) return {
    enabled: false,
    async init() {}, async saveNight() {}, async getNight() { return null; }, async close() {}
  };
  return new SqliteStore(path);
}
