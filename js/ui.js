// Capa DOM: HUD (con PA), cartas de evento, registro, fin de partida y ajustes.
// Todo el texto visible pasa por t() (multiidioma). No dibuja en el canvas.

import { state } from './state.js?v=0.17';
import { t, tRandom } from './i18n.js?v=0.17';
import * as anim from './anim.js?v=0.17';
import { IDLE_NAME } from './anim.js?v=0.17';
import * as audio from './audio.js?v=0.17';
import { VERSION } from './config.js?v=0.17';
import { images, SPRITE_TILE } from './assets.js?v=0.17';
import { pushHistory, getHistory, clearHistory, CATEGORIES } from './eventlog.js?v=0.17';

let afterInteract = () => {};
let restart = () => {};
let onAttemptDisarm = () => {};
export function bindAfterInteract(fn) { afterInteract = fn; }
export function bindRestart(fn) { restart = fn; }
export function bindAttemptDisarm(fn) { onAttemptDisarm = fn; }

const $ = id => document.getElementById(id);
let open = null; // { type:'event', trig } | { type:'over', kind } | null

export function log(html, category = 'event') { $('log').innerHTML = html; pushHistory(html, category); if (logHistoryOpen()) renderLogHistory(); }

// --- Historial completo de eventos (combate/loot/eventos) ------------------
const LOG_FILTERS = ['all', 'combat', 'loot', 'event'];
let logFilter = 'all';

export function logHistoryOpen() { return $('logHistoryVeil').classList.contains('show'); }

function renderLogHistory() {
  const list = $('logHistList');
  const entries = getHistory(logFilter);
  if (!entries.length) {
    list.innerHTML = `<div class="loghist-empty">${t('loghist.empty')}</div>`;
    return;
  }
  list.innerHTML = entries.map(e => `<div class="loghist-entry">${e.text}</div>`).join('');
}

function buildLogFilters() {
  const box = $('logHistFilters');
  box.innerHTML = '';
  LOG_FILTERS.forEach(f => {
    const b = document.createElement('button');
    b.className = 'loghist-filterbtn' + (f === logFilter ? ' on' : '');
    b.textContent = t('loghist.' + f);
    b.addEventListener('click', () => { logFilter = f; buildLogFilters(); renderLogHistory(); });
    box.appendChild(b);
  });
}

export function showLogHistory() {
  buildLogFilters();
  renderLogHistory();
  $('logHistoryVeil').classList.add('show');
}
export function hideLogHistory() { $('logHistoryVeil').classList.remove('show'); }

$('log').addEventListener('click', showLogHistory);
$('logHistCloseBtn').addEventListener('click', hideLogHistory);
$('logHistoryVeil').addEventListener('click', e => { if (e.target === $('logHistoryVeil')) hideLogHistory(); });

// --- Ventana de botín de cadáveres ------------------------------------
// De momento solo hay oro; el icono real es el mismo que el del HUD. Deja
// sitio para más tipos de objeto el día que haga falta (ver LOOT_ICONS y
// applyLootEntry) sin cambiar nada más de esta ventana.
const LOOT_ICONS = { gold: './assets/ui/gold_icon.png' };
let lootCorpse = null;

function lootEntryLabel(entry) {
  if (entry.type === 'gold') return `+${entry.amount} ${t('loot.gold')}`;
  return entry.type;
}

function applyLootEntry(entry) {
  if (entry.type === 'gold') state.hero.gold = Math.max(0, state.hero.gold + entry.amount);
  audio.fx('coins');
}

function renderLootList() {
  const box = $('lootList');
  box.innerHTML = '';
  if (!lootCorpse) return;
  lootCorpse.loot.forEach((entry, i) => {
    const row = document.createElement('div');
    row.className = 'loot-row';
    row.innerHTML = `<img src="${LOOT_ICONS[entry.type] || ''}" alt=""><span>${lootEntryLabel(entry)}</span>`;
    row.addEventListener('click', () => lootOne(i));
    box.appendChild(row);
  });
}

