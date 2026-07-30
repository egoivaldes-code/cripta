// Tienda de habilidades — SISTEMA TEMPORAL DE PRUEBAS.
//
// Objetivo: poder ir metiendo habilidades una a una y probarlas (icono +
// descripción + tipo de daño + activa/pasiva + duración + precio) antes de
// que el sistema "de verdad" (con sus efectos reales en combate) exista.
// Por eso vive en su propio módulo, separado de rules.js/state.js: cuando
// llegue el sistema definitivo, esto se puede sustituir sin tocar el motor.
//
// Cada habilidad tiene 3 tiers. Al comprar un tier, la propia tarjeta pasa a
// ofrecer el siguiente (mismo hueco, no aparecen tarjetas nuevas). El precio
// sube por tier. Se puede subir de tier cualquier habilidad en cualquier
// momento, sin requisitos entre ellas.
//
// Progreso (oro gastado + tiers comprados) persistido en localStorage, con
// botón de "reiniciar progreso" aparte de todo lo demás.
//
// Arquitectura (mismo patrón que inventory.js): un módulo hace de datos +
// estado + render + interacción para toda esta pantalla, ya que es un bloque
// autocontenido de la interfaz.

import { state } from './state.js?v=0.33.1';
import { t } from './i18n.js?v=0.33.1';
import { VERSION, ATTACK_COST } from './config.js?v=0.33.1';
import { showConfirm } from './ui.js?v=0.33.1';
import { getPersistedGold, persistGold } from './savegame.js?v=0.33.1';
import { logEvent } from './telemetry.js?v=0.33.1';

// rules.js no se puede importar aquí (import circular: rules.js ya importa
// getOwnedTier/getSkillDef de aquí) — el enfriamiento restante se conecta
// desde main.js, igual que useSkillFn (ver bindUseActiveSkill).
let cooldownLeftFn = () => 0;
export function bindGetSkillCooldownLeft(fn) { cooldownLeftFn = fn; }

const STORAGE_KEY = 'cripta.skills';
const TIER_COUNT = 3;
const ACTIONBAR_ROW_MAX = 8;    // tope de huecos por fila
const ACTIONBAR_ROW1_MIN = 4;   // la primera fila siempre muestra al menos estos, de serie

// Cuántos huecos se ven en cada fila para `n` habilidades activas compradas.
// La 1ª fila siempre existe, con un mínimo de 4 huecos de serie, y va
// creciendo hasta 8 según se compran más; en cuanto hace falta un 9º hueco
// aparece una 2ª fila (mismo tope de 8, pero SIN mínimo — no se adelantan
// huecos vacíos de más), luego una 3ª a partir del 17º, y así sucesivamente.
function actionBarRowCounts(n) {
  const rows = Math.max(1, Math.ceil(n / ACTIONBAR_ROW_MAX));
  const out = [];
  for (let r = 0; r < rows; r++) {
    const ownedHere = Math.max(0, Math.min(ACTIONBAR_ROW_MAX, n - r * ACTIONBAR_ROW_MAX));
    out.push(r === 0 ? Math.max(ACTIONBAR_ROW1_MIN, ownedHere) : ownedHere);
  }
  return out;
}

// Letras/colores de icono provisional mientras no haya arte de verdad para
// una habilidad (ver assets/ui/skills/<id>.png). En cuanto ese archivo exista
// de verdad, <img onerror> deja de disparar y se ve solo.
const PLACEHOLDER_COLORS = { active: '#7a3a2a', passive: '#2a4a3a' };

let def = { skills: [] };          // contenido de data/skills.json
let owned = {};                    // owned[id] = tier comprado (0 = ninguno)

// El oro es UN SOLO número compartido de verdad con la partida (state.hero.gold),
// persistido aparte (ver savegame.js) para que sobreviva a un "Reiniciar
// partida". Este módulo nunca guarda su propia copia del oro.
function getGoldNow() { return state.hero ? state.hero.gold : getPersistedGold(); }
function spendGold(amount) {
  if (state.hero) state.hero.gold -= amount;
  persistGold(getGoldNow());
}

