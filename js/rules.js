// Reglas del juego: economía de Puntos de Acción (PA), interacción a distancia
// y adyacente, trampas, niebla y salida de nivel. Agnóstico del dibujo.

import { state, walkable, isWall, adjacent, distTo, isVisible, recomputeFog, computeReach, pathTo, findPath, findApproachPath, reachCost, blockingTriggerAt, trapAt, walkTriggerAt, exitAt, stepNeighbors, foeAt, corpseAt, livingFoes, losClear, revealAllExplored } from './state.js?v=0.26';
import { openEvent, openLeverCard, openAltarCard, openChestCard, openTrapCard, openStoryCard, syncHUD, syncInitiativeUI, showCombatBadge, showLootWindow, showConfirm, log, gameOver } from './ui.js?v=0.26';
import { t, tRandom } from './i18n.js?v=0.26';
import { MOVE_COST, ATTACK_COST, INITIATIVE_BASE, INITIATIVE_DIE, TURN_DELAY, COMBAT_ENTER_DELAY, getGameSpeed, setGameSpeed, speedMult, moveDurationMs, ARMOR_CONSTANT } from './config.js?v=0.26';
import * as anim from './anim.js?v=0.26';
import { ANIM_CLIPS } from './anim.js?v=0.26';
import * as audio from './audio.js?v=0.26';
import { centerOnTile } from './render.js?v=0.26';
import { getOwnedTier, getSkillDef } from './skills.js?v=0.26';

const sign = (n) => Math.sign(n);

// --- Habilidades: cooldowns (en combates), Grito de guerra y racha de Sed
// de sangre. Vive aquí (no en skills.js) porque son estado de COMBATE en
// marcha, no progreso persistente de la tienda. ---
const skillCooldowns = {};       // id -> combates restantes hasta poder reusarla
let warCryTurnsLeft = 0, warCryPct = 0;
let bloodlustStacks = 0;         // se reinicia cada vez que un combate termina

function isSkillReady(id) { return !(skillCooldowns[id] > 0); }
// Turnos (combates) que le quedan a una habilidad para salir de enfriamiento;
// 0 si ya está lista. Lo usa skills.js para pintar el velo rojo + el número
// en la barra de acciones (bindGetSkillCooldownLeft, ver main.js).
export function getSkillCooldownLeft(id) { return skillCooldowns[id] || 0; }
function warCryMult() { return 1 + (warCryTurnsLeft > 0 ? warCryPct : 0); }
function bloodlustMult() {
  const tier = getOwnedTier('bloodlust');
  if (!tier) return 1;
  const def = getSkillDef('bloodlust');
  return 1 + bloodlustStacks * def.tiers[tier - 1].power.dmgPerKillPct;
}
function registerBloodlustKill() { if (getOwnedTier('bloodlust') > 0) bloodlustStacks++; }

// --- Habilidades nuevas (V0.23): mismo criterio que arriba — estado de
// COMBATE en marcha, no progreso persistente de la tienda (eso vive en
// skills.js). Cada bloque documenta a qué habilidad pertenece. ---

// Golpe desde las Sombras (Asesino): el crítico garantizado del tier 3 solo
// se puede usar una vez por combate; se reinicia en checkCombatEnd() igual
// que la racha de Sed de sangre.
let shadowStrikeUsedThisCombat = false;

// Cosecha de Almas (Nigromante): misma mecánica que Sed de sangre (racha que
// se resetea al acabar el combate), pero solo cuenta muertes CERCA del héroe
// (power.nearbyRange) y se aplica como multiplicador general de daño, igual
// que Sed de sangre, para que no sea una pasiva "muerta" mientras no haya
// hechizos de sombra propios.
let soulHarvestStacks = 0;
function soulHarvestMult() {
  const tier = getOwnedTier('soul_harvest');
  if (!tier) return 1;
  const def = getSkillDef('soul_harvest');
  return 1 + soulHarvestStacks * def.tiers[tier - 1].power.dmgPerNearbyDeathPct;
}
function registerSoulHarvestKill(target) {
  const tier = getOwnedTier('soul_harvest');
  if (!tier) return;
  const def = getSkillDef('soul_harvest');
  const power = def.tiers[tier - 1].power;
  if (distTo(state.hero, target.x, target.y) > power.nearbyRange) return;
  soulHarvestStacks++;
  if (power.freeCastAtStacks && soulHarvestStacks >= power.freeCastAtStacks) {
    freeNextCastSkip = true;
    soulHarvestStacks = 0;
  }
}

// Sobrecarga Arcana (Mago): probabilidad de que una activa no gaste su
// enfriamiento. `freeNextCastSkip` es un "vale" de un solo uso que también
// puede activar Cosecha de Almas (tier 3) — cualquiera de los dos lo deja a
// true y el próximo useActiveSkill() que lo encuentre activo se lo come.
let arcaneOverloadStreak = 0;    // procs consecutivos, para el tier 3 (cura si son 2 seguidos)
let freeNextCastSkip = false;

// Forma Salvaje (Druida): buff temporal por turnos, mismo patrón que Grito
// de guerra (warCryTurnsLeft/Pct) pero con más de un número asociado.
let wildShapeTurnsLeft = 0;
let wildShapePower = null;   // { dmgBonusPct, armorBonus, healOnHitPct } mientras dura

// Círculo de Renacer (Clérigo): zonas de curación que quedan en el mapa,
// se comprueban en cada startHeroTurn(). Varias pueden coexistir si se lanza
// más de una vez (poco probable con su enfriamiento de 4 combates, pero no
// se impide). `wardConsumed` evita que la MISMA zona salve dos veces.
const holyZones = [];   // { x, y, radius, turnsLeft, healPerTurn, preventLethalOnce, wardConsumed }

// Simbiosis Natural (Druida): cuánto daño ha recibido el héroe durante el
// turno que acaba de pasar, para decidir si cura al empezar el siguiente.
let damageTakenLastTurn = 0;

// --- Altares (ver ALTAR_EVENTS más abajo): las bendiciones/maldiciones de
// tipo buff duran un número de COMBATES (no de turnos) — se cuentan igual
// que los enfriamientos de habilidad (skillCooldowns), decrementando en
// checkCombatEnd(), no en startHeroTurn(). ---
let altarStrengthCombats = 0;   // Bendición de fuerza: +daño hecho
let altarStonehideCombats = 0;  // Bendición de piel de piedra: −daño recibido
let altarWeaknessCombats = 0;   // Maldición de debilidad: −daño hecho
let altarFragileCombats = 0;    // Maldición de fragilidad: +daño recibido
const ALTAR_STRENGTH_PCT = 0.15;
const ALTAR_STONEHIDE_PCT = 0.15;
const ALTAR_WEAKNESS_PCT = 0.10;
const ALTAR_FRAGILE_PCT = 0.10;
function altarOutgoingMult() {
  return 1 + (altarStrengthCombats > 0 ? ALTAR_STRENGTH_PCT : 0) - (altarWeaknessCombats > 0 ? ALTAR_WEAKNESS_PCT : 0);
}
function altarIncomingMult() {
  return 1 - (altarStonehideCombats > 0 ? ALTAR_STONEHIDE_PCT : 0) + (altarFragileCombats > 0 ? ALTAR_FRAGILE_PCT : 0);
}

const DMG_COLORS = { fire: '#e08a3c', ice: '#6ec3d8', poison: '#8a5fc9', holy: '#e8d27a', physical: '#e86a5c', none: '#e0b34a', shadow: '#8a5fc9', nature: '#7fc06a', arcane: '#6a8fe8' };
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

