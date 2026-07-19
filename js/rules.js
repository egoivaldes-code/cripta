// Reglas del juego: economía de Puntos de Acción (PA), interacción a distancia
// y adyacente, trampas, niebla y salida de nivel. Agnóstico del dibujo.

import { state, walkable, adjacent, distTo, isVisible, recomputeFog, computeReach, pathTo, reachCost, blockingTriggerAt, trapAt, walkTriggerAt, stepNeighbors, foeAt, livingFoes, losClear } from './state.js?v=0.10';
import { openEvent, openTrapCard, openStoryCard, syncHUD, log, gameOver } from './ui.js?v=0.10';
import { t } from './i18n.js?v=0.10';
import { MOVE_COST, ATTACK_COST } from './config.js?v=0.10';
import * as anim from './anim.js?v=0.10';
import { ANIM_CLIPS } from './anim.js?v=0.10';
import * as audio from './audio.js?v=0.10';

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
  if (!ev) return;   // sin evento conectado todavía: no hay pista que mostrar
  log(`<b>${t(ev.i18n + '.kicker')}</b> — ${t(ev.i18n + '.hint')}`);
  audio.fx('ui');
}

// Una trampa se activa sola al pisarla si no ha sido desarmada antes.
function triggerTrap(trap) {
  const ev = state.events[trap.id];
  const dmg = ev.trapDmg || 4;
  trap.used = true;
  anim.hurt('hero', 'hero'); anim.floatAt(state.hero.x, state.hero.y, `−${dmg}`, '#e86a5c'); audio.fx('hurt');
  state.hero.hp -= dmg;
  log(`<b>${t(ev.i18n + '.kicker')}</b> — ${t(ev.i18n + '.text')}`);
  syncHUD();
  if (state.hero.hp <= 0) gameOver('lose');
}

// Evento de ambientación que se dispara solo al pisar su casilla (no bloquea,
// no hace daño). Si no tiene datos conectados en events.json, no hace nada
// (en vez de romper el juego) para poder colocar "Eventos" de prueba sin miedo.
function triggerWalkEvent(tr) {
  const ev = state.events[tr.id];
  if (!ev) return;
  tr.used = true;
  if (ev.type === 'story') { openStoryCard(ev); return; }
  log(`<b>${t(ev.i18n + '.kicker')}</b> — ${t(ev.i18n + '.text')}`);
}

// Las trampas son invisibles hasta que el héroe TERMINA un movimiento justo
// al lado (arriba/abajo/izquierda/derecha; las diagonales no cuentan). Una
// vez reveladas se quedan visibles y se pueden intentar desactivar.
function revealTrapsNear(x, y) {
  for (const tr of state.triggers) {
    if (tr.type !== 'trap' || tr.used || tr.revealed) continue;
    const dx = Math.abs(tr.x - x), dy = Math.abs(tr.y - y);
    if (dx + dy === 1) tr.revealed = true;
  }
}

// Intento de desactivar una trampa ya revelada: 50% de acierto (se quita sin
// más), 50% de fallo (mitad del daño de pisarla, redondeado). Lo llama ui.js
// tras la tarjeta de confirmación.
export function attemptDisarm(trap) {
  const { hero } = state;
  const ev = state.events[trap.id];
  const cost = ev.actionCost || 1;
  if (hero.ap < cost) { log(t('log.noAP')); state.busy = false; return; }
  hero.ap -= cost; syncHUD();
  anim.activateAnim('hero', 'hero');
  if (Math.random() < 0.5) {
    trap.used = true;
    audio.fx('ui');
    log(`<b>${t(ev.i18n + '.kicker')}</b> — ${t(ev.i18n + '.disarmSuccess')}`);
  } else {
    const dmg = Math.round((ev.trapDmg || 4) / 2);
    anim.hurt('hero', 'hero'); anim.floatAt(hero.x, hero.y, `−${dmg}`, '#e86a5c'); audio.fx('hurt');
    hero.hp -= dmg;
    log(`<b>${t(ev.i18n + '.kicker')}</b> — ${t(ev.i18n + '.disarmFail', { dmg })}`);
  }
  syncHUD();
  state.busy = false;
  if (hero.hp <= 0) return gameOver('lose');
  computeReach();
  if (hero.ap <= 0) endHeroTurn();
}

// Cooldown entre ataques del héroe: sin esto, tocar dos veces rápido (o dos
// enemigos pegados) encadena los golpes sin dar tiempo a ver ni el primero.
const HERO_ATTACK_COOLDOWN = 1000;
let lastHeroAttackAt = 0;

