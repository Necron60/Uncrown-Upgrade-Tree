import { redirectUri, setSession, takeState } from './_session.js';

async function discord(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

// Every failure lands back in the game with a reason, which it shows as a toast.
const deny = (res, reason) => res.redirect(302, `/?error=${encodeURIComponent(reason)}`);

export default async function handler(req, res) {
  const { code, state, error } = req.query;
  const expected = takeState(req, res);
  if (error) return deny(res, String(error) === 'access_denied' ? 'sign-in was cancelled' : String(error));
  // the state cookie is set by /api/login and cleared here: a callback without a match did not start here
  if (!code || !state || !expected || state !== expected) return deny(res, 'sign-in expired, try again');

  try {
    const token = await discord('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID ?? '',
        client_secret: process.env.DISCORD_CLIENT_SECRET ?? '',
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: redirectUri(req),
      }),
    });
    const user = await discord('https://discord.com/api/users/@me', { headers: { authorization: `Bearer ${token.access_token}` } });
    setSession(res, { id: user.id, name: user.global_name || user.username, avatar: user.avatar ?? null });
    res.redirect(302, '/');
  } catch (failure) {
    console.error('login failed:', failure);
    deny(res, 'sign-in failed, try again');
  }
}
