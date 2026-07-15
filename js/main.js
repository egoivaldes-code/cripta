// Punto de entrada. Carga los datos, conecta los módulos y arranca el bucle.
// Aquí se "cablea" todo para que los demás módulos no dependan en círculo.

import { state, initGame } from './state.js';
import { initRenderer, startLoop } from './render.js';
import { onTapTile, enemyTurn } from './rules.js';
import { syncHUD, log, hideVeil, bindAfterChoice, bindRestart } from './ui.js';
import { loadAssets } from './assets.js';
import * as anim from './anim.js';

const INTRO = 'Toca una casilla contigua para moverte. Alcanza los <b>puntos ámbar</b>.';

async function boot() {
  // Los eventos y el nivel viven en /data como JSON (fetch necesita http://).
  const [events, level] = await Promise.all([
    fetch('./data/events.json').then(r => r.json()),
    fetch('./data/level1.json').then(r => r.json()),
  ]);

  // Precarga del tileset. Si falla, el juego cae a colores planos (no bloquea).
  await loadAssets().catch(err => console.warn('Assets:', err.message));

  function newGame() {
    initGame(level, events);
    anim.reset();
    hideVeil();
    syncHUD();
    log(INTRO);
  }

  // Inyección de dependencias: rompe el ciclo ui <-> rules.
  bindAfterChoice(enemyTurn); // qué hace la UI tras elegir en una carta
  bindRestart(newGame);       // qué hace el botón "Otra incursión"

  initGame(level, events);            // estado listo antes de medir el canvas
  initRenderer(document.getElementById('map'), onTapTile);
  startLoop();
  newGame();

  document.getElementById('reset').addEventListener('click', newGame);
}

boot().catch(err => {
  console.error(err);
  document.getElementById('log').innerHTML =
    'No pude cargar los datos. Si abriste el archivo como <b>file://</b>, ' +
    'súbelo a un servidor (p. ej. GitHub Pages) o sírvelo por http://.';
});
