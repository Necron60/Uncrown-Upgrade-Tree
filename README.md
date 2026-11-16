# Uncrown

A browser upgrade-tree game that puts animation, light and game feel first.

You are a seed of light in the void. **Harvest** in short runs where your lens shatters crystal shards for Lumen, then spend it in the **Bloom**, a radial constellation of 44 upgrades that grows out from the seed. Buy all four keystones and **Awaken the Seed**.

The two trees:

1. **The Bloom** is the tutorial, about 40 minutes. It introduces one idea at a time (levels, mechanics, synergies, Prism, keystones), with a first-time tip when each one appears.
2. **The Hollow Crown** opens after the awakening and is the real game: a harder tree of 66 stars that takes a few hours. It has six branches with a playstyle each (Ember burns, Frost freezes, Storm calls lightning, Tide bends time, Gild hoards, Hollow feeds on hazards), its own currencies (Gloam and Sigils), and a fresh start. On top of that:
   - **Limited light:** every lit star uses light, so a build is a choice. Right-click (or hold) a star to *unweave* it for 75% back.
   - **Forks:** the fourth ring of every branch is an either/or.
   - **Trials:** rings 2 to 5 stay sealed until a harvest meets their gate's challenge. Every gate deepens the void, so shards get tougher and richer.
   - **Hazards:** warded, thief, dimmer and skittish shards fight back. They are the only source of Sigils.
   - **Curses:** six strong stars that come with a drawback and burn no light.
   - **The Hollow Heart:** a boss that rises once every ring is open. Its wounds stay from one harvest to the next. Break it, then **Uncrown**.

Switch between the trees from the tree name at the top of the screen.

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
| Hollow Crown | right-click a lit star (touch: hold it) | unweave it: it goes dark, 75% of its price and its light come back |
| either tree | click the tree's name at the top | your trees: travel between the Bloom and the Hollow Crown |
| Bloom | click the seed / `Space` | begin a Harvest |
| Bloom | `C` · double-click empty space · `M` | recenter · recenter · mute |
| Harvest | move the mouse | steer the lens; it pulses automatically |
| Harvest | `Esc` · sliders icon | pause and open the settings; *End harvest* there ends the run early (you keep what you gathered) |
| Summary | `Space` · `R` | back to the Bloom · harvest again |

## Settings

Press `Esc` (in the Bloom or during a harvest, which pauses it), or use the sliders icon. Every option saves automatically.

- **Graphics:** a low/medium/high preset; glow off/soft/full; render resolution 50–100%; particle amount; simple or rich background; darkness of the void (off/dim/deep); frame-rate cap (30/60/120/max); frame counter.
- **Motion:** a *Reduced motion* master switch, plus individual control of screen-shake strength, camera moves (zooming into and out of the seed, opening and finale moves), distortion ripples, flash strength (below 50%, scene changes fade to dark instead of white), slow motion / hit-stop, and ambient motion. Everything starts on, whatever the OS motion preference.
- **Sound:** master volume; music volume, which piece plays (or all in turn) and how loud it is during a harvest; separate volumes for shattering, special shards and the interface; hover sounds on/off; reverb; silence while the tab is hidden.
- **Interface:** interface size, damage numbers, hints, and skipping the harvest summary.
- **Records:** lifetime stats, plus *Begin anew* to wipe your save.

## Tech

- **Vite + TypeScript**
- **PixiJS 8** (WebGL) for rendering. All art is generated at runtime, so there are no image assets.
- **GSAP** for every tween and timeline.
- **pixi-filters**: bloom, plus shockwave ripples on keystones and the finale.
- **Web Audio**: a soundtrack by Scott Buckley (CC-BY 4.0, streamed) under calm CC0 sound effects (kalimba, soft vibraphone, marimba, chimes and drums from VCSL; a singing bowl and bubble pops from BigSoundBank) re-pitched onto a pentatonic scale, with a generated reverb. In a Harvest only breaking shards make a sound. Credits are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **HTML/CSS** overlay for the HUD, tooltips and modals: quiet solid panels, one ice accent for state, gold only for Lumen; a system UI font for labels and numbers, Cormorant Garamond for names and titles.

## Hosting

The game is static (Vite build in `dist/`) and runs anywhere. On Vercel it also gets **Discord sign-in and cloud saves**, on the same infrastructure as the Rejoin verify panel and wiki: the same OAuth flow, and a small save service on the same VPS behind the same nginx.

