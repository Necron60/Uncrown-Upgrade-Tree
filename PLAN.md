# Uncrown: Plan

A browser game built around an upgrade tree. You are a seed of light in the void. Each **Harvest** is a short run where your lens shatters drifting crystal shards for *Lumen*. Between runs you spend Lumen in the **Bloom**, a radial constellation tree that grows outward from the seed. The tree is the centrepiece, and the focus is on animation, light and game feel.

---

## 1. Research: what makes a good upgrade tree

### 1.1 Design principles

| Principle | What it means for us |
|---|---|
| **Meaningful choice comes from scarcity** | Currency is always short of "buy everything". Every run should afford one to three decisions. |
| **Fewer, stronger nodes beat many +1% nodes** | Critics call "+1% damage" filler nodes "chores, not choices". About a third of our nodes change *how the game plays* (orbiting satellites, chain arcs, novas, echo lens, gravity well, overtime). |
| **Qualitative over quantitative** | Mechanic nodes ("majors") and keystones change behaviour. Minor stat nodes exist mainly to bridge to them. |
| **Synergy and buildcraft** | The whole should exceed the sum of its parts. Synergy nodes sit *between* branches and need both neighbours, e.g. *Charged Satellites* = satellites + crits + arcs. |
| **Connections between branches** | The tree is not four isolated lines. Cross-links at the diagonals reward mixing paths. |
| **Asymmetry over equal strength** | Branches deliberately differ in strength and timing (economy pays off late, force pays off now). |
| **Visible future, hidden detail** | Combine visible locked content with hidden unlocks. Nodes one step past your frontier appear as faint "?" silhouettes, which creates curiosity without overload. |
| **Clear feedback** | Clear iconography, short tooltips, *current → next* values, and previews of downstream unlocks. Node state is shown by **shape + brightness + ring**, never by colour alone. |
| **Avoid decision paralysis** | 46 nodes (seed + 44 upgrades + finale), four themed branches, one clear goal (awaken the seed). No need for an external guide. |
| **Reduce regret** | A respec is planned as a stretch feature. Early costs are cheap, so mistakes are cheap. |

### 1.2 Pacing math (incremental / idle research)

* **Cost per level:** `cost(L) = base × growth^L`. Idle games use growth 1.07–1.15 for generators bought hundreds of times. Tree nodes have only 1–5 levels, so we use a **steeper 1.5–1.9**.
* **Bulk cost (geometric series):** `cost(k→k+n) = base × g^k × (g^n − 1)/(g − 1)`, with max affordable `n = floor(log_g(C(g−1)/(base·g^k) + 1))`.
* **Cost vs. income:** linear income against exponential cost makes each wait a little longer. That is the pacing "spine". **Ring bases grow ~×5–8 per ring.** Tiers in Cookie Clicker scale ~5× per tier while income only rises a bit, so each unlock gets time to be enjoyed.
* **Multipliers widen the strategy space.** Additive bonuses inside a branch and multiplicative bonuses between branches. Several paths to optimise means exponential costs stop any single path from dominating.
* **Fast start, then slow.** The first run must buy a node, and the first 3 runs should unlock a *mechanic*.
* **Prestige** (stretch): reset for a permanent multiplier so each loop gets further along the curve before stalling.
* **Genre lessons (Nodebuster and "Nodebuster-likes", cursor-damage + upgrade-tree games):** players praise the run → tree → run loop and the satisfying progression. They criticise trees that are "mostly just more stats", hard navigation, and returning with "too little currency to buy anything". We answer these with mechanic-heavy majors, smooth pan/zoom/centre controls, and a cheap node always in reach.

### 1.3 Game feel ("juice") research

* *Juice it or Lose it* (Jonasson & Purho): tweening and easing everywhere, particles, colour, screen shake, sound on every action.
* **Screen shake:** short (50–300 ms), eased, amplitude decaying. Trauma-based shake (`shake = trauma²`), and it must be possible to turn it off.
* **Restraint:** juice is seasoning, not the meal, and should echo the core action. Big effects are reserved for big moments (keystones, boss shards, awakening).
* **Squash & stretch, anticipation, follow-through** on every purchase: press-in → overshoot → settle.
* **Hit-stop and slow-mo** for climactic moments only.
* **Reduced-motion setting** that respects `prefers-reduced-motion`.

---

## 2. Game design

### 2.1 Core loop
```
 ┌──────────── BLOOM (tree) ────────────┐
 │ pan/zoom constellation, buy nodes,  │
 │ watch light flow to the seed        │
 └──────────────┬──────────────────────┘
                │  "Begin Harvest" / click seed
 ┌──────────────▼──────────────────────┐
 │ HARVEST (10–40 s run)               │
 │ lens follows cursor, auto-damages   │
 │ shards in radius → shatter → Lumen  │
 └──────────────┬──────────────────────┘
                │  timer ends → summary
                └──────► back to BLOOM
```
**Goal:** buy the four keystones, then **Awaken the Seed** (final node) for an ending cinematic.

