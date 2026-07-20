// Punto de entrada. Carga idioma y datos, cablea módulos y arranca el bucle.

import { state, initGame } from './state.js?v=0.15';
import { initRenderer, startLoop, centerOnHero, toggleGrid, isGridOn } from './render.js?v=0.15';
import { onTapTile, bindDescend, startHeroTurn, endHeroTurn, afterInteract, attemptDisarm, isAITurnActive, getEnemySpeed, setEnemySpeed } from './rules.js?v=0.15';
import { syncHUD, log, hideVeil, bindAfterInteract, bindRestart, bindAttemptDisarm, applyStaticText, syncInitiativeUI, showConfirm } from './ui.js?v=0.15';
import { loadAssets } from './assets.js?v=0.15';
import { initialLang, loadLang, onLangChange, getLang, t } from './i18n.js?v=0.15';
import * as anim from './anim.js?v=0.15';
import * as audio from './audio.js?v=0.15';
import { VERSION } from './config.js?v=0.15';
import { assemble } from './mapgen.js?v=0.15';

// El ensamblador de losetas (mapgen.js) sigue disponible para niveles ALEATORIOS
// futuros; esta función queda de reserva pero no se usa por ahora, ya que el
// cementerio pasó a ser un mapa FIJO pintado a mano (data/levels/cemetery.json).
function buildRandomCemeteryLevel(seed) {
  const m = assemble({ seed, pieces: 9 });
  const spots = [...m.foeSpots];
  const skelSprites = ['enemy1', 'enemy2', 'enemy3'];
  const foes = spots.splice(0, 3).map((s, i) => ({
    x: s.x, y: s.y, hp: 12, maxHp: 12, atk: 4, sprite: skelSprites[i], dormant: true, wakeR: 3,
  }));
  const triggers = spots.slice(0, 3).map(s => ({ x: s.x, y: s.y, id: 'tumba', type: 'grave', sprite: 'grave' }));
  return {
    name: 'El cementerio (aleatorio)',
    tiles: m.tiles, elev: m.elev,
    start: { hero: { x: m.heroStart.x, y: m.heroStart.y, hp: 26, maxHp: 26, atk: 6, gold: 0 }, foes },
    triggers, exit: null,
  };
}

let changelog = { versions: [] };   // notas de versión (se rellena en boot(); se pinta en renderSplash())

// Pinta la pantalla de novedades: notas de cada versión, de más nueva a más vieja.
// Se llama al arrancar y también al cambiar de idioma (para repintar en el idioma nuevo).
function renderSplash() {
  if (!changelog.versions.length) return;
  const lang = getLang();
  const body = document.getElementById('splashBody');
  body.innerHTML = changelog.versions.map(v => {
    const loc = v[lang] || v.es;
    const notes = loc.notes.map(n => `<li>${n}</li>`).join('');
    return `<div class="rel"><div class="rel-ver">v${v.v}</div><div class="rel-title">${loc.title}</div><ul>${notes}</ul></div>`;
  }).join('');
}

