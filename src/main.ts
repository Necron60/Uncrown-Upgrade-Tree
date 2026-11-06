import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/500-italic.css';
import '@fontsource/cormorant-garamond/600-italic.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './ui/styles.css';
import { Game } from './game/Game';
import { cloud } from './core/cloud';
import { boot } from './ui/boot';

boot.step(0.1, 'finding your save');
// the cloud save (if signed in) is settled first, so the game boots straight into the right progress
cloud
  .init()
  .then(() => {
    boot.step(0.2);
    const game = new Game();
    (window as unknown as { game: Game }).game = game; // handy for debugging from the console
    return game.init();
  })
  .catch((err) => {
    console.error(err);
    boot.fail(`This browser could not start the game (WebGL). ${String(err?.message ?? err)}`);
  });
