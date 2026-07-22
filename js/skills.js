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

import { state } from './state.js?v=0.20';
import { t } from './i18n.js?v=0.20';
import { VERSION } from './config.js?v=0.20';
import { showConfirm } from './ui.js?v=0.20';
import { getPersistedGold, persistGold } from './savegame.js?v=0.20';

const STORAGE_KEY = 'cripta.skills';
const TIER_COUNT = 3;
const ACTIONBAR_SLOTS = 10;

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

function renderCards() {
  if (!bodyEl) return;
  bodyEl.innerHTML = def.skills.map(cardHTML).join('');
  bodyEl.querySelectorAll('[data-buy]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (buy(btn.dataset.buy)) { renderAll(); renderActionBar(); }
    });
  });
}

function renderAll() { renderGold(); renderCards(); }

// --- barra de acción (10 slots, abajo, movible por separado) --------------

let actionBarEl = null;

function renderActionBar() {
  if (!actionBarEl) return;
  const actives = getActiveOwnedSkills();
  const slots = [];
  for (let i = 0; i < ACTIONBAR_SLOTS; i++) {
    const s = actives[i];
    slots.push(s
      ? `<div class="actionbar-slot actionbar-filled" title="${t(`skill.${s.id}.name`)}">${iconHTML(s)}</div>`
      : `<div class="actionbar-slot"></div>`);
  }
  actionBarEl.innerHTML = slots.join('');
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

  renderAll();
  renderActionBar();
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
  if (shopEl && shopEl.classList.contains('show')) renderAll();
  renderActionBar();
}