function closeLootVeil() {
  lootCorpse = null;
  $('lootList').innerHTML = '';
  $('lootVeil').classList.remove('show');
}

// Coge un objeto suelto. Si era el último que quedaba, el cadáver
// desaparece de verdad (deja de dibujarse) y la ventana se cierra sola.
function lootOne(index) {
  if (!lootCorpse) return;
  const entry = lootCorpse.loot[index];
  if (!entry) return;
  applyLootEntry(entry);
  lootCorpse.loot.splice(index, 1);
  syncHUD();
  if (lootCorpse.loot.length === 0) { lootCorpse.deathPlaying = false; closeLootVeil(); }
  else renderLootList();
}

function lootAllNow() {
  if (!lootCorpse) return;
  lootCorpse.loot.forEach(applyLootEntry);
  lootCorpse.loot = [];
  syncHUD();
  lootCorpse.deathPlaying = false;   // ya no queda nada: mismo mecanismo de siempre para que el cadáver desaparezca
  closeLootVeil();
}

// La llama rules.js al tocar un cadáver adyacente con loot pendiente.
export function showLootWindow(corpse) {
  lootCorpse = corpse;
  anim.loot('hero', 'hero');
  $('lootTitle').textContent = t('enemy.' + corpse.sprite);
  $('lootAllBtn').textContent = t('loot.takeAll');
  renderLootList();
  $('lootVeil').classList.add('show');
}

$('lootAllBtn').addEventListener('click', lootAllNow);
// Cerrar sin coger todo NO hace desaparecer el cadáver: sigue ahí con lo
// que falte por coger para cuando el jugador quiera volver.
$('lootCloseBtn').addEventListener('click', closeLootVeil);
$('lootVeil').addEventListener('click', e => { if (e.target === $('lootVeil')) closeLootVeil(); });

// --- Confirmación genérica (reiniciar nivel, cerrar juego...) --------------
// Un solo modal reutilizable: showConfirm(título, texto, fn) lo rellena y lo
// muestra; fn se llama solo si el jugador toca "Sí". Tocar fuera de la
// tarjeta o "Cancelar" simplemente lo cierra sin hacer nada.
let confirmCb = null;
export function showConfirm(title, text, onConfirm) {
  $('confirmTitle').textContent = title;
  $('confirmText').textContent = text;
  confirmCb = onConfirm;
  $('confirmVeil').classList.add('show');
}
function hideConfirm() { $('confirmVeil').classList.remove('show'); confirmCb = null; }
$('confirmYes').addEventListener('click', () => { const fn = confirmCb; hideConfirm(); if (fn) fn(); });
$('confirmNo').addEventListener('click', hideConfirm);
$('confirmVeil').addEventListener('click', e => { if (e.target === $('confirmVeil')) hideConfirm(); });

export function syncHUD() {
  const { hero } = state;
  const pct = hero.hp / hero.maxHp;
  $('hpHero').style.width = Math.max(0, (1 - pct) * 100) + '%';
  const hpText = $('hpHeroText');
  hpText.textContent = `${Math.max(0, hero.hp)}/${hero.maxHp}`;
  hpText.style.color = pct < 0.25 ? '#e86a5c' : '#fff';
  $('gold').textContent = hero.gold;
  // Nombre del héroe (de momento fijo; en cuanto haya nombres/personalización
  // de personaje, aquí se pondría el real).
  $('heroName2').textContent = hero.name || t('hud.hero');
  // Maná: todavía no existe como recurso jugable, así que de momento se
  // muestra siempre lleno (10/10) — el hueco ya está listo para cuando exista.
  const manaMax = hero.manaMax ?? 10, mana = hero.mana ?? manaMax;
  $('manaFill').style.width = Math.max(0, (1 - mana / manaMax) * 100) + '%';
  $('manaText').textContent = `${mana}/${manaMax}`;
  // Puntos de acción: un solo dígito grande en vez de puntos, con color según
  // lo que quede (2 o más: blanco · 1: amarillo, aviso · 0: rojo, sin nada).
  // Fuera de combate no hay turnos que saltar ni PA que gastar (movimiento
  // libre), así que se esconden los dos.
  const pips = $('apPips');
  pips.classList.toggle('hidden', !state.combat.active);
  $('endTurn').classList.toggle('hidden', !state.combat.active);
  pips.textContent = hero.ap;
  pips.classList.remove('ap-white', 'ap-warn', 'ap-empty');
  pips.classList.add(hero.ap <= 0 ? 'ap-empty' : hero.ap === 1 ? 'ap-warn' : 'ap-white');
  // Perjuicios/beneficios del héroe (debajo del modelo en el mapa se
  // gestionan aparte, en render.js). De momento no existe ningún estado real
  // que aplicar, así que la fila queda vacía y se esconde sola (ver CSS).
  renderStatusIcons($('heroStatus'), hero.statuses || []);
  syncFoeRow();
}

