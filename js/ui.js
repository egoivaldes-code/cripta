// Capa DOM: HUD (con PA), cartas de evento, registro, fin de partida y ajustes.
// Todo el texto visible pasa por t() (multiidioma). No dibuja en el canvas.

import { state } from './state.js?v=0.28';
import { t, tRandom } from './i18n.js?v=0.28';
import * as anim from './anim.js?v=0.28';
import { IDLE_NAME } from './anim.js?v=0.28';
import * as audio from './audio.js?v=0.28';
import { VERSION } from './config.js?v=0.28';
import { images, SPRITE_TILE } from './assets.js?v=0.28';
import { pushHistory, getHistory, clearHistory, CATEGORIES } from './eventlog.js?v=0.28';
import { submitScore, rankWithinTop10, fetchTop10, formatTime } from './leaderboard.js?v=0.28';

let afterInteract = () => {};
let restart = () => {};
let onAttemptDisarm = () => {};
let resolveAltar = () => null;
let resolveChest = () => null;
let applyChest = () => {};
export function bindAfterInteract(fn) { afterInteract = fn; }
export function bindRestart(fn) { restart = fn; }
export function bindAttemptDisarm(fn) { onAttemptDisarm = fn; }
// rules.js no se puede importar aquí (import circular: rules.js ya importa
// de ui.js) — el sorteo+efecto del altar se conecta desde main.js, igual
// que afterInteract/restart/onAttemptDisarm.
export function bindResolveAltar(fn) { resolveAltar = fn; }
// Cofre: resolveChest solo SORTEA el evento (pickChestEvent, marca el cofre
// gastado); applyChest aplica de verdad el efecto (applyChestEvent), al
// cerrar la carta de resultado — ver openChestCard/renderChestCard.
export function bindResolveChest(fn) { resolveChest = fn; }
export function bindApplyChest(fn) { applyChest = fn; }

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

let onCorpseLooted = () => {};
// rules.js no se puede importar aquí (import circular) — mismo patrón que
// resolveAltar/resolveChest. Se usa para saber si el cadáver/contenedor que
// se acaba de cerrar era el del Esqueleto Mago (ver checkBossLooted, rules.js).
export function bindOnCorpseLooted(fn) { onCorpseLooted = fn; }

function closeLootVeil() {
  const source = lootCorpse;
  lootCorpse = null;
  $('lootList').innerHTML = '';
  $('lootVeil').classList.remove('show');
  if (source) onCorpseLooted(source);
}

// Cuando el botín se vacía del todo, cada tipo de "fuente" desaparece a su
// manera: un cadáver deja de dibujarse (deathPlaying=false, sistema de
// siempre); un contenedor del mapa (cofre/urna) se marca como usado, que ya
// hace que render.js deje de pintarlo (mismo criterio que el resto de
// props de un solo uso).
function markLootSourceEmptied(source) {
  if (source.type === 'container') {
    source.used = true;
    anim.openProp(`prop:${source.x}:${source.y}`, 'container');
    audio.fx('containerBreak');
  } else source.deathPlaying = false;
}

// Coge un objeto suelto. Si era el último que quedaba, la fuente (cadáver o
// contenedor) desaparece de verdad y la ventana se cierra sola.
function lootOne(index) {
  if (!lootCorpse) return;
  const entry = lootCorpse.loot[index];
  if (!entry) return;
  applyLootEntry(entry);
  lootCorpse.loot.splice(index, 1);
  syncHUD();
  if (lootCorpse.loot.length === 0) { markLootSourceEmptied(lootCorpse); closeLootVeil(); }
  else renderLootList();
}

function lootAllNow() {
  if (!lootCorpse) return;
  lootCorpse.loot.forEach(applyLootEntry);
  lootCorpse.loot = [];
  syncHUD();
  markLootSourceEmptied(lootCorpse);   // ya no queda nada: la fuente desaparece
  closeLootVeil();
}

