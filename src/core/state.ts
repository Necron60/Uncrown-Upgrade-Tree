export type Bloom = 'off' | 'soft' | 'full';
export type Level3 = 'low' | 'medium' | 'high';

export interface Settings {
  // sound
  volume: number; // master, 0..1
  sfxVolume: number; // harvest sounds, 0..1
  uiVolume: number; // interface sounds, 0..1
  muteHidden: boolean; // silence while the tab is in the background
  // motion & comfort
  reducedMotion: boolean; // master switch: overrides everything in this group
  shake: number; // screen shake strength, 0..1
  cameraFx: boolean; // zooms into/out of the seed, opening and finale camera moves
  ripples: boolean; // shockwave distortion on keystones and the finale
  flashes: number; // bright flashes, 0..1 (below 0.5 transitions dip to dark instead of white)
  slowmo: boolean; // hit-stop and end-of-run slow motion
  ambient: boolean; // twinkling, shooting stars, drifting motes, breathing nodes, light pulses
  // graphics
  bloom: Bloom;
  resolution: number; // 0.5..1 of the screen's pixel density
  particles: Level3;
  background: 'low' | 'high';
  fpsCap: number; // 0 = match the display
  showFps: boolean;
  // interface
  uiScale: number; // 0.85..1.3
  damageNumbers: boolean;
  hints: boolean;
  skipSummary: boolean;
}

export const GRAPHICS_PRESETS: Record<Level3, Pick<Settings, 'bloom' | 'resolution' | 'particles' | 'background'>> = {
  low: { bloom: 'off', resolution: 0.5, particles: 'low', background: 'low' },
  medium: { bloom: 'soft', resolution: 0.75, particles: 'medium', background: 'high' },
  high: { bloom: 'full', resolution: 1, particles: 'high', background: 'high' },
};

/** Motion settings as they actually apply: reduced motion overrides the individual options. */
export function effectiveMotion(s: Settings) {
  const rm = s.reducedMotion;
  return {
    shake: rm ? 0 : s.shake,
    cameraFx: s.cameraFx && !rm,
    ripples: s.ripples && !rm,
    flashes: rm ? Math.min(s.flashes, 0.3) : s.flashes,
    slowmo: s.slowmo && !rm,
    ambient: s.ambient && !rm,
  };
}
export type Motion = ReturnType<typeof effectiveMotion>;

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

export const SAVE_KEY = 'uncrown-save-v1';
/** Saves from before the game was renamed; read once, then re-saved under SAVE_KEY. */
const LEGACY_SAVE_KEYS = ['lumen-bloom-save-v1'];

export function defaultSettings(): Settings {
  const reduced =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return {
    volume: 0.7, sfxVolume: 1, uiVolume: 1, muteHidden: true,
    reducedMotion: !!reduced, shake: 1, cameraFx: true, ripples: true, flashes: 1, slowmo: true, ambient: true,
    ...GRAPHICS_PRESETS.high, fpsCap: 0, showFps: false,
    uiScale: 1, damageNumbers: true, hints: true, skipSummary: false,
  };
}

/** Validate settings from a save (any shape, any version) against the defaults. */
export function normalizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (k: keyof Settings, lo: number, hi: number) => {
    const v = r[k];
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : (d[k] as number);
  };
  const bool = (k: keyof Settings) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : (d[k] as boolean));
  const pick = <T extends string>(k: keyof Settings, opts: readonly T[]) => (opts.includes(r[k] as T) ? (r[k] as T) : (d[k] as T));
  const out: Settings = {
    volume: num('volume', 0, 1),
    sfxVolume: num('sfxVolume', 0, 1),
    uiVolume: num('uiVolume', 0, 1),
    muteHidden: bool('muteHidden'),
    reducedMotion: bool('reducedMotion'),
    // v0.1 stored shake as a boolean
    shake: typeof r.shake === 'boolean' ? (r.shake ? 1 : 0) : num('shake', 0, 1),
    cameraFx: bool('cameraFx'),
    ripples: bool('ripples'),
    flashes: num('flashes', 0, 1),
    slowmo: bool('slowmo'),
    ambient: bool('ambient'),
    bloom: pick('bloom', ['off', 'soft', 'full'] as const),
    resolution: num('resolution', 0.5, 1),
    particles: pick('particles', ['low', 'medium', 'high'] as const),
    background: pick('background', ['low', 'high'] as const),
    fpsCap: [0, 30, 60, 120].includes(r.fpsCap as number) ? (r.fpsCap as number) : d.fpsCap,
    showFps: bool('showFps'),
    uiScale: num('uiScale', 0.85, 1.3),
    damageNumbers: bool('damageNumbers'),
    hints: bool('hints'),
    skipSummary: bool('skipSummary'),
  };
  // v0.1 had a single quality switch: "low" meant no glow
  if (r.quality === 'low' && r.bloom === undefined) out.bloom = 'off';
  return out;
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
      settings: normalizeSettings(data.settings),
      awakened: !!data.awakened,
    };
  } catch {
    return base;
  }
}

export function loadGame(): GameState {
  try {
    let raw = localStorage.getItem(SAVE_KEY);
    for (const k of LEGACY_SAVE_KEYS) raw ??= localStorage.getItem(k);
    return parseSave(raw);
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
    for (const k of LEGACY_SAVE_KEYS) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