// Dibuja los iconos de perjuicio/beneficio de una lista tipo
// [{ icon: 'envenenado', turns: 3 }, ...] dentro del contenedor dado. De
// momento ningún sitio del juego rellena esto todavía (no hay sistema de
// estados implementado); está listo para cuando lo haya.
function renderStatusIcons(container, list) {
  container.innerHTML = '';
  for (const s of list) {
    const el = document.createElement('span');
    el.className = 'statusIcon';
    el.title = t('status.' + s.icon) || s.icon;
    el.innerHTML = `<img src="./assets/ui/status/status_${s.icon}.png" alt="">` +
      (s.turns != null ? `<span class="turns">${s.turns}</span>` : '');
    container.appendChild(el);
  }
}

// Una caja por cada enemigo despierto (dormido = todavía sin descubrir, no
// sale aquí), con su nombre y su propia barra de vida. Tocar una caja la
// marca como objetivo (icono sobre su cabeza en el mapa; ver render.js).
export function syncFoeRow() {
  const row = $('foeRow');
  row.innerHTML = '';
  state.foes.forEach((foe) => {
    if (!foe.alive || foe.dormant) return;
    if (!state.visible[foe.y] || !state.visible[foe.y][foe.x]) return;   // en niebla/sin explorar: no se ve su caja
    const box = document.createElement('div');
    box.className = 'foebox' + (state.targetFoe === foe ? ' selected' : '');
    const name = t('enemy.' + foe.sprite);
    box.innerHTML = `<div class="fe-row1"><span class="fname">${name}</span><span class="status"></span></div><div class="fe-row2"><div class="bar foe"><span style="width:${Math.max(0, (1 - foe.hp / foe.maxHp) * 100)}%"></span></div></div>`;
    renderStatusIcons(box.querySelector('.status'), foe.statuses || []);
    box.onclick = () => {
      state.targetFoe = state.targetFoe === foe ? null : foe;
      syncFoeRow();
    };
    row.appendChild(box);
  });
}

// --- Iniciativa: aviso de "entra en combate" (espadas, arriba a la derecha,
// se queda mientras dure el combate) y barra horizontal con el orden de
// actuación (retratos sacados del primer fotograma de idle de cada uno).
// Se llama desde rules.js. ---
export function showCombatBadge() {
  const el = $('combatBadge');
  el.classList.remove('show'); void el.offsetWidth;   // reinicia la animación de entrada
  el.classList.add('show');
  audio.fx('ui');
}

// Dibuja el primer fotograma de idle de `ref` (héroe o enemigo) en un canvas
// pequeño, tal cual se pidió (retrato = fotograma 0 de su propia hoja de idle).
function drawPortrait(canvas, ref) {
  const sprite = ref === 'hero' ? 'hero' : ref.sprite;
  const clip = IDLE_NAME[sprite];
  const sheet = images[sprite] && images[sprite][clip];
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!sheet) return;
  ctx.drawImage(sheet, 0, 0, SPRITE_TILE, SPRITE_TILE, 0, 0, canvas.width, canvas.height);
}