### 2.2 Branches (four sectors around the seed)
| Branch | Direction | Colour | Theme |
|---|---|---|---|
| **Force** | up | ember orange | damage, crits, execute, nova chain-explosions |
| **Reach** | right | cyan | radius, orbiting satellites, chain arcs, echo lens, gravity |
| **Flow** | down | jade green | duration, spawn rate, time shards, overtime |
| **Fortune** | left | gold | lumen multipliers, gold shards, combo, deeper shard tiers, prism |

Synergy nodes sit on the diagonals and need both neighbouring branches. Keystones sit at ring 5. Each keystone lights a quarter of the seed's ring, and all four unlock **Awaken**.

### 2.3 Node kinds and states
* **Kinds:** `minor` (circle, stats), `major` (hexagon, new mechanic), `keystone` (star, huge), `synergy` (diamond, cross-branch), `core` (the seed).
* **States:** hidden → silhouette ("?") → locked (requirements shown) → available (pulsing, cost shown) → owned (lit, flowing light, level pips) → maxed (gold ring, orbiting sparkle).

### 2.4 Currencies
* **Lumen**: from every shard.
* **Prism**: from rare prism shards and heart crystals. Gates late-game nodes.

---

## 3. Visual and animation spec

**Tree (Bloom)**
* Deep-space background: three parallax star layers that twinkle, plus additive nebula clouds that **brighten in the sectors you invest in**.
* Edges are polar-interpolated curves (organic spiral branches). Owned edges glow, and **light pulses travel along them toward the seed**, so income is visible as light.
* Purchase: anticipation squish → elastic overshoot → shockwave ring + particle burst in branch colour + level pip fill + soft chime (pitch rises with level). A new child **grows along the edge** before popping in.
* Keystone: displacement shockwave filter, camera punch, beam to the seed.
* Hover: scale-up, path-to-seed highlight, glass tooltip with *current → next*.
* Unaffordable click: shake + red flash.
* Camera: drag-pan with inertia, wheel/pinch zoom toward cursor, double-click to recentre.

**Harvest**
* Faceted crystal shards (gradient fill, facet lines, glow halo) that spawn from a point of light.
* Hit: white flash, scale punch, HP arc. Death: triangular fragments + sparks + Lumen motes that arc to the HUD counter, which bumps on arrival.
* Damage numbers that pop and float (crits bigger and golden). Combo meter. Chain-lightning arcs as jagged, flickering bolts. Nova rings.
* Timer bar shifts from cyan to amber to red and pulses in the final seconds. At the end: slow-mo freeze, then a summary card with counting numbers.
* Transitions: zoom into the seed + flash (tree → harvest), shards dissolve (harvest → tree).

**Audio:** a four-piece orchestral/piano soundtrack by Scott Buckley (CC-BY 4.0) plus calm CC0 recordings in `public/sfx` (VCSL kalimba/vibraphone/marimba/chimes, BigSoundBank singing bowl and bubble pops), re-pitched onto a pentatonic scale. During a harvest only shattering shards make a sound; the music carries the rest.

---

## 4. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Build | **Vite 8** | Instant dev server + HMR, tiny static build that runs anywhere. |
| Language | **TypeScript** | Typed game state and node data; safe refactors as the tree grows. |
| Renderer | **PixiJS 8.22** (WebGL / WebGPU) | Fastest 2D web renderer: ~200k sprites or ~1M `ParticleContainer` particles at 60 fps, additive blending, filters, `Graphics` gradients. The engine does what we need without forcing a game framework on us. |
| Animation | **GSAP 3.15** | Industry-standard timelines and eases (elastic, back, expo). Tweens any JS object, including Pixi display objects. 100% free incl. all plugins since April 2025. |
| Post-FX | **pixi-filters 6.1** | `AdvancedBloomFilter` (global glow), `ShockwaveFilter` (keystone ripples), `GlowFilter`. |
| UI overlay | **HTML/CSS** over the canvas | Crisp text, glassmorphism tooltips/panels, accessible buttons; animated by GSAP. |
| Audio | **Web Audio API** | CC0 samples (~0.9 MB of MP3) pitched and mixed at runtime, plus an 18 MB streamed CC-BY soundtrack. |
| Fonts | **@fontsource** (Chakra Petch + Inter) | Bundled locally, no external requests. |
| Tests | **Vitest** | Pure logic (costs, unlock rules, stats, save) is unit-tested. |
| Save | `localStorage` | Versioned JSON, autosave after every purchase/run. |