// Instinto Letal (Asesino): bonus de daño plano si el objetivo está por
// debajo del % de vida de su tier. Se aplica a CUALQUIER golpe del héroe
// (ataque normal o habilidad activa), no solo a una habilidad concreta.
function lethalInstinctMult(target) {
  const tier = getOwnedTier('lethal_instinct');
  if (!tier || !target || !target.maxHp) return 1;
  const power = getSkillDef('lethal_instinct').tiers[tier - 1].power;
  return (target.hp / target.maxHp) <= power.execThreshold ? (1 + power.dmgBonus) : 1;
}

// Forma Salvaje (Druida): multiplicador de daño mientras dura la
// transformación (ver wildShapeTurnsLeft/wildShapePower, gestionados en
// useActiveSkill/startHeroTurn).
function wildShapeMult() {
  return 1 + (wildShapeTurnsLeft > 0 && wildShapePower ? wildShapePower.dmgBonusPct : 0);
}

// Golpe del HÉROE contra un enemigo: aplica primero los bonus de combate
// (Grito de guerra, Sed de sangre, Cosecha de Almas, Forma Salvaje, Instinto
// Letal) y solo entonces decide si critea (x2). `opts.critBonus` y
// `opts.guaranteedCrit` los usa Golpe desde las Sombras para forzar más
// probabilidad de crítico en ese golpe concreto, sin tocar la esquiva normal.
function resolveHeroHit(baseDamage, target, opts = {}) {
  const buffed = Math.max(1, Math.round(
    baseDamage * warCryMult() * bloodlustMult() * soulHarvestMult() * wildShapeMult() * lethalInstinctMult(target) * altarOutgoingMult()
  ));
  const critChance = (state.hero.critChance || 0) + (opts.critBonus || 0);
  const crit = opts.guaranteedCrit || Math.random() < critChance;
  const damage = crit ? Math.round(buffed * CRIT_MULT) : buffed;
  // Forma Salvaje (tier 3): cura al héroe un % del daño hecho mientras dura.
  if (wildShapeTurnsLeft > 0 && wildShapePower && wildShapePower.healOnHitPct > 0) {
    const heal = Math.max(1, Math.round(damage * wildShapePower.healOnHitPct));
    const hero = state.hero;
    hero.hp = Math.min(hero.maxHp, hero.hp + heal);
    anim.floatAt(hero.x, hero.y, `+${heal}`, '#7fc06a');
  }
  return { damage, crit };
}

// Bonus de armadura TEMPORALES por habilidad, aparte de la armadura de base
// (hero.armor, que ya incluye Piel de hierro vía applySkillBonuses):
// - Forma Salvaje (Druida): mientras dura la transformación.
// - Simbiosis Natural (Druida, tier 3): solo con la vida al completo.
function temporaryArmorBonus() {
  const hero = state.hero;
  let bonus = wildShapeTurnsLeft > 0 && wildShapePower ? wildShapePower.armorBonus : 0;
  const nsTier = getOwnedTier('natural_symbiosis');
  if (nsTier) {
    const power = getSkillDef('natural_symbiosis').tiers[nsTier - 1].power;
    if (power.armorBonusAtFullHp && hero.hp >= hero.maxHp) bonus += power.armorBonusAtFullHp;
  }
  return bonus;
}

// Golpe de un ENEMIGO contra el héroe: esquivar → bloquear → armadura/resistencia.
// damageType: 'physical' | 'fire' | 'cold' | 'nature' | 'shadow' | 'holy'
function resolveIncomingHit(baseDamage, damageType = 'physical') {
  const hero = state.hero;
  if (Math.random() < (hero.dodgeChance || 0)) return { damage: 0, evaded: true, blocked: false };
  if (hero.hasShield && Math.random() < (hero.blockChance || 0)) return { damage: 0, evaded: false, blocked: true };
  // La armadura es un VALOR PLANO (no un %): % de daño físico reducido =
  // armadura / (armadura + ARMOR_CONSTANT), con rendimientos decrecientes
  // (cada punto de armadura reduce un poco menos que el anterior, nunca llega
  // al 100%). El daño elemental sigue usando resistencias en % directas.
  let mitig;
  if (damageType === 'physical') {
    const totalArmor = (hero.armor || 0) + temporaryArmorBonus();
    mitig = totalArmor / (totalArmor + ARMOR_CONSTANT);
  } else {
    mitig = (hero.resist && hero.resist[damageType]) || 0;
  }
  const damage = Math.max(0, Math.round(baseDamage * (1 - mitig)));
  return { damage, evaded: false, blocked: false };
}

// Gracia Vigilante (Clérigo): escudo que se renueva entero cada turno del
// héroe (ver startHeroTurn) y absorbe daño ANTES de tocar la vida. Vive en
// hero.wardShield (número de puntos que le quedan este turno).
function absorbWithWardShield(damage) {
  const hero = state.hero;
  if (!hero.wardShield || damage <= 0) return { remaining: damage, absorbed: 0 };
  const absorbed = Math.min(hero.wardShield, damage);
  hero.wardShield -= absorbed;
  return { remaining: damage - absorbed, absorbed };
}

// Círculo de Renacer (Clérigo, tier 3): si el héroe está dentro de una zona
// con `preventLethalOnce` sin gastar todavía, un golpe que lo dejaría a 0 o
// menos lo deja en 1 en su lugar (una vez por zona lanzada).
function tryLethalWard() {
  for (const z of holyZones) {
    if (z.wardConsumed || !z.preventLethalOnce) continue;
    if (distTo(state.hero, z.x, z.y) > z.radius) continue;
    z.wardConsumed = true;
    return true;
  }
  return false;
}

// Aplica un golpe ya resuelto al héroe: pone el número flotante correcto
// (Esquivado / Bloqueado / daño normal) y resta la vida. Devuelve el daño
// final aplicado (0 si se ha esquivado o bloqueado). También alimenta el
// escudo de Gracia Vigilante, el contador de Simbiosis Natural y la
// salvaguarda del Círculo de Renacer.
function applyIncomingHit(baseDamage, damageType, color) {
  const hero = state.hero;
  const r = resolveIncomingHit(baseDamage, damageType);
  if (r.evaded) { anim.floatAt(hero.x, hero.y, 'Esquivado', EVADE_COLOR); return 0; }
  if (r.blocked) { anim.floatAt(hero.x, hero.y, 'Bloqueado', EVADE_COLOR); return 0; }
  const altarAdjusted = Math.max(0, Math.round(r.damage * altarIncomingMult()));
  const { remaining, absorbed } = absorbWithWardShield(altarAdjusted);
  if (absorbed > 0) {
    anim.floatAt(hero.x, hero.y, `−${absorbed} 🛡`, '#8fc9e8');
    log(t('log.shieldAbsorb', { n: absorbed }), 'combat');
  }
  if (remaining <= 0) return 0;
  damageTakenLastTurn += remaining;
  if (hero.hp - remaining <= 0 && tryLethalWard()) {
    anim.floatAt(hero.x, hero.y, t('log.circleWard'), '#e8d27a', { static: true });
    log(t('log.circleWard'), 'combat');
    hero.hp = 1;
    return remaining;
  }
  anim.floatAt(hero.x, hero.y, `−${remaining}`, color);
  hero.hp -= remaining;
  return remaining;
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
    soulHarvestStacks = 0;
    shadowStrikeUsedThisCombat = false;
    arcaneOverloadStreak = 0;
    if (altarStrengthCombats > 0) altarStrengthCombats--;
    if (altarStonehideCombats > 0) altarStonehideCombats--;
    if (altarWeaknessCombats > 0) altarWeaknessCombats--;
    if (altarFragileCombats > 0) altarFragileCombats--;
    for (const id in skillCooldowns) if (skillCooldowns[id] > 0) skillCooldowns[id]--;
    audio.stopEliteMusic();
    syncInitiativeUI();
    log(tRandom('log.combatEnd', 4), 'combat');
  }
}

