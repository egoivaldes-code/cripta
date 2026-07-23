// Reglas del juego: economía de Puntos de Acción (PA), interacción a distancia
// y adyacente, trampas, niebla y salida de nivel. Agnóstico del dibujo.

import { state, walkable, adjacent, distTo, isVisible, recomputeFog, computeReach, pathTo, findPath, findApproachPath, reachCost, blockingTriggerAt, trapAt, walkTriggerAt, exitAt, stepNeighbors, foeAt, corpseAt, livingFoes, losClear } from './state.js?v=0.21.1';
import { openEvent, openLeverCard, openTrapCard, openStoryCard, syncHUD, syncInitiativeUI, showCombatBadge, showLootWindow, showConfirm, log, gameOver } from './ui.js?v=0.21.1';
import { t, tRandom } from './i18n.js?v=0.21.1';
import { MOVE_COST, ATTACK_COST, INITIATIVE_BASE, INITIATIVE_DIE, TURN_DELAY, COMBAT_ENTER_DELAY } from './config.js?v=0.21.1';
import * as anim from './anim.js?v=0.21.1';
import { ANIM_CLIPS } from './anim.js?v=0.21.1';
import * as audio from './audio.js?v=0.21.1';
import { centerOnTile } from './render.js?v=0.21.1';
import { getOwnedTier, getSkillDef } from './skills.js?v=0.21.1';

const sign = (n) => Math.sign(n);

// --- Habilidades: cooldowns (en combates), Grito de guerra y racha de Sed
// de sangre. Vive aquí (no en skills.js) porque son estado de COMBATE en
// marcha, no progreso persistente de la tienda. ---
const skillCooldowns = {};       // id -> combates restantes hasta poder reusarla
let warCryTurnsLeft = 0, warCryPct = 0;
let bloodlustStacks = 0;         // se reinicia cada vez que un combate termina

function isSkillReady(id) { return !(skillCooldowns[id] > 0); }
function warCryMult() { return 1 + (warCryTurnsLeft > 0 ? warCryPct : 0); }
function bloodlustMult() {
  const tier = getOwnedTier('bloodlust');
  if (!tier) return 1;
  const def = getSkillDef('bloodlust');
  return 1 + bloodlustStacks * def.tiers[tier - 1].power.dmgPerKillPct;
}
function registerBloodlustKill() { if (getOwnedTier('bloodlust') > 0) bloodlustStacks++; }

const DMG_COLORS = { fire: '#e08a3c', ice: '#6ec3d8', poison: '#8a5fc9', holy: '#e8d27a', physical: '#e86a5c', none: '#e0b34a' };
function dmgColor(type) { return DMG_COLORS[type] || '#e86a5c'; }

// Total de enemigos de TODA la mazmorra (cementerio + cripta + mausoleos),
// para que la victoria dependa de limpiarla entera y no de vaciar un único
// tramo (ver setTotalFoeCount, llamado una vez desde main.js al arrancar).
let totalFoeCount = null;
export function setTotalFoeCount(n) { totalFoeCount = n; }

// --- Resolución de combate (esquivar → bloquear → crítico → armadura/resistencia) ---
// Ver combat_stats_v0.11.md para el diseño. Los monstruos NUNCA critean al
// héroe; el héroe SÍ puede critear a los monstruos (los monstruos no tienen
// esquivar/bloquear/armadura propios todavía, solo el héroe las tiene).
const CRIT_MULT = 2;
const EVADE_COLOR = '#9aa0ab';
const CRIT_COLOR = '#f0c94a';

// Golpe del HÉROE contra un enemigo: aplica primero los bonus de combate
// (Grito de guerra, Sed de sangre) y solo entonces decide si critea (x2).
function resolveHeroHit(baseDamage) {
  const buffed = Math.round(baseDamage * warCryMult() * bloodlustMult());
  const crit = Math.random() < (state.hero.critChance || 0);
  return { damage: crit ? Math.round(buffed * CRIT_MULT) : buffed, crit };
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

// Destinos por los que ya se preguntó "¿seguro?" y se confirmó Sí — evita que
// una salida se resuelva dos veces si el jugador toca la confirmación rápido.
function goExit(to) { onDescend(to); }

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
}

