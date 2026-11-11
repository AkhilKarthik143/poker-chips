import { randomUUID } from 'node:crypto';
import { avatarForAccount, privacyForAccount } from './identity.js';

export class FriendError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}

export class FriendsStore {
  constructor(db) { this.db = db; }
  account(id) { return this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) ?? null; }
  byUsername(username) { return this.db.prepare('SELECT * FROM accounts WHERE username_lower = ?').get(username.toLowerCase()) ?? null; }
  publicAccount(account, status) {
    const publicAvatar = privacyForAccount(account).profileVisibility !== 'private';
    return { username: account.username, displayName: account.display_name,
      avatar: publicAvatar ? avatarForAccount(account) : null, status };
  }
  pair(first, second) { return first < second ? [first, second] : [second, first]; }
  blocked(first, second) {
    return this.db.prepare('SELECT blocker_id FROM friend_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)')
      .all(first, second, second, first).map(row => row.blocker_id);
  }
  relation(first, second) {
    const [a, b] = this.pair(first, second);
    return this.db.prepare('SELECT * FROM friend_relations WHERE user_a = ? AND user_b = ?').get(a, b) ?? null;
  }
  status(first, second) {
    if (first === second) return 'self';
    const blocks = this.blocked(first, second);
    if (blocks.includes(first)) return 'blocked';
    if (blocks.length) return 'unavailable';
    const relation = this.relation(first, second);
    if (!relation) return 'not-friends';
    if (relation.status === 'friends') return 'friends';
    return relation.requester_id === first ? 'request-sent' : 'request-received';
  }
  peer(viewerId, targetId, { table = false } = {}) {
    const target = this.account(targetId);
    if (!target || !target.username || targetId === viewerId) return null;
    const status = this.status(viewerId, targetId);
    if (status === 'unavailable') return null;
    if (table) {
      const privacy = privacyForAccount(target);
      return { displayName: target.display_name, username: privacy.showUsernameAtTables ? target.username : null,
        avatar: privacy.showAvatarAtTables ? avatarForAccount(target) : null, status };
    }
    return this.publicAccount(target, status);
  }
  search(viewerId, query) {
    const rows = this.db.prepare(`SELECT * FROM accounts WHERE username_lower IS NOT NULL
      AND instr(username_lower, ?) = 1 AND id <> ? ORDER BY username_lower LIMIT 20`).all(query.toLowerCase(), viewerId);
    return rows.map(account => this.peer(viewerId, account.id)).filter(Boolean).slice(0, 10);
  }
  list(viewerId) {
    const rows = this.db.prepare(`SELECT r.*,a.* FROM friend_relations r JOIN accounts a
      ON a.id = CASE WHEN r.user_a = ? THEN r.user_b ELSE r.user_a END
      WHERE r.user_a = ? OR r.user_b = ? ORDER BY r.updated_at DESC,r.user_a,r.user_b`).all(viewerId, viewerId, viewerId);
    const result = { friends: [], incoming: [], outgoing: [], blocked: [] };
    for (const row of rows) {
      const status = row.status === 'friends' ? 'friends' : row.requester_id === viewerId ? 'request-sent' : 'request-received';
      const item = this.publicAccount(row, status);
      result[status === 'friends' ? 'friends' : status === 'request-sent' ? 'outgoing' : 'incoming'].push(item);
    }
    const blocked = this.db.prepare(`SELECT a.* FROM friend_blocks b JOIN accounts a ON a.id = b.blocked_id
      WHERE b.blocker_id = ? ORDER BY b.created_at DESC`).all(viewerId);
    result.blocked = blocked.map(account => this.publicAccount(account, 'blocked'));
    return result;
  }
  unread(viewerId) {
    return this.db.prepare('SELECT COUNT(*) AS count FROM friend_events WHERE account_id = ? AND read_at IS NULL').get(viewerId).count;
  }
  notifications(viewerId) {
    return this.db.prepare(`SELECT e.id,e.kind,e.created_at,a.username,a.display_name FROM friend_events e
      JOIN accounts a ON a.id = e.actor_id WHERE e.account_id = ? AND e.read_at IS NULL
      ORDER BY e.created_at DESC,e.id DESC LIMIT 20`).all(viewerId).map(row => ({ id: row.id,
      kind: row.kind, at: row.created_at, username: row.username, displayName: row.display_name }));
  }
  markRead(viewerId, time) {
    this.db.prepare('UPDATE friend_events SET read_at = ? WHERE account_id = ? AND read_at IS NULL').run(time, viewerId);
  }
  event(accountId, actorId, kind, time) {
    this.db.prepare('INSERT INTO friend_events (id,account_id,actor_id,kind,created_at) VALUES (?,?,?,?,?)')
      .run(randomUUID(), accountId, actorId, kind, time);
  }
  clearRequestEvent(recipientId, actorId) {
    this.db.prepare("DELETE FROM friend_events WHERE account_id = ? AND actor_id = ? AND kind = 'request'")
      .run(recipientId, actorId);
  }
  change(actorId, targetId, action, time) {
    if (!this.account(actorId) || !this.account(targetId)) throw new FriendError('User not found.', 404);
    if (actorId === targetId) throw new FriendError('You cannot add yourself.', 400);
    const [a, b] = this.pair(actorId, targetId);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      let status = this.status(actorId, targetId);
      if (action === 'block') {
        this.db.prepare('INSERT OR IGNORE INTO friend_blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)')
          .run(actorId, targetId, time);
        this.db.prepare('DELETE FROM friend_relations WHERE user_a = ? AND user_b = ?').run(a, b);
        this.db.prepare('DELETE FROM friend_events WHERE (account_id = ? AND actor_id = ?) OR (account_id = ? AND actor_id = ?)')
          .run(actorId, targetId, targetId, actorId);
        status = 'blocked';
      } else if (action === 'unblock') {
        if (status !== 'blocked') throw new FriendError('This user is not blocked.');
        this.db.prepare('DELETE FROM friend_blocks WHERE blocker_id = ? AND blocked_id = ?').run(actorId, targetId);
        status = this.status(actorId, targetId);
      } else {
        if (status === 'blocked' || status === 'unavailable') throw new FriendError('This user is unavailable.', 404);
        if (action === 'send') {
          if (status === 'not-friends') {
            this.db.prepare(`INSERT INTO friend_relations
              (user_a,user_b,requester_id,status,created_at,updated_at) VALUES (?,?,?,'pending',?,?)`)
              .run(a, b, actorId, time, time);
            this.event(targetId, actorId, 'request', time);
            status = 'request-sent';
          } else if (status === 'request-received') {
            this.db.prepare("UPDATE friend_relations SET status = 'friends',updated_at = ?,accepted_at = ? WHERE user_a = ? AND user_b = ?")
              .run(time, time, a, b);
            this.clearRequestEvent(actorId, targetId);
            this.event(targetId, actorId, 'accepted', time);
            status = 'friends';
          }
        } else if (action === 'accept' && status === 'request-received') {
          this.db.prepare("UPDATE friend_relations SET status = 'friends',updated_at = ?,accepted_at = ? WHERE user_a = ? AND user_b = ?")
            .run(time, time, a, b);
          this.clearRequestEvent(actorId, targetId);
          this.event(targetId, actorId, 'accepted', time);
          status = 'friends';
        } else if (action === 'decline' && status === 'request-received') {
          this.db.prepare('DELETE FROM friend_relations WHERE user_a = ? AND user_b = ?').run(a, b);
          this.clearRequestEvent(actorId, targetId);
          status = 'not-friends';
        } else if (action === 'cancel' && status === 'request-sent') {
          this.db.prepare('DELETE FROM friend_relations WHERE user_a = ? AND user_b = ?').run(a, b);
          this.clearRequestEvent(targetId, actorId);
          status = 'not-friends';
        } else if (action === 'remove' && status === 'friends') {
          this.db.prepare('DELETE FROM friend_relations WHERE user_a = ? AND user_b = ?').run(a, b);
          status = 'not-friends';
        } else if (!(action === 'send' && (status === 'request-sent' || status === 'friends'))) {
          throw new FriendError('Friend request state changed. Refresh and try again.');
        }
      }
      this.db.exec('COMMIT');
      return { status };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
