# Third-party notices

Uncrown's own source code is MIT-licensed (see [LICENSE](LICENSE)). The built game also bundles the following third-party software. Each keeps its own license.

| Package | License | Notes |
|---|---|---|
| [PixiJS](https://github.com/pixijs/pixijs) (`pixi.js`) | MIT | Rendering |
| [pixi-filters](https://github.com/pixijs/filters) | MIT | Bloom and shockwave filters |
| [GSAP](https://gsap.com) (`gsap`) | [GSAP Standard "No Charge" License](https://gsap.com/standard-license) | **Not open source.** It is free to use, including commercially, and is owned by Webflow. Its terms (not the MIT license) apply to GSAP itself. Forks must not use it in no-code visual animation tools that compete with Webflow. |
| [Chakra Petch](https://github.com/m4rc1e/Chakra-Petch) via `@fontsource/chakra-petch` | SIL Open Font License 1.1 | Copyright 2018 The Chakra Petch Project Authors |
| [Inter](https://github.com/rsms/inter) via `@fontsource-variable/inter` | SIL Open Font License 1.1 | Copyright 2016 The Inter Project Authors |

Smaller transitive dependencies of PixiJS are MIT, ISC, or BSD-3-Clause licensed.

The full license texts ship inside each package in `node_modules/` after `npm install`. If you redistribute a build (`dist/`), keep this file with it. The SIL OFL requires its notice to travel with the font files.
