import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
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
const presetsMigration = `
  CREATE TABLE table_presets (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL, settings_json TEXT NOT NULL, position INTEGER NOT NULL, created_at INTEGER NOT NULL);
  CREATE INDEX table_presets_owner ON table_presets(account_id, position, created_at);
`;
const googleIdentityMigration = `
  CREATE TABLE google_identities (google_sub TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE);
  CREATE INDEX google_identities_account ON google_identities(account_id);
`;
const identityMigration = `
  ALTER TABLE accounts ADD COLUMN username TEXT;
  ALTER TABLE accounts ADD COLUMN username_lower TEXT;
  ALTER TABLE accounts ADD COLUMN username_changed_at INTEGER;
  ALTER TABLE accounts ADD COLUMN avatar_json TEXT;
  ALTER TABLE accounts ADD COLUMN profile_json TEXT;
  CREATE UNIQUE INDEX accounts_username_lower ON accounts(username_lower);
  CREATE TABLE username_history (username_lower TEXT PRIMARY KEY, account_id TEXT NOT NULL, released_at INTEGER NOT NULL);
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
    if (version < 5) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(presetsMigration);
        this.db.prepare('UPDATE schema_version SET version = 5').run();
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
    if (version < 6) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(googleIdentityMigration);
        this.db.prepare('UPDATE schema_version SET version = 6').run();
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
    if (version < 7) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(identityMigration);
        this.db.prepare('UPDATE schema_version SET version = 7').run();
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
  uniqueDisplayName(name) {
    const taken = this.db.prepare('SELECT 1 FROM accounts WHERE display_name = ? COLLATE NOCASE LIMIT 1');
    if (!taken.get(name)) return name;
    for (let number = 2; number < Number.MAX_SAFE_INTEGER; number++) {
      const suffix = ` ${number}`;
      const candidate = `${name.slice(0, 20 - suffix.length).trimEnd()}${suffix}`;
      if (!taken.get(candidate)) return candidate;
    }
    throw new Error('No display name is available.');
  }
  async createAccount(id, email, displayName, time) {
    const existing = await this.getAccountByEmail(email);
    if (existing) return existing;
    this.db.prepare('INSERT INTO accounts (id,email,display_name,created_at) VALUES (?,?,?,?) ON CONFLICT(email) DO NOTHING')
      .run(id, email, this.uniqueDisplayName(displayName), time);
    return this.getAccountByEmail(email);
  }
  async signInGoogle(sub, email, displayName, authoritative, time) {
    this.db.exec('BEGIN');
    try {
      let account = this.db.prepare(`SELECT a.* FROM google_identities g
        JOIN accounts a ON a.id = g.account_id WHERE g.google_sub = ?`).get(sub);
      if (!account) {
        account = this.db.prepare('SELECT * FROM accounts WHERE email = ?').get(email);
        if (account && !authoritative) { this.db.exec('ROLLBACK'); return null; }
        if (!account) {
          const id = randomUUID();
          this.db.prepare('INSERT INTO accounts (id,email,display_name,created_at) VALUES (?,?,?,?)')
            .run(id, email, this.uniqueDisplayName(displayName), time);
          account = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
        }
        this.db.prepare('INSERT INTO google_identities (google_sub,account_id) VALUES (?,?)').run(sub, account.id);
      }
      this.db.exec('COMMIT');
      return account;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  async updateAccount(id, displayName) {
    this.db.prepare('UPDATE accounts SET display_name = ? WHERE id = ?').run(displayName, id);
    return this.getAccount(id);
  }
  usernameAvailability(accountId, username, time, cooldownMs) {
    const lower = username.toLowerCase();
    const account = this.db.prepare('SELECT username_lower,username_changed_at FROM accounts WHERE id = ?').get(accountId);
    if (!account) return 'taken';
    if (account.username_lower === lower) return null;
    const owner = this.db.prepare('SELECT id FROM accounts WHERE username_lower = ?').get(lower);
    if (owner && owner.id !== accountId) return 'taken';
    const held = this.db.prepare('SELECT account_id,released_at FROM username_history WHERE username_lower = ?').get(lower);
    if (held && held.account_id !== accountId && time - held.released_at < cooldownMs) return 'held';
    if (account.username_changed_at !== null && time - account.username_changed_at < cooldownMs && held?.account_id !== accountId) return 'cooldown';
    return null;
  }
  async updateProfile(accountId, patch, time, cooldownMs) {
    this.db.exec('BEGIN');
    try {
      const current = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
      if (!current) throw new Error('Account not found.');
      if (patch.username !== undefined) {
        const reason = this.usernameAvailability(accountId, patch.username, time, cooldownMs);
        if (reason) { this.db.exec('ROLLBACK'); return { reason }; }
        const lower = patch.username.toLowerCase();
        if (lower !== current.username_lower) {
          if (current.username_lower) this.db.prepare(`INSERT INTO username_history (username_lower,account_id,released_at) VALUES (?,?,?)
            ON CONFLICT(username_lower) DO UPDATE SET account_id=excluded.account_id,released_at=excluded.released_at`)
            .run(current.username_lower, accountId, time);
          this.db.prepare('DELETE FROM username_history WHERE username_lower = ? AND account_id = ?').run(lower, accountId);
          this.db.prepare('UPDATE accounts SET username = ?,username_lower = ?,username_changed_at = ? WHERE id = ?')
            .run(patch.username, lower, time, accountId);
        } else this.db.prepare('UPDATE accounts SET username = ? WHERE id = ?').run(patch.username, accountId);
      }
      if (patch.displayName !== undefined) this.db.prepare('UPDATE accounts SET display_name = ? WHERE id = ?').run(patch.displayName, accountId);
      if (patch.avatar !== undefined) this.db.prepare('UPDATE accounts SET avatar_json = ? WHERE id = ?').run(JSON.stringify(patch.avatar), accountId);
      if (patch.privacy !== undefined) this.db.prepare('UPDATE accounts SET profile_json = ? WHERE id = ?').run(JSON.stringify(patch.privacy), accountId);
      this.db.exec('COMMIT');
      return { account: await this.getAccount(accountId) };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  async profileByUsername(username) {
    return this.db.prepare('SELECT * FROM accounts WHERE username_lower = ?').get(username.toLowerCase()) ?? null;
  }
  sharedLeagues(first, second) {
    return this.db.prepare(`SELECT l.id,l.name FROM leagues l JOIN league_members mine ON mine.league_id = l.id
      JOIN league_members theirs ON theirs.league_id = l.id WHERE mine.account_id = ? AND theirs.account_id = ?
      AND mine.left_at IS NULL AND theirs.left_at IS NULL AND l.archived_at IS NULL ORDER BY l.name,l.id`).all(first, second);
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
  async listAccountNights(accountId, includeOpen = false) {
    return this.db.prepare(`SELECT n.id AS night_id,n.room_code,n.started_at,n.ended_at,
      p.buy_in,p.cash_out,p.net,p.hands_played,p.hands_won,p.vpip_hands,p.pfr_hands,
      p.raises,p.calls,p.checks,p.folds,p.all_ins,p.showdowns,p.showdown_wins
      FROM night_players p JOIN nights n ON n.id = p.night_id
      WHERE p.account_id = ? ${includeOpen ? '' : 'AND n.ended_at IS NOT NULL'}
      ORDER BY COALESCE(n.ended_at,n.updated_at) DESC,n.id DESC`).all(accountId);
  }
  async exportAccount(accountId) {
    return { account: await this.getAccount(accountId), googleIdentities: this.db.prepare('SELECT google_sub FROM google_identities WHERE account_id = ?').all(accountId).map(row => row.google_sub),
      settings: await this.getSettings(accountId), presets: await this.listPresets(accountId), nights: await this.listAccountNights(accountId, true) };
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
  async listPresets(accountId) {
    return this.db.prepare('SELECT id,name,settings_json,position,created_at FROM table_presets WHERE account_id = ? ORDER BY position,created_at,id').all(accountId)
      .map(row => ({ ...JSON.parse(row.settings_json), id: row.id, name: row.name, position: row.position, createdAt: row.created_at }));
  }
  async getPreset(accountId, id) {
    return (await this.listPresets(accountId)).find(item => item.id === id) ?? null;
  }
  async createPreset(accountId, id, preset, time) {
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM table_presets WHERE account_id = ?').get(accountId).n;
    if (count >= 10) return null;
    const position = this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM table_presets WHERE account_id = ?').get(accountId).n;
    this.db.prepare('INSERT INTO table_presets (id,account_id,name,settings_json,position,created_at) VALUES (?,?,?,?,?,?)')
      .run(id, accountId, preset.name, JSON.stringify(preset), position, time);
    return this.getPreset(accountId, id);
  }
  async updatePreset(accountId, id, preset, position) {
    const current = await this.getPreset(accountId, id);
    if (!current) return null;
    const next = preset || Object.fromEntries(['name', 'startingStack', 'smallBlind', 'bigBlind', 'blindMinutes', 'centsPer1000Chips', 'rebuyPolicy']
      .map(key => [key, current[key]]));
    this.db.prepare('UPDATE table_presets SET name = ?,settings_json = ?,position = ? WHERE account_id = ? AND id = ?')
      .run(next.name, JSON.stringify(next), position ?? current.position, accountId, id);
    return this.getPreset(accountId, id);
  }
  async deletePreset(accountId, id) {
    return this.db.prepare('DELETE FROM table_presets WHERE account_id = ? AND id = ?').run(accountId, id).changes > 0;
  }
  async deleteAccount(accountId, time = Date.now()) {
    this.db.exec('BEGIN');
    try {
      const identity = this.db.prepare('SELECT username_lower FROM accounts WHERE id = ?').get(accountId);
      if (identity?.username_lower) this.db.prepare(`INSERT INTO username_history (username_lower,account_id,released_at) VALUES (?,?,?)
        ON CONFLICT(username_lower) DO UPDATE SET account_id=excluded.account_id,released_at=excluded.released_at`)
        .run(identity.username_lower, accountId, time);
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