// Revisa si algún enemigo dormido ha quedado a tiro (o ya estaba despierto,
// p.ej. por un golpe directo) y aún no está en la cola; si es así, entra en
// combate. Se llama al terminar el turno del héroe (mismo momento en que
// antes se comprobaba el despertar de los enemigos).
// Devuelve true si el combate ACABA de empezar con esta llamada (no estaba
// activo antes y ahora sí) — así quien llama puede cortar el turno del héroe
// ahí mismo ("movimiento libre hasta que activas a alguien, y ahí se para").
function scanForNewCombatants() {
  const wasActive = state.combat.active;
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
  return !wasActive && state.combat.active;
}

// Si ya no queda ningún enemigo vivo, se acaba el combate (oculta la barra de
// iniciativa). No afecta a la victoria/derrota, que ya se gestiona aparte.
// Sale de combate en cuanto no quede ningún enemigo VIVO de los que ya
// estaban activados en esta escaramuza (state.combat.order) — no hay que
// limpiar el nivel entero de enemigos dormidos en otra punta del mapa para
// volver al modo paz, solo con los que de verdad te han detectado a ti.
function checkCombatEnd() {
  if (!state.combat.active) return;
  const stillFighting = state.combat.order.some(e => e.ref !== 'hero' && e.ref.alive);
  if (!stillFighting) {
    state.combat.active = false;
    state.combat.order = [];
    state.combat.idx = 0;
    bloodlustStacks = 0;
    for (const id in skillCooldowns) if (skillCooldowns[id] > 0) skillCooldowns[id]--;
    syncInitiativeUI();
    log(tRandom('log.combatEnd', 4), 'combat');
  }
}

// Loot al morir un enemigo — de momento solo oro. Es un array a propósito
// (no un número suelto) para poder añadir más tipos de objeto el día que
// haga falta sin cambiar la forma de todo lo demás (ver showLootWindow en
// ui.js, que recorre esta lista genéricamente).
function generateLoot(foe) {
  const gold = 10 + Math.floor(Math.random() * 191);   // 10–200 de oro (subido temporalmente para probar la tienda)
  return [{ type: 'gold', amount: gold }];
}

// Marca a un enemigo como muerto de verdad: animación, botín, registro, racha
// de Sed de sangre y el contador de bajas de TODA la mazmorra (no solo este
// nivel — ver setTotalFoeCount/gameOver más abajo). La usan tanto el ataque
// normal (onTapTile) como las habilidades activas (useActiveSkill).
function killFoe(target, foeName) {
  audio.fx('kill'); target.alive = false;
  if (state.targetFoe === target) state.targetFoe = null;
  if (ANIM_CLIPS[target.sprite]) { anim.die(target.anim); target.deathPlaying = true; }
  target.loot = generateLoot(target);
  state.hero.totalKills = (state.hero.totalKills || 0) + 1;
  registerBloodlustKill();
  log(tRandom('log.killFoe', 5, { name: foeName }), 'combat');
  checkCombatEnd();
}

// Si con esta muerte se ha limpiado la mazmorra ENTERA (todas las zonas
// conectadas: cementerio + cripta + mausoleos), ahora sí toca la pantalla de
// victoria — limpiar solo esta zona (p.ej. los 2 esqueletos de un mausoleo)
// ya no la dispara por sí solo.
function checkFullVictory() {
  return totalFoeCount != null && (state.hero.totalKills || 0) >= totalFoeCount;
}

