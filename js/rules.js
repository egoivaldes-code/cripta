// Reglas del juego: turnos, movimiento, combate, niebla y salida de nivel.
// Agnóstico del dibujo. Pide a `ui` mostrar eventos/HUD y a `anim` las animaciones.

import { state, walkable, adjacent, recomputeFog } from './state.js';
import { openEvent, syncHUD, log, gameOver } from './ui.js';
import { t } from './i18n.js';
import * as anim from './anim.js';
import * as audio from './audio.js';

const sign = (n) => Math.sign(n);

let onDescend = () => {};
export function bindDescend(fn) { onDescend = fn; } // lo cablea main (cargar nivel)

// Acción del jugador al tocar una casilla (la llama render.js).
export function onTapTile(gx, gy) {
  const { hero, foe } = state;
  if (!adjacent(hero, gx, gy)) return;

  // ¿Atacar al enemigo?
  if (foe.alive && foe.x === gx && foe.y === gy) {
    anim.attack('hero', sign(gx - hero.x), sign(gy - hero.y));
    anim.hurt('foe'); anim.floatAt(foe.x, foe.y, `−${hero.atk}`, '#e86a5c'); audio.fx('hit');
    foe.hp -= hero.atk;
    log(t('log.hitFoe', { dmg: hero.atk }));
    if (foe.hp <= 0) { foe.alive = false; syncHUD(); return gameOver('win'); }
    syncHUD();
    return enemyTurn();
  }

  // ¿Mover?
  if (!walkable(gx, gy)) return;
  const fromX = hero.x, fromY = hero.y;
  hero.x = gx; hero.y = gy;
  anim.move('hero', fromX, fromY, gx, gy); audio.fx('move');
  recomputeFog();

  // ¿Escalera de salida? -> cambia de nivel (fin del turno).
  if (state.exit && gx === state.exit.x && gy === state.exit.y) { onDescend(); return; }

  // ¿Punto de evento?
  const trig = state.triggers.find(tr => !tr.used && tr.x === gx && tr.y === gy);
  if (trig) { openEvent(trig); return; }

  enemyTurn();
}

// Turno del enemigo: acercarse un paso o atacar si está contiguo.
export function enemyTurn() {
  const { hero, foe } = state;
  if (!foe.alive) return;

  if (adjacent(foe, hero.x, hero.y)) {
    anim.attack('foe', sign(hero.x - foe.x), sign(hero.y - foe.y));
    anim.hurt('hero'); anim.floatAt(hero.x, hero.y, `−${foe.atk}`, '#e86a5c'); audio.fx('hit');
    hero.hp -= foe.atk;
    log(t('log.hitHero', { dmg: foe.atk }));
    syncHUD();
    if (hero.hp <= 0) return gameOver('lose');
    return;
  }

  const cur = Math.abs(foe.x - hero.x) + Math.abs(foe.y - hero.y);
  const step = [[0,-1],[0,1],[-1,0],[1,0]]
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