// La llama rules.js al tocar un cadáver o un contenedor adyacente con loot
// pendiente. `source.type === 'container'` distingue un contenedor del mapa
// (título genérico) de un cadáver de enemigo (título = nombre del enemigo).
export function showLootWindow(source) {
  lootCorpse = source;
  anim.loot('hero', 'hero');
  $('lootTitle').textContent = source.type === 'container' ? t('loot.container') : t('enemy.' + source.sprite);
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

let refreshActionBar = () => {};
// skills.js no se puede importar aquí (import circular: skills.js ya importa
// showConfirm de ui.js) — el refresco de la barra de acciones (velo rojo +
// número de CD) se conecta desde main.js, igual que bindResolveAltar.
export function bindRefreshActionBar(fn) { refreshActionBar = fn; }

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
  refreshActionBar();
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

// Palanca (o cualquier mecanismo futuro con el mismo patrón): primero
// pregunta Sí/No; si se acepta, la MISMA tarjeta cambia su texto al
// resultado (sin cerrarse) y se cierra al tocar, igual que una carta
// de ambientación. Reutilizable para futuras palancas.
export function openLeverCard(trig) {
  state.busy = true;
  open = { type: 'lever', trig, stage: 'ask' };
  renderCard();
  $('veil').classList.add('show');
  audio.fx('ui');
}

// Altar: un solo marcador genérico. Primero pregunta Sí/No (imagen
// 'altar_decision'); si se acepta, sortea+aplica el efecto (resolveAltar,
// conectado desde main.js a rollAltar en rules.js) y la MISMA tarjeta pasa
// a mostrar la imagen/texto de ESE evento concreto, con botón "Cerrar"
// (a diferencia de la palanca, aquí se pidió un botón explícito, no
// "tocar en cualquier parte"). Al cerrar, se dispara la animación de
// encendido/apagado del altar en el mapa (ver afterInteract en rules.js).
export function openAltarCard(trig) {
  state.busy = true;
  open = { type: 'altar', trig, stage: 'ask', result: null };
  renderCard();
  $('veil').classList.add('show');
  audio.fx('altarOpen');
}

// Cofre: mismo patrón visual que el altar (pregunta Sí/No con imagen, luego
// carta de resultado con botón "Cerrar"), pero con su propia imagen
// (chest_decision) y sin ilustración propia todavía por evento (arte
// pendiente — de momento el resultado es solo texto). El sonido de abrir
// (chestOpen) y la animación de la tapa se disparan al confirmar "Sí", no
// al cerrar — ver renderChestCard.
export function openChestCard(trig) {
  state.busy = true;
  open = { type: 'chest', trig, stage: 'ask', result: null };
  renderCard();
  $('veil').classList.add('show');
}

function renderCard() {
  if (!open) return;
  const card = $('card');
  if (open.type === 'over') { renderOver(card, open.kind, open.extra); return; }
  if (open.type === 'trap') { renderTrapCard(card, open.trap); return; }
  if (open.type === 'story') { renderStoryCard(card, open.ev); return; }
  if (open.type === 'lever') { renderLeverCard(card, open); return; }
  if (open.type === 'altar') { renderAltarCard(card, open); return; }
  if (open.type === 'chest') { renderChestCard(card, open); return; }

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

// Palanca: etapa 'ask' (pregunta Sí/No) o 'stage' 'result' (texto final,
// se cierra al tocar en cualquier parte de la tarjeta, como una carta de
// ambientación). El efecto (desbloquear salidas) se aplica al pasar a
// 'result', antes de repintar.
function renderLeverCard(card, o) {
  const ev = state.events[o.trig.id];
  const b = ev ? ev.i18n : null;
  if (!b) { card.innerHTML = `<p>${t('log.noEventYet')}</p>`; return; }
  card.onclick = null;
  const img = ev.image ? images[ev.image] : null;

  if (img) {
    // Tarjeta cómic (misma plantilla visual que la carta de ambientación):
    // la imagen ocupa toda la tarjeta, y kicker/título/pregunta/opciones (o
    // el resultado) se colocan en su hueco de pergamino a la derecha.
    card.classList.add('story');
    const src = img.src;
    if (o.stage === 'ask') {
      card.innerHTML =
        `<div class="storywrap">
           <img src="${src}" alt="">
           <div class="storychoices">
             <div class="kicker">${t(b + '.kicker')}</div>
             <h2>${t(b + '.title')}</h2>
             <p>${t(b + '.question')}</p>
             <div class="choices"></div>
           </div>
         </div>`;
      const box = card.querySelector('.choices');
      const yes = document.createElement('button');
      yes.className = 'choice';
      yes.innerHTML = `<span>${t('ui.yes')}</span>`;
      yes.onclick = () => { o.stage = 'result'; renderCard(); };
      const no = document.createElement('button');
      no.className = 'choice';
      no.innerHTML = `<span>${t('ui.no')}</span>`;
      no.onclick = () => { card.classList.remove('story'); state.busy = false; hideVeil(); };
      box.appendChild(yes);
      box.appendChild(no);
    } else {
      card.innerHTML =
        `<div class="storywrap">
           <img src="${src}" alt="">
           <div class="storychoices">
             <div class="kicker">${t(b + '.kicker')}</div>
             <h2>${t(b + '.title')}</h2>
             <p>${t(b + '.result')}</p>
           </div>
           <div class="storyhint">${t('ui.clickContinue')}</div>
         </div>`;
      card.onclick = () => {
        card.classList.remove('story');
        card.onclick = null;
        state.busy = false;
        hideVeil();
        activateLever(o.trig, ev);   // desbloquea salidas + marca usada AHORA (dispara la animación)
        afterInteract(o.trig);
      };
    }
    return;
  }

  // Sin imagen todavía (compatibilidad): el menú normal de siempre.
  if (o.stage === 'ask') {
    card.innerHTML =
      `<div class="kicker">${t(b + '.kicker')}</div>
       <h2>${t(b + '.title')}</h2>
       <p>${t(b + '.question')}</p>
       <div class="choices"></div>`;
    const box = card.querySelector('.choices');
    const yes = document.createElement('button');
    yes.className = 'choice';
    yes.innerHTML = `<span>${t('ui.yes')}</span>`;
    yes.onclick = () => { o.stage = 'result'; renderCard(); };
    const no = document.createElement('button');
    no.className = 'choice';
    no.innerHTML = `<span>${t('ui.no')}</span>`;
    no.onclick = () => { state.busy = false; hideVeil(); };
    box.appendChild(yes);
    box.appendChild(no);
  } else {
    card.innerHTML =
      `<div class="kicker">${t(b + '.kicker')}</div>
       <h2>${t(b + '.title')}</h2>
       <p>${t(b + '.result')}</p>
       <div class="storyhint">${t('ui.clickContinue')}</div>`;
    card.onclick = () => {
      card.onclick = null;
      state.busy = false;
      hideVeil();
      activateLever(o.trig, ev);   // desbloquea salidas + marca usada AHORA (dispara la animación)
      afterInteract(o.trig);
    };
  }
}

// Aplica el efecto de la palanca de verdad (desbloquea las salidas que le
// toquen, marca el trigger como usado, avisa en el registro). Se llama al
// CERRAR la carta de resultado (no al pulsar "Sí") para que la animación de
// tirar de la palanca — que se dispara sola en cuanto tr.used pasa a true,
// ver render.js — coincida con el momento de cerrar la ventana, tal como se
// pidió. Antes de esto se aplicaba ya al pulsar "Sí"; el único cambio es
// CUÁNDO se aplica, no qué hace.
let onLeverPulled = () => {};
// Igual que resolveAltar/resolveChest: rules.js no se puede importar aquí
// (import circular), así que el gancho se conecta desde main.js. Sirve para
// mecánicas de nivel que dependen de una palanca concreta (p.ej. "cuando se
// tiran DOS palancas a la vez, aparece un jefe" — ver checkLeverBossSpawn en
// rules.js, cripta V0.27).
export function bindOnLeverPulled(fn) { onLeverPulled = fn; }

function activateLever(trig, ev) {
  trig.used = true;
  const ids = (ev && ev.unlocks) || [];
  for (const id of ids) {
    const ex = state.exits.find(e => e.id === id);
    if (ex) ex.blocked = false;
  }
  log(t('log.leverActivated'), 'event');
  audio.fx('ui');
  onLeverPulled(trig);
}

// Altar: misma plantilla visual "story" (imagen a toda tarjeta + hueco de
// pergamino a la derecha) que la palanca, pero con un botón "Cerrar"
// explícito en el resultado en vez de "toca en cualquier parte".
function renderAltarCard(card, o) {
  card.classList.add('story');
  card.onclick = null;

  if (o.stage === 'ask') {
    const img = images.altar_decision;
    card.innerHTML =
      `<div class="storywrap">
         <img src="${img ? img.src : ''}" alt="">
         <div class="storychoices">
           <div class="kicker">${t('altar.kicker')}</div>
           <h2>${t('altar.title')}</h2>
           <p>${t('altar.question')}</p>
           <div class="choices"></div>
         </div>
       </div>`;
    const box = card.querySelector('.choices');
    const yes = document.createElement('button');
    yes.className = 'choice';
    yes.innerHTML = `<span>${t('ui.yes')}</span>`;
    yes.onclick = () => {
      const chosen = resolveAltar(o.trig);
      if (!chosen) { card.classList.remove('story'); state.busy = false; hideVeil(); return; }
      o.result = chosen;
      o.trig._altarClip = 'activate' + chosen.n;
      audio.fx(chosen.kind === 'good' ? 'altarGood' : 'altarBad');
      o.stage = 'result';
      renderCard();
    };
    const no = document.createElement('button');
    no.className = 'choice';
    no.innerHTML = `<span>${t('ui.no')}</span>`;
    no.onclick = () => { card.classList.remove('story'); state.busy = false; hideVeil(); };
    box.appendChild(yes);
    box.appendChild(no);
    return;
  }

  // stage 'result': imagen y texto propios del evento sorteado, con botón
  // "Cerrar" explícito (a diferencia de la palanca/ambientación).
  const n = o.result.n;
  const img = images['altar_ev' + n];
  card.innerHTML =
    `<div class="storywrap">
       <img src="${img ? img.src : ''}" alt="">
       <div class="storychoices">
         <div class="kicker">${t('altar.kicker')}</div>
         <h2>${t('altar.ev' + n + '.title')}</h2>
         <p>${t('altar.ev' + n + '.result')}</p>
         <div class="choices"></div>
       </div>
     </div>`;
  const box = card.querySelector('.choices');
  const close = document.createElement('button');
  close.className = 'choice';
  close.innerHTML = `<span>${t('ui.close')}</span>`;
  close.onclick = () => {
    card.classList.remove('story');
    state.busy = false;
    hideVeil();
    syncHUD();
    afterInteract(o.trig);
  };
  box.appendChild(close);
}

// Cofre: misma plantilla visual "story" (imagen a toda tarjeta + hueco de
// pergamino) que el altar para la pregunta inicial, con su propia imagen
// (chest_decision). El resultado (stage 'result') sigue siendo solo texto
// por ahora — arte pendiente, el usuario generará las 6 ilustraciones
// (chest_ev1..6) más adelante; en cuanto existan, se añade aquí el mismo
// <div class="storywrap"><img>... que ya usa el stage 'result' del altar.
function renderChestCard(card, o) {
  card.onclick = null;

  if (o.stage === 'ask') {
    card.classList.add('story');
    const img = images.chest_decision;
    card.innerHTML =
      `<div class="storywrap">
         <img src="${img ? img.src : ''}" alt="">
         <div class="storychoices">
           <div class="kicker">${t('chest.kicker')}</div>
           <h2>${t('chest.title')}</h2>
           <p>${t('chest.question')}</p>
           <div class="choices"></div>
         </div>
       </div>`;
    const box = card.querySelector('.choices');
    const yes = document.createElement('button');
    yes.className = 'choice';
    yes.innerHTML = `<span>${t('ui.yes')}</span>`;
    yes.onclick = () => {
      const chosen = resolveChest(o.trig);   // sortea (pickChestEvent); no aplica el efecto todavía
      if (!chosen) { card.classList.remove('story'); state.busy = false; hideVeil(); return; }
      audio.fx('chestOpen');
      anim.loot('hero', 'hero');
      anim.openProp(`prop:${o.trig.x}:${o.trig.y}`, 'chest');   // se queda abierta en su último fotograma
      o.result = chosen;
      o.stage = 'result';
      renderCard();
    };
    const no = document.createElement('button');
    no.className = 'choice';
    no.innerHTML = `<span>${t('ui.no')}</span>`;
    no.onclick = () => { card.classList.remove('story'); state.busy = false; hideVeil(); };
    box.appendChild(yes);
    box.appendChild(no);
    return;
  }

  // stage 'result': texto del evento sorteado, con botón "Cerrar" explícito
  // (la recompensa de verdad se aplica aquí, al cerrar — ver applyChest).
  card.classList.remove('story');
  const n = o.result.n;
  card.innerHTML =
    `<div class="kicker">${t('chest.kicker')}</div>
     <h2>${t('chest.ev' + n + '.title')}</h2>
     <p>${t('chest.ev' + n + '.result')}</p>
     <div class="choices"></div>`;
  const box = card.querySelector('.choices');
  const close = document.createElement('button');
  close.className = 'choice';
  close.innerHTML = `<span>${t('ui.close')}</span>`;
  close.onclick = () => {
    applyChest(o.trig, o.result);
    state.busy = false;
    hideVeil();
    syncHUD();
    afterInteract(o.trig);
  };
  box.appendChild(close);
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

export function gameOver(kind, extra) {
  state.busy = true;
  if (kind === 'lose') log(tRandom('log.heroDeath', 3), 'combat');
  open = { type: 'over', kind, extra: extra || {} };
  renderCard();
  $('veil').classList.add('show');
}

// Si la victoria trae un tiempo (matar al jefe, ver checkBossLooted en
// rules.js), se ofrece mandarlo al leaderboard global (Supabase) con un
// nombre a elegir. `submitted` evita que se pueda enviar dos veces la misma
// pantalla (el botón desaparece en cuanto se manda, con éxito o sin él).
function renderOver(card, kind, extra) {
  const win = kind === 'win';
  const timeMs = win ? extra.timeMs : null;
  card.innerHTML =
    `<div class="banner">
       <div class="kicker">${t(win ? 'over.winKicker' : 'over.loseKicker')}</div>
       <h2>${t(win ? 'over.winTitle' : 'over.loseTitle')}</h2>
       <p>${win ? t('over.winText', { gold: state.hero.gold }) : t('over.loseText')}</p>
       ${timeMs != null ? `<p class="over-time">${t('over.yourTime', { time: formatTime(timeMs) })}</p>` : ''}
       <div id="overScoreForm"></div>
       <button class="again" id="again">${t('over.again')}</button>
     </div>`;
  $('again').onclick = restart;
  if (timeMs != null) renderScoreForm(document.getElementById('overScoreForm'), timeMs);
}

function renderScoreForm(box, timeMs) {
  box.innerHTML =
    `<div class="over-score">
       <input type="text" id="overScoreName" maxlength="20" placeholder="${t('over.namePlaceholder')}">
       <button class="choice" id="overScoreSend">${t('over.sendScore')}</button>
     </div>`;
  const input = document.getElementById('overScoreName');
  const btn = document.getElementById('overScoreSend');
  btn.onclick = async () => {
    const name = input.value.trim();
    if (name.length < 2) { input.focus(); return; }
    btn.disabled = true;
    btn.textContent = t('over.sending');
    const ok = await submitScore(name, Math.round(timeMs), VERSION);
    if (!ok) {
      box.innerHTML = `<p class="over-score-fail">${t('over.sendFail')}</p>`;
      return;
    }
    const top10 = await fetchTop10();
    const rank = rankWithinTop10(top10.filter(r => r.player_name !== name || r.time_ms !== Math.round(timeMs)), timeMs);
    box.innerHTML = `<p class="over-score-ok">${rank ? t('over.rankMade', { rank }) : t('over.sent')}</p>`;
  };
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
  $('leaderboardTitle').textContent = t('leaderboard.title');
  $('leaderboardContinue').textContent = t('btn.continue');
  $('skillShopTitle').textContent = t('skillshop.title');
  $('skillShopSubtitle').textContent = t('skillshop.subtitle');
  $('shopResetBtn').textContent = t('skillshop.reset');
  $('shopFinishBtn').textContent = t('skillshop.finish');
  if (open) renderCard();
  syncFoeRow();
}