// Reinicio completo de la mazmorra (nivel1 desde cero), enganchado desde
// main.js — lo usa el botón "reiniciar progreso" de esta misma tienda,
// porque cambiar de tiers/oro a medio de una partida en curso dejaría
// combinaciones raras (p.ej. mitad de mausoleo con las habilidades recién
// vaciadas). bindFullReset(fn) lo conecta con newGame() de main.js.
let fullReset = () => {};
export function bindFullReset(fn) { fullReset = fn; }

// Usar una habilidad ACTIVA de verdad en combate vive en rules.js (necesita
// el motor de daño/turnos). Para no crear un import circular (rules.js ya
// importa cosas de aquí), se conecta con un "bind" — main.js hace de puente.
let useSkillFn = () => false;
export function bindUseActiveSkill(fn) { useSkillFn = fn; }

// Habilidad activa "armada": esperando a que el jugador toque un objetivo
// (o, si es de auto-lanzamiento como Grito de guerra, se usa al toque sin
// esperar nada más). Solo puede haber una armada a la vez.
let armedSkillId = null;
export function getArmedSkill() { return armedSkillId; }

export function toggleArm(id) {
  const s = skillDef(id);
  if (!s || getOwnedTier(id) <= 0) return;
  if (s.range === 0) {                 // auto-lanzamiento: no hace falta objetivo
    useSkillFn(id, null, null);
    renderActionBar();
    return;
  }
  // Si ya hay un enemigo marcado como objetivo (marco de objetivo — ver
  // syncFoeRow en ui.js), lanzarla directo sobre él en vez de armar y
  // esperar a que se vuelva a tocar algo: da igual el orden en que se
  // toquen las dos cosas (objetivo primero y habilidad después, o al
  // revés — ver también tryUseArmedOnFoe más abajo para el otro sentido).
  // Si falla (fuera de alcance, sin línea de visión...), useSkillFn ya
  // deja su propio aviso en el registro; no se arma nada en ese caso.
  if (state.targetFoe && state.targetFoe.alive) {
    useSkillFn(id, state.targetFoe.x, state.targetFoe.y);
    renderActionBar();
    return;
  }
  armedSkillId = (armedSkillId === id) ? null : id;
  renderActionBar();
}

// Atajos de teclado para PC: 1-8 arman el hueco 1-8 de la PRIMERA fila de la
// barra de acción, Shift+1-8 los de la segunda fila, Ctrl+1-8 los de la
// tercera — igual que si se tocara directamente. Solo tiene sentido con
// teclado de verdad, así que no hace nada especial en móvil (no hay tecla
// que pulsar). Se ignora si el foco está en un campo de texto (el nombre del
// leaderboard, por ejemplo) para no robarle las teclas mientras se escribe,
// y con Alt/Meta por si el navegador quiere usarlas para otra cosa (Ctrl y
// Shift sí se usan aquí, a propósito, para elegir la fila).
function slotIndexForKey(key) {
  if (key >= '1' && key <= '8') return key.charCodeAt(0) - '1'.charCodeAt(0);
  return -1;
}
function initActionBarHotkeys() {
  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.metaKey) return;
    if (e.shiftKey && e.ctrlKey) return;   // sin fila para los dos modificadores a la vez
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const localIdx = slotIndexForKey(e.key);
    if (localIdx < 0) return;
    const row = e.ctrlKey ? 2 : (e.shiftKey ? 1 : 0);
    const flatIdx = row * ACTIONBAR_ROW_MAX + localIdx;
    const s = getActiveOwnedSkills()[flatIdx];
    if (!s) return;
    const cdLeft = cooldownLeftFn(s.id);
    const noAP = !!(state.hero && state.hero.ap < ATTACK_COST);
    if (cdLeft > 0 || noAP) return;   // mismo criterio que el velo rojo: bloqueada, no hace nada
    toggleArm(s.id);
  });
}

