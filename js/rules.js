// Reglas del juego: economía de Puntos de Acción (PA), interacción a distancia
// y adyacente, trampas, niebla y salida de nivel. Agnóstico del dibujo.

import { state, walkable, adjacent, distTo, isVisible, recomputeFog, computeReach, pathTo, reachCost, blockingTriggerAt, trapAt, walkTriggerAt, stepNeighbors, foeAt, livingFoes, losClear } from './state.js?v=0.13.2';
import { openEvent, openTrapCard, openStoryCard, syncHUD, syncInitiativeUI, showCombatBadge, log, gameOver } from './ui.js?v=0.13.2';
import { t } from './i18n.js?v=0.13.2';
import { MOVE_COST, ATTACK_COST, INITIATIVE_BASE, INITIATIVE_DIE, TURN_DELAY } from './config.js?v=0.13.2';
import * as anim from './anim.js?v=0.13.2';
import { ANIM_CLIPS } from './anim.js?v=0.13.2';
import * as audio from './audio.js?v=0.13.2';

const sign = (n) => Math.sign(n);

// --- Resolución de combate (esquivar → bloquear → crítico → armadura/resistencia) ---
// Ver combat_stats_v0.11.md para el diseño. Los monstruos NUNCA critean al
// héroe; el héroe SÍ puede critear a los monstruos (los monstruos no tienen
// esquivar/bloquear/armadura propios todavía, solo el héroe las tiene).
const CRIT_MULT = 2;
const EVADE_COLOR = '#9aa0ab';
const CRIT_COLOR = '#f0c94a';

// Golpe del HÉROE contra un enemigo: solo puede critear (x2), nada más.
function resolveHeroHit(baseDamage) {
  const crit = Math.random() < (state.hero.critChance || 0);
  return { damage: crit ? Math.round(baseDamage * CRIT_MULT) : baseDamage, crit };
}

// Golpe de un ENEMIGO contra el héroe: esquivar → bloquear → armadura/resistencia.
// damageType: 'physical' | 'fire' | 'cold' | 'nature' | 'shadow' | 'holy'
function resolveIncomingHit(baseDamage, damageType = 'physical') {
  const hero = state.hero;
  if (Math.random() < (hero.dodgeChance || 0)) return { damage: 0, evaded: true, blocked: false };
  if (hero.hasShield && Math.random() < (hero.blockChance || 0)) return { damage: 0, evaded: false, blocked: true };
  const mitig = damageType === 'physical' ? (hero.armor || 0) : ((hero.resist && hero.resist[damageType]) || 0);
  const damage = Math.max(0, Math.round(baseDamage * (1 - mitig)));
  return { damage, evaded: false, blocked: false };
}

// Aplica un golpe ya resuelto al héroe: pone el número flotante correcto
// (Esquivado / Bloqueado / daño normal) y resta la vida. Devuelve el daño
// final aplicado (0 si se ha esquivado o bloqueado).
function applyIncomingHit(baseDamage, damageType, color) {
  const hero = state.hero;
  const r = resolveIncomingHit(baseDamage, damageType);
  if (r.evaded) { anim.floatAt(hero.x, hero.y, 'Esquivado', EVADE_COLOR); return 0; }
  if (r.blocked) { anim.floatAt(hero.x, hero.y, 'Bloqueado', EVADE_COLOR); return 0; }
  anim.floatAt(hero.x, hero.y, `−${r.damage}`, color);
  hero.hp -= r.damage;
  return r.damage;
}

let onDescend = () => {};
export function bindDescend(fn) { onDescend = fn; }

// --- Iniciativa -------------------------------------------------------------
// Tirada de iniciativa: base por tipo + 1-6, una sola vez por escaramuza (no
// se vuelve a tirar cada ronda). El héroe usa hero.initiativeBonus (0 por
// defecto; hueco reservado para cuando el equipo pueda sumar iniciativa).
function rollInitiative(base) {
  return base + 1 + Math.floor(Math.random() * INITIATIVE_DIE);
}

