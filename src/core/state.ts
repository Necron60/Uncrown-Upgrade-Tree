import type { TreeId } from '../data/tree';

export type Bloom = 'off' | 'soft' | 'full';
export type Level3 = 'low' | 'medium' | 'high';
export const MUSIC_TRACKS = ['all', 'adrift', 'hymn', 'cirrus', 'hope'] as const;
export type MusicTrack = (typeof MUSIC_TRACKS)[number];

export interface Settings {
  // sound
  volume: number; // master, 0..1
  sfxVolume: number; // shattering in a harvest, 0..1
  specialVolume: number; // chimes and gongs of special shards, 0..1
  uiVolume: number; // interface sounds, 0..1
  musicVolume: number; // background music, 0..1
  musicTrack: MusicTrack; // 'all' plays the pieces in turn
  harvestMusic: 'full' | 'soft' | 'off'; // music level while harvesting
  hoverSounds: boolean;
  reverb: number; // 0..1
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
  darkness: 'off' | 'dim' | 'deep'; // how dark the void is beyond the light of the tree
  antialias: 'auto' | 'on' | 'off'; // multisampled edges inside the glow/darkness passes (auto: only below ~2x density)
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

/** One tree's progress: its wallet, its nodes, and how far it has come. */
export interface TreeProgress {
  /** the common currency (the Bloom: Lumen, the Hollow Crown: Gloam) */
  lumen: number;
  /** the rare currency (Prism, Sigils) */
  prism: number;
  levels: Record<string, number>;
  /** the finale has been bought */
  awakened: boolean;
  /** trials passed (the Hollow Crown) */
  trials: string[];
  /** the furthest a harvest has come toward each trial */
  trialBest: Record<string, number>;
  /** the Hollow Heart's wounds, 0..1 of its health: they stay from one harvest to the next */
  heart: number;
  runs: number;
  bestRun: number;
}

/**
 * The save. Still version 1, so the cloud save service takes it unchanged: Tree I (the Bloom) keeps
 * its progress at the top level, where saves from before there were two trees have it, and the
 * Hollow Crown has its own slot beside it.
 */
export interface GameState extends TreeProgress {
  version: 1;
  lifetime: LifetimeStats;
  settings: Settings;
  /** the tree on screen */
  active: TreeId;
  crown: TreeProgress;
  /** first-time tips already shown */
  tips: string[];
}

/** Marks a save from before there were tips: the tips module quietly ticks off what the player is already past. */
export const LEGACY_TIPS = '*legacy';

export function progressOf(state: GameState, tree: TreeId): TreeProgress {
  return tree === 'bloom' ? state : state.crown;
}

export const SAVE_KEY = 'uncrown-save-v1';
/** Saves from before the game was renamed; read once, then re-saved under SAVE_KEY. */
const LEGACY_SAVE_KEYS = ['lumen-bloom-save-v1'];

export function defaultSettings(): Settings {
  return {
    volume: 0.7, sfxVolume: 0.7, specialVolume: 0.7, uiVolume: 0.7, musicVolume: 1, musicTrack: 'all', harvestMusic: 'full',
    hoverSounds: true, reverb: 0.5, muteHidden: true,
    reducedMotion: false, shake: 1, cameraFx: true, ripples: true, flashes: 1, slowmo: true, ambient: true,
    ...GRAPHICS_PRESETS.high, darkness: 'deep', antialias: 'auto', fpsCap: 0, showFps: false,
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
    specialVolume: num('specialVolume', 0, 1),
    uiVolume: num('uiVolume', 0, 1),
    musicVolume: num('musicVolume', 0, 1),
    musicTrack: pick('musicTrack', MUSIC_TRACKS),
    harvestMusic: pick('harvestMusic', ['full', 'soft', 'off'] as const),
    hoverSounds: bool('hoverSounds'),
    reverb: num('reverb', 0, 1),
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
    darkness: pick('darkness', ['off', 'dim', 'deep'] as const),
    antialias: pick('antialias', ['auto', 'on', 'off'] as const),
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

const ROOTS: Record<TreeId, string> = { bloom: 'seed', crown: 'crown' };

export function newProgress(tree: TreeId): TreeProgress {
  return { lumen: 0, prism: 0, levels: { [ROOTS[tree]]: 1 }, awakened: false, trials: [], trialBest: {}, heart: 0, runs: 0, bestRun: 0 };
}

export function newGame(): GameState {
  return {
    version: 1,
    ...newProgress('bloom'),
    lifetime: { runs: 0, shardsBroken: 0, lumenEarned: 0, prismEarned: 0, bestRun: 0, playTime: 0, bestCombo: 0 },
    settings: defaultSettings(),
    active: 'bloom',
    crown: newProgress('crown'),
    tips: [],
  };
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** One tree's progress from a save, tolerating anything. */
function parseProgress(raw: unknown, tree: TreeId, fallback: { runs?: number; bestRun?: number } = {}): TreeProgress {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Partial<TreeProgress>;
  const root = ROOTS[tree];
  const levels: Record<string, number> = {};
  if (d.levels && typeof d.levels === 'object') {
    for (const [k, v] of Object.entries(d.levels)) levels[k] = Math.max(0, Math.floor(num(v, 0)));
  }
  levels[root] = 1;
  return {
    lumen: Math.max(0, num(d.lumen, 0)),
    prism: Math.max(0, num(d.prism, 0)),
    levels,
    awakened: !!d.awakened,
    trials: Array.isArray(d.trials) ? d.trials.filter((t): t is string => typeof t === 'string') : [],
    trialBest: Object.fromEntries(Object.entries(d.trialBest && typeof d.trialBest === 'object' ? d.trialBest : {})
      .filter(([, v]) => typeof v === 'number' && Number.isFinite(v)).map(([k, v]) => [k, Math.max(0, v as number)])),
    heart: Math.min(1, Math.max(0, num(d.heart, 0))),
    runs: Math.max(0, Math.floor(num(d.runs, fallback.runs ?? 0))),
    bestRun: Math.max(0, num(d.bestRun, fallback.bestRun ?? 0)),
  };
}

/** Parse a save, tolerating missing/extra fields from older versions. */
export function parseSave(raw: string | null): GameState {
  const base = newGame();
  if (!raw) return base;
  try {
    const data = JSON.parse(raw) as Partial<GameState>;
    if (typeof data !== 'object' || data === null) return base;
    const lifetime = { ...base.lifetime, ...(data.lifetime ?? {}) };
    // before there were two trees, every harvest was a harvest of the Bloom
    const bloom = parseProgress(data, 'bloom', { runs: lifetime.runs, bestRun: lifetime.bestRun });
    const tips = Array.isArray(data.tips) ? data.tips.filter((t): t is string => typeof t === 'string')
      : lifetime.runs > 0 ? [LEGACY_TIPS] : [];
    return {
      version: 1,
      ...bloom,
      lifetime,
      settings: normalizeSettings(data.settings),
      active: data.active === 'crown' ? 'crown' : 'bloom',
      crown: parseProgress(data.crown, 'crown'),
      tips,
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