// Llamado desde main.js en CADA toque al mapa, antes que la lógica normal de
// mover/atacar. Si hay una habilidad armada y el toque cae en un objetivo
// válido, la usa y devuelve true (para que main.js no siga con onTapTile).
export function tryUseArmedOnTile(gx, gy) {
  if (!armedSkillId) return false;
  const id = armedSkillId;
  const used = useSkillFn(id, gx, gy);
  if (used) armedSkillId = null;
  renderActionBar();
  return used;
}

// Igual que tryUseArmedOnTile, pero para cuando el toque cae en el marco/
// caja de un enemigo (fila de objetivos del HUD, ver syncFoeRow en ui.js)
// en vez de su casilla en el mapa — mismo resultado, da igual dónde se toque
// al enemigo. Devuelve false sin hacer nada si no hay ninguna habilidad
// armada, para que quien llama siga con su comportamiento normal (marcar/
// desmarcar objetivo).
export function tryUseArmedOnFoe(foe) {
  if (!armedSkillId || !foe) return false;
  return tryUseArmedOnTile(foe.x, foe.y);
}

// --- persistencia (solo los tiers comprados; el oro va aparte, ver arriba) --

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && saved.owned) owned = saved.owned;
  } catch { /* progreso corrupto o inexistente: se queda vacío */ }
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ owned })); } catch {}
}

export async function loadSkillsData() {
  def = await fetch(`./data/skills.json?v=${VERSION}`).then(r => r.json());
  load();
}

// --- consultas -------------------------------------------------------------

export function getGold() { return getGoldNow(); }
export function getOwnedTier(id) { return owned[id] || 0; }
function skillDef(id) { return def.skills.find(s => s.id === id); }

function priceFor(id, tierIndex) {   // tierIndex: 0-based (tier a comprar)
  const s = skillDef(id);
  return s && s.tiers[tierIndex] ? s.tiers[tierIndex].price : null;
}

export function getActiveOwnedSkills() {
  // Orden de compra (según se fueron comprando), no el orden del catálogo.
  return Object.keys(owned)
    .filter(id => owned[id] > 0 && skillDef(id) && skillDef(id).kind === 'active')
    .map(id => skillDef(id));
}

export function getPassiveOwnedSkills() {
  return Object.keys(owned)
    .filter(id => owned[id] > 0 && skillDef(id) && skillDef(id).kind === 'passive')
    .map(id => skillDef(id));
}

export function getSkillDef(id) { return skillDef(id); }

// Valores de referencia SIN ninguna habilidad — deben coincidir con los
// valores por defecto de state.js (initGame). Si esos cambian allí, cambiar
// también aquí para que la hoja de personaje siga sumando bien.
const BASE_STATS = { critChance: 0.01, armor: 25, dodgeChance: 0.01 }; // armor: valor plano, no %, ver ARMOR_CONSTANT en config.js

// Bonus actuales aportados por las pasivas de estadística plana (no cuenta
// Golpes de fe/Sed de sangre, que son de proc/combate, no un número fijo).
export function getSkillBonuses() {
  const bp = getOwnedTier('butcher_precision');
  const is = getOwnedTier('iron_skin');
  const cr = getOwnedTier('cat_reflexes');
  const bpDef = skillDef('butcher_precision'), isDef = skillDef('iron_skin'), crDef = skillDef('cat_reflexes');
  return {
    crit: bp > 0 && bpDef ? bpDef.tiers[bp - 1].power.critBonus : 0,
    armor: is > 0 && isDef ? isDef.tiers[is - 1].power.armorBonus : 0,
    dodge: cr > 0 && crDef ? crDef.tiers[cr - 1].power.dodgeBonus : 0,
  };
}

// Aplica los bonus de las pasivas de estadística plana sobre un héroe recién
// preparado (nivel nuevo, carry entre niveles, o partida retomada). Se puede
// llamar varias veces sin problema: siempre RECALCULA desde la base, nunca
// suma sobre sí mismo (evita duplicar el bonus si se llama dos veces).
export function applySkillBonuses(hero) {
  if (!hero) return;
  const b = getSkillBonuses();
  hero.critChance = BASE_STATS.critChance + b.crit;
  hero.armor = BASE_STATS.armor + b.armor;
  hero.dodgeChance = BASE_STATS.dodgeChance + b.dodge;
}

