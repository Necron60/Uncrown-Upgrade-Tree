// Uncrown cloud saves: one JSON file per Discord account, on the VPS behind nginx.
// Only the Vercel functions hold SAVES_TOKEN; browsers never talk to this directly.
// Node standard library only. Deployment: "Hosting" in README.md.
import { createServer } from 'node:http';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';

const PORT = Number(process.env.PORT) || 48760;
const DIR = process.env.STATE_DIRECTORY || process.env.SAVES_DIR || './data'; // systemd's StateDirectory sets the first
const TOKEN = (process.env.SAVES_TOKEN ?? '').trim();
const MAX_BYTES = 64 * 1024;
const MIN_GAP_MS = 4000; // per account, so a looping client cannot hammer the disk
// A write may be at most this much play time behind the stored save. Play time only ever grows,
// so a device with less of it is one that missed progress made elsewhere.
const SLACK_SECONDS = 60;

if (TOKEN.length < 24) {
  console.error('SAVES_TOKEN is missing or shorter than 24 characters');
  process.exit(1);
}
await mkdir(DIR, { recursive: true });

const lastWrite = new Map(); // ponytail: in memory and unbounded; one entry per account that ever saved, fine at this scale
const file = (id) => join(DIR, `${id}.json`);
const playTime = (save) => Number(save?.lifetime?.playTime) || 0;

function tokenOk(header) {
  const given = Buffer.from(String(header ?? '').replace(/^Bearer /, ''));
  const want = Buffer.from(TOKEN);
  return given.length === want.length && timingSafeEqual(given, want);
}

function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readSave(id) {
  try {
    return JSON.parse(await readFile(file(id), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BYTES) {
        reject(Object.assign(new Error('too big'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://local');
  if (url.pathname === '/health') return send(res, 200, { ok: true });
  if (!tokenOk(req.headers.authorization)) return send(res, 401, { error: 'unauthorized' });
  const id = /^\/saves\/(\d{5,25})$/.exec(url.pathname)?.[1];
  if (!id) return send(res, 404, { error: 'not found' });

  if (req.method === 'GET') {
    const record = await readSave(id);
    return record ? send(res, 200, record) : send(res, 404, { error: 'no save' });
  }
  if (req.method !== 'PUT') return send(res, 405, { error: 'method not allowed' });

  const now = Date.now();
  if (now - (lastWrite.get(id) ?? 0) < MIN_GAP_MS) return send(res, 429, { error: 'too fast' });
  lastWrite.set(id, now);

  let save;
  try {
    save = JSON.parse(await readBody(req));
  } catch (e) {
    return send(res, e.status ?? 400, { error: e.status ? 'too big' : 'not json' });
  }
  if (!save || typeof save !== 'object' || save.version !== 1) return send(res, 400, { error: 'not a save' });

  const old = await readSave(id);
  // a device that is behind must not wipe progress made on another one, unless the player reset on purpose
  if (old && url.searchParams.get('force') !== '1' && playTime(save) + SLACK_SECONDS < playTime(old.save)) {
    return send(res, 409, { error: 'the cloud save is ahead', ...old });
  }
  const record = { save, updatedAt: now };
  const tmp = `${file(id)}.tmp`;
  await writeFile(tmp, JSON.stringify(record));
  if (old) await copyFile(file(id), join(DIR, `${id}.prev.json`)); // one step of history, for the support case
  await rename(tmp, file(id)); // atomic: a crash leaves the old file or the new one, never half of either
  send(res, 200, { updatedAt: now });
}

createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: 'server error' });
  });
}).listen(PORT, '127.0.0.1', () => console.log(`uncrown saves on 127.0.0.1:${PORT}, data in ${DIR}`));