async function boot() {
  // Idioma primero (los textos) y assets/datos en paralelo.
  onLangChange(() => { applyStaticText(); markLang(); markEnemySpeed(); renderSplash(); });
  await loadLang(initialLang());

  const [events, cl] = await Promise.all([
    fetch(`./data/events.json?v=${VERSION}`).then(r => r.json()),
    fetch(`./data/changelog.json?v=${VERSION}`).then(r => r.json()).catch(() => ({ versions: [] })),
    loadAssets().catch(err => console.warn('Assets:', err.message)),
  ]);
  changelog = cl;
  renderSplash();

  const levelCache = {};
  async function getLevel(name) {
    const file = name === 'level1' ? 'cemetery' : name;   // 'level1' = el cementerio (mapa fijo pintado)
    if (!levelCache[file]) {
      const res = await fetch(`./data/levels/${file}.json?v=${VERSION}`);
      if (!res.ok) throw new Error(`Nivel "${file}" no encontrado (${res.status})`);
      levelCache[file] = await res.json();
    }
    return levelCache[file];
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
    syncInitiativeUI();
    log(t('log.intro'));
  }

  function newGame() { loadLevel('level1'); }
  async function descend() {
    const c = { hp: state.hero.hp, maxHp: state.hero.maxHp, atk: state.hero.atk, gold: state.hero.gold };
    try {
      audio.fx('descend');
      await loadLevel(state.exit.to, c);
      log(t('log.descend'));
    } catch (err) {
      console.warn('No se pudo cargar el nivel de destino:', state.exit.to, err);
      log(t('log.levelMissing'));
    }
  }

  bindAfterInteract(afterInteract);
  bindRestart(newGame);
  bindDescend(descend);
  bindAttemptDisarm(attemptDisarm);

  initRenderer(document.getElementById('map'), onTapTile);
  startLoop();
  await loadLevel('level1');

  // --- controles ---
  document.getElementById('reset').addEventListener('click', () => {
    showConfirm(t('confirm.reset.title'), t('confirm.reset.text'), () => {
      document.getElementById('settingsVeil').classList.remove('show');
      newGame();
    });
  });
  // Cerrar el juego: como es una página web (no una app nativa), el navegador
  // solo deja cerrar la pestaña sola si él mismo la abrió por script — en
  // móvil, sobre todo, suele bloquearlo. Se intenta igualmente y, si no lo
  // consigue, se avisa en el registro para que el jugador la cierre a mano.
  document.getElementById('quitBtn').addEventListener('click', () => {
    showConfirm(t('confirm.quit.title'), t('confirm.quit.text'), () => {
      window.close();
      setTimeout(() => log(t('log.cantClose')), 300);
    });
  });
  document.getElementById('endTurn').addEventListener('click', () => {
    if (!state.busy && !isAITurnActive()) { log(t('log.turnSkipped')); endHeroTurn(); }
  });
  document.getElementById('recenter').addEventListener('click', () => centerOnHero(false));
  document.getElementById('hudRow').addEventListener('click', () => centerOnHero(false));

  // Pantalla de novedades: el botón Continuar la cierra y, de paso, hace de
  // primer toque para desbloquear el audio (importante en móvil).
  document.getElementById('splashContinue').addEventListener('click', () => {
    document.getElementById('splash').classList.remove('show');
    audio.unlock();
  });

  // Rejilla: alterna visible/invisible y refleja el estado en el propio botón.
  const gridBtn = document.getElementById('gridBtn');
  function syncGridBtn(on) { gridBtn.classList.toggle('off', !on); gridBtn.setAttribute('aria-pressed', String(on)); }
  syncGridBtn(isGridOn());
  gridBtn.addEventListener('click', () => syncGridBtn(toggleGrid()));

  // Ajustes
  const settingsVeil = document.getElementById('settingsVeil');
  document.getElementById('settingsBtn').addEventListener('click', () => settingsVeil.classList.add('show'));
  document.getElementById('setClose').addEventListener('click', () => settingsVeil.classList.remove('show'));
  settingsVeil.addEventListener('click', e => { if (e.target === settingsVeil) settingsVeil.classList.remove('show'); });

  document.querySelectorAll('.langbtn[data-lang]').forEach(btn =>
    btn.addEventListener('click', () => loadLang(btn.dataset.lang)));

  // Velocidad de turnos enemigos (persistida; reutiliza el mismo estilo de
  // botones que el selector de idioma, pero es un grupo aparte).
  document.querySelectorAll('.langbtn[data-speed]').forEach(btn =>
    btn.addEventListener('click', () => { setEnemySpeed(btn.dataset.speed); markEnemySpeed(); }));
  markEnemySpeed();

  setupLayoutEditor();

  // Audio: se desbloquea con el primer toque (requisito del móvil).
  window.addEventListener('pointerdown', () => audio.unlock(), { once: true });

  // Escala de la interfaz (persistida)
  const gameEl = document.getElementById('game');
  // Escala de la interfaz (persistida). La primera vez (sin preferencia
  // guardada) se parte de un valor mayor en pantallas grandes/PC, para que no
  // arranque diminuta en resoluciones altas; a partir de ahí, lo que el
  // jugador toque con el deslizador manda y se recuerda.
  function defaultUiForScreen() {
    const w = window.innerWidth || 1280;
    return Math.max(1, Math.min(1.6, w / 1400)).toFixed(2);
  }
  const uiInput = document.getElementById('uiScale');
  function setUiScale(v) { gameEl.style.setProperty('--ui', v); try { localStorage.setItem('cripta.ui', v); } catch {} }
  let savedUi = null;
  try { savedUi = localStorage.getItem('cripta.ui'); } catch {}
  const initialUi = savedUi || defaultUiForScreen();
  uiInput.value = initialUi; setUiScale(initialUi);
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
  document.querySelectorAll('.langbtn[data-lang]').forEach(b => b.classList.toggle('on', b.dataset.lang === getLang()));
}

function markEnemySpeed() {
  document.querySelectorAll('.langbtn[data-speed]').forEach(b => b.classList.toggle('on', b.dataset.speed === getEnemySpeed()));
}

// --- Reposicionar interfaz: arrastrar los bloques del HUD y anclarlos donde
// se dejen. El offset de cada bloque se guarda por separado (variables CSS
// --dragX/--dragY propias de cada elemento) para no pisar el escalado de
// --ui ni las media queries de pantallas estrechas, que siguen aplicando
// igual encima del arrastre.
const LAYOUT_KEY = 'cripta.layout';
const LAYOUT_IDS = ['hud', 'topright', 'bottomright', 'log'];

function loadLayoutOffsets() {
  try { return JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}'); } catch { return {}; }
}

function setupLayoutEditor() {
  const offsets = loadLayoutOffsets();

  function applyOffset(id) {
    const el = document.getElementById(id);
    const o = offsets[id] || { x: 0, y: 0 };
    el.style.setProperty('--dragX', o.x + 'px');
    el.style.setProperty('--dragY', o.y + 'px');
  }
  LAYOUT_IDS.forEach(applyOffset);

  let dragging = null;   // { id, el, startX, startY, baseX, baseY }

  LAYOUT_IDS.forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('pointerdown', e => {
      if (!document.body.classList.contains('layout-edit')) return;
      el.setPointerCapture(e.pointerId);
      const o = offsets[id] || { x: 0, y: 0 };
      dragging = { id, el, startX: e.clientX, startY: e.clientY, baseX: o.x, baseY: o.y };
    });
    el.addEventListener('pointermove', e => {
      if (!dragging || dragging.id !== id) return;
      offsets[id] = { x: dragging.baseX + (e.clientX - dragging.startX), y: dragging.baseY + (e.clientY - dragging.startY) };
      applyOffset(id);
    });
    const stopDrag = () => { if (dragging && dragging.id === id) dragging = null; };
    el.addEventListener('pointerup', stopDrag);
    el.addEventListener('pointercancel', stopDrag);
  });

  document.getElementById('repositionBtn').addEventListener('click', () => {
    document.getElementById('settingsVeil').classList.remove('show');
    document.body.classList.add('layout-edit');
  });

  document.getElementById('layoutApplyBtn').addEventListener('click', () => {
    document.body.classList.remove('layout-edit');
    dragging = null;
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(offsets)); } catch {}
  });
}

boot().catch(err => {
  console.error(err);
  document.getElementById('log').textContent =
    'Error al cargar. Si abriste el archivo como file://, sírvelo por http:// (GitHub Pages).';
});
