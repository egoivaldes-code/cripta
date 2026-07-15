// Reglas del juego: turnos, movimiento y combate.
// Es agnóstico del dibujo. Pide a `ui` que muestre eventos y actualice el HUD.

import { state, walkable, adjacent } from './state.js';
import { openEvent, syncHUD, log, gameOver } from './ui.js';
import * as anim from './anim.js';

const sign = (n) => Math.sign(n);

// Acción del jugador al tocar una casilla (la llama render.js).
export function onTapTile(gx, gy) {
  const { hero, foe } = state;
  if (!adjacent(hero, gx, gy)) return; // solo casillas contiguas

  // ¿Atacar al enemigo?
  if (foe.alive && foe.x === gx && foe.y === gy) {
    anim.attack('hero', sign(gx - hero.x), sign(gy - hero.y));
    foe.hp -= hero.atk;
    log(`Golpeas al acechador. <span class="dmg">−${hero.atk}</span>`);
    if (foe.hp <= 0) { foe.alive = false; syncHUD(); return gameOver('win'); }
    syncHUD();
    return enemyTurn();
  }

  // ¿Mover?
  if (!walkable(gx, gy)) return; // muro: no pasa nada
  const fromX = hero.x, fromY = hero.y;
  hero.x = gx; hero.y = gy;
  anim.move('hero', fromX, fromY, gx, gy);

  // ¿He pisado un punto de evento?
  const trig = state.triggers.find(t => !t.used && t.x === gx && t.y === gy);
  if (trig) { openEvent(trig); return; } // el turno se cierra al elegir

  enemyTurn();
}

// Turno del enemigo: acercarse un paso o atacar si está contiguo.
export function enemyTurn() {
  const { hero, foe } = state;
  if (!foe.alive) return;

  if (adjacent(foe, hero.x, hero.y)) {
    anim.attack('foe', sign(hero.x - foe.x), sign(hero.y - foe.y));
    hero.hp -= foe.atk;
    log(`El acechador te alcanza. <span class="dmg">−${foe.atk}</span>`);
    syncHUD();
    if (hero.hp <= 0) return gameOver('lose');
    return;
  }

  const cur = Math.abs(foe.x - hero.x) + Math.abs(foe.y - hero.y);
  const step = [[0, -1], [0, 1], [-1, 0], [1, 0]]
    .map(([dx, dy]) => ({ x: foe.x + dx, y: foe.y + dy }))
    .filter(p => walkable(p.x, p.y) && !(p.x === hero.x && p.y === hero.y))
    .map(p => ({ ...p, d: Math.abs(p.x - hero.x) + Math.abs(p.y - hero.y) }))
    .sort((a, b) => a.d - b.d)[0];

  if (step && step.d < cur) {
    const fromX = foe.x, fromY = foe.y;
    foe.x = step.x; foe.y = step.y;
    anim.move('foe', fromX, fromY, step.x, step.y);
  }
  syncHUD();
}
