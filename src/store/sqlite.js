import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const migration = `
  CREATE TABLE IF NOT EXISTS nights (
    id TEXT PRIMARY KEY, room_code TEXT NOT NULL, group_id TEXT,
    started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, ended_at INTEGER,
    hands INTEGER NOT NULL, settings_json TEXT NOT NULL, settlement_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS night_players (
    night_id TEXT NOT NULL REFERENCES nights(id) ON DELETE CASCADE,
    seat_id TEXT NOT NULL, name TEXT NOT NULL, account_id TEXT,
    claim_hash TEXT NOT NULL, buy_in INTEGER NOT NULL, cash_out INTEGER NOT NULL,
    net INTEGER NOT NULL, hands_played INTEGER NOT NULL, hands_won INTEGER NOT NULL,
    vpip_hands INTEGER NOT NULL, pfr_hands INTEGER NOT NULL,
    raises INTEGER NOT NULL, calls INTEGER NOT NULL, checks INTEGER NOT NULL,
    folds INTEGER NOT NULL, all_ins INTEGER NOT NULL,
    showdowns INTEGER NOT NULL, showdown_wins INTEGER NOT NULL,
    PRIMARY KEY (night_id, seat_id)
  );
  CREATE INDEX IF NOT EXISTS night_players_account ON night_players(account_id);
  CREATE INDEX IF NOT EXISTS nights_group_ended ON nights(group_id, ended_at);
`;

export class SqliteStore {
  constructor(path) {
    const require = createRequire(import.meta.url);
    let DatabaseSync;
    try { ({ DatabaseSync } = require('node:sqlite')); }
    catch { DatabaseSync = require('better-sqlite3'); }
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
    if (!this.db.prepare('SELECT version FROM schema_version').get()) this.db.prepare('INSERT INTO schema_version VALUES (0)').run();
    this.enabled = true;
    this.migrate();
  }
  migrate() {
    const version = this.db.prepare('SELECT version FROM schema_version').get().version;
    if (version < 1) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(migration);
        this.db.prepare('UPDATE schema_version SET version = 1').run();
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
  }
  async init() { this.migrate(); }
  async saveNight(snapshot) {
    this.db.exec('BEGIN');
    try {
      this.db.prepare(`INSERT INTO nights
        (id, room_code, group_id, started_at, updated_at, ended_at, hands, settings_json, settlement_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, ended_at=excluded.ended_at,
          hands=excluded.hands, settings_json=excluded.settings_json, settlement_json=excluded.settlement_json`)
        .run(snapshot.nightId, snapshot.roomCode, snapshot.groupId ?? null, snapshot.startedAt,
          snapshot.updatedAt, snapshot.endedAt ?? null, snapshot.hands, JSON.stringify(snapshot.settings), JSON.stringify(snapshot.settlement));
      const insert = this.db.prepare(`INSERT INTO night_players
        (night_id,seat_id,name,account_id,claim_hash,buy_in,cash_out,net,hands_played,hands_won,
          vpip_hands,pfr_hands,raises,calls,checks,folds,all_ins,showdowns,showdown_wins)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(night_id,seat_id) DO UPDATE SET name=excluded.name,account_id=excluded.account_id,
          claim_hash=excluded.claim_hash,buy_in=excluded.buy_in,cash_out=excluded.cash_out,net=excluded.net,
          hands_played=excluded.hands_played,hands_won=excluded.hands_won,vpip_hands=excluded.vpip_hands,
          pfr_hands=excluded.pfr_hands,raises=excluded.raises,calls=excluded.calls,checks=excluded.checks,
          folds=excluded.folds,all_ins=excluded.all_ins,showdowns=excluded.showdowns,showdown_wins=excluded.showdown_wins`);
      for (const p of snapshot.players) insert.run(snapshot.nightId, p.id, p.name, p.accountId ?? null,
        p.claimHash, p.buyIn, p.cashOut, p.net, p.handsPlayed, p.handsWon, p.vpipHands, p.pfrHands,
        p.raises, p.calls, p.checks, p.folds, p.allIns, p.showdowns, p.showdownWins);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  async getNight(nightId) {
    const night = this.db.prepare('SELECT * FROM nights WHERE id = ?').get(nightId);
    if (!night) return null;
    return { ...night, players: this.db.prepare('SELECT * FROM night_players WHERE night_id = ? ORDER BY seat_id').all(nightId) };
  }
  async close() { this.db.close(); }
}
