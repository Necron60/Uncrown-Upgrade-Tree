// Signed session cookie for Discord login. Adapted from the verify panel (DiscordVerify/web),
// minus its owner allowlist: anybody with a Discord account may sign in and keep a cloud save.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const MaxAgeSeconds = 30 * 24 * 60 * 60;
const SessionCookie = 'uncrown_session';
const StateCookie = 'uncrown_state';

// No secret means no signing key, and an HMAC keyed on the empty string is one anybody can forge.
function secret() {
  const value = (process.env.SESSION_SECRET ?? '').trim();
  if (value.length < 32) throw new Error('SESSION_SECRET is missing or shorter than 32 characters');
  return value;
}

const b64 = (input) => Buffer.from(input).toString('base64url');
const sign = (payload) => createHmac('sha256', secret()).update(payload).digest('base64url');

function signatureMatches(payload, given) {
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(given ?? '');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function seal(user, now = Date.now()) {
  const payload = b64(JSON.stringify({ ...user, exp: Math.floor(now / 1000) + MaxAgeSeconds }));
  return `${payload}.${sign(payload)}`;
}

/** The user in a session token, or null for anything not certain: bad shape, bad signature, expired. */
export function unseal(token, now = Date.now()) {
  const [payload, signature] = (token ?? '').split('.');
  if (!payload || !signature || !signatureMatches(payload, signature)) return null;
  let user;
  try {
    user = JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return null;
  }
  if (!/^\d{5,25}$/.test(user?.id ?? '') || !Number.isFinite(user.exp) || user.exp < Math.floor(now / 1000)) return null;
  return user;
}

export function cookies(req) {
  const jar = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0) jar[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
  }
  return jar;
}

function setCookie(res, name, value, maxAge) {
  const previous = res.getHeader('Set-Cookie');
  const cookie = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
  res.setHeader('Set-Cookie', previous ? [...[previous].flat(), cookie] : [cookie]);
}

export const setSession = (res, user) => setCookie(res, SessionCookie, seal(user), MaxAgeSeconds);
export const clearSession = (res) => setCookie(res, SessionCookie, '', 0);

// SameSite=Lax so it survives the redirect back from Discord, a top-level GET; Strict would drop it.
export function newState(res) {
  const state = randomBytes(16).toString('hex');
  setCookie(res, StateCookie, state, 600);
  return state;
}

export function takeState(req, res) {
  const state = cookies(req)[StateCookie];
  setCookie(res, StateCookie, '', 0);
  return state;
}

export const sessionOf = (req) => unseal(cookies(req)[SessionCookie]);

/** Every protected route starts here. Answers the 401 itself, so forgetting to check fails closed. */
export function requireSession(req, res) {
  const user = sessionOf(req);
  if (!user) res.status(401).json({ error: 'not signed in' });
  return user;
}

// Vercel terminates TLS in front of the function. PUBLIC_URL pins the OAuth redirect to the
// production domain, so preview deployments still come back to an address Discord knows.
export function origin(req) {
  const configured = (process.env.PUBLIC_URL ?? '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  return `https://${req.headers['x-forwarded-host'] ?? req.headers.host}`;
}

export const redirectUri = (req) => `${origin(req)}/api/callback`;
