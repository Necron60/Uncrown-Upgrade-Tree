# Third-party notices

Uncrown's own source code is MIT-licensed (see [LICENSE](LICENSE)). The built game also bundles the following third-party software. Each keeps its own license.

| Package | License | Notes |
|---|---|---|
| [PixiJS](https://github.com/pixijs/pixijs) (`pixi.js`) | MIT | Rendering |
| [pixi-filters](https://github.com/pixijs/filters) | MIT | Bloom and shockwave filters |
| [GSAP](https://gsap.com) (`gsap`) | [GSAP Standard "No Charge" License](https://gsap.com/standard-license) | **Not open source.** It is free to use, including commercially, and is owned by Webflow. Its terms (not the MIT license) apply to GSAP itself. Forks must not use it in no-code visual animation tools that compete with Webflow. |
| [Cormorant Garamond](https://github.com/CatharsisFonts/Cormorant) via `@fontsource/cormorant-garamond` | SIL Open Font License 1.1 | Copyright 2015 The Cormorant Project Authors |
| [IBM Plex Mono](https://github.com/IBM/plex) via `@fontsource/ibm-plex-mono` | SIL Open Font License 1.1 | Copyright 2017 IBM Corp. |

Smaller transitive dependencies of PixiJS are MIT, ISC, or BSD-3-Clause licensed.

## Sounds

Every file in `public/sfx/` is [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain). Credit isn't required, but here it is. The sound effects were cut, trimmed, mixed to mono, peak-normalized and encoded as MP3; the music is the original file.

| Files | Source |
|---|---|
| `kal_*`, `vib_*`, `mar_*`, `chime_*`, `bell_*`, `marktree_*`, `vibes_bowed_*`, `zither_up_slow`, `drum_soft`, `gong_*`, `tubular_c4` | [Versilian Community Sample Library (VCSL)](https://github.com/sgossner/VCSL) by Versilian Studios: Tanzanian kalimba, soft-mallet vibraphone, marimba, hand chimes, bell tree, mark trees, bowed vibraphone, dan tranh glissando, frame drum, gong, tubular bells |
| `bowl` | [Tibetan bowl singing (#1109)](https://bigsoundbank.com/tibetan-bowl-singing-s1109.html), BigSoundBank (Joseph Sardin) |
| `pop_*` | [Bubbles Burst (#1074)](https://bigsoundbank.com/search?q=bubble), BigSoundBank |

## Music

The soundtrack in `public/music/` is by **Scott Buckley** and released under [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/): free to use, including commercially, **as long as he is credited**. The game credits him under Settings → Sound → Music. The tracks were re-encoded at a lower bitrate and loudness-matched to -16 LUFS; the music itself is unchanged.

- ['Adrift Among Infinite Stars'](https://www.scottbuckley.com.au/library/adrift-among-infinite-stars/) by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au
- ['Hymn To The Dawn'](https://www.scottbuckley.com.au/library/hymn-to-the-dawn/) by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au
- ['Cirrus'](https://www.scottbuckley.com.au/library/cirrus/) by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au
- ['A Kind Of Hope'](https://www.scottbuckley.com.au/library/a-kind-of-hope/) by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au

The full license texts ship inside each package in `node_modules/` after `npm install`. If you redistribute a build (`dist/`), keep this file with it. The SIL OFL requires its notice to travel with the font files.