export function syncInitiativeUI() {
  $('combatBadge').classList.toggle('show', state.combat.active);
  const bar = $('initiativeBar');
  if (!state.combat.active || !state.combat.order.length) { bar.classList.remove('show'); bar.innerHTML = ''; return; }
  bar.classList.add('show');
  bar.innerHTML = '';
  state.combat.order.forEach((entry, i) => {
    const isFoe = entry.ref !== 'hero';
    if (isFoe && !entry.ref.alive) return;   // los muertos desaparecen de la barra
    const slot = document.createElement('div');
    slot.className = 'initSlot' + (i === state.combat.idx ? ' current' : '');
    const canvas = document.createElement('canvas');
    canvas.width = 40; canvas.height = 40;
    slot.appendChild(canvas);
    bar.appendChild(slot);
    drawPortrait(canvas, entry.ref);
  });
}

export function hideVeil() { $('veil').classList.remove('show'); open = null; }

export function openEvent(trig) {
  state.busy = true;
  open = { type: 'event', trig };
  renderCard();
  $('veil').classList.add('show');
  audio.fx('coins');
}

// Trampa ya descubierta: pregunta si se quiere intentar desactivar (50/50),
// en vez de desactivarla directo. Usa la misma tarjeta visual que los eventos.
export function openTrapCard(trap) {
  state.busy = true;
  open = { type: 'trap', trap };
  renderCard();
  $('veil').classList.add('show');
  audio.fx('ui');
}

// Evento de ambientación (imagen + texto, sin opciones): se cierra al tocar
// en cualquier parte de la tarjeta. `ev` es la entrada de events.json (con
// ev.image = clave del asset y ev.i18n = prefijo de sus textos).
export function openStoryCard(ev) {
  state.busy = true;
  open = { type: 'story', ev };
  renderCard();
  $('veil').classList.add('show');
  audio.fx('ui');
}

function renderCard() {
  if (!open) return;
  const card = $('card');
  if (open.type === 'over') { renderOver(card, open.kind); return; }
  if (open.type === 'trap') { renderTrapCard(card, open.trap); return; }
  if (open.type === 'story') { renderStoryCard(card, open.ev); return; }

  const ev = state.events[open.trig.id];
  const b = ev.i18n;
  card.innerHTML =
    `<div class="kicker">${t(b + '.kicker')}</div>
     <h2>${t(b + '.title')}</h2>
     <p>${t(b + '.text')}</p>
     <div class="choices"></div>`;
  const box = card.querySelector('.choices');
  ev.choices.forEach((ch, i) => {
    const btn = document.createElement('button');
    btn.className = 'choice';
    const e = ch.effect || {};
    const tc = e.hp > 0 ? 'heal' : e.hp < 0 ? 'dmg' : e.gold ? 'gold' : '';
    btn.innerHTML = `<span>${t(`${b}.c${i}`)}</span><span class="tag ${tc}">${t(`${b}.c${i}.tag`)}</span>`;
    btn.onclick = () => resolveChoice(open.trig, ch, i, b);
    box.appendChild(btn);
  });
}

function renderStoryCard(card, ev) {
  card.classList.add('story');
  const img = images[ev.image];
  const src = img ? img.src : '';
  card.innerHTML =
    `<div class="storywrap">
       <img src="${src}" alt="">
       <div class="storytext">${t(ev.i18n + '.text')}</div>
       <div class="storyhint">${t('ui.clickContinue')}</div>
     </div>`;
  card.onclick = () => {
    card.classList.remove('story');
    card.onclick = null;
    state.busy = false;
    hideVeil();
  };
}