// Botín al morir un enemigo O al abrir un contenedor del mapa — de momento
// solo oro. Es un array a propósito (no un número suelto) para poder añadir
// más tipos de objeto el día que haga falta (afijos, únicos...) sin cambiar
// la forma de todo lo demás (ver showLootWindow en ui.js, que recorre esta
// lista genéricamente). El parámetro `foe` no se usa todavía (reservado para
// cuando el botín dependa del tipo de enemigo/contenedor).
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
  if (target.sprite === 'golembone') audio.fx('golemboneDeath');
  if (state.targetFoe === target) state.targetFoe = null;
  if (ANIM_CLIPS[target.sprite]) { anim.die(target.anim); target.deathPlaying = true; }
  target.loot = generateLoot(target);
  state.hero.totalKills = (state.hero.totalKills || 0) + 1;
  registerBloodlustKill();
  registerSoulHarvestKill(target);
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

// Gracia Vigilante (Clérigo): al empezar el turno, el escudo se PONE a su
// valor máximo de nuevo (no se acumula con lo que quedara) — "se reconstruye
// solo cada turno". El bonus del tier 3 se paga por el escudo del turno
// ANTERIOR, comprobado justo antes de refrescarlo.
function refreshWardShield() {
  const hero = state.hero;
  const tier = getOwnedTier('watchful_grace');
  if (!tier) { hero.wardShield = 0; return; }
  const power = getSkillDef('watchful_grace').tiers[tier - 1].power;
  if (power.bonusHealIfShieldHeld && hero.wardShield > 0) {
    hero.hp = Math.min(hero.maxHp, hero.hp + power.bonusHealIfShieldHeld);
    anim.floatAt(hero.x, hero.y, t('log.wardHeal', { n: power.bonusHealIfShieldHeld }), '#e8d27a');
  }
  hero.wardShield = Math.round(hero.maxHp * power.shieldPct);
}

// Simbiosis Natural (Druida): revisa cuánto daño se recibió en el turno que
// acaba de pasar (damageTakenLastTurn) y cura si toca, según el tier.
function tickNaturalSymbiosis() {
  const hero = state.hero;
  const tier = getOwnedTier('natural_symbiosis');
  if (!tier) { damageTakenLastTurn = 0; return; }
  const power = getSkillDef('natural_symbiosis').tiers[tier - 1].power;
  const lowThreshold = power.healIfLowDamagePct ? hero.maxHp * power.healIfLowDamagePct : 0;
  const qualifies = damageTakenLastTurn === 0 || (lowThreshold > 0 && damageTakenLastTurn <= lowThreshold);
  damageTakenLastTurn = 0;
  if (!qualifies || hero.hp >= hero.maxHp) return;
  hero.hp = Math.min(hero.maxHp, hero.hp + power.healIfNoDamage);
  anim.floatAt(hero.x, hero.y, t('log.symbiosisHeal', { n: power.healIfNoDamage }), '#7fc06a');
}

// Círculo de Renacer (Clérigo): cura a quien esté dentro del radio y
// descuenta un turno de vida a la zona; la retira cuando se agota.
function tickHolyZones() {
  const hero = state.hero;
  for (let i = holyZones.length - 1; i >= 0; i--) {
    const z = holyZones[i];
    if (z.healPerTurn > 0 && distTo(hero, z.x, z.y) <= z.radius) {
      hero.hp = Math.min(hero.maxHp, hero.hp + z.healPerTurn);
      anim.floatAt(hero.x, hero.y, t('log.circleHeal', { n: z.healPerTurn }), '#e8d27a');
    }
    z.turnsLeft--;
    if (z.turnsLeft <= 0) holyZones.splice(i, 1);
  }
}

// Empieza el turno del héroe: PA a tope y recalcula su alcance.
export function startHeroTurn() {
  state.hero.ap = state.hero.apMax;
  // Aturdido (Golem de hueso, ver stunTarget()): no puedes hacer nada este
  // turno tuyo, se avisa con el texto flotante y el turno pasa solo. Se
  // cuenta en turnos DEL AFECTADO (no del golem) — más simple y predecible
  // con cualquier orden de iniciativa.
  if (state.hero.stunnedTurnsLeft > 0) {
    state.hero.ap = 0;
    syncHUD();
    centerOnTile(state.hero.x, state.hero.y);
    anim.floatAt(state.hero.x, state.hero.y, `¡${t('status.aturdido')}!`, '#b98fe0', { static: true });
    audio.fx('ui');
    state.hero.stunnedTurnsLeft--;
    refreshHeroStunStatus();
    setTimeout(() => endHeroTurn(), 700);   // deja ver el aviso antes de pasar el turno solo
    return;
  }
  if (warCryTurnsLeft > 0) warCryTurnsLeft--;
  if (wildShapeTurnsLeft > 0) {
    wildShapeTurnsLeft--;
    if (wildShapeTurnsLeft === 0) { log(t('log.wildShapeEnd'), 'combat'); wildShapePower = null; }
  }
  refreshWardShield();
  tickNaturalSymbiosis();
  tickHolyZones();
  computeReach();
  syncHUD();
}

