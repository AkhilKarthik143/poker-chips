import { mkdirSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { Database } from './database.js';

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
const friendsMigration = `
  CREATE TABLE friend_relations (
    user_a TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    user_b TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    requester_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('pending','friends')),
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, accepted_at INTEGER,
    PRIMARY KEY(user_a,user_b), CHECK(user_a < user_b),
    CHECK(requester_id = user_a OR requester_id = user_b)
  );
  CREATE INDEX friend_relations_b ON friend_relations(user_b,status);
  CREATE TABLE friend_blocks (
    blocker_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    blocked_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL, PRIMARY KEY(blocker_id,blocked_id), CHECK(blocker_id <> blocked_id)
  );
  CREATE INDEX friend_blocks_target ON friend_blocks(blocked_id);
  CREATE TABLE friend_events (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('request','accepted')),
    created_at INTEGER NOT NULL, read_at INTEGER
  );
  CREATE INDEX friend_events_inbox ON friend_events(account_id,read_at,created_at);
`;
const photoMigration = `
  CREATE TABLE avatar_photos (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    photo_key TEXT NOT NULL UNIQUE,
    image_webp BLOB NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;
const inviteMigration = `
  ALTER TABLE accounts ADD COLUMN share_id TEXT;
  CREATE UNIQUE INDEX accounts_share_id ON accounts(share_id);
`;

export class SqliteStore {
  constructor(path, authToken) {
    const remote = typeof path === 'string' && /^(libsql|https):\/\//.test(path);
    if (!remote && path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database({ url: remote ? path : path === ':memory:' ? 'file::memory:' : `file:${path}`, authToken });
    this.enabled = true;
    this.ready = this.migrate();
    // The promise is also awaited by init(); attach a handler so a failed
    // remote connection cannot become an unhandled rejection before listen().
    this.ready.catch(() => {});
  }
  async migrate() {
    await this.db.prepare('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)').run();
    await this.db.prepare('INSERT INTO schema_version (version) SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM schema_version)').run();
    const migrations = [migration, accountsMigration, leagueMigration, settingsMigration, presetsMigration,
      googleIdentityMigration, identityMigration, friendsMigration, photoMigration, inviteMigration];
    for (let index = 0; index < migrations.length; index++) {
      await this.db.transaction(async () => {
        const version = (await this.db.prepare('SELECT version FROM schema_version').get()).version;
        if (version >= index + 1) return;
        if (version !== index) throw new Error(`Unsupported database schema version ${version}.`);
        for (const statement of migrations[index].split(';').map(part => part.trim()).filter(Boolean)) {
          await this.db.prepare(statement).run();
        }
        await this.db.prepare('UPDATE schema_version SET version = ?').run(index + 1);
      });
    }
  }
  async init() { await this.ready; await this.db.prepare('SELECT 1').get(); }
  async ping() { await this.ready; await this.db.prepare('SELECT 1').get(); }
  async saveNight(snapshot) { await this.ready;
    return (await this.db.transaction(async () => {
      (await this.db.prepare(`INSERT INTO nights
        (id, room_code, group_id, started_at, updated_at, ended_at, hands, settings_json, settlement_json, league_id, season_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,
          ended_at=COALESCE(excluded.ended_at,nights.ended_at),
          hands=excluded.hands, settings_json=excluded.settings_json, settlement_json=excluded.settlement_json,
          league_id=COALESCE(excluded.league_id,nights.league_id), season_id=COALESCE(excluded.season_id,nights.season_id)`)
        .run(snapshot.nightId, snapshot.roomCode, snapshot.groupId ?? null, snapshot.startedAt,
          snapshot.updatedAt, snapshot.endedAt ?? null, snapshot.hands, JSON.stringify(snapshot.settings), JSON.stringify(snapshot.settlement),
          snapshot.leagueId ?? null, snapshot.seasonId ?? null));
      const insert = this.db.prepare(`INSERT INTO night_players
        (night_id,seat_id,name,account_id,claim_hash,buy_in,cash_out,net,hands_played,hands_won,
          vpip_hands,pfr_hands,raises,calls,checks,folds,all_ins,showdowns,showdown_wins)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(night_id,seat_id) DO UPDATE SET name=excluded.name,
          account_id=COALESCE(night_players.account_id,excluded.account_id),
          claim_hash=COALESCE(night_players.claim_hash,excluded.claim_hash),buy_in=excluded.buy_in,cash_out=excluded.cash_out,net=excluded.net,
          hands_played=excluded.hands_played,hands_won=excluded.hands_won,vpip_hands=excluded.vpip_hands,
          pfr_hands=excluded.pfr_hands,raises=excluded.raises,calls=excluded.calls,checks=excluded.checks,
          folds=excluded.folds,all_ins=excluded.all_ins,showdowns=excluded.showdowns,showdown_wins=excluded.showdown_wins`);
      for (const p of snapshot.players) (await insert.run(snapshot.nightId, p.id, p.name, p.accountId ?? null,
        p.claimHash, p.buyIn, p.cashOut, p.net, p.handsPlayed, p.handsWon, p.vpipHands, p.pfrHands,
        p.raises, p.calls, p.checks, p.folds, p.allIns, p.showdowns, p.showdownWins));
    }));
  }
  async getNight(nightId) { await this.ready;
    const night = (await this.db.prepare('SELECT * FROM nights WHERE id = ?').get(nightId));
    if (!night) return null;
    return { ...night, players: (await this.db.prepare('SELECT * FROM night_players WHERE night_id = ? ORDER BY seat_id').all(nightId)) };
  }
  async saveMagicLink(tokenHash, email, expiresAt) { await this.ready;
    (await this.db.prepare('INSERT INTO magic_links (token_hash,email,expires_at) VALUES (?,?,?)').run(tokenHash, email, expiresAt));
  }
  async consumeMagicLink(tokenHash, time) { await this.ready;
    const row = (await this.db.prepare('DELETE FROM magic_links WHERE token_hash = ? RETURNING email, expires_at').get(tokenHash));
    return row && row.expires_at > time ? row.email : null;
  }
  async getAccountByEmail(email) { await this.ready; return (await this.db.prepare('SELECT * FROM accounts WHERE email = ?').get(email)) ?? null; }
  async getAccount(id) { await this.ready; return (await this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id)) ?? null; }
  async friendShareId(id) { await this.ready;
    const candidate = randomBytes(16).toString('hex');
    await this.db.prepare('UPDATE accounts SET share_id = ? WHERE id = ? AND share_id IS NULL').run(candidate, id);
    return (await this.getAccount(id))?.share_id ?? null;
  }
  async uniqueDisplayName(name) { await this.ready;
    const taken = this.db.prepare('SELECT 1 FROM accounts WHERE display_name = ? COLLATE NOCASE LIMIT 1');
    if (!(await taken.get(name))) return name;
    for (let number = 2; number < Number.MAX_SAFE_INTEGER; number++) {
      const suffix = ` ${number}`;
      const candidate = `${name.slice(0, 20 - suffix.length).trimEnd()}${suffix}`;
      if (!(await taken.get(candidate))) return candidate;
    }
    throw new Error('No display name is available.');
  }
  async createAccount(id, email, displayName, time) { await this.ready;
    return this.db.transaction(async () => {
      const existing = await this.getAccountByEmail(email);
      if (existing) return existing;
      await this.db.prepare('INSERT INTO accounts (id,email,display_name,created_at) VALUES (?,?,?,?) ON CONFLICT(email) DO NOTHING')
        .run(id, email, await this.uniqueDisplayName(displayName), time);
      return this.getAccountByEmail(email);
    });
  }
  async signInGoogle(sub, email, displayName, authoritative, time) { await this.ready;
    return (await this.db.transaction(async () => {
      let account = (await this.db.prepare(`SELECT a.* FROM google_identities g
        JOIN accounts a ON a.id = g.account_id WHERE g.google_sub = ?`).get(sub));
      if (!account) {
        account = (await this.db.prepare('SELECT * FROM accounts WHERE email = ?').get(email));
        if (account && !authoritative) { return null; }
        if (!account) {
          const id = randomUUID();
          (await this.db.prepare('INSERT INTO accounts (id,email,display_name,created_at) VALUES (?,?,?,?)')
            .run(id, email, (await this.uniqueDisplayName(displayName)), time));
          account = (await this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id));
        }
        (await this.db.prepare('INSERT INTO google_identities (google_sub,account_id) VALUES (?,?)').run(sub, account.id));
      }
      return account;
    }));
  }
  async updateAccount(id, displayName) { await this.ready;
    (await this.db.prepare('UPDATE accounts SET display_name = ? WHERE id = ?').run(displayName, id));
    return (await this.getAccount(id));
  }
  async usernameAvailability(accountId, username, time, cooldownMs) { await this.ready;
    const lower = username.toLowerCase();
    const account = (await this.db.prepare('SELECT username_lower,username_changed_at FROM accounts WHERE id = ?').get(accountId));
    if (!account) return 'taken';
    if (account.username_lower === lower) return null;
    const owner = (await this.db.prepare('SELECT id FROM accounts WHERE username_lower = ?').get(lower));
    if (owner && owner.id !== accountId) return 'taken';
    const held = (await this.db.prepare('SELECT account_id,released_at FROM username_history WHERE username_lower = ?').get(lower));
    if (held && held.account_id !== accountId && time - held.released_at < cooldownMs) return 'held';
    if (account.username_changed_at !== null && time - account.username_changed_at < cooldownMs && held?.account_id !== accountId) return 'cooldown';
    return null;
  }
  async updateProfile(accountId, patch, time, cooldownMs) { await this.ready;
    return (await this.db.transaction(async () => {
      const current = (await this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId));
      if (!current) throw new Error('Account not found.');
      if (patch.username !== undefined) {
        const reason = (await this.usernameAvailability(accountId, patch.username, time, cooldownMs));
        if (reason) { return { reason }; }
        const lower = patch.username.toLowerCase();
        if (lower !== current.username_lower) {
          if (current.username_lower) (await this.db.prepare(`INSERT INTO username_history (username_lower,account_id,released_at) VALUES (?,?,?)
            ON CONFLICT(username_lower) DO UPDATE SET account_id=excluded.account_id,released_at=excluded.released_at`)
            .run(current.username_lower, accountId, time));
          (await this.db.prepare('DELETE FROM username_history WHERE username_lower = ? AND account_id = ?').run(lower, accountId));
          (await this.db.prepare('UPDATE accounts SET username = ?,username_lower = ?,username_changed_at = ? WHERE id = ?')
            .run(patch.username, lower, time, accountId));
        } else (await this.db.prepare('UPDATE accounts SET username = ? WHERE id = ?').run(patch.username, accountId));
      }
      if (patch.displayName !== undefined) (await this.db.prepare('UPDATE accounts SET display_name = ? WHERE id = ?').run(patch.displayName, accountId));
      if (patch.avatar !== undefined) {
        (await this.db.prepare('DELETE FROM avatar_photos WHERE account_id = ?').run(accountId));
        (await this.db.prepare('UPDATE accounts SET avatar_json = ? WHERE id = ?').run(JSON.stringify(patch.avatar), accountId));
      }
      if (patch.privacy !== undefined) (await this.db.prepare('UPDATE accounts SET profile_json = ? WHERE id = ?').run(JSON.stringify(patch.privacy), accountId));
      return { account: await this.getAccount(accountId) };
    }));
  }
  async setAvatarPhoto(accountId, key, image, time) { await this.ready;
    return (await this.db.transaction(async () => {
      (await this.db.prepare(`INSERT INTO avatar_photos (account_id,photo_key,image_webp,updated_at) VALUES (?,?,?,?)
        ON CONFLICT(account_id) DO UPDATE SET photo_key=excluded.photo_key,image_webp=excluded.image_webp,updated_at=excluded.updated_at`)
        .run(accountId, key, image, time));
      (await this.db.prepare('UPDATE accounts SET avatar_json = ? WHERE id = ?').run(JSON.stringify({ v: 3, key }), accountId));
      return (await this.getAccount(accountId));
    }));
  }
  async getAvatarPhoto(key) { await this.ready;
    const row = (await this.db.prepare('SELECT image_webp FROM avatar_photos WHERE photo_key = ?').get(key));
    return row ? Buffer.from(row.image_webp) : null;
  }
  async profileByUsername(username) { await this.ready;
    return (await this.db.prepare('SELECT * FROM accounts WHERE username_lower = ?').get(username.toLowerCase())) ?? null;
  }
  async sharedLeagues(first, second) { await this.ready;
    return (await this.db.prepare(`SELECT l.id,l.name FROM leagues l JOIN league_members mine ON mine.league_id = l.id
      JOIN league_members theirs ON theirs.league_id = l.id WHERE mine.account_id = ? AND theirs.account_id = ?
      AND mine.left_at IS NULL AND theirs.left_at IS NULL AND l.archived_at IS NULL ORDER BY l.name,l.id`).all(first, second));
  }
  async saveSession(tokenHash, accountId, expiresAt) { await this.ready;
    (await this.db.prepare('INSERT INTO sessions (token_hash,account_id,expires_at) VALUES (?,?,?)').run(tokenHash, accountId, expiresAt));
  }
  async getSession(tokenHash, time) { await this.ready;
    const row = (await this.db.prepare('SELECT account_id FROM sessions WHERE token_hash = ? AND expires_at > ?').get(tokenHash, time));
    return row?.account_id ?? null;
  }
  async deleteSession(tokenHash) { await this.ready; (await this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)); }
  async claimNight(nightId, tokenHash, accountId) { await this.ready;
    const result = (await this.db.prepare(`UPDATE night_players SET account_id = ?
      WHERE night_id = ? AND claim_hash = ? AND account_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM night_players owned
          WHERE owned.night_id = night_players.night_id AND owned.account_id = ?)`).run(accountId, nightId, tokenHash, accountId));
    return result.changes;
  }
  async listAccountNights(accountId, includeOpen = false) { await this.ready;
    return (await this.db.prepare(`SELECT n.id AS night_id,n.room_code,n.started_at,n.ended_at,
      p.buy_in,p.cash_out,p.net,p.hands_played,p.hands_won,p.vpip_hands,p.pfr_hands,
      p.raises,p.calls,p.checks,p.folds,p.all_ins,p.showdowns,p.showdown_wins
      FROM night_players p JOIN nights n ON n.id = p.night_id
      WHERE p.account_id = ? ${includeOpen ? '' : 'AND n.ended_at IS NOT NULL'}
        AND COALESCE(n.counts,1) = 1
      ORDER BY COALESCE(n.ended_at,n.updated_at) DESC,n.id DESC`).all(accountId));
  }
  async listCurrentAccountNights(accountId) { await this.ready;
    return (await this.db.prepare(`SELECT n.id AS night_id,n.room_code,n.started_at,n.updated_at,n.ended_at,
      p.buy_in,p.cash_out,p.net,p.hands_played,p.hands_won,p.vpip_hands,p.pfr_hands,
      p.raises,p.calls,p.checks,p.folds,p.all_ins,p.showdowns,p.showdown_wins
      FROM night_players p JOIN nights n ON n.id = p.night_id
      WHERE p.account_id = ? AND n.ended_at IS NULL AND n.hands > 0 AND COALESCE(n.counts,1) = 1
        AND n.id = (SELECT active.id FROM nights active JOIN night_players active_player
          ON active_player.night_id = active.id
          WHERE active_player.account_id = ? AND active.ended_at IS NULL AND active.hands > 0 AND COALESCE(active.counts,1) = 1
          ORDER BY active.updated_at DESC,active.id DESC LIMIT 1)
      ORDER BY p.seat_id`).all(accountId, accountId));
  }
  async exportAccount(accountId) { await this.ready;
    const photo = (await this.db.prepare('SELECT image_webp FROM avatar_photos WHERE account_id = ?').get(accountId));
    return { account: await this.getAccount(accountId), avatarPhoto: photo ? { mimeType: 'image/webp', base64: Buffer.from(photo.image_webp).toString('base64') } : null,
      googleIdentities: (await this.db.prepare('SELECT google_sub FROM google_identities WHERE account_id = ?').all(accountId)).map(row => row.google_sub),
      settings: await this.getSettings(accountId), presets: await this.listPresets(accountId), nights: await this.listAccountNights(accountId, true),
      friendships: (await this.db.prepare(`SELECT a.username,r.status,r.created_at,r.accepted_at,
        (r.requester_id = ?) AS sent_by_me FROM friend_relations r JOIN accounts a
        ON a.id = CASE WHEN r.user_a = ? THEN r.user_b ELSE r.user_a END
        WHERE r.user_a = ? OR r.user_b = ?`).all(accountId, accountId, accountId, accountId)),
      blockedUsers: (await this.db.prepare(`SELECT a.username,b.created_at FROM friend_blocks b
        JOIN accounts a ON a.id = b.blocked_id WHERE b.blocker_id = ?`).all(accountId)),
      friendUpdates: (await this.db.prepare(`SELECT a.username,e.kind,e.created_at,e.read_at FROM friend_events e
        JOIN accounts a ON a.id = e.actor_id WHERE e.account_id = ? ORDER BY e.created_at DESC`).all(accountId)) };
  }
  async getSettings(accountId) { await this.ready;
    const row = (await this.db.prepare('SELECT settings_json FROM account_settings WHERE account_id = ?').get(accountId));
    return row ? JSON.parse(row.settings_json) : null;
  }
  async saveSettings(accountId, settings, time) { await this.ready;
    (await this.db.prepare(`INSERT INTO account_settings (account_id,settings_json,updated_at) VALUES (?,?,?)
      ON CONFLICT(account_id) DO UPDATE SET settings_json=excluded.settings_json,updated_at=excluded.updated_at`)
      .run(accountId, JSON.stringify(settings), time));
    return settings;
  }
  async listPresets(accountId) { await this.ready;
    return (await this.db.prepare('SELECT id,name,settings_json,position,created_at FROM table_presets WHERE account_id = ? ORDER BY position,created_at,id').all(accountId))
      .map(row => ({ ...JSON.parse(row.settings_json), id: row.id, name: row.name, position: row.position, createdAt: row.created_at }));
  }
  async getPreset(accountId, id) { await this.ready;
    return (await this.listPresets(accountId)).find(item => item.id === id) ?? null;
  }
  async createPreset(accountId, id, preset, time) { await this.ready;
    return this.db.transaction(async () => {
      const count = (await this.db.prepare('SELECT COUNT(*) AS n FROM table_presets WHERE account_id = ?').get(accountId)).n;
      if (count >= 10) return null;
      const position = (await this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM table_presets WHERE account_id = ?').get(accountId)).n;
      await this.db.prepare('INSERT INTO table_presets (id,account_id,name,settings_json,position,created_at) VALUES (?,?,?,?,?,?)')
        .run(id, accountId, preset.name, JSON.stringify(preset), position, time);
      return this.getPreset(accountId, id);
    });
  }
  async updatePreset(accountId, id, preset, position) { await this.ready;
    const current = await this.getPreset(accountId, id);
    if (!current) return null;
    const next = preset || Object.fromEntries(['name', 'startingStack', 'smallBlind', 'bigBlind', 'blindMinutes', 'centsPer1000Chips', 'rebuyPolicy']
      .map(key => [key, current[key]]));
    (await this.db.prepare('UPDATE table_presets SET name = ?,settings_json = ?,position = ? WHERE account_id = ? AND id = ?')
      .run(next.name, JSON.stringify(next), position ?? current.position, accountId, id));
    return (await this.getPreset(accountId, id));
  }
  async deletePreset(accountId, id) { await this.ready;
    return (await this.db.prepare('DELETE FROM table_presets WHERE account_id = ? AND id = ?').run(accountId, id)).changes > 0;
  }
  async deleteAccount(accountId, time = Date.now()) { await this.ready;
    return (await this.db.transaction(async () => {
      const identity = (await this.db.prepare('SELECT username_lower FROM accounts WHERE id = ?').get(accountId));
      if (identity?.username_lower) (await this.db.prepare(`INSERT INTO username_history (username_lower,account_id,released_at) VALUES (?,?,?)
        ON CONFLICT(username_lower) DO UPDATE SET account_id=excluded.account_id,released_at=excluded.released_at`)
        .run(identity.username_lower, accountId, time));
      const owned = (await this.db.prepare(`SELECT league_id,id FROM league_members WHERE account_id = ? AND role = 'commissioner' AND left_at IS NULL`).all(accountId));
      for (const owner of owned) {
        const successor = (await this.db.prepare(`SELECT id FROM league_members WHERE league_id = ? AND id <> ? AND left_at IS NULL
          ORDER BY (role = 'co') DESC,joined_at,id LIMIT 1`).get(owner.league_id, owner.id));
        if (successor) {
          (await this.db.prepare(`UPDATE league_members SET role = 'member' WHERE id = ?`).run(owner.id));
          (await this.db.prepare(`UPDATE league_members SET role = 'commissioner' WHERE id = ?`).run(successor.id));
        } else (await this.db.prepare('UPDATE leagues SET archived_at = ? WHERE id = ?').run(Date.now(), owner.league_id));
      }
      (await this.db.prepare('UPDATE night_players SET account_id = NULL WHERE account_id = ?').run(accountId));
      (await this.db.prepare(`UPDATE league_members SET account_id = NULL, display_name = 'Former member',
        left_at = COALESCE(left_at, ?) WHERE account_id = ?`).run(Date.now(), accountId));
      (await this.db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId));
    }));
  }
  async close() { this.db.close(); }
}