function renderTrapCard(card, trap) {
  const ev = state.events[trap.id] || state.events.trampa;
  const b = ev ? ev.i18n : null;
  if (!b) { card.innerHTML = `<p>${t('log.noEventYet')}</p>`; return; }
  card.innerHTML =
    `<div class="kicker">${t(b + '.kicker')}</div>
     <h2>${t(b + '.disarmTitle')}</h2>
     <p>${t(b + '.disarmQuestion')}</p>
     <div class="choices"></div>`;
  const box = card.querySelector('.choices');
  const yes = document.createElement('button');
  yes.className = 'choice';
  yes.innerHTML = `<span>${t('ui.yes')}</span>`;
  yes.onclick = () => { hideVeil(); onAttemptDisarm(trap); };
  const no = document.createElement('button');
  no.className = 'choice';
  no.innerHTML = `<span>${t('ui.no')}</span>`;
  no.onclick = () => { state.busy = false; hideVeil(); };
  box.appendChild(yes);
  box.appendChild(no);
}

function resolveChoice(trig, ch, i, b) {
  const { hero } = state;
  const e = ch.effect || {};
  if (e.hp) { hero.hp = Math.min(hero.maxHp, hero.hp + e.hp); anim.floatAt(hero.x, hero.y, (e.hp > 0 ? '+' : '') + e.hp, e.hp > 0 ? '#7fc06a' : '#e86a5c'); }
  if (e.gold) hero.gold = Math.max(0, hero.gold + e.gold);
  trig.used = true;
  hideVeil();
  syncHUD();
  log(t(`${b}.c${i}.r`), e.gold ? 'loot' : 'event');
  state.busy = false;
  if (hero.hp <= 0) return gameOver('lose');
  afterInteract(trig);
}

export function gameOver(kind) {
  state.busy = true;
  if (kind === 'lose') log(tRandom('log.heroDeath', 3), 'combat');
  open = { type: 'over', kind };
  renderCard();
  $('veil').classList.add('show');
}

function renderOver(card, kind) {
  const win = kind === 'win';
  card.innerHTML =
    `<div class="banner">
       <div class="kicker">${t(win ? 'over.winKicker' : 'over.loseKicker')}</div>
       <h2>${t(win ? 'over.winTitle' : 'over.loseTitle')}</h2>
       <p>${win ? t('over.winText', { gold: state.hero.gold }) : t('over.loseText')}</p>
       <button class="again" id="again">${t('over.again')}</button>
     </div>`;
  $('again').onclick = restart;
}

// Aplica los textos estáticos (y re-renderiza lo abierto). Se llama al cambiar idioma.
export function applyStaticText() {
  if (logHistoryOpen()) { buildLogFilters(); renderLogHistory(); }
  $('reset').textContent = t('btn.reset');
  $('gridBtn').title = t('btn.grid');
  $('endTurn').textContent = t('btn.endturn');
  $('settingsBtn').title = t('btn.settings');
  $('recenter').title = t('btn.recenter');
  $('apPips').setAttribute('aria-label', t('hud.ap'));
  $('setTitle').textContent = t('set.title');
  $('setLangLabel').textContent = t('set.lang');
  $('setScaleLabel').textContent = t('set.uiscale');
  $('setMusicLabel').textContent = t('set.music');
  $('setFxLabel').textContent = t('set.fx');
  $('setEnemySpeedLabel').textContent = t('set.enemyspeed');
  $('speedSlow').textContent = t('set.speed.slow');
  $('speedNormal').textContent = t('set.speed.normal');
  $('speedFast').textContent = t('set.speed.fast');
  $('quitBtn').textContent = t('btn.quit');
  $('confirmYes').textContent = t('confirm.yes');
  $('confirmNo').textContent = t('confirm.no');
  $('setClose').textContent = t('set.close');
  $('repositionBtn').textContent = t('btn.repositionUI');
  $('layoutApplyBtn').textContent = t('btn.applyLayout');
  $('verTag').textContent = 'v' + VERSION;
  $('verTagPanel').textContent = 'cripta v' + VERSION;
  $('splashTitle').textContent = t('splash.title');
  $('splashContinue').textContent = t('btn.continue');
  if (open) renderCard();
  syncFoeRow();
}
