import { RequestError } from './validation.js';
import { avatarForAccount, privacyForAccount } from './identity.js';

const requireRow = (value, message = 'League item not found.') => { if (!value) throw new RequestError(message); return value; };
export class LeagueStore {
  constructor(db) { this.db = db; }
  async transaction(fn) { return (await this.db.transaction(fn)); }
  async get(id) { return (await this.db.prepare('SELECT * FROM leagues WHERE id = ? AND archived_at IS NULL').get(id)) ?? null; }
  async byInvite(code) { return (await this.db.prepare('SELECT * FROM leagues WHERE invite_code = ? AND archived_at IS NULL').get(code)) ?? null; }
  async member(leagueId, accountId) {
    return (await this.db.prepare('SELECT * FROM league_members WHERE league_id = ? AND account_id = ? AND left_at IS NULL').get(leagueId, accountId)) ?? null;
  }
  async roster(leagueId) {
    return (await this.db.prepare(`SELECT m.id AS memberId,COALESCE(a.display_name,m.display_name) AS displayName,
      m.role,m.joined_at AS joinedAt,m.left_at AS leftAt,m.account_id IS NULL AS former,
      a.username,a.id AS accountSeed,a.avatar_json AS avatarJson,a.profile_json AS profileJson
      FROM league_members m LEFT JOIN accounts a ON a.id = m.account_id WHERE m.league_id = ? ORDER BY m.joined_at,m.id`).all(leagueId))
      .map(({ accountSeed, avatarJson, profileJson, ...row }) => ({ ...row, former: Boolean(row.former),
        avatar: accountSeed && privacyForAccount({ profile_json: profileJson }).profileVisibility === 'leagues'
          ? avatarForAccount({ id: accountSeed, avatar_json: avatarJson }) : null }));
  }
  async mine(accountId) {
    return (await this.db.prepare(`SELECT l.id,l.name,m.role FROM leagues l JOIN league_members m ON m.league_id = l.id
      WHERE m.account_id = ? AND m.left_at IS NULL AND l.archived_at IS NULL ORDER BY l.name,l.id`).all(accountId));
  }
  async create({ id, name, inviteCode, settings, account, memberId, time }) {
    await this.transaction(async () => {
      (await this.db.prepare('INSERT INTO leagues (id,name,invite_code,table_settings_json,created_at) VALUES (?,?,?,?,?)')
        .run(id, name, inviteCode, JSON.stringify(settings), time));
      (await this.db.prepare('INSERT INTO league_members (id,league_id,account_id,display_name,role,joined_at) VALUES (?,?,?,?,?,?)')
        .run(memberId, id, account.id, account.display_name, 'commissioner', time));
    });
    return (await this.get(id));
  }
  async join(leagueId, account, memberId, time) {
    return this.transaction(async () => {
      const existing = await this.db.prepare('SELECT * FROM league_members WHERE league_id = ? AND account_id = ?').get(leagueId, account.id);
      if (existing && existing.left_at === null) return existing;
      const count = (await this.db.prepare('SELECT count(*) AS n FROM league_members WHERE league_id = ? AND left_at IS NULL').get(leagueId)).n;
      if (count >= 30) throw new RequestError('League roster is full.');
      if (existing) {
        await this.db.prepare(`UPDATE league_members SET left_at = NULL, role = 'member', display_name = ? WHERE id = ?`)
          .run(account.display_name, existing.id);
        return this.member(leagueId, account.id);
      }
      await this.db.prepare('INSERT INTO league_members (id,league_id,account_id,display_name,role,joined_at) VALUES (?,?,?,?,?,?)')
        .run(memberId, leagueId, account.id, account.display_name, 'member', time);
      return this.member(leagueId, account.id);
    });
  }
  async leave(member, time) {
    if (member.role === 'commissioner') throw new RequestError('Transfer commissioner before leaving.');
    (await this.db.prepare('UPDATE league_members SET left_at = ? WHERE id = ?').run(time, member.id));
  }
  async rotate(leagueId, code) { (await this.db.prepare('UPDATE leagues SET invite_code = ? WHERE id = ?').run(code, leagueId)); }
  async update(leagueId, name, settings) {
    (await this.db.prepare('UPDATE leagues SET name = ?, table_settings_json = ? WHERE id = ?').run(name, JSON.stringify(settings), leagueId));
    return (await this.get(leagueId));
  }
  async setRole(leagueId, memberId, role) {
    const target = requireRow((await this.db.prepare('SELECT * FROM league_members WHERE league_id = ? AND id = ? AND left_at IS NULL').get(leagueId, memberId)));
    if (target.role === 'commissioner') throw new RequestError('Transfer commissioner instead.');
    (await this.db.prepare('UPDATE league_members SET role = ? WHERE id = ?').run(role, target.id));
  }
  async remove(leagueId, memberId, time) {
    const target = requireRow((await this.db.prepare('SELECT * FROM league_members WHERE league_id = ? AND id = ? AND left_at IS NULL').get(leagueId, memberId)));
    if (target.role === 'commissioner') throw new RequestError('Commissioner cannot be removed.');
    (await this.db.prepare('UPDATE league_members SET left_at = ? WHERE id = ?').run(time, memberId));
  }
  async transfer(leagueId, commissionerId, targetId) {
    if (commissionerId === targetId) throw new RequestError('Choose another member.');
    const target = requireRow((await this.db.prepare('SELECT * FROM league_members WHERE league_id = ? AND id = ? AND left_at IS NULL').get(leagueId, targetId)));
    await this.transaction(async () => {
      (await this.db.prepare(`UPDATE league_members SET role = 'member' WHERE id = ?`).run(commissionerId));
      (await this.db.prepare(`UPDATE league_members SET role = 'commissioner' WHERE id = ?`).run(target.id));
    });
  }
  async seasons(leagueId) { return (await this.db.prepare('SELECT * FROM seasons WHERE league_id = ? ORDER BY created_at DESC,id DESC').all(leagueId)); }
  async season(leagueId, id) { return (await this.db.prepare('SELECT * FROM seasons WHERE league_id = ? AND id = ?').get(leagueId, id)) ?? null; }
  async activeSeason(leagueId) { return (await this.db.prepare(`SELECT * FROM seasons WHERE league_id = ? AND status = 'active'`).get(leagueId)) ?? null; }
  async createSeason(leagueId, id, name, scoring, time) {
    (await this.db.prepare(`INSERT INTO seasons (id,league_id,name,status,scoring_json,created_at) VALUES (?,?,?,'draft',?,?)`)
      .run(id, leagueId, name, JSON.stringify(scoring), time));
    return (await this.season(leagueId, id));
  }
  async updateSeason(leagueId, id, name, scoring) {
    const row = requireRow((await this.season(leagueId, id)));
    if (row.status !== 'draft') throw new RequestError('Season rules are locked.');
    (await this.db.prepare('UPDATE seasons SET name = ?, scoring_json = ? WHERE id = ?').run(name, JSON.stringify(scoring), id));
    return (await this.season(leagueId, id));
  }
  async activateSeason(leagueId, id, time) {
    const row = requireRow((await this.season(leagueId, id)));
    if (row.status !== 'draft' || (await this.activeSeason(leagueId))) throw new RequestError('Another season is active, or this season is not a draft.');
    (await this.db.prepare(`UPDATE seasons SET status = 'active', starts_at = ? WHERE id = ?`).run(time, id));
    return (await this.season(leagueId, id));
  }
  async closeSeason(leagueId, id, championId, time) {
    const row = requireRow((await this.season(leagueId, id)));
    if (row.status !== 'active') throw new RequestError('Only an active season can close.');
    (await this.db.prepare(`UPDATE seasons SET status = 'closed', champion_member_id = ?, ends_at = ? WHERE id = ?`)
      .run(championId, time, id));
    return (await this.season(leagueId, id));
  }
  async finalizeNight(nightId) {
    const night = (await this.db.prepare('SELECT id,league_id,season_id,ended_at FROM nights WHERE id = ?').get(nightId));
    if (!night?.league_id || !night.ended_at || !night.season_id) return;
    const season = (await this.season(night.league_id, night.season_id));
    if (season?.status === 'closed') return;
    const rows = (await this.db.prepare(`SELECT p.account_id,p.net,p.buy_in,m.id AS member_id
      FROM night_players p JOIN league_members m ON m.account_id = p.account_id AND m.league_id = ?
      WHERE p.night_id = ? AND p.account_id IS NOT NULL ORDER BY p.net DESC,m.id`).all(night.league_id, nightId));
    await this.transaction(async () => {
      (await this.db.prepare('DELETE FROM league_night_results WHERE night_id = ?').run(nightId));
      if (rows.length < 2) return;
      const insert = this.db.prepare('INSERT INTO league_night_results (night_id,league_id,season_id,member_id,rank,net,buy_in) VALUES (?,?,?,?,?,?,?)');
      for (const row of rows) {
        const rank = rows.findIndex(other => other.net === row.net) + 1;
        await insert.run(nightId, night.league_id, night.season_id, row.member_id, rank, row.net, row.buy_in);
      }
    });
  }
  async results(leagueId, seasonId = null) {
    const query = `SELECT r.night_id AS nightId,r.member_id AS memberId,COALESCE(a.display_name,m.display_name) AS displayName,
      r.rank,r.net,r.buy_in AS buyIn,n.ended_at AS endedAt,n.counts,
      m.account_id IS NULL AS former,a.username,a.id AS accountSeed,a.avatar_json AS avatarJson,a.profile_json AS profileJson
      FROM league_night_results r JOIN nights n ON n.id = r.night_id
      JOIN league_members m ON m.id = r.member_id LEFT JOIN accounts a ON a.id = m.account_id
      WHERE r.league_id = ? ${seasonId ? 'AND r.season_id = ?' : ''}
      ORDER BY n.ended_at,r.rank,m.display_name`;
    return (await this.db.prepare(query).all(...(seasonId ? [leagueId, seasonId] : [leagueId])))
      .map(({ accountSeed, avatarJson, profileJson, ...row }) => ({ ...row, counts: Boolean(row.counts), former: Boolean(row.former),
        avatar: accountSeed && privacyForAccount({ profile_json: profileJson }).profileVisibility === 'leagues'
          ? avatarForAccount({ id: accountSeed, avatar_json: avatarJson }) : null }));
  }
  async nights(leagueId, seasonId = null) {
    const rows = (await this.db.prepare(`SELECT n.id,n.room_code AS roomCode,n.ended_at AS endedAt,n.hands,n.counts,n.season_id AS seasonId,
      (SELECT a.detail_json FROM league_audit a WHERE a.night_id = n.id AND a.action = 'void'
        ORDER BY a.at DESC,a.id DESC LIMIT 1) AS voidDetail
      FROM nights n WHERE n.league_id = ? AND n.ended_at IS NOT NULL ${seasonId ? 'AND n.season_id = ?' : ''}
      ORDER BY ended_at DESC,id DESC`).all(...(seasonId ? [leagueId, seasonId] : [leagueId])));
    return Promise.all(rows.map(async row => {
      const { voidDetail, ...night } = row;
      return { ...night, counts: Boolean(row.counts), voidReason: row.counts ? null : JSON.parse(voidDetail || '{}').reason || null,
        results: (await this.results(leagueId, row.seasonId)).filter(result => result.nightId === row.id),
        participants: (await this.db.prepare('SELECT name,net,buy_in AS buyIn FROM night_players WHERE night_id = ? ORDER BY name').all(row.id)) };
    }));
  }
  async reviewNight(leagueId, nightId, counts, actorMemberId, reason, time, auditId) {
    const night = requireRow((await this.db.prepare('SELECT * FROM nights WHERE league_id = ? AND id = ? AND ended_at IS NOT NULL').get(leagueId, nightId)), 'Night not found.');
    const season = night.season_id && (await this.season(leagueId, night.season_id));
    if (!season || season.status !== 'active') throw new RequestError('Only active-season nights can be reviewed.');
    await this.transaction(async () => {
      (await this.db.prepare('UPDATE nights SET counts = ? WHERE id = ?').run(Number(counts), nightId));
      (await this.db.prepare('INSERT INTO league_audit (id,league_id,season_id,night_id,actor_member_id,action,detail_json,at) VALUES (?,?,?,?,?,?,?,?)')
        .run(auditId, leagueId, season.id, nightId, actorMemberId, counts ? 'restore' : 'void', JSON.stringify({ reason }), time));
    });
  }
  async audit(leagueId, limit = 50, offset = 0) {
    return (await this.db.prepare(`SELECT a.id,a.season_id AS seasonId,a.night_id AS nightId,m.display_name AS actor,
      a.action,a.detail_json AS detail,a.at FROM league_audit a JOIN league_members m ON m.id = a.actor_member_id
      WHERE a.league_id = ? ORDER BY a.at DESC,a.id DESC LIMIT ? OFFSET ?`).all(leagueId, limit, offset))
      .map(row => ({ ...row, detail: JSON.parse(row.detail) }));
  }
}