// Probabilidad de Golpes de fe (Paladín): un golpe cuerpo a cuerpo tiene
// una probabilidad de curar parte de lo infligido.
function maybeFaithStrikesHeal(dmgDealt) {
  const tier = getOwnedTier('faith_strikes');
  if (!tier || dmgDealt <= 0) return;
  const power = getSkillDef('faith_strikes').tiers[tier - 1].power;
  if (Math.random() >= power.healChance) return;
  const heal = Math.max(1, Math.round(dmgDealt * power.healPct));
  const hero = state.hero;
  hero.hp = Math.min(hero.maxHp, hero.hp + heal);
  anim.floatAt(hero.x, hero.y, `+${heal}`, '#7fc06a');
  log(t('log.faithHeal', { n: heal }), 'combat');
}

// Empieza el turno del héroe: PA a tope y recalcula su alcance.
export function startHeroTurn() {
  state.hero.ap = state.hero.apMax;
  if (warCryTurnsLeft > 0) warCryTurnsLeft--;
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
  if (hero.ap <= 0 && !state.combat.active) endHeroTurn();
}

// Cooldown entre ataques del héroe: sin esto, tocar dos veces rápido (o dos
// enemigos pegados) encadena los golpes sin dar tiempo a ver ni el primero.
const HERO_ATTACK_COOLDOWN = 1000;

// Bloquea toques nuevos mientras el héroe está a media zancada de un
// movimiento en curso (ver isHeroMoving en render.js/main.js si hiciera
// falta usarlo fuera de aquí).
let heroMoving = false;
export function isHeroMoving() { return heroMoving; }
const D_MOVE_STEP = 170;   // ritmo entre casillas al andar, a juego con la animación (anim.js: D_MOVE)
let lastHeroAttackAt = 0;

// Acción del jugador al tocar una casilla (la llama render.js).
// Usa de verdad una habilidad ACTIVA. `gx,gy` es la casilla tocada (null si
// es de auto-lanzamiento, como Grito de guerra). Devuelve true si se ha
// usado de verdad (para que quien llama sepa si debe desarmarla).
export function useActiveSkill(id, gx, gy) {
  const hero = state.hero;
  if (state.busy || isAITurnActive()) return false;
  const tier = getOwnedTier(id);
  const def = getSkillDef(id);
  if (!tier || !def || def.kind !== 'active') return false;
  const skillName = t(`skill.${id}.name`);
  if (!isSkillReady(id)) { log(t('log.skillCooldown', { name: skillName })); return false; }
  if (hero.ap < ATTACK_COST) { log(t('log.noAP')); return false; }
  const power = def.tiers[tier - 1].power;
  if (!power) return false;

  if (def.range === 0) {
    // Auto-lanzamiento (Grito de guerra): se aplica sobre el propio héroe, sin objetivo.
    warCryTurnsLeft = power.turns;
    warCryPct = power.atkBuffPct;
    anim.floatAt(hero.x, hero.y, skillName, '#f0c94a', { static: true });
    log(t('log.skillCastSelf', { name: skillName }), 'combat');
    audio.fx('ui');
  } else {
    if (gx == null || gy == null) return false;
    const target = foeAt(gx, gy);
    if (!target || !target.alive) return false;
    if (!isVisible(gx, gy)) return false;
    const dist = distTo(hero, gx, gy);
    if (dist > def.range || (def.range === 1 && !adjacent(hero, gx, gy))) { log(t('log.skillOutOfRange')); return false; }

    const targets = [target];
    if (def.area) {
      for (const f of state.foes) {
        if (f.alive && f !== target && distTo(f, gx, gy) <= def.area) targets.push(f);
      }
    }
    for (const foe of targets) {
      const dmg = Math.max(1, Math.round(hero.atk * power.dmgMult * warCryMult() * bloodlustMult()));
      anim.hurt(foe.anim, foe.sprite);
      anim.floatAt(foe.x, foe.y, `−${dmg}`, dmgColor(def.damageType));
      foe.hp -= dmg;
      foe.dormant = false;
      const foeName = t('enemy.' + foe.sprite);
      if (foe.hp <= 0 && foe.alive) killFoe(foe, foeName);
    }
    log(t('log.skillHit', { name: skillName }), 'combat');
    audio.fx('attack');
  }

  hero.ap -= ATTACK_COST;
  skillCooldowns[id] = def.cooldown || 0;
  syncHUD();
  syncInitiativeUI();
  computeReach();
  if (checkFullVictory()) { gameOver('win'); return true; }
  const justEnteredCombat = scanForNewCombatants();
  if (justEnteredCombat || (hero.ap <= 0 && !state.combat.active)) endHeroTurn(justEnteredCombat);
  return true;
}