// Acción del jugador al tocar una casilla (la llama render.js).
export function onTapTile(gx, gy) {
  const { hero } = state;

  // --- ¿Atacar al enemigo que hay en esta casilla? Pegado y con PA suficientes. ---
  const target = foeAt(gx, gy);
  if (target) {
    if (!adjacent(hero, gx, gy)) return;
    if (hero.ap < ATTACK_COST) { log(t('log.noAP')); return; }
    const now = performance.now();
    if (now - lastHeroAttackAt < HERO_ATTACK_COOLDOWN) return;   // demasiado seguido: se ignora este toque
    lastHeroAttackAt = now;
    hero.ap -= ATTACK_COST;
    anim.attack('hero', sign(gx - hero.x), sign(gy - hero.y), 'hero');
    anim.hurt(target.anim, target.sprite); anim.floatAt(target.x, target.y, `−${hero.atk}`, '#e86a5c');
    target.hp -= hero.atk;
    target.dormant = false;                 // si le pegas, despierta
    log(t('log.hitFoe', { dmg: hero.atk }));
    if (target.hp <= 0) {
      audio.fx('kill'); target.alive = false;
      if (state.targetFoe === target) state.targetFoe = null;
      if (ANIM_CLIPS[target.sprite]) { anim.die(target.anim); target.deathPlaying = true; }
      syncHUD();
      if (livingFoes().length === 0) return gameOver('win');
    } else {
      audio.fx('attack'); syncHUD();
    }
    computeReach();
    if (hero.ap <= 0) return endHeroTurn();
    return;
  }

  // --- ¿Objeto (cofre, altar, palanca, orbe, mesa, evento...)? Adyacente =
  // interactuar; a distancia = pista. Si todavía no tiene un evento conectado
  // en events.json (p.ej. un "Evento" recién colocado en el editor, sin
  // enlazar aún), no revienta: se avisa con un mensaje neutro y no pasa nada más. ---
  const tr = blockingTriggerAt(gx, gy);
  if (tr) {
    const d = distTo(hero, gx, gy);
    if (d <= 1) {
      const ev = state.events[tr.id];
      if (!ev) { log(t('log.noEventYet')); anim.activateAnim('hero', 'hero'); return; }
      const cost = ev.actionCost || 1;
      if (hero.ap < cost) { log(t('log.noAP')); return; }
      hero.ap -= cost; syncHUD();
      if (tr.type === 'chest') {
        // El cofre se abre DESPUÉS de resolver la tarjeta (ver afterInteract);
        // aquí solo se reproduce la animación de activar/inspeccionar.
        anim.activateAnim('hero', 'hero');
      } else if (['grave', 'item'].includes(tr.type)) {
        anim.loot('hero', 'hero');
      } else {
        anim.activateAnim('hero', 'hero');
      }
      openEvent(tr);
    } else if (isVisible(gx, gy)) {
      showHint(tr);
    }
    return;
  }

  // --- ¿Trampa ya descubierta? Adyacente = ofrece intentar desactivarla (con
  // su 50/50); a distancia = pista. Si no está revelada, es invisible: se
  // trata como suelo normal (ver el bloque de mover, más abajo). ---
  const trapHere = trapAt(gx, gy);
  if (trapHere && trapHere.revealed) {
    const d = distTo(hero, gx, gy);
    if (d <= 1) {
      openTrapCard(trapHere);
    } else if (isVisible(gx, gy)) {
      showHint(trapHere);
    }
    return;
  }

  // --- Mover (rango según PA restantes; rodea muros y objetos). ---
  const path = pathTo(gx, gy);
  if (!path) return;
  const cost = reachCost(gx, gy);   // ya incluye el extra por subir escalones
  hero.ap -= cost;
  hero.x = gx; hero.y = gy;
  anim.movePath('hero', path); audio.fx('move');
  recomputeFog();
  revealTrapsNear(gx, gy);
  syncHUD();

  // ¿Se cruza con alguna trampa sin desarmar por el camino? Se activa sola.
  // Lo mismo para los eventos de ambientación marcados como walkTrigger.
  for (const cell of path.slice(1)) {
    const trap = trapAt(cell.x, cell.y);
    if (trap) triggerTrap(trap);
    const wt = walkTriggerAt(cell.x, cell.y);
    if (wt) triggerWalkEvent(wt);
  }

  if (state.exit && gx === state.exit.x && gy === state.exit.y) { onDescend(); return; }

  computeReach();
  if (hero.hp > 0 && hero.ap <= 0) endHeroTurn();
}