// Mete a un combatiente (el héroe o un enemigo) en la cola de iniciativa si
// todavía no estaba. Se cuela en el hueco que le toque ESTA ronda si su
// tirada supera a alguien que aún no ha actuado; si no, entra al final y
// esperará a la ronda siguiente.
function enterCombat(ref) {
  const wasActive = state.combat.active;
  if (!wasActive) { state.combat.active = true; state.combat.order = []; state.combat.idx = 0; }
  if (state.combat.order.some(o => o.ref === ref)) return;
  const base = ref === 'hero'
    ? (state.hero.initiativeBase ?? INITIATIVE_BASE.hero) + (state.hero.initiativeBonus || 0)
    : (INITIATIVE_BASE[ref.sprite] ?? 6);
  const entry = { ref, initiative: rollInitiative(base) };
  const remaining = state.combat.order.slice(state.combat.idx);
  const gap = remaining.findIndex(o => o.initiative < entry.initiative);
  if (gap === -1) state.combat.order.push(entry);
  else state.combat.order.splice(state.combat.idx + gap, 0, entry);
  if (!wasActive) showCombatBadge();
}

// Revisa si algún enemigo dormido ha quedado a tiro (o ya estaba despierto,
// p.ej. por un golpe directo) y aún no está en la cola; si es así, entra en
// combate. Se llama al terminar el turno del héroe (mismo momento en que
// antes se comprobaba el despertar de los enemigos).
function scanForNewCombatants() {
  const { hero } = state;
  for (const f of state.foes) {
    if (!f.alive) continue;
    if (f.dormant) {
      if (distTo(f, hero.x, hero.y) <= f.wakeR) { f.dormant = false; syncHUD(); }
      else continue;
    }
    enterCombat(f);
  }
  if (state.combat.active) enterCombat('hero');
}

// Si ya no queda ningún enemigo vivo, se acaba el combate (oculta la barra de
// iniciativa). No afecta a la victoria/derrota, que ya se gestiona aparte.
function checkCombatEnd() {
  if (state.combat.active && livingFoes().length === 0) {
    state.combat.active = false;
    state.combat.order = [];
    state.combat.idx = 0;
    syncInitiativeUI();
  }
}

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

