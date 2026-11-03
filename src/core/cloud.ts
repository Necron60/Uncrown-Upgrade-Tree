import { SAVE_KEY, loadGame, type GameState } from './state';

export interface CloudUser {
  id: string;
  name: string;
  avatar: string | null;
}

/**
 * unavailable: no /api here (local dev, offline) · signed-out · synced · saving
 * behind: another device saved more progress; this one stops uploading until a reload
 * error: the last upload failed; the next save retries
 */
export type CloudStatus = 'unavailable' | 'signed-out' | 'synced' | 'saving' | 'behind' | 'error';

const playTime = (s: Partial<GameState> | null | undefined) => Number(s?.lifetime?.playTime) || 0;
const MIN_GAP_MS = 5000; // the save service accepts one write per account every 4 s
const DEBOUNCE_MS = 2000;

async function getJson(url: string): Promise<{ status: number; body: any }> {
  const r = await fetch(url, { credentials: 'same-origin', signal: AbortSignal.timeout(5000) });
  const type = r.headers.get('content-type') ?? '';
  return { status: r.status, body: type.includes('json') ? await r.json() : null };
}

/**
 * Cloud saves for players signed in with Discord (the /api functions on Vercel). Guests keep the
 * local save only. The local save stays the working copy either way; the cloud is a mirror that is
 * read once at boot and written after saves.
 */
class Cloud {
  user: CloudUser | null = null;
  status: CloudStatus = 'unavailable';
  lastSync = 0;
  onChange: () => void = () => {};
  private pending: GameState | null = null;
  private timer = 0;
  private lastPush = 0;

  /** Before the game boots: who is signed in, and adopt the cloud save if it holds more progress. */
  async init(): Promise<void> {
    try {
      const me = await getJson('/api/me');
      if (me.status !== 200 || typeof me.body?.signedIn !== 'boolean') return; // no backend here
      if (!me.body.signedIn) {
        this.status = 'signed-out';
        return;
      }
      this.user = me.body.user;
      this.status = 'synced';
      const cloud = await getJson('/api/save');
      if (cloud.status === 404) return; // nothing saved yet: the first local save uploads
      if (cloud.status !== 200) throw new Error(`save answered ${cloud.status}`);
      if (playTime(cloud.body.save) > playTime(loadGame())) localStorage.setItem(SAVE_KEY, JSON.stringify(cloud.body.save));
      this.lastSync = cloud.body.updatedAt ?? Date.now();
    } catch (e) {
      console.warn('cloud save unavailable', e);
      if (this.user) this.status = 'error';
    }
  }

  /** Queue an upload of the game state (sent a moment later, batched with any saves that follow). */
  push(state: GameState) {
    if (!this.user || this.status === 'behind') return;
    this.pending = state;
    clearTimeout(this.timer);
    const wait = Math.max(DEBOUNCE_MS, MIN_GAP_MS - (Date.now() - this.lastPush));
    this.timer = window.setTimeout(() => void this.send(), wait);
  }

  /** The page is being hidden or closed: send what is pending now (keepalive outlives the page). */
  flush() {
    if (!this.pending || !this.user) return;
    clearTimeout(this.timer);
    void this.send(false, true);
  }

  /** "Begin anew": overwrite the cloud save even though it holds more progress. */
  async replace(state: GameState): Promise<void> {
    if (!this.user) return;
    this.pending = state;
    clearTimeout(this.timer);
    // a 429 here would leave the old save in the cloud, and the reload that follows would adopt it again
    await new Promise((r) => setTimeout(r, Math.max(0, MIN_GAP_MS - (Date.now() - this.lastPush))));
    await this.send(true);
  }

  private async send(force = false, keepalive = false) {
    const state = this.pending;
    if (!state || !this.user) return;
    this.pending = null;
    this.lastPush = Date.now();
    this.status = 'saving';
    this.onChange();
    try {
      const r = await fetch(`/api/save${force ? '?force=1' : ''}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(state),
        keepalive,
      });
      if (r.status === 409) this.status = 'behind';
      else if (r.status === 401) {
        this.user = null;
        this.status = 'signed-out';
      } else if (r.status === 429) {
        this.status = 'synced';
        this.push(this.pending ?? state); // too soon after the last write: try again in a moment, with the newest state
      } else if (r.ok) {
        this.status = 'synced';
        this.lastSync = Date.now();
      } else throw new Error(`save answered ${r.status}`);
    } catch (e) {
      console.warn('cloud save failed', e);
      this.status = 'error';
    }
    this.onChange();
  }
}

export const cloud = new Cloud();
