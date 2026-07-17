// Reglas del juego: economía de Puntos de Acción (PA), interacción a distancia
// y adyacente, trampas, niebla y salida de nivel. Agnóstico del dibujo.

import { state, walkable, adjacent, distTo, isVisible, recomputeFog, computeReach, pathTo, blockingTriggerAt, trapAt, stepNeighbors, foeAt, livingFoes } from './state.js?v=0.4';
import { openEvent, syncHUD, log, gameOver } from './ui.js?v=0.4';
import { t } from './i18n.js?v=0.4';
import { MOVE_COST, ATTACK_COST } from './config.js?v=0.4';
import * as anim from './anim.js?v=0.4';
import * as audio from './audio.js?v=0.4';

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
  anim.hurt('hero'); anim.floatAt(state.hero.x, state.hero.y, `−${dmg}`, '#e86a5c'); audio.fx('hurt');
  state.hero.hp -= dmg;
  log(`<b>${t(ev.i18n + '.kicker')}</b> — ${t(ev.i18n + '.text')}`);
  syncHUD();
  if (state.hero.hp <= 0) gameOver('lose');
}

// Acción del jugador al tocar una casilla (la llama render.js).
export function onTapTile(gx, gy) {
  const { hero } = state;

  // --- ¿Atacar al enemigo que hay en esta casilla? Pegado y con PA suficientes. ---
  const target = foeAt(gx, gy);
  if (target) {
    if (!adjacent(hero, gx, gy)) return;
    if (hero.ap < ATTACK_COST) { log(t('log.noAP')); return; }
    hero.ap -= ATTACK_COST;
    anim.attack('hero', sign(gx - hero.x), sign(gy - hero.y));
    anim.hurt(target.anim); anim.floatAt(target.x, target.y, `−${hero.atk}`, '#e86a5c');
    target.hp -= hero.atk;
    target.dormant = false;                 // si le pegas, despierta
    log(t('log.hitFoe', { dmg: hero.atk }));
    if (target.hp <= 0) {
      audio.fx('kill'); target.alive = false; syncHUD();
      if (livingFoes().length === 0) return gameOver('win');
    } else {
      audio.fx('attack'); syncHUD();
    }
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
  const { hero } = state;
  for (const foe of state.foes) {
    if (!foe.alive) continue;

    // Enemigo dormido: solo despierta si el héroe está a wakeR casillas o menos.
    if (foe.dormant) {
      if (distTo(foe, hero.x, hero.y) <= foe.wakeR) foe.dormant = false;
      else continue;
    }

    let ap = foe.apMax;
    while (ap > 0) {
      if (adjacent(foe, hero.x, hero.y)) {
        if (ap < ATTACK_COST) break;
        ap -= ATTACK_COST;
        anim.attack(foe.anim, sign(hero.x - foe.x), sign(hero.y - foe.y));
        anim.hurt('hero'); anim.floatAt(hero.x, hero.y, `−${foe.atk}`, '#e86a5c'); audio.fx('hurt');
        hero.hp -= foe.atk;
        log(t('log.hitHero', { dmg: foe.atk }));
        syncHUD();
        if (hero.hp <= 0) { gameOver('lose'); return; }
        continue;
      }
      if (ap < MOVE_COST) break;
      const cur = distTo(foe, hero.x, hero.y);
      const step = stepNeighbors(foe.x, foe.y)
        .map(([x, y]) => ({ x, y }))
        .filter(p => !(p.x === hero.x && p.y === hero.y))
        .map(p => ({ ...p, d: distTo(hero, p.x, p.y) }))
        .sort((a, b) => a.d - b.d)[0];
      if (!step || step.d >= cur) break;   // no puede acercarse más: no malgasta PA
      const fromX = foe.x, fromY = foe.y;
      foe.x = step.x; foe.y = step.y;
      anim.move(foe.anim, fromX, fromY, step.x, step.y);
      ap -= MOVE_COST;
    }
  }
  syncHUD();
}
