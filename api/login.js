import { newState, redirectUri } from './_session.js';

export default function handler(req, res) {
  const clientId = (process.env.DISCORD_CLIENT_ID ?? '').trim();
  if (!clientId) return res.status(500).send('DISCORD_CLIENT_ID is not set on this deployment.');

  // identify only: the game needs to know which account this is, and its name and avatar
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri(req));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('state', newState(res));
  res.redirect(302, url.toString());
}