// --- acciones ----------------------------------------------------------

function buy(id) {
  const s = skillDef(id);
  if (!s) return false;
  const tier = getOwnedTier(id);
  if (tier >= TIER_COUNT) return false;
  const price = priceFor(id, tier);
  if (getGoldNow() < price) { log(t('skillshop.notEnoughGold')); return false; }
  spendGold(price);
  owned[id] = tier + 1;
  persist();
  return true;
}

function resetProgress() {
  owned = {};
  persist();
  persistGold(1000);
  if (state.hero) state.hero.gold = 1000;
  fullReset();   // recarga el nivel 1 desde cero (ver bindFullReset)
  renderAll();
  renderActionBar();
}

// Pequeño aviso dentro de la propia tienda (no usa el registro del juego,
// que está debajo de esta pantalla y no se ve todavía).
let noticeEl = null;
function log(msg) {
  if (!noticeEl) return;
  noticeEl.textContent = msg;
  noticeEl.classList.add('show');
  clearTimeout(log._t);
  log._t = setTimeout(() => noticeEl.classList.remove('show'), 1800);
}

// --- render: tarjetas de la tienda ------------------------------------

let bodyEl = null, goldEl = null, shopEl = null;

function iconHTML(s) {
  const color = PLACEHOLDER_COLORS[s.kind] || '#444';
  const letter = (t(`skill.${s.id}.name`)[0] || '?').toUpperCase();
  // El <img> real se intenta siempre primero; si no existe el archivo aún
  // (caso normal ahora mismo), onerror lo oculta y queda el círculo de detrás.
  return `<div class="skill-icon" style="background:${color}">` +
         `<span class="skill-icon-letter">${letter}</span>` +
         `<img src="${s.icon}?v=${VERSION}" alt="" onerror="this.style.display='none'" onload="this.previousElementSibling.style.display='none'">` +
         `</div>`;
}

function rangeLabel(s) {
  if (s.range == null) return null;
  if (s.range === 0) return t('skillshop.rangeSelf');
  if (s.range === 1) return t('skillshop.rangeMelee');
  return t('skillshop.range', { n: s.range });
}
function areaLabel(s) { return s.area ? t('skillshop.area', { n: s.area }) : t('skillshop.areaNone'); }
function cooldownLabel(s) { return s.cooldown != null ? t('skillshop.cooldown', { n: s.cooldown }) : t('skillshop.cooldownNone'); }

function cardHTML(s) {
  const tier = getOwnedTier(s.id);
  const maxed = tier >= TIER_COUNT;
  const nextTier = tier + 1;   // 1-based, para mostrar "Nivel 1/2/3"
  const price = maxed ? null : priceFor(s.id, tier);
  const durationText = s.durationLabel ? t(s.durationLabel)
    : s.duration ? t('skillshop.duration', { n: s.duration })
    : t('skillshop.durationNone');
  const tierDescKey = `skill.${s.id}.tier${maxed ? TIER_COUNT : nextTier}`;

  return `
    <div class="skill-card${maxed ? ' skill-maxed' : ''}" data-id="${s.id}">
      ${iconHTML(s)}
      <div class="skill-info">
        <div class="skill-name">${t(`skill.${s.id}.name`)}</div>
        <div class="skill-tags">
          ${s.class ? `<span class="skill-tag skill-tag-class">${t(`class.${s.class}`)}</span>` : ''}
          <span class="skill-tag skill-tag-kind">${t(`skillshop.kind.${s.kind}`)}</span>
          <span class="skill-tag skill-tag-dmg">${t(`dmgtype.${s.damageType}`)}</span>
          <span class="skill-tag skill-tag-dur">${durationText}</span>
          ${s.kind === 'active' ? `
            ${rangeLabel(s) ? `<span class="skill-tag skill-tag-range">${rangeLabel(s)}</span>` : ''}
            <span class="skill-tag skill-tag-area">${areaLabel(s)}</span>
            <span class="skill-tag skill-tag-cd">${cooldownLabel(s)}</span>
          ` : ''}
        </div>
        <div class="skill-desc">${t(`skill.${s.id}.desc`)}</div>
        <div class="skill-tierdesc">${t(tierDescKey)}</div>
        ${tier > 0 ? `<div class="skill-owned-tier">${t('skillshop.tierLabel', { n: tier })} ${'★'.repeat(tier)}${'☆'.repeat(TIER_COUNT - tier)}</div>` : ''}
      </div>
      <div class="skill-buy">
        ${maxed
          ? `<div class="skill-max-badge">${t('skillshop.tierMax')}</div>`
          : `<button class="skill-buy-btn" data-buy="${s.id}">
               <span class="skill-price"><img class="goldIcon" src="./assets/ui/gold_icon.png" alt="">${price}</span>
               <span>${t('skillshop.buy')} · ${t('skillshop.tierLabel', { n: nextTier })}</span>
             </button>`}
      </div>
    </div>`;
}

