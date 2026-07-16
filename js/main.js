// Punto de entrada. Carga idioma y datos, cablea módulos y arranca el bucle.

import { state, initGame } from './state.js';
import { initRenderer, startLoop, centerOnHero } from './render.js';
import { onTapTile, bindDescend, startHeroTurn, endHeroTurn, afterInteract } from './rules.js';
import { syncHUD, log, hideVeil, bindAfterInteract, bindRestart, applyStaticText } from './ui.js';
import { loadAssets } from './assets.js';
import { initialLang, loadLang, onLangChange, getLang, t } from './i18n.js';
import * as anim from './anim.js';
import * as audio from './audio.js';

async function boot() {
  // Idioma primero (los textos) y assets/datos en paralelo.
  onLangChange(() => { applyStaticText(); markLang(); });
  await loadLang(initialLang());

  const [events] = await Promise.all([
    fetch('./data/events.json').then(r => r.json()),
    loadAssets().catch(err => console.warn('Assets:', err.message)),
  ]);

  const levelCache = {};
  async function getLevel(name) {
    if (!levelCache[name]) levelCache[name] = await fetch(`./data/levels/${name}.json`).then(r => r.json());
    return levelCache[name];
  }

  async function loadLevel(name, carry) {
    const level = await getLevel(name);
    initGame(level, events);
    if (carry) Object.assign(state.hero, carry);   // arrastra vida/oro entre niveles
    anim.reset();
    centerOnHero(true);
    hideVeil();
    startHeroTurn();
    syncHUD();
    log(t('log.intro'));
  }

  function newGame() { loadLevel('level1'); }
  async function descend() {
    const c = { hp: state.hero.hp, maxHp: state.hero.maxHp, atk: state.hero.atk, gold: state.hero.gold };
    audio.fx('descend');
    await loadLevel(state.exit.to, c);
    log(t('log.descend'));
  }

  bindAfterInteract(afterInteract);
  bindRestart(newGame);
  bindDescend(descend);

  initRenderer(document.getElementById('map'), onTapTile);
  startLoop();
  await loadLevel('level1');

  // --- controles ---
  document.getElementById('reset').addEventListener('click', newGame);
  document.getElementById('endTurn').addEventListener('click', () => {
    if (!state.busy) endHeroTurn();
  });
  document.getElementById('recenter').addEventListener('click', () => centerOnHero(false));
  document.getElementById('hud').addEventListener('click', () => centerOnHero(false));

  // Ajustes
  const settingsVeil = document.getElementById('settingsVeil');
  document.getElementById('settingsBtn').addEventListener('click', () => settingsVeil.classList.add('show'));
  document.getElementById('setClose').addEventListener('click', () => settingsVeil.classList.remove('show'));
  settingsVeil.addEventListener('click', e => { if (e.target === settingsVeil) settingsVeil.classList.remove('show'); });

  document.querySelectorAll('.langbtn').forEach(btn =>
    btn.addEventListener('click', () => loadLang(btn.dataset.lang)));

  // Audio: se desbloquea con el primer toque (requisito del móvil).
  window.addEventListener('pointerdown', () => audio.unlock(), { once: true });

  // Escala de la interfaz (persistida)
  const gameEl = document.getElementById('game');
  const uiInput = document.getElementById('uiScale');
  function setUiScale(v) { gameEl.style.setProperty('--ui', v); try { localStorage.setItem('cripta.ui', v); } catch {} }
  let savedUi = '1';
  try { savedUi = localStorage.getItem('cripta.ui') || '1'; } catch {}
  uiInput.value = savedUi; setUiScale(savedUi);
  uiInput.addEventListener('input', e => setUiScale(e.target.value));

  // Volúmenes de música y efectos (persistidos)
  const musicInput = document.getElementById('musicVol');
  const fxInput = document.getElementById('fxVol');
  musicInput.value = audio.initialMusicVol();
  fxInput.value = audio.initialFxVol();
  musicInput.addEventListener('input', e => audio.setMusicVol(parseFloat(e.target.value)));
  fxInput.addEventListener('input', e => { audio.setFxVol(parseFloat(e.target.value)); audio.fx('ui'); });

  markLang();
}

function markLang() {
  document.querySelectorAll('.langbtn').forEach(b => b.classList.toggle('on', b.dataset.lang === getLang()));
}

boot().catch(err => {
  console.error(err);
  document.getElementById('log').textContent =
    'Error al cargar. Si abriste el archivo como file://, sírvelo por http:// (GitHub Pages).';
});
