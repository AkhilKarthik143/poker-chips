import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient } from '@libsql/client/node';

// Both file: and libsql: use the same asynchronous, parameterized API. A
// transaction's connection is kept in async context so concurrent requests
// cannot accidentally run statements in one another's transactions.
export class Database {
  constructor({ url, authToken }) {
    this.client = createClient({ url, ...(authToken ? { authToken } : {}) });
    this.context = new AsyncLocalStorage();
    this.serial = url.startsWith('file:');
    this.tail = Promise.resolve();
    this.writeTail = Promise.resolve();
  }
  async queued(fn, write = false) {
    const previous = write ? this.writeTail : this.tail;
    let release;
    const current = new Promise(resolve => { release = resolve; });
    if (write) this.writeTail = current;
    else this.tail = current;
    await previous;
    try { return await fn(); } finally { release(); }
  }
  connection() { return this.context.getStore() || this.client; }
  async execute(sql, args = []) {
    if (this.context.getStore()) return this.connection().execute({ sql, args });
    const query = () => this.client.execute({ sql, args });
    if (this.serial) return this.queued(query);
    return /^(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|PRAGMA)\b/i.test(sql.trimStart())
      ? this.queued(query, true) : query();
  }
  prepare(sql) {
    return {
      get: async (...args) => (await this.execute(sql, args)).rows[0] ?? undefined,
      all: async (...args) => (await this.execute(sql, args)).rows,
      run: async (...args) => {
        const result = await this.execute(sql, args);
        return { changes: result.rowsAffected, lastInsertRowid: result.lastInsertRowid };
      }
    };
  }
  async transaction(fn) {
    if (this.context.getStore()) return fn();
    const transaction = async () => {
      const tx = await this.client.transaction('write');
      try {
        const value = await this.context.run(tx, fn);
        await tx.commit();
        return value;
      } catch (error) {
        try { await tx.rollback(); } catch { /* Preserve the original failure. */ }
        throw error;
      } finally { await tx.close(); }
    };
    return this.queued(transaction, !this.serial);
  }
  async close() { await Promise.all([this.tail, this.writeTail]); await this.client.close(); }
}
