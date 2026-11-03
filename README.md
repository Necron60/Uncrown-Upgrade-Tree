# Uncrown

A browser upgrade-tree game that puts animation, light and game feel first.

You are a seed of light in the void. **Harvest** in short runs where your lens shatters crystal shards for Lumen, then spend it in the **Bloom**, a radial constellation of 44 upgrades that grows out from the seed. Buy all four keystones and **Awaken the Seed** to finish.

The research and design rationale is in [PLAN.md](PLAN.md).

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/ (host anywhere)
npm test           # unit tests and the pacing simulation
npm run typecheck
```

## Controls

| Where | Input | Action |
|---|---|---|
| Bloom | drag · wheel · pinch | pan · zoom toward the cursor · zoom |
| Bloom | click a glowing node | grow it (touch: tap to preview, tap again to buy) |
| Bloom | click the seed / `Space` | begin a Harvest |
| Bloom | `C` · double-click empty space · `M` | recenter · recenter · mute |
| Harvest | move the mouse | steer the lens; it pulses automatically |
| Harvest | `Esc` | end the run early (you keep what you gathered) |
| Summary | `Space` · `R` | back to the Bloom · harvest again |

## Settings

Press `Esc` in the Bloom, or use the sliders icon. Every option saves automatically.

- **Graphics:** a low/medium/high preset; glow off/soft/full; render resolution 50–100%; particle amount; simple or rich background; frame-rate cap (30/60/120/max); frame counter.
- **Motion:** a *Reduced motion* master switch, plus individual control of screen-shake strength, camera moves (zooming into and out of the seed, opening and finale moves), distortion ripples, flash strength (below 50%, scene changes fade to dark instead of white), slow motion / hit-stop, and ambient motion. Your OS reduced-motion preference is respected on first launch.
- **Sound:** master, harvest and interface volume; silence while the tab is hidden.
- **Interface:** interface size, damage numbers, hints, and skipping the harvest summary.
- **Records:** lifetime stats, plus *Begin anew* to wipe your save.

## Tech

- **Vite + TypeScript**
- **PixiJS 8** (WebGL) for rendering. All art is generated at runtime, so there are no image assets.
- **GSAP** for every tween and timeline.
- **pixi-filters**: bloom, plus shockwave ripples on keystones and the finale.
- **Web Audio**: procedural sound with a pentatonic chime scale and a generated reverb.
- **HTML/CSS** overlay for the HUD, tooltips and modals: an engraved star-atlas look (hairline gold rules, Cormorant Garamond + IBM Plex Mono).

## Project layout

```
src/data/tree.ts          the 46 node definitions (polar layout, costs, modifiers)
src/data/stats.ts         stat model + computeStats()
src/systems/tree-logic.ts unlock/visibility/cost rules (pure, unit-tested)
src/scenes/TreeScene.ts   the Bloom: camera, nodes, branches, purchase/reveal choreography
src/scenes/HarvestScene.ts the run: lens, shards, satellites, arcs, novas, motes
src/render/               generated textures, particle system, starfield, icons, shake
src/ui/                   HUD, tooltip, summary, settings, ending
tests/balance.test.ts     headless playthrough sim (SIMALL=1 prints every run)
```

## Dev URL flags

`?fresh` wipes the save · `?dev` adds currency (`L` adds more) · `?ownall` owns every node · `?lowfx` turns bloom off · `?dtcap=0.2` lets slow machines run in real time

## License

[MIT](LICENSE) © 2026 Necron60. This covers the game's own code.

Bundled dependencies keep their own licenses. Note that GSAP is free but not open source; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