// Aturde a `target` (por ahora, siempre el héroe: es el único con turnos
// propios de verdad) durante `turns` de SUS PROPIOS turnos. Actualiza a la
// vez `hero.statuses` para el icono con el numerito (ver renderStatusIcons
// en ui.js — el icono `status_aturdido.png` y el texto ya existían,
// preparados para cuando hiciera falta un sistema de estados real).
function stunTarget(target, turns) {
  target.stunnedTurnsLeft = Math.max(target.stunnedTurnsLeft || 0, turns);
  if (target === state.hero) refreshHeroStunStatus();
}
function refreshHeroStunStatus() {
  const hero = state.hero;
  hero.statuses = (hero.statuses || []).filter(s => s.icon !== 'aturdido');
  if (hero.stunnedTurnsLeft > 0) hero.statuses.push({ icon: 'aturdido', turns: hero.stunnedTurnsLeft });
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
let lastHeroAttackAt = 0;

// Acción del jugador al tocar una casilla (la llama render.js).
// Usa de verdad una habilidad ACTIVA. `gx,gy` es la casilla tocada (null si
// es de auto-lanzamiento, como Grito de guerra). Devuelve true si se ha
// usado de verdad (para que quien llama sepa si debe desarmarla).
// Cola/remate compartido por CUALQUIER uso de habilidad activa: gasta el PA,
// fija el enfriamiento (salvo que un "vale" de Sobrecarga Arcana/Cosecha de
// Almas lo perdone), sincroniza HUD/iniciativa y decide si el turno se acaba.
// `power` es el tier ya resuelto de la habilidad que se acaba de usar (para
// poder tirar la probabilidad de Sobrecarga Arcana sobre CUALQUIER activa).
function finishActiveSkillUse(id, def) {
  const hero = state.hero;
  hero.ap -= ATTACK_COST;

  let freeCast = false;
  if (freeNextCastSkip) { freeCast = true; freeNextCastSkip = false; }
  const aoTier = getOwnedTier('arcane_overload');
  if (!freeCast && aoTier) {
    const power = getSkillDef('arcane_overload').tiers[aoTier - 1].power;
    if (Math.random() < power.freeCastChance) {
      freeCast = true;
      arcaneOverloadStreak++;
      if (power.healOnDoubleProc && arcaneOverloadStreak >= 2) {
        hero.hp = Math.min(hero.maxHp, hero.hp + power.healOnDoubleProc);
        anim.floatAt(hero.x, hero.y, `+${power.healOnDoubleProc}`, '#6a8fe8');
        arcaneOverloadStreak = 0;
      }
    } else arcaneOverloadStreak = 0;
  }
  skillCooldowns[id] = freeCast ? 0 : (def.cooldown || 0);

  syncHUD();
  syncInitiativeUI();
  computeReach();
  if (checkFullVictory()) { gameOver('win'); return; }
  const justEnteredCombat = scanForNewCombatants();
  if (justEnteredCombat || (hero.ap <= 0 && !state.combat.active)) endHeroTurn(justEnteredCombat);
}

// Busca una casilla libre adyacente a (tx,ty) lo más cercana posible al héroe
// — la usan Golpe desde las Sombras (teletransporte junto al objetivo).
function freeTileAdjacentTo(tx, ty) {
  const { hero } = state;
  let best = null, bd = Infinity;
  for (const [nx, ny] of stepNeighbors(tx, ty)) {
    if (!walkable(nx, ny)) continue;
    if (foeAt(nx, ny)) continue;
    if (nx === hero.x && ny === hero.y) continue;
    const d = distTo(hero, nx, ny);
    if (d < bd) { bd = d; best = { x: nx, y: ny }; }
  }
  return best;
}

// --- Altares: un solo marcador genérico (todos los altares son iguales),
// pool de 10 eventos aleatorios (5 buenos / 5 malos), un solo uso por altar.
// Ver AGENTS.md ("Altares") y ui.js (openAltarCard/renderAltarCard) para la
// parte visual — aquí solo vive el sorteo y el efecto de cada uno. ---
const ALTAR_GOOD_PCT = [0.15, 0.40];   // curación de oro/vida de los eventos buenos
const ALTAR_BAD_PCT = [0.05, 0.15];    // robo de oro/vida de los eventos malos (suavizado)
const ALTAR_BUFF_COMBATS = 3;          // duración de las bendiciones (en combates)
const ALTAR_DEBUFF_COMBATS = 2;        // duración de las maldiciones (en combates)

function altarPct(range) { return range[0] + Math.random() * (range[1] - range[0]); }

// Enemigos que puede sacar "Invocación", ponderados a la INVERSA de su vida
// máxima (cuanto más poderoso, menos probable) — pero todos pueden salir,
// según se pidió. Solo tipos ya probados/animados de verdad en el juego.
const ALTAR_SUMMON_POOL = [
  { sprite: 'enemy1', hp: 12, maxHp: 12, atk: 4 },   // esqueleto básico
  { sprite: 'enemy4', hp: 9,  maxHp: 9,  atk: 3 },   // esqueleto arquero
  { sprite: 'enemy5', hp: 16, maxHp: 16, atk: 4 },   // espectro
];
function pickWeightedSummon() {
  const weights = ALTAR_SUMMON_POOL.map(f => 1 / f.maxHp);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < ALTAR_SUMMON_POOL.length; i++) {
    r -= weights[i];
    if (r <= 0) return ALTAR_SUMMON_POOL[i];
  }
  return ALTAR_SUMMON_POOL[ALTAR_SUMMON_POOL.length - 1];
}

// Cada entrada: nº (1-10, coincide con el clip 'activateN' y la imagen
// 'altar_evN'), tipo (bueno/malo, decide qué sonido suena) y `apply(tr)`,
// que aplica el efecto de verdad y devuelve un pequeño resumen (no se usa
// para nada crítico, solo por si hiciera falta depurar).
const ALTAR_EVENTS = [
  { n: 1, kind: 'good', apply: () => {
      const hero = state.hero;
      const healed = hero.maxHp - hero.hp;
      hero.hp = hero.maxHp;
      if (healed > 0) anim.floatAt(hero.x, hero.y, `+${healed}`, '#7fc06a');
      return { healed };
  } },
  { n: 2, kind: 'good', apply: () => {
      const hero = state.hero;
      const gained = hero.gold > 0 ? Math.max(1, Math.round(hero.gold * altarPct(ALTAR_GOOD_PCT))) : 0;
      hero.gold += gained;
      if (gained > 0) anim.floatAt(hero.x, hero.y, `+${gained}`, '#e0b34a');
      return { gained };
  } },
  { n: 3, kind: 'good', apply: () => { altarStrengthCombats = ALTAR_BUFF_COMBATS; return {}; } },
  { n: 4, kind: 'good', apply: () => { altarStonehideCombats = ALTAR_BUFF_COMBATS; return {}; } },
  { n: 5, kind: 'good', apply: () => { revealAllExplored(); return {}; } },
  { n: 6, kind: 'bad', apply: () => {
      const hero = state.hero;
      const dmg = Math.max(1, Math.round(hero.hp * altarPct(ALTAR_BAD_PCT)));
      hero.hp = Math.max(1, hero.hp - dmg);
      anim.floatAt(hero.x, hero.y, `−${dmg}`, '#e86a5c');
      return { dmg };
  } },
  { n: 7, kind: 'bad', apply: () => { altarWeaknessCombats = ALTAR_DEBUFF_COMBATS; return {}; } },
  { n: 8, kind: 'bad', apply: () => {
      const hero = state.hero;
      const stolen = Math.round(hero.gold * altarPct(ALTAR_BAD_PCT));
      hero.gold = Math.max(0, hero.gold - stolen);
      if (stolen > 0) anim.floatAt(hero.x, hero.y, `−${stolen}`, '#e86a5c');
      return { stolen };
  } },
  { n: 9, kind: 'bad', apply: (tr) => {
      const summon = pickWeightedSummon();
      const spot = freeTileAdjacentTo(tr.x, tr.y);
      let spawned = false;
      if (spot) {
        state.foes.push({
          x: spot.x, y: spot.y, alive: true, hp: summon.hp, maxHp: summon.maxHp,
          atk: summon.atk, sprite: summon.sprite, apMax: 4,
          anim: 'foe' + state.foes.length, dormant: false, wakeR: 0,
        });
        spawned = true;
        syncHUD();
      }
      return { spawned, sprite: summon.sprite };
  } },
  { n: 10, kind: 'bad', apply: () => { altarFragileCombats = ALTAR_DEBUFF_COMBATS; return {}; } },
];

// Sortea un evento del pool, lo aplica de verdad y marca el altar como
// gastado. Llamado desde ui.js (openAltarCard) cuando el jugador acepta
// inclinarse. Devuelve la entrada del pool para que ui.js sepa qué imagen,
// clip de animación y sonido usar en la carta de resultado.
export function rollAltar(tr) {
  const chosen = ALTAR_EVENTS[Math.floor(Math.random() * ALTAR_EVENTS.length)];
  tr.used = true;
  chosen.apply(tr);
  syncHUD();
  return chosen;
}

// --- Cofres (V0.26): mismo patrón que los altares — un solo marcador
// genérico (todos los `chest` son iguales), pool de eventos aleatorios, un
// solo uso por cofre. Ver ui.js (openChestCard/renderChestCard) y AGENTS.md
// ("Cofres"). Arte pendiente: de momento la carta es solo texto (sin
// ilustración propia todavía, a diferencia del altar) — en cuanto haya arte
// nuevo (Nano Banana) se añade a assets.js y renderChestCard se actualiza
// para mostrarlo, igual que ya se hizo con los altares. De momento 6
// eventos (3 buenos / 3 malos); pensado para ir ampliando el pool según se
// añadan más minijuegos/riesgos u objetos de verdad (aún no existen objetos
// equipables reales, solo oro — ver inventory.js). ---
const CHEST_BIG_GOLD = [30, 70];      // tesoro abundante
const CHEST_SMALL_GOLD = [12, 30];    // bolsa modesta, sin riesgo
const CHEST_SUPPLY_GOLD = [8, 15];    // acompaña a la curación pequeña
const CHEST_STING_PCT = [0.05, 0.15]; // aguijón oculto: % de la vida actual