export async function onTapTile(gx, gy) {
  const { hero } = state;
  if (heroMoving) return;   // ya está andando; ignora el toque hasta que termine (o se corte por combate/carta)

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
    maybeFaithStrikesHeal(hit.damage);
    const foeName = t('enemy.' + target.sprite);
    log(hit.crit ? tRandom('log.hitFoeCrit', 3, { name: foeName, dmg: hit.damage })
                 : tRandom('log.hitFoe', 5, { name: foeName, dmg: hit.damage }), 'combat');
    if (target.hp <= 0) {
      killFoe(target, foeName);
      syncHUD();
      syncInitiativeUI();
      if (checkFullVictory()) return gameOver('win');
    } else {
      audio.fx('attack'); syncHUD();
    }
    computeReach();
    const justEnteredCombat = scanForNewCombatants();
    if (justEnteredCombat || (hero.ap <= 0 && !state.combat.active)) return endHeroTurn(justEnteredCombat);
    return;
  }

  // --- ¿Cadáver con loot pendiente? Adyacente = abre la ventana de botín;
  // a distancia = solo un aviso de que hay que acercarse (los cadáveres no
  // usan el sistema de pistas de eventos/trampas, no tienen ese id). ---
  const corpse = corpseAt(gx, gy);
  if (corpse) {
    if (distTo(hero, gx, gy) <= 1) showLootWindow(corpse);
    else if (isVisible(gx, gy)) log(t('log.corpseTooFar'));
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
      if (tr.type === 'lever') openLeverCard(tr);
      else openEvent(tr);
    } else if (isVisible(gx, gy)) {
      showHint(tr);
    }
    return;
  }

  // --- ¿Salida (formato nuevo: portón/verja, varias por nivel)? Adyacente =
  // usarla (si está bloqueada, solo avisa; si no, pregunta antes de bajar de
  // nivel); a distancia = pista, igual que el resto de objetos. No cuesta PA:
  // es solo una transición, no una acción de combate. ---
  const ex = exitAt(gx, gy);
  if (ex) {
    const d = distTo(hero, gx, gy);
    const ev = state.events[ex.id];
    if (d <= 1) {
      if (ex.blocked) {
        if (ev) log(`<b>${t(ev.i18n + '.kicker')}</b> — ${t(ev.i18n + '.blockedHint')}`);
        else log(t('log.exitBlocked'));
      } else if (ev) {
        showConfirm(t(ev.i18n + '.title'), t(ev.i18n + '.question'), () => goExit(ex.to));
      } else {
        // Sin evento conectado todavía (salida recién colocada en el editor,
        // sin enlazar): mismo criterio que el resto de objetos sin conectar.
        log(t('log.noEventYet'));
      }
    } else if (isVisible(gx, gy)) {
      showHint(ex);
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

  // --- Mover (rango según PA restantes; rodea muros y objetos). Se anda
  // paso a paso (no de golpe a todo el camino): si un enemigo se activa, o
  // se dispara una trampa/evento que abre una carta, a mitad de camino, el
  // héroe se para justo ahí y NO completa el resto del trayecto ya elegido,
  // aunque le quedaran más pasos o PA para llegar más lejos. ---
  const path = pathTo(gx, gy);
  if (!path) return;

  heroMoving = true;
  try {
    for (let i = 1; i < path.length; i++) {
      const prev = path[i - 1], cell = path[i];
      const stepEntry = stepNeighbors(prev.x, prev.y).find(([nx, ny]) => nx === cell.x && ny === cell.y);
      const stepCost = stepEntry ? stepEntry[2] : 1;
      if (hero.ap < stepCost) break;   // por si acaso; no debería pasar (el camino ya viene dentro de alcance)

      hero.ap -= stepCost;
      anim.move('hero', prev.x, prev.y, cell.x, cell.y);
      hero.x = cell.x; hero.y = cell.y;
      audio.fx('move');
      recomputeFog();
      revealTrapsNear(cell.x, cell.y);
      syncHUD();

      const trap = trapAt(cell.x, cell.y);
      if (trap) triggerTrap(trap);
      if (hero.hp <= 0) return;                          // trampa mortal a mitad de camino
      const wt = walkTriggerAt(cell.x, cell.y);
      if (wt) triggerWalkEvent(wt);
      if (state.busy) return;                             // se abrió una carta (evento de historia): se para aquí

      if (state.exit && cell.x === state.exit.x && cell.y === state.exit.y) { onDescend(state.exit.to); return; }

      computeReach();
      // Fuera de combate el movimiento es libre (sin turnos); en cuanto un
      // enemigo entra en rango de activación —aunque sea a mitad de camino—
      // se para aquí mismo y empieza el combate por turnos ya, sin esperar
      // a llegar a la casilla que se había tocado.
      const justEnteredCombat = scanForNewCombatants();
      if (justEnteredCombat) { await endHeroTurn(true); return; }

      if (i < path.length - 1) await sleep(D_MOVE_STEP);   // deja ver el paso antes de encadenar el siguiente
    }
  } finally {
    heroMoving = false;
  }

  if (hero.hp > 0 && hero.ap <= 0 && !state.combat.active) endHeroTurn();
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
  if (state.hero.hp > 0 && state.hero.ap <= 0 && !state.combat.active) endHeroTurn();
}

// Fin del turno del héroe (botón, o automático al llegar a 0 PA). Detecta
// quién entra en combate, marca el hueco del héroe en la cola como ya hecho
// (la ronda de acciones que acaba de terminar ES su turno de iniciativa), y
// deja pasar a los enemigos que le toquen antes de que vuelva a él.
export async function endHeroTurn(justEntered = false) {
  // Si ya hay una resolución de turno en marcha (p.ej. el jugador ha tocado
  // dos veces casi a la vez, justo cuando el PA llega a 0), no se vuelve a
  // entrar: evita que dos "fin de turno" se pisen y descuadren la cola.
  if (aiTurnActive) return;
  aiTurnActive = true;   // esto ya bloquea toques del jugador (ver isAITurnActive en render.js)
  try {
    const wasActive = state.combat.active;
    scanForNewCombatants();
    const enteringNow = justEntered || (!wasActive && state.combat.active);
    if (enteringNow) {
      // Entrada en combate: un pequeño respiro (con su propio sonido) antes de
      // congelar el juego en modo por turnos, para que no se sienta instantáneo.
      audio.fx('combatstart');
      await sleep(COMBAT_ENTER_DELAY);
      showCombatBadge();
      log(tRandom('log.combatStart', 4), 'combat');
    }
    if (state.combat.active) {
      const heroIdx = state.combat.order.findIndex(o => o.ref === 'hero');
      if (heroIdx !== -1 && state.combat.idx <= heroIdx) state.combat.idx = heroIdx + 1;
      syncInitiativeUI();
      await enemySleep(TURN_DELAY);   // pausa al terminar el turno del héroe
      await runFoeQueue();
      if (state.combat.active) centerOnTile(state.hero.x, state.hero.y);
    }
  } finally {
    aiTurnActive = false;
  }
  if (!state.busy) startHeroTurn();   // si busy=true, hay una carta de fin de partida abierta
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let aiTurnActive = false;
export function isAITurnActive() { return aiTurnActive; }

// --- Velocidad de turnos enemigos (ajustable desde el menú de Ajustes) ------
// Multiplica todas las pausas de la IA (entre acciones y entre turnos). No
// afecta a la duración de las propias animaciones, solo al tiempo de espera
// entre pasos, para que el combate se sienta más lento o más rápido.
const ENEMY_SPEED_MULT = { slow: 1.6, normal: 1, fast: 0.55 };
function loadEnemySpeed() {
  try { const v = localStorage.getItem('cripta.enemySpeed'); return ENEMY_SPEED_MULT[v] ? v : 'normal'; }
  catch { return 'normal'; }
}
let enemySpeedKey = loadEnemySpeed();
export function getEnemySpeed() { return enemySpeedKey; }
export function setEnemySpeed(v) {
  if (!ENEMY_SPEED_MULT[v]) return;
  enemySpeedKey = v;
  try { localStorage.setItem('cripta.enemySpeed', v); } catch {}
}
const enemySleep = (ms) => sleep(ms * (ENEMY_SPEED_MULT[enemySpeedKey] || 1));

// Recorre la cola de iniciativa desde donde se quedó, actuando un enemigo
// cada vez (con pausa antes y después de cada uno), hasta llegar de nuevo al
// hueco del héroe — ahí se para y le devuelve el control al jugador. Si da
// la vuelta entera a la cola sin encontrarlo (no debería pasar, el héroe
// siempre está metido), empieza otra ronda desde el principio.
async function runFoeQueue() {
  while (state.combat.active && state.combat.order.length) {
    if (state.combat.idx >= state.combat.order.length) state.combat.idx = 0;   // nueva ronda
    const entry = state.combat.order[state.combat.idx];
    if (entry.ref === 'hero') break;   // le toca al jugador
    const foe = entry.ref;
    state.combat.idx++;
    if (!foe.alive) continue;
    centerOnTile(foe.x, foe.y);
    syncInitiativeUI();
    const heroDied = await runSingleFoeTurn(foe);
    checkCombatEnd();
    syncHUD();
    if (heroDied || !state.combat.active) return;
    await enemySleep(TURN_DELAY);   // pausa al terminar el turno de este NPC
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
      log(tRandom('log.hitHero', 5, { name: t('enemy.' + foe.sprite), dmg }), 'combat');
      const allies = livingFoes().filter(f => f !== foe && distTo(f, foe.x, foe.y) <= 2).length;
      if (dmg > 0 && allies > 0) {
        const healPct = Math.min(3, allies) * 0.10;
        const healed = Math.max(1, Math.round(dmg * healPct));
        foe.hp = Math.min(foe.maxHp, foe.hp + healed);
        anim.floatAt(foe.x, foe.y, `+${healed}`, HEAL_COLOR);
      }
      syncHUD();
      if (hero.hp <= 0) { gameOver('lose'); return true; }
      await enemySleep(320);
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
    await enemySleep(190);
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
    await enemySleep(420);
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
      await enemySleep(300);
      continue;
    }

    const d = distTo(foe, hero.x, hero.y);
    if (d <= MAGE_RANGE && ap >= MAGE_SHOOT_COST && losClear(foe.x, foe.y, hero.x, hero.y)) {
      ap -= MAGE_SHOOT_COST;
      anim.attack(foe.anim, sign(hero.x - foe.x), sign(hero.y - foe.y), foe.sprite);
      audio.fx('hurt');
      const dmg = applyIncomingHit(foe.atk, 'shadow', SHADOW_COLOR);
      if (dmg > 0) anim.hurt('hero', 'hero');
      log(tRandom('log.hitHero', 5, { name: t('enemy.' + foe.sprite), dmg }), 'combat');
      syncHUD();
      if (hero.hp <= 0) { gameOver('lose'); return true; }
      await enemySleep(320);
      continue;
    }

    if (ap >= MOVE_COST && moved < MAGE_MAX_MOVE) {
      const step = approachStep(foe, ap);
      if (step) { doMove(foe, step); ap -= step.cost; moved++; await enemySleep(190); continue; }
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
    // Romper la línea de visión pesa más que la distancia en sí: un
    // arquero que consigue esconderse tras una esquina está más a salvo
    // que otro que solo se ha alejado un poco más a la vista de todos.
    if (!losClear(x, y, hero.x, hero.y)) score += 500;
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
  // Camino real hasta la casilla del héroe (el terreno en sí es transitable
  // ahí; el hueco de "adyacente, no encima" lo da quedarse en el penúltimo
  // paso). Así, si hace falta rodear un muro o pasar por un cuello de botella
  // de una sola casilla, el enemigo encuentra el camino en vez de quedarse
  // parado esperando que la línea recta se despeje sola.
  let path = findPath(foe.x, foe.y, hero.x, hero.y);
  if (!path || path.length < 2) {
    // No hay camino directo — normalmente porque otro enemigo ya ocupa la
    // única casilla de paso (pasillo de una sola casilla, p.ej.). En vez de
    // quedarse quieto, se acerca todo lo que pueda: a la casilla alcanzable
    // más próxima al héroe (típicamente, justo detrás del aliado que sí
    // llegó). Si ni eso mejora nada, entonces sí, no puede acercarse más.
    path = findApproachPath(foe.x, foe.y, hero.x, hero.y);
    if (!path || path.length < 2) return null;
  }
  const next = path[1];
  const here = stepNeighbors(foe.x, foe.y).find(([x, y]) => x === next.x && y === next.y);
  if (!here) return null;
  const cost = here[2];
  if (cost > ap) return null;   // el primer paso del camino ya no le llega con el PA que le queda
  return { x: next.x, y: next.y, cost };
}

function doMove(foe, step) {
  const fromX = foe.x, fromY = foe.y;
  foe.x = step.x; foe.y = step.y;
  anim.move(foe.anim, fromX, fromY, step.x, step.y);
  centerOnTile(foe.x, foe.y);   // la cámara sigue al NPC paso a paso durante todo su turno
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
  log(tRandom('log.hitHero', 5, { name: t('enemy.' + foe.sprite), dmg }), 'combat');
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
  let fledThisTurn = false;   // si ya ha huido este turno, no deshacerlo acercándose otra vez solo porque ahora no ve
  while (ap > 0) {
    const d = distTo(foe, hero.x, hero.y);
    const canSee = losClear(foe.x, foe.y, hero.x, hero.y);
    if (d <= cfg.fleeAt) {                                     // 1) huir
      const fs = fleeStep(foe, ap);
      if (fs) { doMove(foe, fs); ap -= fs.cost; fledThisTurn = true; await enemySleep(190); continue; }
      // acorralado sin salida: si tiene el tiro despejado, dispara a bocajarro (bloque 2)
    }
    if (d <= cfg.range && canSee) {                           // 2) a tiro y con visión
      if (ap >= cfg.shootCost) {
        ap -= cfg.shootCost;
        if (archerShoot(foe)) return true;
        await enemySleep(320);
        continue;
      }
      break;   // en posición pero sin PA para otro tiro: se queda quieto, no se acerca al héroe
    }
    if (!fledThisTurn && ap >= MOVE_COST) {                    // 3) lejos o sin visión: acercarse
      const as = approachStep(foe, ap);
      if (as) { doMove(foe, as); ap -= as.cost; await enemySleep(190); continue; }
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
      log(tRandom('log.hitHero', 5, { name: t('enemy.' + foe.sprite), dmg }), 'combat');
      syncHUD();
      if (hero.hp <= 0) { gameOver('lose'); return true; }
      await enemySleep(320);
      continue;
    }
    if (ap < MOVE_COST) break;
    const step = approachStep(foe, ap);
    if (!step) break;                                          // no puede acercarse más
    doMove(foe, step);
    ap -= step.cost;
    await enemySleep(190);
  }
  return false;
}


