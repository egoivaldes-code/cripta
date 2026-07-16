// Capa DOM: HUD, cartas de evento, registro, fin de partida y textos de ajustes.
// Todo el texto visible pasa por t() (multiidioma). No dibuja en el canvas.

import { state } from './state.js';
import { t } from './i18n.js';
import * as anim from './anim.js';
import * as audio from './audio.js';

let afterChoice = () => {};
let restart = () => {};
export function bindAfterChoice(fn) { afterChoice = fn; }
export function bindRestart(fn) { restart = fn; }

const $ = id => document.getElementById(id);
let open = null; // { type:'event', trig } | { type:'over', kind } | null

export function log(html) { $('log').innerHTML = html; }

export function syncHUD() {
  const { hero, foe } = state;
  $('hpHero').style.width = Math.max(0, hero.hp / hero.maxHp * 100) + '%';
  $('hpFoe').style.width = foe.alive ? Math.max(0, foe.hp / foe.maxHp * 100) + '%' : '0%';
  $('gold').textContent = hero.gold;
}

export function hideVeil() { $('veil').classList.remove('show'); open = null; }

export function openEvent(trig) {
  state.busy = true;
  open = { type: 'event', trig };
  renderCard();
  $('veil').classList.add('show');
  audio.fx('event');
}

function renderCard() {
  if (!open) return;
  const card = $('card');
  if (open.type === 'over') { renderOver(card, open.kind); return; }

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

function resolveChoice(trig, ch, i, b) {
  const { hero } = state;
  const e = ch.effect || {};
  if (e.hp) { hero.hp = Math.min(hero.maxHp, hero.hp + e.hp); anim.floatAt(hero.x, hero.y, (e.hp > 0 ? '+' : '') + e.hp, e.hp > 0 ? '#7fc06a' : '#e86a5c'); }
  if (e.gold) hero.gold = Math.max(0, hero.gold + e.gold);
  trig.used = true;
  hideVeil();
  syncHUD();
  log(t(`${b}.c${i}.r`));
  state.busy = false;
  if (hero.hp <= 0) return gameOver('lose');
  afterChoice();
}

export function gameOver(kind) {
  state.busy = true;
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
  $('heroName').textContent = t('hud.hero');
  $('foeName').textContent = t('hud.foe');
  $('reset').title = t('btn.reset');
  $('settingsBtn').title = t('btn.settings');
  $('recenter').title = t('btn.recenter');
  $('setTitle').textContent = t('set.title');
  $('setLangLabel').textContent = t('set.lang');
  $('setScaleLabel').textContent = t('set.uiscale');
  $('setMusicLabel').textContent = t('set.music');
  $('setFxLabel').textContent = t('set.fx');
  $('setClose').textContent = t('set.close');
  if (open) renderCard();
}
