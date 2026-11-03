import { requireSession } from './_session.js';

// Proxies the signed-in player's own save to the save service on the VPS. The account id comes
// from the session, never from the request, so nobody can read or write another player's save.
// SAVES_TOKEN stays here on the server.
export default async function handler(req, res) {
  const user = requireSession(req, res);
  if (!user) return;
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'PUT') return res.status(405).json({ error: 'method not allowed' });

  const base = (process.env.SAVES_API_URL ?? '').trim().replace(/\/+$/, '');
  if (!base) return res.status(503).json({ error: 'SAVES_API_URL is not set on this deployment' });
  const force = req.method === 'PUT' && req.query.force === '1' ? '?force=1' : '';
  try {
    const upstream = await fetch(`${base}/saves/${user.id}${force}`, {
      method: req.method,
      headers: { authorization: `Bearer ${process.env.SAVES_TOKEN ?? ''}`, 'content-type': 'application/json' },
      body: req.method === 'PUT' ? JSON.stringify(req.body ?? null) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    res.status(upstream.status).json(await upstream.json());
  } catch (failure) {
    console.error('save proxy failed:', failure);
    res.status(502).json({ error: 'the save service did not answer' });
  }
}
