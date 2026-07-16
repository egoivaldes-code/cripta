// Reglas del juego: economía de Puntos de Acción (PA), interacción a distancia
// y adyacente, trampas, niebla y salida de nivel. Agnóstico del dibujo.

import { state, walkable, adjacent, distTo, isVisible, recomputeFog, computeReach, pathTo, blockingTriggerAt, trapAt } from './state.js?v=0.3.1';
import { openEvent, syncHUD, log, gameOver } from './ui.js?v=0.3.1';
import { t } from './i18n.js?v=0.3.1';
import { MOVE_COST, ATTACK_COST } from './config.js?v=0.3.1';
import * as anim from './anim.js?v=0.3.1';
import * as audio from './audio.js?v=0.3.1';

const sign = (n) => Math.sign(n);

let onDescend = () => {};
export function bindDescend(fn) { onDescend = fn; }

// Empieza el turno del héroe: PA a tope y recalcula su alcance.
export function startHeroTurn() {
  state.hero.ap = state.hero.apMax;
  computeReach();
  syncHUD();
}

// Muestra la pista ambigua de un objeto visto a distancia (gratis, sin PA).
function showHint(tr) {
  const ev = state.events[tr.id];
  log(`<b>${t(ev.i18n + '.kicker')}</b> — ${t(ev.i18n + '.hint')}`);
  audio.fx('ui');
}

// Una trampa se activa sola al pisarla si no ha sido desarmada antes.
function triggerTrap(trap) {
  const ev = state.events[trap.id];
  const dmg = ev.trapDmg || 4;
  trap.used = true;
  anim.hurt('hero'); anim.floatAt(state.hero.x, state.hero.y, `−${dmg}`, '#e86a5c'); audio.fx('hit');
  state.hero.hp -= dmg;
  log(`<b>${t(ev.i18n + '.kicker')}</b> — ${t(ev.i18n + '.text')}`);
  syncHUD();
  if (state.hero.hp <= 0) gameOver('lose');
}

// Acción del jugador al tocar una casilla (la llama render.js).
export function onTapTile(gx, gy) {
  const { hero, foe } = state;

  // --- ¿Atacar? Requiere estar pegado y tener PA suficientes. ---
  if (foe.alive && foe.x === gx && foe.y === gy) {
    if (!adjacent(hero, gx, gy)) return;
    if (hero.ap < ATTACK_COST) { log(t('log.noAP')); return; }
    hero.ap -= ATTACK_COST;
    anim.attack('hero', sign(gx - hero.x), sign(gy - hero.y));
    anim.hurt('foe'); anim.floatAt(foe.x, foe.y, `−${hero.atk}`, '#e86a5c'); audio.fx('hit');
    foe.hp -= hero.atk;
    log(t('log.hitFoe', { dmg: hero.atk }));
    if (foe.hp <= 0) { foe.alive = false; syncHUD(); return gameOver('win'); }
    syncHUD();
    computeReach();
    if (hero.ap <= 0) return endHeroTurn();
    return;
  }

  // --- ¿Objeto (cofre, altar, palanca, orbe, mesa)? Adyacente = interactuar; a distancia = pista. ---
  const tr = blockingTriggerAt(gx, gy);
  if (tr) {
    const d = distTo(hero, gx, gy);
    if (d <= 1) {
      const cost = state.events[tr.id].actionCost || 1;
      if (hero.ap < cost) { log(t('log.noAP')); return; }
      hero.ap -= cost; syncHUD();
      openEvent(tr);
    } else if (isVisible(gx, gy)) {
      showHint(tr);
    }
    return;
  }

  // --- ¿Trampa? Adyacente = desarmar (gasta PA); a distancia = pista. Tocarla directamente
  // nunca te mueve encima sin querer; para cruzarla, mueve el destino más allá (ver abajo). ---
  const trapHere = trapAt(gx, gy);
  if (trapHere) {
    const d = distTo(hero, gx, gy);
    if (d <= 1) {
      const cost = state.events[trapHere.id].actionCost || 1;
      if (hero.ap < cost) { log(t('log.noAP')); return; }
      hero.ap -= cost; syncHUD();
      trapHere.used = true;
      log(`<b>${t(state.events[trapHere.id].i18n + '.kicker')}</b> — ${t('log.trapDisarm')}`);
      computeReach();
      if (hero.ap <= 0) endHeroTurn();
    } else if (isVisible(gx, gy)) {
      showHint(trapHere);
    }
    return;
  }

  // --- Mover (rango según PA restantes; rodea muros y objetos). ---
  const path = pathTo(gx, gy);
  if (!path) return;
  const cost = path.length - 1;
  hero.ap -= cost;
  hero.x = gx; hero.y = gy;
  anim.movePath('hero', path); audio.fx('move');
  recomputeFog();
  syncHUD();

  // ¿Se cruza con alguna trampa sin desarmar por el camino? Se activa sola.
  for (const cell of path.slice(1)) {
    const trap = trapAt(cell.x, cell.y);
    if (trap) triggerTrap(trap);
  }

  if (state.exit && gx === state.exit.x && gy === state.exit.y) { onDescend(); return; }

  computeReach();
  if (hero.hp > 0 && hero.ap <= 0) endHeroTurn();
}

// Se llama tras resolver la carta de un objeto (ui.js). El coste ya se
// descontó al abrirlo; aquí solo se refresca todo y se cierra turno si toca.
export function afterInteract() {
  computeReach();
  if (state.hero.hp > 0 && state.hero.ap <= 0) endHeroTurn();
}

// Fin del turno del héroe (botón, o automático al llegar a 0 PA).
export function endHeroTurn() {
  enemyAITurn();
  if (!state.busy) startHeroTurn();   // si busy=true, hay una carta de fin de partida abierta
}

// Turno del enemigo: presupuesto de PA interno (no se muestra en pantalla).
// Se acerca mientras le rinda, y ataca si queda pegado y le alcanzan los PA
// (puede encadenar varios ataques, igual que el héroe).
export function enemyAITurn() {
  const { hero, foe } = state;
  if (!foe.alive) return;
  let ap = foe.apMax;

  while (ap > 0) {
    if (adjacent(foe, hero.x, hero.y)) {
      if (ap < ATTACK_COST) break;
      ap -= ATTACK_COST;
      anim.attack('foe', sign(hero.x - foe.x), sign(hero.y - foe.y));
      anim.hurt('hero'); anim.floatAt(hero.x, hero.y, `−${foe.atk}`, '#e86a5c'); audio.fx('hit');
      hero.hp -= foe.atk;
      log(t('log.hitHero', { dmg: foe.atk }));
      syncHUD();
      if (hero.hp <= 0) { gameOver('lose'); return; }
      continue;
    }
    if (ap < MOVE_COST) break;
    const cur = distTo(foe, hero.x, hero.y);
    const step = [[0,-1],[0,1],[-1,0],[1,0]]
      .map(([dx, dy]) => ({ x: foe.x + dx, y: foe.y + dy }))
      .filter(p => walkable(p.x, p.y) && !(p.x === hero.x && p.y === hero.y))
      .map(p => ({ ...p, d: distTo(hero, p.x, p.y) }))
      .sort((a, b) => a.d - b.d)[0];
    if (!step || step.d >= cur) break;   // no puede acercarse más: no malgasta el resto de PA
    const fromX = foe.x, fromY = foe.y;
    foe.x = step.x; foe.y = step.y;
    anim.move('foe', fromX, fromY, step.x, step.y);
    ap -= MOVE_COST;
  }
  syncHUD();
}