```
browser ──Discord OAuth──> /api/login, /api/callback   (signed cookie, 30 days, identify scope only)
        ──/api/me────────> who is signed in (the game asks before it boots)
        ──/api/save──────> proxy (adds SAVES_TOKEN) ──> server/saves.mjs on the VPS, one JSON file per account
```

Without `/api` (local dev, any other host) the account button hides itself and the game keeps its save in the browser only. Signed in, the browser save stays the working copy. The cloud copy is read once at boot (the one with more play time wins) and written a few seconds after each save. A device that has fallen behind is refused (409) instead of overwriting newer progress, and *Begin anew* forces its reset through.

### 1. Save service on the VPS

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"   # SAVES_TOKEN
```

```powershell
ssh root@107.152.36.220 "mkdir -p /opt/uncrown-saves"
scp server\saves.mjs root@107.152.36.220:/opt/uncrown-saves/
scp server\uncrown-saves.service root@107.152.36.220:/etc/systemd/system/
ssh root@107.152.36.220 "umask 077 && echo SAVES_TOKEN=<token> > /etc/uncrown-saves.env && systemctl daemon-reload && systemctl enable --now uncrown-saves"
```

It listens on `127.0.0.1:48760` and keeps its files in `/var/lib/uncrown-saves` (with one `.prev.json` of history per account). Give it a path on the nginx server block that already serves `107-152-36-220.sslip.io` for the verify bot:

```nginx
location /uncrown/ {
    proxy_pass http://127.0.0.1:48760/;
    client_max_body_size 128k;
}
```

`nginx -t && systemctl reload nginx`, then `curl https://107-152-36-220.sslip.io/uncrown/health` should answer `{"ok":true}`. Code updates are the first `scp` plus `systemctl restart uncrown-saves`.

### 2. Discord

Developer Portal → the verify panel's application (or any other) → OAuth2 → add the redirect `https://<this game's domain>/api/callback`, exactly, no trailing slash.

### 3. Vercel

The project is linked as `uncrown` (`.vercel/`). Set the variables in [.env.example](.env.example) for Production: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `SESSION_SECRET`, `PUBLIC_URL`, `SAVES_API_URL`, `SAVES_TOKEN`. Then `vercel deploy --prod`. `vercel.json` pins the Vite build; the functions come from `api/` (files starting with `_` are helpers, not routes).

`npm test` covers the login cookie (forgery, foreign key, expiry) and runs the save service for real: token, path checks, the behind-device refusal, the forced reset and the write limit.

## Project layout

```
src/data/tree.ts          node and tree types, branch colours, light costs
src/data/trees/bloom.ts   Tree I, the Bloom: 46 nodes (polar layout, costs, modifiers)
src/data/trees/crown.ts   Tree II, the Hollow Crown: 68 nodes, trials, shard tiers, light
src/data/stats.ts         stat model + computeStats()
src/systems/tree-logic.ts unlock/visibility/cost/light/fork/gate/unweave rules (pure, unit-tested)
src/scenes/TreeScene.ts   one tree on screen: camera, nodes, branches, gates, purchase/reveal choreography
src/scenes/HarvestScene.ts the run: lens, shards, hazards, fire, frost, lightning, the Hollow Heart, motes
src/render/               generated textures, particle system, starfield, icons, shake
src/ui/                   HUD, tooltip, summary, settings, tree picker, ending, tips
src/core/cloud.ts         Discord account + cloud save mirror (client side)
api/                      Vercel functions: Discord login, session, save proxy
server/                   the save service and its systemd unit, for the VPS
tests/balance.test.ts     headless playthrough sim of the Bloom (SIMALL=1 prints every run)
tests/crown-sim.ts        pacing model of the Hollow Crown (hazards, light, trials, the Hollow Heart)
tests/crown-balance.test.ts plays every pair of its branches through, both sides of every fork
tests/cloud.test.mjs      login cookie + save service checks
```

## Dev URL flags

`?fresh` wipes the save · `?dev` adds currency (`L` adds more) · `?ownall` owns every node of the tree on screen · `?crown` opens the Hollow Crown · `?trials` passes its trials · `?bootdemo` slows the loading screen down · `?lowfx` turns bloom off · `?dtcap=0.2` lets slow machines run in real time

## License

[MIT](LICENSE) © 2026 Necron60. This covers the game's own code.

Bundled dependencies keep their own licenses. Note that GSAP is free but not open source; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