// Una trampa se activa sola al pisarla si no ha sido desarmada antes. Si por
// lo que sea no tiene un evento conectado en events.json, usa un daño por
// defecto y un aviso genérico en vez de reventar (mismo criterio que ya se
// aplica a los objetos "mueble" sin evento).
function triggerTrap(trap) {
  const ev = state.events[trap.id];
  const dmg = (ev && ev.trapDmg) || 4;
  trap.used = true;
  anim.hurt('hero', 'hero'); anim.floatAt(state.hero.x, state.hero.y, `−${dmg}`, '#e86a5c'); audio.fx('hurt');
  state.hero.hp -= dmg;
  if (ev) log(`<b>${t(ev.i18n + '.kicker')}</b> — ${t(ev.i18n + '.text')}`);
  else log(t('log.noEventYet'));
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
  const cost = (ev && ev.actionCost) || 1;
  if (hero.ap < cost) { log(t('log.noAP')); state.busy = false; return; }
  hero.ap -= cost; syncHUD();
  anim.activateAnim('hero', 'hero');
  if (Math.random() < 0.5) {
    trap.used = true;
    audio.fx('ui');
    if (ev) log(`<b>${t(ev.i18n + '.kicker')}</b> — ${t(ev.i18n + '.disarmSuccess')}`);
    else log(t('log.noEventYet'));
  } else {
    const dmg = Math.round(((ev && ev.trapDmg) || 4) / 2);
    anim.hurt('hero', 'hero'); anim.floatAt(hero.x, hero.y, `−${dmg}`, '#e86a5c'); audio.fx('hurt');
    hero.hp -= dmg;
    if (ev) log(`<b>${t(ev.i18n + '.kicker')}</b> — ${t(ev.i18n + '.disarmFail', { dmg })}`);
    else log(t('log.noEventYet'));
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
    const hit = resolveHeroHit(hero.atk);
    anim.hurt(target.anim, target.sprite);
    if (hit.crit) anim.floatAt(target.x, target.y, `¡CRÍTICO! −${hit.damage}`, CRIT_COLOR, { static: true });
    else anim.floatAt(target.x, target.y, `−${hit.damage}`, '#e86a5c');
    target.hp -= hit.damage;
    target.dormant = false;                 // si le pegas, despierta
    log(t('log.hitFoe', { dmg: hit.damage }));
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

// Fin del turno del héroe (botón, o automático al llegar a 0 PA). Detecta
// quién entra en combate, marca el hueco del héroe en la cola como ya hecho
// (la ronda de acciones que acaba de terminar ES su turno de iniciativa), y
// deja pasar a los enemigos que le toquen antes de que vuelva a él.
export async function endHeroTurn() {
  scanForNewCombatants();
  if (state.combat.active) {
    const heroIdx = state.combat.order.findIndex(o => o.ref === 'hero');
    if (heroIdx !== -1 && state.combat.idx <= heroIdx) state.combat.idx = heroIdx + 1;
    syncInitiativeUI();
    await sleep(TURN_DELAY);   // pausa al terminar el turno del héroe
    await runFoeQueue();
  }
  if (!state.busy) startHeroTurn();   // si busy=true, hay una carta de fin de partida abierta
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let aiTurnActive = false;
export function isAITurnActive() { return aiTurnActive; }

// Recorre la cola de iniciativa desde donde se quedó, actuando un enemigo
// cada vez (con pausa antes y después de cada uno), hasta llegar de nuevo al
// hueco del héroe — ahí se para y le devuelve el control al jugador. Si da
// la vuelta entera a la cola sin encontrarlo (no debería pasar, el héroe
// siempre está metido), empieza otra ronda desde el principio.
async function runFoeQueue() {
  aiTurnActive = true;
  try {
    while (state.combat.active && state.combat.order.length) {
      if (state.combat.idx >= state.combat.order.length) state.combat.idx = 0;   // nueva ronda
      const entry = state.combat.order[state.combat.idx];
      if (entry.ref === 'hero') break;   // le toca al jugador
      const foe = entry.ref;
      state.combat.idx++;
      if (!foe.alive) continue;
      syncInitiativeUI();
      const heroDied = await runSingleFoeTurn(foe);
      checkCombatEnd();
      if (heroDied || !state.combat.active) return;
      await sleep(TURN_DELAY);   // pausa al terminar el turno de este NPC
    }
  } finally {
    aiTurnActive = false;
  }
  syncHUD();
  syncInitiativeUI();
}

// El arquero, el espectro y el mago tienen su propia lógica; el resto pelea
// cuerpo a cuerpo (comportamiento de siempre). Devuelve true si el héroe muere.
function runSingleFoeTurn(foe) {
  const cfg = RANGED_CFG[foe.sprite];
  if (foe.sprite === 'enemy5') return spectreTurn(foe);
  if (foe.sprite === 'enemy6') return mageTurn(foe);
  if (cfg) return archerTurn(foe, cfg);
  return meleeTurn(foe);
}

// --- Espectro (enemy5): cuerpo a cuerpo con robo de vida en grupo -----------
// PA 4, golpe a 2 PA. Si al golpear tiene OTROS enemigos vivos a 2 casillas o
// menos, se cura un 10% del daño hecho por cada uno (tope 30% con 3+). Solo
// enemigos: si está solo, no cura nada, simplemente pega. Si está solo Y no
// está ya pegado al héroe, prefiere acercarse a otro compañero antes que al
// héroe (buscando compañía para poder robar vida), no directamente al héroe.
const SPECTRE_COST = 2;
const SHADOW_COLOR = '#b06bd6';
const HEAL_COLOR = '#6bd68f';

function nearestAlly(foe) {
  let best = null, bd = Infinity;
  for (const f of state.foes) {
    if (!f.alive || f === foe) continue;
    const d = distTo(foe, f.x, f.y);
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}

async function spectreTurn(foe) {
  const { hero } = state;
  let ap = foe.apMax;
  while (ap > 0) {
    if (adjacent(foe, hero.x, hero.y)) {
      if (ap < SPECTRE_COST) break;
      ap -= SPECTRE_COST;
      anim.attack(foe.anim, sign(hero.x - foe.x), sign(hero.y - foe.y), foe.sprite);
      audio.fx('hurt');
      const dmg = applyIncomingHit(foe.atk, 'physical', '#e86a5c');
      if (dmg > 0) anim.hurt('hero', 'hero');
      log(t('log.hitHero', { dmg }));
      const allies = livingFoes().filter(f => f !== foe && distTo(f, foe.x, foe.y) <= 2).length;
      if (dmg > 0 && allies > 0) {
        const healPct = Math.min(3, allies) * 0.10;
        const healed = Math.max(1, Math.round(dmg * healPct));
        foe.hp = Math.min(foe.maxHp, foe.hp + healed);
        anim.floatAt(foe.x, foe.y, `+${healed}`, HEAL_COLOR);
      }
      syncHUD();
      if (hero.hp <= 0) { gameOver('lose'); return true; }
      await sleep(320);
      continue;
    }
    if (ap < MOVE_COST) break;
    const ally = nearestAlly(foe);
    // Solo: sin compañía a 2 casillas, se acerca a otro no-muerto en vez de
    // ir directo al héroe (busca compañía antes que pelear en solitario).
    const isolated = !livingFoes().some(f => f !== foe && distTo(f, foe.x, foe.y) <= 2);
    let target = hero;
    if (isolated && ally) target = ally;
    const cur = distTo(foe, target.x, target.y);
    const step = stepNeighbors(foe.x, foe.y)
      .map(([x, y, cost]) => ({ x, y, cost }))
      .filter(p => !(p.x === hero.x && p.y === hero.y) && p.cost <= ap)
      .map(p => ({ ...p, d: distTo(target, p.x, p.y) }))
      .sort((a, b) => a.d - b.d)[0];
    if (!step || step.d >= cur) break;
    doMove(foe, step);
    ap -= step.cost;
    await sleep(190);
  }
  return false;
}

// --- Esqueleto Mago (enemy6): invocador a distancia -------------------------
// PA 6, se mueve hasta 4 casillas por turno. Ataca a distancia (igual que el
// arquero) a 3 PA, pero con daño de sombras (número morado) en vez de físico.
// A menos de 4 casillas del héroe, cada 2 turnos suyos resucita un esqueleto
// (2 PA) junto a él, hasta controlar 3 a la vez; el 3º que invoque siempre es
// arquero. Al entrar en acción por primera vez, antes de nada, lanza Llamada
// Sepulcral: todo no-muerto vivo a 20 casillas o menos se teleporta lo más
// cerca posible de él (sin pasar de 4 casillas), gastando el turno entero.
const MAGE_RANGE = 4, MAGE_SHOOT_COST = 3, MAGE_SUMMON_COST = 2, MAGE_MAX_MOVE = 4;
const MAGE_SUMMON_RADIUS = 4, MAGE_SUMMON_EVERY = 2, MAGE_MAX_SKELETONS = 3;
const MAGE_CALL_RANGE = 20, MAGE_CALL_GATHER = 4;

// Casillas libres cerca de (ox,oy), más cercanas primero (para colocar invocaciones).
function freeTilesNear(ox, oy, maxDist) {
  const { hero } = state;
  const seen = new Set([`${ox},${oy}`]);
  let frontier = [[ox, oy, 0]];
  const out = [];
  while (frontier.length) {
    const next = [];
    for (const [x, y, d] of frontier) {
      if (d > 0 && !(x === hero.x && y === hero.y) && walkable(x, y)) out.push({ x, y, d });
      if (d >= maxDist) continue;
      for (const [nx, ny] of stepNeighbors(x, y)) {
        const key = `${nx},${ny}`;
        if (seen.has(key)) continue;
        seen.add(key);
        next.push([nx, ny, d + 1]);
      }
    }
    frontier = next;
  }
  out.sort((a, b) => a.d - b.d);
  return out;
}

function spawnSkeleton(mage) {
  const spot = freeTilesNear(mage.x, mage.y, 1)[0];
  if (!spot) return null;
  mage.summonCount = (mage.summonCount || 0) + 1;
  const isArcher = mage.summonCount === 3;
  const foe = {
    x: spot.x, y: spot.y, alive: true,
    hp: isArcher ? 9 : 12, maxHp: isArcher ? 9 : 12, atk: isArcher ? 3 : 4,
    sprite: isArcher ? 'enemy4' : 'enemy1', apMax: 4,
    anim: 'foe' + state.foes.length, dormant: false, wakeR: 0,
    summonedBy: mage,
  };
  state.foes.push(foe);
  anim.floatAt(spot.x, spot.y, '✚', HEAL_COLOR);
  return foe;
}

// Llamada Sepulcral: reúne a todo no-muerto vivo (menos el propio mago) que
// esté a MAGE_CALL_RANGE casillas o menos, colocándolo lo más cerca posible
// del mago sin pasar de MAGE_CALL_GATHER casillas (teletransporte instantáneo:
// es un efecto mágico, no gasta el PA de esos enemigos).
function castSepulchralCall(mage) {
  const targets = state.foes.filter(f => f.alive && f !== mage && distTo(mage, f.x, f.y) <= MAGE_CALL_RANGE);
  if (!targets.length) return;
  const spots = freeTilesNear(mage.x, mage.y, MAGE_CALL_GATHER);
  const claimed = new Set();
  // los que estaban más lejos se colocan primero, para que se queden con el
  // hueco más próximo al mago (parece más "llamada urgente" para esos).
  targets.sort((a, b) => distTo(mage, b.x, b.y) - distTo(mage, a.x, a.y));
  for (const f of targets) {
    const spot = spots.find(s => !claimed.has(`${s.x},${s.y}`));
    if (!spot) break;
    claimed.add(`${spot.x},${spot.y}`);
    f.x = spot.x; f.y = spot.y;
    f.dormant = false;
    anim.floatAt(spot.x, spot.y, '↷', SHADOW_COLOR);
  }
  log(t('log.sepulchralCall'));
}

async function mageTurn(foe) {
  const { hero } = state;

  // Primera vez que actúa: Llamada Sepulcral, gasta el turno entero.
  if (!foe.castOpening) {
    foe.castOpening = true;
    castSepulchralCall(foe);
    await sleep(420);
    return false;
  }

  let ap = foe.apMax, moved = 0, summonedThisTurn = false;
  while (ap > 0) {
    const controlled = livingFoes().filter(f => f.summonedBy === foe).length;
    foe.turnsSinceSummon = (foe.turnsSinceSummon || 0) + (summonedThisTurn ? 0 : 0); // (se actualiza abajo, una vez)
    const dueToSummon = !summonedThisTurn && distTo(foe, hero.x, hero.y) < MAGE_SUMMON_RADIUS
      && (foe.turnsSinceSummon || 0) >= MAGE_SUMMON_EVERY
      && controlled < MAGE_MAX_SKELETONS && (foe.summonCount || 0) < MAGE_MAX_SKELETONS;

    if (dueToSummon && ap >= MAGE_SUMMON_COST) {
      ap -= MAGE_SUMMON_COST;
      spawnSkeleton(foe);
      foe.turnsSinceSummon = 0;
      summonedThisTurn = true;
      syncHUD();
      await sleep(300);
      continue;
    }

    const d = distTo(foe, hero.x, hero.y);
    if (d <= MAGE_RANGE && ap >= MAGE_SHOOT_COST && losClear(foe.x, foe.y, hero.x, hero.y)) {
      ap -= MAGE_SHOOT_COST;
      anim.attack(foe.anim, sign(hero.x - foe.x), sign(hero.y - foe.y), foe.sprite);
      audio.fx('hurt');
      const dmg = applyIncomingHit(foe.atk, 'shadow', SHADOW_COLOR);
      if (dmg > 0) anim.hurt('hero', 'hero');
      log(t('log.hitHero', { dmg }));
      syncHUD();
      if (hero.hp <= 0) { gameOver('lose'); return true; }
      await sleep(320);
      continue;
    }

    if (ap >= MOVE_COST && moved < MAGE_MAX_MOVE) {
      const step = approachStep(foe, ap);
      if (step) { doMove(foe, step); ap -= step.cost; moved++; await sleep(190); continue; }
    }
    break;
  }
  if (!summonedThisTurn) foe.turnsSinceSummon = (foe.turnsSinceSummon || 0) + 1;
  return false;
}


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
  const baseDmg = foe.atk + Math.min(4, alliesWithin2(foe));
  anim.attack(foe.anim, sign(hero.x - foe.x), sign(hero.y - foe.y), foe.sprite);
  audio.fx('hurt');
  const dmg = applyIncomingHit(baseDmg, 'physical', '#e86a5c');
  if (dmg > 0) anim.hurt('hero', 'hero');
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
      audio.fx('hurt');
      const dmg = applyIncomingHit(foe.atk, 'physical', '#e86a5c');
      if (dmg > 0) anim.hurt('hero', 'hero');
      log(t('log.hitHero', { dmg }));
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


