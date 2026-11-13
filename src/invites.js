export const validFriendShareId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
export const validLeagueInvite = value => typeof value === 'string' && /^[A-HJ-NP-Z]{8}$/.test(value);

// Only invite destinations may survive authentication. Never accept a URL, a
// protocol-relative path, encoded slashes, or a second redirect parameter.
export function safeInviteReturn(value) {
  if (typeof value !== 'string' || value.length > 150 || !value.startsWith('/invite.html?') || /[\\#\r\n]/.test(value)) return null;
  const query = value.slice('/invite.html?'.length);
  const parts = query.split('&');
  if (parts.length !== 1) return null;
  const fields = parts[0].split('=');
  if (fields.length !== 2) return null;
  const [key, token] = fields;
  if (key === 'friend' && validFriendShareId(token)) return value;
  if (key === 'league' && validLeagueInvite(token)) return value;
  return null;
}
