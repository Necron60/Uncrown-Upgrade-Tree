import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/500-italic.css';
import '@fontsource/cormorant-garamond/600-italic.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './ui/styles.css';
import { Game } from './game/Game';

const game = new Game();
game.init().catch((err) => {
  console.error(err);
  const boot = document.getElementById('boot');
  if (boot) boot.innerHTML = `<div class="boot-title">This browser could not start WebGL.<br/>${String(err?.message ?? err)}</div>`;
});

// handy for debugging from the console
(window as unknown as { game: Game }).game = game;