const CHEST_EVENTS = [
  { n: 1, kind: 'good', apply: () => {
      const hero = state.hero;
      const gained = Math.round(CHEST_BIG_GOLD[0] + Math.random() * (CHEST_BIG_GOLD[1] - CHEST_BIG_GOLD[0]));
      hero.gold += gained;
      anim.floatAt(hero.x, hero.y, `+${gained}`, '#e0b34a');
      return { gained };
  } },
  { n: 2, kind: 'good', apply: () => {
      const hero = state.hero;
      const gained = Math.round(CHEST_SMALL_GOLD[0] + Math.random() * (CHEST_SMALL_GOLD[1] - CHEST_SMALL_GOLD[0]));
      hero.gold += gained;
      anim.floatAt(hero.x, hero.y, `+${gained}`, '#e0b34a');
      return { gained };
  } },
  { n: 3, kind: 'good', apply: () => {
      const hero = state.hero;
      const healed = Math.min(hero.maxHp - hero.hp, Math.max(1, Math.round(hero.maxHp * 0.15)));
      hero.hp += healed;
      const gained = Math.round(CHEST_SUPPLY_GOLD[0] + Math.random() * (CHEST_SUPPLY_GOLD[1] - CHEST_SUPPLY_GOLD[0]));
      hero.gold += gained;
      if (healed > 0) anim.floatAt(hero.x, hero.y, `+${healed}`, '#7fc06a');
      anim.floatAt(hero.x, hero.y, `+${gained}`, '#e0b34a');
      return { healed, gained };
  } },
  { n: 4, kind: 'bad', apply: () => ({ gained: 0 }) },   // cofre vacío: solo polvo
  { n: 5, kind: 'bad', apply: () => {
      const hero = state.hero;
      const dmg = Math.max(1, Math.round(hero.hp * altarPct(CHEST_STING_PCT)));
      hero.hp = Math.max(1, hero.hp - dmg);
      anim.floatAt(hero.x, hero.y, `−${dmg}`, '#e86a5c');
      return { dmg };
  } },
  { n: 6, kind: 'bad', apply: (tr) => {
      const summon = pickWeightedSummon();
      const spot = freeTileAdjacentTo(tr.x, tr.y);
      let spawned = false;
      if (spot) {
        state.foes.push({
          x: spot.x, y: spot.y, alive: true, hp: summon.hp, maxHp: summon.maxHp,
          atk: summon.atk, sprite: summon.sprite, apMax: 4,
          anim: 'foe' + state.foes.length, dormant: false, wakeR: 0,
        });
        spawned = true;
        syncHUD();
      }
      return { spawned, sprite: summon.sprite };
  } },
];

// Sortea un evento del pool del cofre y marca el cofre como gastado, pero
// SIN aplicar el efecto todavía. Llamado desde ui.js (openChestCard) en
// cuanto el jugador confirma "Sí" en la pregunta de si quiere abrirlo — el
// texto de ambientación del evento sorteado se enseña ya, pero la
// recompensa (oro/vida/invocación) se aplica de verdad al cerrar la carta
// (ver applyChestEvent), tal como se pidió.
export function pickChestEvent(tr) {
  const chosen = CHEST_EVENTS[Math.floor(Math.random() * CHEST_EVENTS.length)];
  tr.used = true;
  return chosen;
}

// Aplica de verdad el efecto de un evento ya sorteado (pickChestEvent).
// Llamado desde ui.js al pulsar "Cerrar" en la carta de resultado del cofre.
export function applyChestEvent(tr, chosen) {
  chosen.apply(tr);
  syncHUD();
}