// Se llama tras resolver la carta de un objeto (ui.js). El coste ya se
// descontó al abrirlo; aquí solo se refresca todo y se cierra turno si toca.
// Si era un cofre, aquí es cuando se abre de verdad (lootear + su propia
// animación), después del evento/tarjeta que hubiera, tal como se pidió.
export function afterInteract(trig) {
  if (trig && trig.type === 'chest') {
    anim.loot('hero', 'hero');
    anim.openProp(`prop:${trig.x}:${trig.y}`, 'chest');
  }
  computeReach();
  if (state.hero.hp > 0 && state.hero.ap <= 0) endHeroTurn();
}

// Fin del turno del héroe (botón, o automático al llegar a 0 PA).
export async function endHeroTurn() {
  await enemyAITurn();
  if (!state.busy) startHeroTurn();   // si busy=true, hay una carta de fin de partida abierta
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let aiTurnActive = false;
export function isAITurnActive() { return aiTurnActive; }

// --- Enemigos a distancia (arquero) ------------------------------------------
// Config por tipo de sprite: alcance de tiro y a qué distancia el héroe se
// considera "demasiado cerca" y toca huir. Un sprite que no esté aquí pelea
// cuerpo a cuerpo (comportamiento de siempre).
const RANGED_CFG = { enemy4: { range: 4, fleeAt: 2, shootCost: 3 } };

// Cuántos OTROS esqueletos vivos tiene a 2 casillas o menos (para el bonus de
// daño "más fuerte cuanto más rodeado").
function alliesWithin2(foe) {
  return livingFoes().filter(f => f !== foe && distTo(f, foe.x, foe.y) <= 2).length;
}

// El compañero vivo más cercano que quede por el lado OPUESTO al héroe (para
// huir "hacia el grupo"). null si no hay ninguno por ese lado.
function allyAwayFromHero(foe) {
  const { hero } = state;
  const ax = sign(foe.x - hero.x), ay = sign(foe.y - hero.y); // dirección de huida
  let best = null, bd = Infinity;
  for (const f of state.foes) {
    if (!f.alive || f === foe) continue;
    if ((f.x - foe.x) * ax + (f.y - foe.y) * ay <= 0) continue; // no está por el lado de huida
    const d = distTo(foe, f.x, f.y);
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}

// Mejor casilla para huir: se aleja del héroe (nunca se acerca), prefiere sitios
// despejados (más salidas, para no encerrarse) y, si hay compañero por el lado
// de huida, tira hacia él. null si está acorralado.
function fleeStep(foe, ap) {
  const { hero } = state;
  const cur = distTo(foe, hero.x, hero.y);
  const ally = allyAwayFromHero(foe);
  let best = null, bestScore = -Infinity;
  for (const [x, y, cost] of stepNeighbors(foe.x, foe.y)) {
    if (cost > ap || (x === hero.x && y === hero.y)) continue;
    const nd = distTo(hero, x, y);
    if (nd < cur) continue;                                   // no acercarse al héroe
    let score = nd * 100 + stepNeighbors(x, y).length * 3;    // lejos + despejado
    if (ally) {
      const before = distTo(foe, ally.x, ally.y);
      const after = Math.max(Math.abs(x - ally.x), Math.abs(y - ally.y));
      if (after < before) score += 25;                        // se acerca al compañero
    }
    if (score > bestScore) { bestScore = score; best = { x, y, cost }; }
  }
  return best;
}

// Mejor casilla para acercarse al héroe (lejos o sin línea de tiro). null si no
// puede acercarse más (no malgasta PA).
function approachStep(foe, ap) {
  const { hero } = state;
  const cur = distTo(foe, hero.x, hero.y);
  const step = stepNeighbors(foe.x, foe.y)
    .map(([x, y, cost]) => ({ x, y, cost }))
    .filter(p => !(p.x === hero.x && p.y === hero.y) && p.cost <= ap)
    .map(p => ({ ...p, d: distTo(hero, p.x, p.y) }))
    .sort((a, b) => a.d - b.d)[0];
  if (!step || step.d >= cur) return null;
  return step;
}

function doMove(foe, step) {
  const fromX = foe.x, fromY = foe.y;
  foe.x = step.x; foe.y = step.y;
  anim.move(foe.anim, fromX, fromY, step.x, step.y);
}

// El arquero dispara: daño = base + 1 por cada esqueleto a 2 casillas (tope +4).
// Devuelve true si el héroe muere (fin de partida).
function archerShoot(foe) {
  const { hero } = state;
  const dmg = foe.atk + Math.min(4, alliesWithin2(foe));
  anim.attack(foe.anim, sign(hero.x - foe.x), sign(hero.y - foe.y), foe.sprite);
  anim.hurt('hero', 'hero'); anim.floatAt(hero.x, hero.y, `−${dmg}`, '#e86a5c'); audio.fx('hurt');
  hero.hp -= dmg;
  log(t('log.hitHero', { dmg }));
  syncHUD();
  if (hero.hp <= 0) { gameOver('lose'); return true; }
  return false;
}

// Turno de un arquero. Prioridad por cada punto de acción:
//  1) héroe demasiado cerca -> huir (alejarse lo máximo posible);
//  2) a tiro y con el tiro despejado -> disparar;
//  3) lejos o con una pared de por medio -> acercarse para tenerlo a tiro.
// Devuelve true si el héroe muere.
async function archerTurn(foe, cfg) {
  const { hero } = state;
  let ap = foe.apMax;
  while (ap > 0) {
    const d = distTo(foe, hero.x, hero.y);
    const canSee = losClear(foe.x, foe.y, hero.x, hero.y);
    if (d <= cfg.fleeAt) {                                     // 1) huir
      const fs = fleeStep(foe, ap);
      if (fs) { doMove(foe, fs); ap -= fs.cost; await sleep(190); continue; }
      // acorralado sin salida: si tiene el tiro despejado, dispara a bocajarro (bloque 2)
    }
    if (d <= cfg.range && canSee) {                           // 2) a tiro y con visión
      if (ap >= cfg.shootCost) {
        ap -= cfg.shootCost;
        if (archerShoot(foe)) return true;
        await sleep(320);
        continue;
      }
      break;   // en posición pero sin PA para otro tiro: se queda quieto, no se acerca al héroe
    }
    if (ap >= MOVE_COST) {                                     // 3) lejos o sin visión: acercarse
      const as = approachStep(foe, ap);
      if (as) { doMove(foe, as); ap -= as.cost; await sleep(190); continue; }
    }
    break;
  }
  return false;
}

// Turno de un enemigo cuerpo a cuerpo (comportamiento de siempre). Devuelve true
// si el héroe muere.
async function meleeTurn(foe) {
  const { hero } = state;
  let ap = foe.apMax;
  while (ap > 0) {
    if (adjacent(foe, hero.x, hero.y)) {
      if (ap < ATTACK_COST) break;
      ap -= ATTACK_COST;
      anim.attack(foe.anim, sign(hero.x - foe.x), sign(hero.y - foe.y), foe.sprite);
      anim.hurt('hero', 'hero'); anim.floatAt(hero.x, hero.y, `−${foe.atk}`, '#e86a5c'); audio.fx('hurt');
      hero.hp -= foe.atk;
      log(t('log.hitHero', { dmg: foe.atk }));
      syncHUD();
      if (hero.hp <= 0) { gameOver('lose'); return true; }
      await sleep(320);
      continue;
    }
    if (ap < MOVE_COST) break;
    const step = approachStep(foe, ap);
    if (!step) break;                                          // no puede acercarse más
    doMove(foe, step);
    ap -= step.cost;
    await sleep(190);
  }
  return false;
}

// Turno del enemigo: cada uno gasta su presupuesto de PA interno (no se muestra).
// El arquero usa su propia lógica (disparar/huir); el resto, cuerpo a cuerpo.
// Cada acción espera un poco antes de la siguiente para que se vea (si no, se
// pisan entre sí y parece que el turno pasa instantáneo).
export async function enemyAITurn() {
  aiTurnActive = true;
  try {
    const { hero } = state;
    for (const foe of state.foes) {
      if (!foe.alive) continue;

      // Enemigo dormido: solo despierta si el héroe está a wakeR casillas o menos.
      if (foe.dormant) {
        if (distTo(foe, hero.x, hero.y) <= foe.wakeR) { foe.dormant = false; syncHUD(); }
        else continue;
      }

      const cfg = RANGED_CFG[foe.sprite];
      const heroDied = cfg ? await archerTurn(foe, cfg) : await meleeTurn(foe);
      if (heroDied) return;
    }
  } finally {
    aiTurnActive = false;
  }
  syncHUD();
}
