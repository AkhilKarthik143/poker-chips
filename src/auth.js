import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { normalizedName, validName } from './validation.js';

export const hashSecret = secret => createHash('sha256').update(secret).digest('hex');
export const normalizeEmail = value => {
  if (typeof value !== 'string') return null;
  const email = value.normalize('NFKC').trim().toLowerCase();
  return email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : null;
};
export function parseSessionCookie(header) {
  const part = String(header || '').split(';').map(value => value.trim()).find(value => value.startsWith('tm_session='));
  const token = part?.slice('tm_session='.length);
  return /^[a-f0-9]{64}$/.test(token || '') ? token : null;
}
export function createAuth({ store, mailer, now = Date.now }) {
  const displayNameFor = email => {
    const local = email.split('@')[0].replace(/[<>\p{Cc}\p{Cf}]/gu, '').slice(0, 20);
    return validName(local) ? normalizedName(local) : 'Player';
  };
  const sessionFor = async account => {
    const sessionToken = randomBytes(32).toString('hex');
    await store.saveSession(hashSecret(sessionToken), account.id, now() + 30 * 24 * 60 * 60_000);
    return { account, sessionToken };
  };
  return {
    async request(email, origin) {
      const token = randomBytes(32).toString('hex');
      await store.saveMagicLink(hashSecret(token), email, now() + 15 * 60_000);
      const link = `${origin}/verify.html?token=${token}`;
      await mailer.send(email, link);
      return link;
    },
    async verify(token) {
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
      const email = await store.consumeMagicLink(hashSecret(token), now());
      if (!email) return null;
      const account = await store.createAccount(randomUUID(), email, displayNameFor(email), now());
      return sessionFor(account);
    },
    async google(payload) {
      const email = normalizeEmail(payload?.email);
      if (!email || payload.email_verified !== true || typeof payload.sub !== 'string' ||
        !/^[A-Za-z0-9_-]{1,255}$/.test(payload.sub)) return null;
      const name = validName(payload.name) ? normalizedName(payload.name) : displayNameFor(email);
      const authoritative = email.endsWith('@gmail.com') || (typeof payload.hd === 'string' && payload.hd.length > 0);
      const account = await store.signInGoogle(payload.sub, email, name, authoritative, now());
      return account ? sessionFor(account) : { needsEmail: true };
    },
    async accountFromCookie(cookie) {
      const token = parseSessionCookie(cookie);
      if (!token) return null;
      const id = await store.getSession(hashSecret(token), now());
      return id ? store.getAccount(id) : null;
    },
    async logout(cookie) {
      const token = parseSessionCookie(cookie);
      if (token) await store.deleteSession(hashSecret(token));
    }
  };
}