function renderGold() { if (goldEl) goldEl.textContent = getGoldNow(); }

// --- filtros y orden de la tienda ------------------------------------------
// Orden: primero por tier YA POSEÍDO, descendente (lo más avanzado arriba);
// dentro del mismo tier poseído, por precio del PRÓXIMO nivel, ascendente
// (lo más barato de mejorar primero). Al máximo (sin precio siguiente) va al
// final de su grupo de tier.
let filterOwned = 'all';    // 'all' | 'owned'
let filterKind = 'all';     // 'all' | 'active' | 'passive'
let filterClass = 'all';    // 'all' | <id de clase>

function nextTierPrice(s) {
  const tier = getOwnedTier(s.id);
  return tier >= TIER_COUNT ? Infinity : s.tiers[tier].price;
}

function classList() {
  return [...new Set(def.skills.map(s => s.class).filter(Boolean))].sort();
}

export function setShopFilterOwned(v) { filterOwned = v; renderCards(); }
export function setShopFilterKind(v) { filterKind = v; renderCards(); }
export function setShopFilterClass(v) { filterClass = v; renderCards(); }

function sortedFilteredSkills() {
  return def.skills
    .filter(s => filterOwned === 'all' || getOwnedTier(s.id) > 0)
    .filter(s => filterKind === 'all' || s.kind === filterKind)
    .filter(s => filterClass === 'all' || s.class === filterClass)
    .sort((a, b) => {
      const ta = getOwnedTier(a.id), tb = getOwnedTier(b.id);
      if (tb !== ta) return tb - ta;
      return nextTierPrice(a) - nextTierPrice(b);
    });
}

function renderCards() {
  if (!bodyEl) return;
  bodyEl.innerHTML = sortedFilteredSkills().map(cardHTML).join('');
  bodyEl.querySelectorAll('[data-buy]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (buy(btn.dataset.buy)) {
        applySkillBonuses(state.hero);   // si no, un pasivo plano (Piel de hierro, Reflejos felinos...) no se nota hasta el siguiente nivel
        logEvent('skill_purchased', { id: btn.dataset.buy, tier: getOwnedTier(btn.dataset.buy) });
        renderAll();
        renderActionBar();
      }
    });
  });
}

function renderAll() { renderGold(); renderCards(); }

// --- barra de acción (filas dinámicas: 4→8 huecos en la 1ª, filas nuevas
// cada 8 habilidades activas más — ver actionBarRowCounts) -----------------

let actionBarEl = null;

