import { SqliteStore } from './sqlite.js';

export function createStore(path = process.env.TABLEMATE_DB_PATH) {
  if (!path) return {
    enabled: false,
    async init() {}, async saveNight() {}, async getNight() { return null; }, async close() {}
  };
  return new SqliteStore(path);
}