**Alternatives considered:** *Phaser* (full framework, but heavier and we need custom UI more than physics/tilemaps). *Three.js* (3D overkill for a 2D tree). *DOM/SVG + CSS* (great for a small tree, but chokes on thousands of glowing particles and full-screen bloom). *React* (unnecessary for a canvas-first game, and the HUD is small).

---

## 5. Architecture
```
src/
  main.ts                 bootstrap (Pixi app, fonts, game)
  game/Game.ts            scene manager, transitions, autosave
  core/                   state & save, events, number format, math utils
  data/tree.ts            node definitions (pure data, polar coords)
  data/stats.ts           base stats + computeStats(levels)
  systems/tree-logic.ts   cost, visibility, canBuy, buy  (unit-tested)
  systems/audio.ts        sample playback (public/sfx)
  render/                 textures, particles, background, shake, icons
  scenes/TreeScene.ts     + tree/NodeView, EdgeView, Camera
  scenes/HarvestScene.ts  + harvest/Shard, Lens, Satellites, Arcs
  ui/                     HUD, tooltip, run summary, settings (HTML)
```

---

## 6. Milestones

> **Status (v0.1):** milestones 1–6 are implemented. The pacing sim (`tests/balance.test.ts`) puts a cheapest-first player at ~62 runs (~42 min) to the finale, with two deliberate "breakthrough" jumps when Sapphire and Abyssal shard tiers unlock. Milestone 7 is open.

1. **Foundation**: Vite + TS + Pixi + GSAP scaffold, state/save, tree data, tree logic + tests.
2. **Bloom (tree)**: background, camera, edges, nodes, states, hover/tooltip, purchase animations.
3. **Harvest**: lens, shards, damage, particles, motes, timer, summary.
4. **Mechanics**: satellites, arcs, nova, execute, echo lens, gravity, time/gold/prism shards, tiers, heart crystal, combo, overtime.
5. **Polish**: transitions, audio, bloom, settings (volume, shake, reduced motion, quality), ending cinematic.
6. **Balance**: pacing sim + tuning, so a full playthrough takes ~30–45 min.
7. **Stretch**: prestige ("New Cycle"), respec, achievements, gamepad, mobile layout.

## 7. Risks
* **Bloom filter cost on high-DPI screens.** Mitigation: resolution cap, plus a quality toggle that falls back to pre-rendered additive glow sprites.
* **Too many stat nodes feel like chores.** Mitigation: a third of the nodes are mechanics, and every node shows *current → next*.
* **Pacing walls.** Mitigation: a headless balance sim over the real data files.

## Sources
* [The problem with skill trees (Wayline)](https://www.wayline.io/blog/the-problem-with-skill-trees)
* [Illusion of choice in skill trees (Wayline)](https://www.wayline.io/blog/marketing-tutorials-illusion-of-choice-skill-tree)
* [Design Dive 20 (skill trees)](https://designdive.substack.com/p/design-dive-20)
* [r/RPGdesign: How to make skill trees fun](https://lr.us.psf.lt/r/RPGdesign/comments/1ki2dow/how_to_make_skill_trees_fun)
* [Diablo IV skill tree feedback (Blizzard forums)](https://us.forums.blizzard.com/en/d3/t/diablo-iv-skill-tree-feedback/22272)
* [Numbers Getting Bigger: The Design and Math of Incremental Games (Tuts+)](https://code.tutsplus.com/numbers-getting-bigger-the-design-and-math-of-incremental-games--cms-24023a)
* [The Math of Idle Games, Part I](https://gamedeveloper.com/design/the-math-of-idle-games-part-i) / [Part III](https://www.gamedeveloper.com/design/the-math-of-idle-games-part-iii) (Pecorella)
* [Incremental game (Wikipedia)](https://en.wikipedia.org/wiki/Incremental_game)
* [Nodebuster review (The Mancunion)](https://mancunion.com/2025/05/08/nodebuster-review-a-short-and-sweet-incremental-game/), [Steam discussion](https://steamcommunity.com/app/3107330/discussions/0/6929437211297706726)
* [Game Feel & Juice course (Wayline)](https://www.wayline.io/learn/game-feel/1), [Juicing (GDQuest)](https://school.gdquest.com/glossary/juicing), [Research: making a juicy game](https://rpgplayground.com/research-making-a-juicy-game/), [Game feel in Pygame: screenshake](https://slicker.me/python/game_feel_pygame.htm), [juicy-breakout](https://github.com/grapefrukt/juicy-breakout)
* [PixiJS ParticleContainer v8](https://pixijs.com/blog/particlecontainer-v8), [pixi-filters](https://npmjs.com/package/pixi-filters)
* [Webflow makes GSAP 100% free](https://webflow.com/blog/gsap-becomes-free), [GSAP standard license](https://gsap.com/community/standard-license/)