export function renderActionBar() {
  if (!actionBarEl) return;
  const actives = getActiveOwnedSkills();
  const rowCounts = actionBarRowCounts(actives.length);
  const rowsHTML = rowCounts.map((count, r) => {
    const slots = [];
    for (let i = 0; i < count; i++) {
      const s = actives[r * ACTIONBAR_ROW_MAX + i];
      if (!s) { slots.push(`<div class="actionbar-slot"></div>`); continue; }
      const cdLeft = cooldownLeftFn(s.id);
      const noAP = !!(state.hero && state.hero.ap < ATTACK_COST);
      const locked = cdLeft > 0 || noAP;
      slots.push(
        `<div class="actionbar-slot actionbar-filled${armedSkillId === s.id ? ' actionbar-armed' : ''}${locked ? ' actionbar-locked' : ''}" data-skill="${s.id}" data-locked="${locked ? '1' : '0'}" title="${t(`skill.${s.id}.name`)}">${iconHTML(s)}${cdLeft > 0 ? `<div class="actionbar-cd">${cdLeft}</div>` : ''}</div>`
      );
    }
    return `<div class="actionbar-row" data-row="${r}">${slots.join('')}</div>`;
  }).join('');
  actionBarEl.innerHTML = rowsHTML;
  actionBarEl.querySelectorAll('[data-skill]').forEach(el => {
    el.addEventListener('click', () => { if (el.dataset.locked === '1') return; toggleArm(el.dataset.skill); });
  });
}

// --- apertura / cierre de la tienda -------------------------------------

export function initSkillShop() {
  shopEl = document.getElementById('skillShop');
  bodyEl = document.getElementById('skillShopBody');
  goldEl = document.getElementById('shopGold');
  noticeEl = document.getElementById('shopNotice');
  actionBarEl = document.getElementById('actionbar');

  document.getElementById('shopResetBtn').addEventListener('click', () => {
    showConfirm(t('confirm.resetShop.title'), t('confirm.resetShop.text'), resetProgress);
  });

  document.querySelectorAll('.skillshop-filter-group[data-filter]').forEach(group => {
    const key = group.dataset.filter;   // 'owned' | 'kind'
    group.querySelectorAll('button[data-value]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (key === 'owned') filterOwned = btn.dataset.value;
        else filterKind = btn.dataset.value;
        markShopFilters();
        renderCards();
      });
    });
  });
  document.getElementById('filterClassSelect').addEventListener('change', e => {
    filterClass = e.target.value;
    renderCards();
  });

  markShopFilters();
  renderAll();
  renderActionBar();
  initActionBarHotkeys();
}

// Textos + opción seleccionada de los 3 filtros (se llama al iniciar y cada
// vez que cambia el idioma, igual que el resto de refreshSkillTexts).
function markShopFilters() {
  document.querySelectorAll('#filterOwnedGroup button[data-value]').forEach(b => {
    b.textContent = t(`skillshop.filter.owned.${b.dataset.value}`);
    b.classList.toggle('on', b.dataset.value === filterOwned);
  });
  document.querySelectorAll('#filterKindGroup button[data-value]').forEach(b => {
    b.textContent = t(`skillshop.filter.kind.${b.dataset.value}`);
    b.classList.toggle('on', b.dataset.value === filterKind);
  });
  const sel = document.getElementById('filterClassSelect');
  if (sel) {
    const classes = classList();
    sel.innerHTML = `<option value="all">${t('skillshop.filter.allclasses')}</option>` +
      classes.map(c => `<option value="${c}">${t(`class.${c}`)}</option>`).join('');
    sel.value = classes.includes(filterClass) ? filterClass : 'all';
    if (sel.value !== filterClass) filterClass = sel.value;
  }
}

export function openSkillShop() {
  if (!shopEl) return;
  renderAll();
  shopEl.classList.add('show');
}

export function closeSkillShop() {
  if (!shopEl) return;
  shopEl.classList.remove('show');
}

// Si cambia el idioma con la tienda abierta o la barra de acción visible,
// hay que repintar (los textos y el título de cada slot dependen de t()).
export function refreshSkillTexts() {
  markShopFilters();
  if (shopEl && shopEl.classList.contains('show')) renderAll();
  renderActionBar();
}
