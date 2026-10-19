// Who is using the editor?
//
// When Folio runs on the same domain as Immich (the normal setup), the browser
// already sends Immich's own session cookie, so editors are signed in with the
// account they use in Immich. As a fallback (e.g. local testing on another port)
// a user can paste an Immich API key, which is kept in an HttpOnly cookie.
import crypto from 'node:crypto';
import { HttpError, parseCookies } from './http.js';
import { getMe, ImmichError } from './immich.js';
import { secret } from './store.js';

export const KEY_COOKIE = 'folio_api_key';
const cache = new Map();
const TTL = 60_000;

function credentials(req) {
  const cookies = parseCookies(req.headers.cookie);
  const out = [];
  if (cookies.immich_access_token) out.push({ cookie: `immich_access_token=${cookies.immich_access_token}` });
  if (cookies[KEY_COOKIE]) out.push({ 'x-api-key': cookies[KEY_COOKIE] });
  return out;
}

export async function resolveUser(headers) {
  const id = crypto.createHash('sha256').update(JSON.stringify(headers)).digest('hex');
  const hit = cache.get(id);
  if (hit && hit.expires > Date.now()) return hit.value;
  try {
    const me = await getMe({ headers });
    const value = { user: { id: me.id, name: me.name || me.email, email: me.email, isAdmin: me.isAdmin }, headers };
    cache.set(id, { value, expires: Date.now() + TTL });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return value;
  } catch (err) {
    if (err instanceof ImmichError && (err.status === 401 || err.status === 403)) return null;
    throw err;
  }
}

export async function getAuth(req) {
  for (const headers of credentials(req)) {
    const auth = await resolveUser(headers);
    if (auth) return auth;
  }
  return null;
}

export async function requireAuth(req) {
  const auth = await getAuth(req);
  if (!auth) throw new HttpError(401, 'Sign in to Immich to manage pages.');
  return auth;
}

// ---- page passwords ----------------------------------------------------------

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return { salt, hash, version: crypto.randomBytes(4).toString('hex') };
}

export function checkPassword(record, password) {
  if (!record || typeof password !== 'string') return false;
  const hash = crypto.scryptSync(password, record.salt, 32);
  return crypto.timingSafeEqual(hash, Buffer.from(record.hash, 'hex'));
}

// The unlock cookie is bound to the page and to the current password version,
// so changing the password signs every visitor out.
export const unlockCookieName = (pageId) => `folio_unlock_${pageId}`;
export const unlockToken = (pageId, record) =>
  crypto.createHmac('sha256', secret()).update(`${pageId}:${record.version}`).digest('base64url');

export function isUnlocked(req, page) {
  if (!page.password) return true;
  const token = parseCookies(req.headers.cookie)[unlockCookieName(page.id)];
  if (!token) return false;
  const expected = Buffer.from(unlockToken(page.id, page.password));
  const given = Buffer.from(token);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
