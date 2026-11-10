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
const accountsMigration = `
  CREATE TABLE accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL);
  CREATE INDEX sessions_account ON sessions(account_id);
  CREATE TABLE magic_links (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at INTEGER NOT NULL);
`;
const leagueMigration = `
  ALTER TABLE nights ADD COLUMN league_id TEXT;
  ALTER TABLE nights ADD COLUMN season_id TEXT;
  ALTER TABLE nights ADD COLUMN counts INTEGER NOT NULL DEFAULT 1;
  CREATE INDEX nights_league_ended ON nights(league_id, ended_at);
  CREATE TABLE leagues (id TEXT PRIMARY KEY, name TEXT NOT NULL, invite_code TEXT NOT NULL UNIQUE,
    table_settings_json TEXT NOT NULL, created_at INTEGER NOT NULL, archived_at INTEGER);
  CREATE TABLE league_members (id TEXT PRIMARY KEY, league_id TEXT NOT NULL REFERENCES leagues(id),
    account_id TEXT, display_name TEXT NOT NULL, role TEXT NOT NULL,
    joined_at INTEGER NOT NULL, left_at INTEGER,
    UNIQUE(league_id, account_id));
  CREATE INDEX league_members_active ON league_members(league_id, left_at);
  CREATE TABLE seasons (id TEXT PRIMARY KEY, league_id TEXT NOT NULL REFERENCES leagues(id),
    name TEXT NOT NULL, status TEXT NOT NULL, starts_at INTEGER, ends_at INTEGER,
    scoring_json TEXT NOT NULL, champion_member_id TEXT, created_at INTEGER NOT NULL);
  CREATE UNIQUE INDEX one_active_season ON seasons(league_id) WHERE status = 'active';
  CREATE TABLE league_night_results (night_id TEXT NOT NULL REFERENCES nights(id),
    league_id TEXT NOT NULL, season_id TEXT, member_id TEXT NOT NULL,
    rank INTEGER NOT NULL, net INTEGER NOT NULL, buy_in INTEGER NOT NULL,
    PRIMARY KEY(night_id, member_id));
  CREATE INDEX league_results_season ON league_night_results(season_id);
  CREATE TABLE league_audit (id TEXT PRIMARY KEY, league_id TEXT NOT NULL,
    season_id TEXT, night_id TEXT, actor_member_id TEXT NOT NULL,
    action TEXT NOT NULL, detail_json TEXT NOT NULL, at INTEGER NOT NULL);
`;
const settingsMigration = `
  CREATE TABLE account_settings (account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    settings_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
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
    if (version < 2) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(accountsMigration);
        this.db.prepare('UPDATE schema_version SET version = 2').run();
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
    if (version < 3) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(leagueMigration);
        this.db.prepare('UPDATE schema_version SET version = 3').run();
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
    if (version < 4) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(settingsMigration);
        this.db.prepare('UPDATE schema_version SET version = 4').run();
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
  }
  async init() { this.migrate(); }
  async saveNight(snapshot) {
    this.db.exec('BEGIN');
    try {
      this.db.prepare(`INSERT INTO nights
        (id, room_code, group_id, started_at, updated_at, ended_at, hands, settings_json, settlement_json, league_id, season_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, ended_at=excluded.ended_at,
          hands=excluded.hands, settings_json=excluded.settings_json, settlement_json=excluded.settlement_json`)
        .run(snapshot.nightId, snapshot.roomCode, snapshot.groupId ?? null, snapshot.startedAt,
          snapshot.updatedAt, snapshot.endedAt ?? null, snapshot.hands, JSON.stringify(snapshot.settings), JSON.stringify(snapshot.settlement),
          snapshot.leagueId ?? null, snapshot.seasonId ?? null);
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
  async saveMagicLink(tokenHash, email, expiresAt) {
    this.db.prepare('INSERT INTO magic_links (token_hash,email,expires_at) VALUES (?,?,?)').run(tokenHash, email, expiresAt);
  }
  async consumeMagicLink(tokenHash, time) {
    const row = this.db.prepare('DELETE FROM magic_links WHERE token_hash = ? RETURNING email, expires_at').get(tokenHash);
    return row && row.expires_at > time ? row.email : null;
  }
  async getAccountByEmail(email) { return this.db.prepare('SELECT * FROM accounts WHERE email = ?').get(email) ?? null; }
  async getAccount(id) { return this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) ?? null; }
  async createAccount(id, email, displayName, time) {
    this.db.prepare('INSERT INTO accounts (id,email,display_name,created_at) VALUES (?,?,?,?) ON CONFLICT(email) DO NOTHING')
      .run(id, email, displayName, time);
    return this.getAccountByEmail(email);
  }
  async updateAccount(id, displayName) {
    this.db.prepare('UPDATE accounts SET display_name = ? WHERE id = ?').run(displayName, id);
    return this.getAccount(id);
  }
  async saveSession(tokenHash, accountId, expiresAt) {
    this.db.prepare('INSERT INTO sessions (token_hash,account_id,expires_at) VALUES (?,?,?)').run(tokenHash, accountId, expiresAt);
  }
  async getSession(tokenHash, time) {
    const row = this.db.prepare('SELECT account_id FROM sessions WHERE token_hash = ? AND expires_at > ?').get(tokenHash, time);
    return row?.account_id ?? null;
  }
  async deleteSession(tokenHash) { this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash); }
  async claimNight(nightId, tokenHash, accountId) {
    const result = this.db.prepare(`UPDATE night_players SET account_id = ?
      WHERE night_id = ? AND claim_hash = ? AND account_id IS NULL`).run(accountId, nightId, tokenHash);
    return result.changes;
  }
  async listAccountNights(accountId) {
    return this.db.prepare(`SELECT n.id AS night_id,n.room_code,n.started_at,n.ended_at,
      p.buy_in,p.cash_out,p.net,p.hands_played,p.hands_won,p.vpip_hands,p.pfr_hands,
      p.raises,p.calls,p.checks,p.folds,p.all_ins,p.showdowns,p.showdown_wins
      FROM night_players p JOIN nights n ON n.id = p.night_id
      WHERE p.account_id = ? AND n.ended_at IS NOT NULL
      ORDER BY n.ended_at DESC,n.id DESC`).all(accountId);
  }
  async exportAccount(accountId) {
    return { account: await this.getAccount(accountId), settings: await this.getSettings(accountId), nights: await this.listAccountNights(accountId) };
  }
  async getSettings(accountId) {
    const row = this.db.prepare('SELECT settings_json FROM account_settings WHERE account_id = ?').get(accountId);
    return row ? JSON.parse(row.settings_json) : null;
  }
  async saveSettings(accountId, settings, time) {
    this.db.prepare(`INSERT INTO account_settings (account_id,settings_json,updated_at) VALUES (?,?,?)
      ON CONFLICT(account_id) DO UPDATE SET settings_json=excluded.settings_json,updated_at=excluded.updated_at`)
      .run(accountId, JSON.stringify(settings), time);
    return settings;
  }
  async deleteAccount(accountId) {
    this.db.exec('BEGIN');
    try {
      const owned = this.db.prepare(`SELECT league_id,id FROM league_members WHERE account_id = ? AND role = 'commissioner' AND left_at IS NULL`).all(accountId);
      for (const owner of owned) {
        const successor = this.db.prepare(`SELECT id FROM league_members WHERE league_id = ? AND id <> ? AND left_at IS NULL
          ORDER BY (role = 'co') DESC,joined_at,id LIMIT 1`).get(owner.league_id, owner.id);
        if (successor) {
          this.db.prepare(`UPDATE league_members SET role = 'member' WHERE id = ?`).run(owner.id);
          this.db.prepare(`UPDATE league_members SET role = 'commissioner' WHERE id = ?`).run(successor.id);
        } else this.db.prepare('UPDATE leagues SET archived_at = ? WHERE id = ?').run(Date.now(), owner.league_id);
      }
      this.db.prepare('UPDATE night_players SET account_id = NULL WHERE account_id = ?').run(accountId);
      this.db.prepare(`UPDATE league_members SET account_id = NULL, display_name = 'Former member',
        left_at = COALESCE(left_at, ?) WHERE account_id = ?`).run(Date.now(), accountId);
      this.db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  async close() { this.db.close(); }
}
