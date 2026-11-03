export interface Settings {
  volume: number; // 0..1
  shake: boolean;
  reducedMotion: boolean;
  quality: 'high' | 'low';
}

export interface LifetimeStats {
  runs: number;
  shardsBroken: number;
  lumenEarned: number;
  prismEarned: number;
  bestRun: number;
  playTime: number; // seconds
  bestCombo: number;
}

export interface GameState {
  version: 1;
  lumen: number;
  prism: number;
  levels: Record<string, number>;
  lifetime: LifetimeStats;
  settings: Settings;
  awakened: boolean;
}

export const SAVE_KEY = 'lumen-bloom-save-v1';

export function defaultSettings(): Settings {
  const reduced =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return { volume: 0.7, shake: true, reducedMotion: !!reduced, quality: 'high' };
}

export function newGame(): GameState {
  return {
    version: 1,
    lumen: 0,
    prism: 0,
    levels: { seed: 1 },
    lifetime: { runs: 0, shardsBroken: 0, lumenEarned: 0, prismEarned: 0, bestRun: 0, playTime: 0, bestCombo: 0 },
    settings: defaultSettings(),
    awakened: false,
  };
}

/** Parse a save, tolerating missing/extra fields from older versions. */
export function parseSave(raw: string | null): GameState {
  const base = newGame();
  if (!raw) return base;
  try {
    const data = JSON.parse(raw) as Partial<GameState>;
    if (typeof data !== 'object' || data === null) return base;
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    const levels: Record<string, number> = { seed: 1 };
    if (data.levels && typeof data.levels === 'object') {
      for (const [k, v] of Object.entries(data.levels)) levels[k] = Math.max(0, Math.floor(num(v, 0)));
    }
    levels.seed = 1;
    return {
      version: 1,
      lumen: Math.max(0, num(data.lumen, 0)),
      prism: Math.max(0, num(data.prism, 0)),
      levels,
      lifetime: { ...base.lifetime, ...(data.lifetime ?? {}) },
      settings: { ...base.settings, ...(data.settings ?? {}) },
      awakened: !!data.awakened,
    };
  } catch {
    return base;
  }
}

export function loadGame(): GameState {
  try {
    return parseSave(localStorage.getItem(SAVE_KEY));
  } catch {
    return newGame();
  }
}

export function saveGame(state: GameState): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch {
    /* storage full or disabled; the game keeps running */
  }
}

export function wipeSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}