// Traza una línea recta (8 direcciones) desde el héroe hacia (tx,ty) y
// devuelve los enemigos que encuentra por el camino, hasta `range` casillas
// o hasta topar con un muro — la usa Disparo Múltiple.
function foesInLine(tx, ty, range) {
  const { hero } = state;
  const dx = sign(tx - hero.x), dy = sign(ty - hero.y);
  const out = [];
  let x = hero.x, y = hero.y;
  for (let i = 0; i < range; i++) {
    x += dx; y += dy;
    if (isWall(x, y)) break;
    const f = foeAt(x, y);
    if (f) out.push(f);
  }
  return out;
}

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

  // --- Círculo de Renacer (Clérigo): auto-lanzamiento, crea una zona en la
  // casilla actual del héroe (no hace falta objetivo). ---
  if (id === 'circle_of_rebirth') {
    hero.hp = Math.min(hero.maxHp, hero.hp + power.healOnCast);
    anim.floatAt(hero.x, hero.y, `+${power.healOnCast}`, '#e8d27a');
    log(t('log.circleHeal', { n: power.healOnCast }), 'combat');
    if (power.durationTurns > 0) {
      holyZones.push({
        x: hero.x, y: hero.y, radius: def.area, turnsLeft: power.durationTurns,
        healPerTurn: power.healPerTurn, preventLethalOnce: !!power.preventLethalOnce, wardConsumed: false,
      });
    }
    audio.fx('ui');
    finishActiveSkillUse(id, def);
    return true;
  }

  // --- Forma Salvaje (Druida): auto-lanzamiento, activa el buff temporal. ---
  if (id === 'wild_shape') {
    wildShapeTurnsLeft = power.durationTurns;
    wildShapePower = { dmgBonusPct: power.dmgBonusPct, armorBonus: power.armorBonus, healOnHitPct: power.healOnHitPct };
    anim.floatAt(hero.x, hero.y, skillName, '#7fc06a', { static: true });
    log(t('log.wildShapeStart', { name: skillName }), 'combat');
    audio.fx('ui');
    finishActiveSkillUse(id, def);
    return true;
  }

  if (def.range === 0) {
    // Auto-lanzamiento genérico (Grito de guerra): se aplica sobre el propio héroe, sin objetivo.
    warCryTurnsLeft = power.turns;
    warCryPct = power.atkBuffPct;
    anim.floatAt(hero.x, hero.y, skillName, '#f0c94a', { static: true });
    log(t('log.skillCastSelf', { name: skillName }), 'combat');
    audio.fx('ui');
    finishActiveSkillUse(id, def);
    return true;
  }

  if (gx == null || gy == null) return false;
  if (!isVisible(gx, gy)) return false;
  const dist = distTo(hero, gx, gy);
  if (dist > def.range) { log(t('log.skillOutOfRange')); return false; }

  // --- Disparo Múltiple (Cazador): línea recta, varios objetivos. ---
  if (id === 'multi_shot') {
    const targets = foesInLine(gx, gy, def.range).slice(0, power.maxTargets);
    if (!targets.length) return false;
    for (const foe of targets) {
      const { damage } = resolveHeroHit(hero.atk * power.dmgMult, foe);
      anim.hurt(foe.anim, foe.sprite);
      anim.floatAt(foe.x, foe.y, `−${damage}`, dmgColor(def.damageType));
      foe.hp -= damage;
      foe.dormant = false;
      if (power.slowTurns > 0) foe.slowedTurns = power.slowTurns;
      const foeName = t('enemy.' + foe.sprite);
      if (foe.hp <= 0 && foe.alive) killFoe(foe, foeName);
    }
    log(t('log.skillHit', { name: skillName }), 'combat');
    audio.fx('attack');
    finishActiveSkillUse(id, def);
    return true;
  }

  const target = foeAt(gx, gy);
  if (!target || !target.alive) return false;
  if (def.range === 1 && !adjacent(hero, gx, gy)) { log(t('log.skillOutOfRange')); return false; }

  // --- Golpe desde las Sombras (Asesino): teletransporte junto al objetivo + golpe crítico. ---
  if (id === 'shadow_strike') {
    const spot = freeTileAdjacentTo(target.x, target.y);
    if (!spot) { log(t('log.skillOutOfRange')); return false; }
    hero.x = spot.x; hero.y = spot.y;
    anim.snapTo('hero', spot.x, spot.y);   // si no, el sprite se queda atrás y parece que atacas/interactúas "a distancia"
    centerOnTile(spot.x, spot.y, true);
    recomputeFog();
    const guaranteedCrit = !!power.guaranteedCritOncePerCombat && !shadowStrikeUsedThisCombat;
    if (guaranteedCrit) shadowStrikeUsedThisCombat = true;
    const { damage, crit } = resolveHeroHit(hero.atk * (power.dmgMult || 1), target, { critBonus: power.critBonus || 0, guaranteedCrit });
    anim.hurt(target.anim, target.sprite);
    anim.floatAt(target.x, target.y, crit ? `¡CRÍTICO! −${damage}` : `−${damage}`, crit ? CRIT_COLOR : dmgColor(def.damageType), crit ? { static: true } : undefined);
    target.hp -= damage;
    target.dormant = false;
    const foeName = t('enemy.' + target.sprite);
    if (target.hp <= 0) killFoe(target, foeName);
    log(t('log.skillHit', { name: skillName }), 'combat');
    audio.fx('attack');
    finishActiveSkillUse(id, def);
    return true;
  }

  // --- Pacto de Sangre (Brujo): coste de vida propia + golpe grande. ---
  if (id === 'blood_pact') {
    const cost = Math.min(hero.hp - 1, Math.max(1, Math.round(hero.hp * power.selfHpCostPct)));
    hero.hp -= cost;
    anim.floatAt(hero.x, hero.y, `−${cost}`, '#8a5fc9');
    log(t('log.bloodPactCost', { n: cost }), 'combat');
    const { damage } = resolveHeroHit(hero.atk * power.dmgMult, target);
    anim.hurt(target.anim, target.sprite);
    anim.floatAt(target.x, target.y, `−${damage}`, dmgColor(def.damageType));
    target.hp -= damage;
    target.dormant = false;
    const foeName = t('enemy.' + target.sprite);
    const wasAlive = target.alive;
    if (target.hp <= 0 && wasAlive) {
      killFoe(target, foeName);
      if (power.lifestealOnKillPct) {
        const healed = Math.max(1, Math.round(damage * power.lifestealOnKillPct));
        hero.hp = Math.min(hero.maxHp, hero.hp + healed);
        anim.floatAt(hero.x, hero.y, `+${healed}`, '#7fc06a');
        log(t('log.bloodPactLifesteal', { n: healed }), 'combat');
      }
    }
    log(t('log.skillHit', { name: skillName }), 'combat');
    audio.fx('attack');
    syncHUD();
    finishActiveSkillUse(id, def);
    if (hero.hp <= 0) { gameOver('lose'); return true; }
    return true;
  }

  // --- Cadena Arcana (Mago): golpea y salta a enemigos cercanos con caída de daño. ---
  if (id === 'arcane_chain') {
    let dmgMult = power.dmgMult;
    let from = target;
    const hit = (foe, mult) => {
      const { damage } = resolveHeroHit(hero.atk * mult, foe);
      anim.hurt(foe.anim, foe.sprite);
      anim.floatAt(foe.x, foe.y, `−${damage}`, dmgColor(def.damageType));
      foe.hp -= damage;
      foe.dormant = false;
      const foeName = t('enemy.' + foe.sprite);
      if (foe.hp <= 0 && foe.alive) killFoe(foe, foeName);
    };
    hit(target, dmgMult);
    const hitAlready = new Set([target]);
    for (let j = 0; j < power.jumps; j++) {
      let next = null, bd = Infinity;
      for (const f of state.foes) {
        if (!f.alive || hitAlready.has(f)) continue;
        const d = distTo(from, f.x, f.y);
        if (d <= power.jumpRange && d < bd) { bd = d; next = f; }
      }
      if (!next) break;
      dmgMult *= (1 - power.falloffPct);
      hit(next, dmgMult);
      hitAlready.add(next);
      from = next;
    }
    log(t('log.skillHit', { name: skillName }), 'combat');
    audio.fx('attack');
    finishActiveSkillUse(id, def);
    return true;
  }

  // --- Resto de activas (Tajo llameante, Flecha de escarcha, Nube de veneno,
  // Golpe sagrado): mismo camino genérico de siempre (objetivo + área). ---
  if (def.range === 1 && !adjacent(hero, gx, gy)) { log(t('log.skillOutOfRange')); return false; }
  const targets = [target];
  if (def.area) {
    for (const f of state.foes) {
      if (f.alive && f !== target && distTo(f, gx, gy) <= def.area) targets.push(f);
    }
  }
  for (const foe of targets) {
    const { damage } = resolveHeroHit(hero.atk * power.dmgMult, foe);
    anim.hurt(foe.anim, foe.sprite);
    anim.floatAt(foe.x, foe.y, `−${damage}`, dmgColor(def.damageType));
    foe.hp -= damage;
    foe.dormant = false;
    const foeName = t('enemy.' + foe.sprite);
    if (foe.hp <= 0 && foe.alive) killFoe(foe, foeName);
  }
  log(t('log.skillHit', { name: skillName }), 'combat');
  audio.fx('attack');
  finishActiveSkillUse(id, def);
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
    const hit = resolveHeroHit(hero.atk, target);
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

  // --- ¿Contenedor de botín (cofre/urna genérico, futuro sistema de items)?
  // No usa cartas de evento: adyacente = se abre con su animación y aparece
  // la misma ventana de botín que un cadáver (de momento solo oro aleatorio,
  // 10-200). No cuesta PA, igual que recoger de un cadáver. Al vaciarlo del
  // todo desaparece del mapa para siempre (no se puede volver a saquear). ---
  const tr = blockingTriggerAt(gx, gy);
  if (tr && tr.type === 'container') {
    const d = distTo(hero, gx, gy);
    if (d <= 1) {
      anim.loot('hero', 'hero');
      if (!tr.loot) tr.loot = generateLoot();
      showLootWindow(tr);
    } else if (isVisible(gx, gy)) {
      showHint(tr);
    }
    return;
  }

  // --- ¿Altar? Un solo marcador genérico (todos son iguales): adyacente y
  // sin gastar todavía = pregunta si quieres inclinarte (openAltarCard, que
  // sortea uno de los 10 eventos del pool solo si dices que sí); ya gastado
  // = mensaje neutro, se queda ahí en reposo para siempre (no desaparece
  // como un contenedor). No pasa por events.json: el contenido es el mismo
  // pool para cualquier altar, en cualquier nivel. ---
  if (tr && tr.type === 'altar') {
    const d = distTo(hero, gx, gy);
    if (d <= 1) {
      if (tr.used) { log(t('log.altarSpent')); return; }
      const cost = 1;
      if (hero.ap < cost) { log(t('log.noAP')); return; }
      hero.ap -= cost; syncHUD();
      anim.activateAnim('hero', 'hero');
      openAltarCard(tr);
    } else if (isVisible(gx, gy) && !tr.used) {
      log(`<b>${t('altar.kicker')}</b> — ${t('altar.hint')}`);
      audio.fx('ui');
    }
    return;
  }

  // --- ¿Cofre? Un solo marcador genérico (todos son iguales, igual que el
  // altar): adyacente y sin gastar todavía = pregunta si quieres abrirlo
  // (openChestCard, imagen "¿lo intentas abrir?" + Sí/No); ya gastado =
  // mensaje neutro, se queda ahí abierto para siempre (no desaparece, y al
  // estar `used` deja de bloquear la casilla — ver blockingTriggerAt en
  // state.js). No pasa por events.json: el contenido es el mismo pool para
  // cualquier cofre, en cualquier nivel (ver CHEST_EVENTS más arriba). ---
  if (tr && tr.type === 'chest') {
    const d = distTo(hero, gx, gy);
    if (d <= 1) {
      if (tr.used) { log(t('log.chestSpent')); return; }
      const cost = 1;
      if (hero.ap < cost) { log(t('log.noAP')); return; }
      hero.ap -= cost; syncHUD();
      anim.activateAnim('hero', 'hero');
      openChestCard(tr);
    } else if (isVisible(gx, gy) && !tr.used) {
      log(`<b>${t('chest.kicker')}</b> — ${t('chest.hint')}`);
      audio.fx('ui');
    }
    return;
  }

  // --- ¿Objeto (altar, palanca, orbe, mesa, evento...)? Adyacente =
  // interactuar; a distancia = pista. Si todavía no tiene un evento conectado
  // en events.json (p.ej. un "Evento" recién colocado en el editor, sin
  // enlazar aún), no revienta: se avisa con un mensaje neutro y no pasa nada más. ---
  if (tr) {
    const d = distTo(hero, gx, gy);
    if (d <= 1) {
      const ev = state.events[tr.id];
      if (!ev) { log(t('log.noEventYet')); anim.activateAnim('hero', 'hero'); return; }
      const cost = ev.actionCost || 1;
      if (hero.ap < cost) { log(t('log.noAP')); return; }
      hero.ap -= cost; syncHUD();
      if (tr.type === 'grave') {
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

      if (i < path.length - 1) await sleep(moveDurationMs());   // deja ver el paso antes de encadenar el siguiente
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
  if (trig && trig.type === 'altar') {
    // Se enciende (fotogramas 1→4) y se apaga solo (4→1); nunca se congela:
    // el altar vuelve a su reposo de siempre, solo queda "gastado" en el
    // estado del nivel (tr.used, ya puesto por rollAltar).
    anim.pulseProp(`prop:${trig.x}:${trig.y}`, 'altar', trig._altarClip || 'activate1');
  } else if (trig && trig.type === 'ambush') {
    triggerAmbush(trig);
    return;   // la propia emboscada decide cómo termina el turno (ver más abajo)
  }
  // El cofre (`type: 'chest'`) ya no hace nada aquí: su sonido/animación de
  // apertura y el sorteo del evento se disparan al pulsar "Sí" en la
  // pregunta (openChestCard, ui.js); al cerrar la carta de resultado solo
  // se aplica la recompensa (applyChestEvent) — ver rules.js/ui.js.
  computeReach();
  if (state.hero.hp > 0 && state.hero.ap <= 0 && !state.combat.active) endHeroTurn();
}

// Sonido ambiental de monstruos grandes: por ahora solo el Golem de hueso
// tiene uno registrado (golemboneIdle) — si más adelante otro monstruo trae
// el suyo, basta con añadirlo aquí. Suena si el jugador tiene alguno
// despierto a menos de 4 casillas, como mucho una vez cada 10s POR
// monstruo (cada uno con su propio cronómetro, para que no se amontonen
// si hay varios a la vez).
const MONSTER_IDLE_SOUND = { golembone: 'golemboneIdle' };
const monsterAmbienceTimer = setInterval(() => {
  if (!state.hero || !state.foes || !state.foes.length) return;
  const now = performance.now();
  for (const foe of state.foes) {
    if (!foe.alive || foe.dormant) continue;
    const cue = MONSTER_IDLE_SOUND[foe.sprite];
    if (!cue) continue;
    if (distTo(foe, state.hero.x, state.hero.y) >= 4) continue;
    if (foe._idleSoundAt && now - foe._idleSoundAt < 10000) continue;
    foe._idleSoundAt = now;
    audio.fx(cue);
  }
}, 1000);
// En Node (pruebas headless) un intervalo activo deja el proceso colgado para
// siempre; en el navegador esto no existe y no pasa nada. No afecta al juego.
if (typeof monsterAmbienceTimer.unref === 'function') monsterAmbienceTimer.unref();

// --- Emboscada sincronizada (p.ej. los 2 sigilos gemelos de Mausoleo 2) -----
// Varios triggers `type: "ambush"` pueden compartir el mismo `id` (por tanto
// la misma carta de events.json): al activar CUALQUIERA de ellos, todos los
// del grupo se marcan usados de golpe (el otro deja de poder tocarse) y se
// invocan enemigos alrededor de TODOS los orígenes del grupo a la vez.
function triggerAmbush(trig) {
  const group = state.triggers.filter(t => t.type === 'ambush' && t.id === trig.id);
  for (const t of group) t.used = true;
  audio.startEliteMusic();
  if (trig.id === 'mausoleo1_golem_guard') spawnGolemGuard(group);
  else spawnAmbushSpectres(group);
  const justEntered = scanForNewCombatants();
  if (justEntered) endHeroTurn(true);   // igual que despertar a un enemigo dormido a mitad de camino
  else { computeReach(); if (state.hero.ap <= 0 && !state.combat.active) endHeroTurn(); }
}

// Guardia del Golem de hueso (Mausoleo 1): al activar el marcador aparecen el
// golem y 4 esqueletos normales a su alrededor, todos ya despiertos. Mismo
// reparto de casillas libres que spawnAmbushSpectres, pero con esta
// composición fija en vez de solo espectros.
function spawnGolemGuard(origins) {
  const spots = freeTilesNear(origins[0].x, origins[0].y, 3)
    .sort((a, b) => a.d - b.d);
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }
  const composition = [
    { sprite: 'golembone', hp: 90, maxHp: 90, atk: 9, apMax: 4, tall: 1.725 },
    { sprite: 'enemy1', hp: 12, maxHp: 12, atk: 4, apMax: 4 },
    { sprite: 'enemy1', hp: 12, maxHp: 12, atk: 4, apMax: 4 },
    { sprite: 'enemy1', hp: 12, maxHp: 12, atk: 4, apMax: 4 },
    { sprite: 'enemy1', hp: 12, maxHp: 12, atk: 4, apMax: 4 },
  ];
  composition.forEach((def, i) => {
    const spot = spots[i] || origins[0];
    state.foes.push({
      x: spot.x, y: spot.y, alive: true, ...def,
      anim: 'foe' + state.foes.length, dormant: false, wakeR: 0,
    });
  });
  syncHUD();
}

// Reparte `count` espectros en casillas libres alrededor de los orígenes dados
// (radio `maxDist` cada uno), sin pisarse entre sí ni con nada ya ocupado.
// `freeTilesNear` ya excluye al héroe, muros, otros enemigos y cualquier
// objeto/altar/marcador bloqueante — exactamente lo que hace falta aquí.
function spawnAmbushSpectres(origins, count = 6, maxDist = 3) {
  const seen = new Set();
  const candidates = [];
  for (const o of origins) {
    for (const spot of freeTilesNear(o.x, o.y, maxDist)) {
      const key = `${spot.x},${spot.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(spot);
    }
  }
  // Barajar (Fisher-Yates) para que el patrón de aparición no sea siempre
  // el mismo, dando prioridad relativa a las casillas más cercanas.
  candidates.sort((a, b) => a.d - b.d);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const chosen = candidates.slice(0, count);
  for (const spot of chosen) {
    state.foes.push({
      x: spot.x, y: spot.y, alive: true,
      hp: 16, maxHp: 16, atk: 4,
      sprite: 'enemy5', apMax: 4,
      anim: 'foe' + state.foes.length, dormant: false, wakeR: 0,
    });
  }
  syncHUD();
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

// --- Velocidad de juego (ajustable desde el menú de Ajustes) ---------------
// Multiplica tanto las pausas de la IA (entre acciones y entre turnos) como
// la propia animación de movimiento (ver config.js: moveDurationMs), para que
// el cambio se note de verdad y no solo en las pausas.
export function getEnemySpeed() { return getGameSpeed(); }
export function setEnemySpeed(v) { setGameSpeed(v); }
const enemySleep = (ms) => sleep(ms * speedMult());

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
// Disparo Múltiple (Cazador, tier 3): un enemigo golpeado con `slowedTurns`
// pendiente actúa con 1 PA menos en su PRÓXIMO turno (y solo en ese), sea
// cual sea su tipo de IA — se resta aquí, en el único punto por el que pasan
// las 4 variantes de turno enemigo, en vez de tocar cada una por separado.
function runSingleFoeTurn(foe) {
  const cfg = RANGED_CFG[foe.sprite];
  let restoreApMax = null;
  if (foe.slowedTurns > 0) {
    foe.slowedTurns--;
    restoreApMax = foe.apMax;
    foe.apMax = Math.max(1, foe.apMax - 1);
  }
  const finish = (result) => { if (restoreApMax != null) foe.apMax = restoreApMax; return result; };
  if (foe.sprite === 'enemy5') return Promise.resolve(spectreTurn(foe)).then(finish);
  if (foe.sprite === 'enemy6') return Promise.resolve(mageTurn(foe)).then(finish);
  if (foe.sprite === 'golembone') return Promise.resolve(golemTurn(foe)).then(finish);
  if (cfg) return Promise.resolve(archerTurn(foe, cfg)).then(finish);
  return Promise.resolve(meleeTurn(foe)).then(finish);
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
  if (foe.sprite === 'golembone') audio.fx('golemboneWalk');
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
// --- Golem de hueso: monstruosidad grande y lenta, con 2 habilidades ------
// propias que se comprueban al EMPEZAR su turno, antes de la pelea normal:
//
// 1) Rematar débiles: si algo adyacente (amigo o enemigo suyo — el héroe o
//    uno de sus propios compañeros) tiene menos del 5% de su vida máxima, lo
//    mata de un golpe, se cura 25% de su propia vida máxima y su daño sube
//    un 10% PARA SIEMPRE (no caduca, es un monstruo que crece con cada
//    víctima). Cuesta lo mismo que un ataque normal.
// 2) Aturdir: si tiene 2 o más unidades "del bando del héroe" (el propio
//    héroe y, el día de mañana, mascotas) adyacentes A LA VEZ, gasta 2 PA en
//    aturdir de un golpe a la que menos vida tenga, durante 2 turnos DE ELLA
//    (no del golem) — ver stunTarget()/refreshHeroStunStatus() más arriba.
//    Con solo 1 héroe y sin mascotas todavía esto casi nunca se cumple; se
//    deja construido para cuando existan mascotas de verdad.
//
// Si se cumplen las dos a la vez, primero remata (a petición expresa).
const GOLEM_EXECUTE_HP_PCT = 0.05;
const GOLEM_EXECUTE_HEAL_PCT = 0.25;
const GOLEM_EXECUTE_DMG_BUFF = 0.10;
const GOLEM_STUN_COST = 2;
const GOLEM_STUN_TURNS = 2;

// Unidades "del bando del héroe" adyacentes al golem (por ahora solo puede
// haber 1: el propio héroe; el día de mañana se le sumarían las mascotas).
function heroSideAdjacentTo(foe) {
  const list = [];
  if (state.hero.hp > 0 && distTo(foe, state.hero.x, state.hero.y) <= 1) list.push(state.hero);
  return list;
}

// Mata sin pasar por killFoe() (que registra Sed de Sangre/Cosecha de Almas
// como si el HÉROE hubiera hecho la muerte — aquí es el golem rematando a
// uno de sus propios aliados, no debe darle ningún buff al jugador).
function executeAllyFoe(target) {
  audio.fx('golemboneIdle');
  target.alive = false;
  if (ANIM_CLIPS[target.sprite]) { anim.die(target.anim); target.deathPlaying = true; }
  target.loot = generateLoot(target);
  checkCombatEnd();
}

async function golemTurn(foe) {
  const { hero } = state;
  let ap = foe.apMax;

  // --- 1) Rematar débiles (prioridad si se cumplen las dos condiciones) ---
  const adjAllies = heroSideAdjacentTo(foe).filter(u => u.hp / u.maxHp <= GOLEM_EXECUTE_HP_PCT);
  const adjOwnWeak = state.foes.filter(f => f !== foe && f.alive && distTo(foe, f.x, f.y) <= 1 && f.hp / f.maxHp <= GOLEM_EXECUTE_HP_PCT);
  const executeTarget = adjAllies[0] || adjOwnWeak[0];
  if (executeTarget && ap >= ATTACK_COST) {
    ap -= ATTACK_COST;
    anim.attack(foe.anim, sign(executeTarget.x - foe.x), sign(executeTarget.y - foe.y), foe.sprite);
    const heal = Math.round(foe.maxHp * GOLEM_EXECUTE_HEAL_PCT);
    foe.hp = Math.min(foe.maxHp, foe.hp + heal);
    foe.atk = Math.round(foe.atk * (1 + GOLEM_EXECUTE_DMG_BUFF));
    if (executeTarget === hero) {
      audio.fx('golemboneIdle');
      anim.hurt('hero', 'hero');
      hero.hp = 0;
      log(t('log.golemExecute', { name: t('enemy.golembone') }), 'combat');
      syncHUD();
      gameOver('lose');
      return true;
    } else {
      executeAllyFoe(executeTarget);
      log(t('log.golemExecute', { name: t('enemy.golembone') }), 'combat');
    }
    syncHUD();
    await enemySleep(320);
  }

  // --- 2) Aturdir (solo si de verdad hay 2+ del bando del héroe adyacentes) ---
  const adjHeroSide = heroSideAdjacentTo(foe);
  if (adjHeroSide.length >= 2 && ap >= GOLEM_STUN_COST) {
    ap -= GOLEM_STUN_COST;
    const weakest = adjHeroSide.reduce((a, b) => (b.hp < a.hp ? b : a));
    stunTarget(weakest, GOLEM_STUN_TURNS);
    audio.fx('golemboneIdle');
    anim.attack(foe.anim, sign(weakest.x - foe.x), sign(weakest.y - foe.y), foe.sprite);
    log(t('log.golemStun', { name: t('enemy.golembone') }), 'combat');
    syncHUD();
    await enemySleep(320);
  }

  // --- Resto del turno: pelea cuerpo a cuerpo normal, con el PA que quede ---
  while (ap > 0) {
    if (hero.hp <= 0 || !state.combat.active) break;
    if (adjacent(foe, hero.x, hero.y)) {
      if (ap < ATTACK_COST) break;
      ap -= ATTACK_COST;
      anim.attack(foe.anim, sign(hero.x - foe.x), sign(hero.y - foe.y), foe.sprite);
      audio.fx('hurt');
      const dmg = applyIncomingHit(foe.atk, 'physical', '#e86a5c');
      if (dmg > 0) anim.hurt('hero', 'hero');
      log(tRandom('log.hitHero', 5, { name: t('enemy.golembone'), dmg }), 'combat');
      syncHUD();
      if (hero.hp <= 0) { gameOver('lose'); return true; }
      await enemySleep(320);
      continue;
    }
    if (ap < MOVE_COST) break;
    const step = approachStep(foe, ap);
    if (!step) break;
    doMove(foe, step);
    ap -= step.cost;
    await enemySleep(190);
  }
  return false;
}

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


