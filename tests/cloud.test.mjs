// The two security- and data-loss-relevant pieces of cloud saves: the login cookie (api/_session.js)
// and the save service on the VPS (server/saves.mjs), run for real on a temp directory.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SESSION_SECRET = 'x'.repeat(40);
const { seal, unseal } = await import('../api/_session.js');

describe('session cookie', () => {
  const user = { id: '976834826319560755', name: 'Necron', avatar: null };

  it('round-trips a signed session', () => {
    expect(unseal(seal(user))).toMatchObject(user);
  });

  it('rejects a forged payload, a foreign key and an expired cookie', () => {
    const [, sig] = seal(user).split('.');
    const forged = Buffer.from(JSON.stringify({ ...user, id: '111111111111111111', exp: 9e9 })).toString('base64url');
    expect(unseal(`${forged}.${sig}`)).toBeNull();

    const token = seal(user);
    process.env.SESSION_SECRET = 'y'.repeat(40);
    expect(unseal(token)).toBeNull();
    process.env.SESSION_SECRET = 'x'.repeat(40);

    expect(unseal(seal(user, Date.now() - 31 * 24 * 3600 * 1000))).toBeNull();
    expect(unseal('garbage')).toBeNull();
  });
});

describe('save service', () => {
  const TOKEN = 't'.repeat(32);
  const PORT = 48761;
  const base = `http://127.0.0.1:${PORT}`;
  const dir = mkdtempSync(join(tmpdir(), 'uncrown-saves-'));
  let proc;
  const call = (path, init = {}) =>
    fetch(base + path, { ...init, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...init.headers } });
  const save = (playTime) => JSON.stringify({ version: 1, lumen: 5, lifetime: { playTime } });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    proc = spawn(process.execPath, ['server/saves.mjs'], { env: { ...process.env, SAVES_TOKEN: TOKEN, PORT: String(PORT), SAVES_DIR: dir }, stdio: 'ignore' });
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`${base}/health`)).ok) return;
      } catch { /* not up yet */ }
      await wait(100);
    }
    throw new Error('save service did not start');
  });
  afterAll(() => {
    proc?.kill();
    rmSync(dir, { recursive: true, force: true });
  });

  it('needs the token and a numeric account id', async () => {
    expect((await fetch(`${base}/saves/123456789`)).status).toBe(401);
    expect((await call('/saves/../etc')).status).toBe(404);
    expect((await call('/saves/123456789')).status).toBe(404); // no save yet
  });

  it('stores a save, refuses a device that is behind, and lets a reset force through', async () => {
    const id = '123456789012345678';
    expect((await call(`/saves/${id}`, { method: 'PUT', body: save(500) })).status).toBe(200);
    expect((await (await call(`/saves/${id}`)).json()).save.lifetime.playTime).toBe(500);

    await wait(4100); // one write per account every 4 s
    expect((await call(`/saves/${id}`, { method: 'PUT', body: save(10) })).status).toBe(409);

    await wait(4100);
    expect((await call(`/saves/${id}?force=1`, { method: 'PUT', body: save(0) })).status).toBe(200);
    expect((await (await call(`/saves/${id}`)).json()).save.lifetime.playTime).toBe(0);
  }, 15000);

  it('limits how fast one account can write and rejects things that are not saves', async () => {
    const id = '223456789012345678';
    expect((await call(`/saves/${id}`, { method: 'PUT', body: '{"nope":1}' })).status).toBe(400);
    await wait(4100);
    expect((await call(`/saves/${id}`, { method: 'PUT', body: save(1) })).status).toBe(200);
    expect((await call(`/saves/${id}`, { method: 'PUT', body: save(2) })).status).toBe(429);
  }, 10000);
});
