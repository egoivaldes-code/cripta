// Punto de entrada. Carga idioma y datos, cablea módulos y arranca el bucle.

import { state, initGame, recomputeFog, computeReach, walkable } from './state.js?v=0.33';
import { initRenderer, startLoop, centerOnHero, toggleGrid, isGridOn } from './render.js?v=0.33';
import { onTapTile, bindDescend, startHeroTurn, endHeroTurn, afterInteract, attemptDisarm, isAITurnActive, getEnemySpeed, setEnemySpeed, setTotalFoeCount, useActiveSkill, rollAltar, pickChestEvent, applyChestEvent, checkLeverBossSpawn, checkBossLooted, resetRunState, getSkillCooldownLeft } from './rules.js?v=0.33';
import { syncHUD, log, hideVeil, bindAfterInteract, bindRestart, bindAttemptDisarm, bindResolveAltar, bindResolveChest, bindApplyChest, bindOnLeverPulled, bindOnCorpseLooted, applyStaticText, syncInitiativeUI, showConfirm, showLogHistory, hideLogHistory, logHistoryOpen, bindRefreshActionBar, isLootOpen, lootAllNow, bindFoeBoxTap } from './ui.js?v=0.33';
import { loadAssets } from './assets.js?v=0.33';
import { initialLang, loadLang, onLangChange, getLang, t } from './i18n.js?v=0.33';
import * as anim from './anim.js?v=0.33';
import * as audio from './audio.js?v=0.33';
import { VERSION, getAutoLoot, setAutoLoot, getAutoSkipZeroAP, setAutoSkipZeroAP } from './config.js?v=0.33';
import { assemble } from './mapgen.js?v=0.33';
import { initInventory, openInventory, closeInventory, isInventoryOpen, resetInventory, refreshInventoryTexts } from './inventory.js?v=0.33';
import { loadSkillsData, initSkillShop, openSkillShop, closeSkillShop, refreshSkillTexts, bindFullReset, applySkillBonuses, bindUseActiveSkill, tryUseArmedOnTile, tryUseArmedOnFoe, bindGetSkillCooldownLeft, renderActionBar } from './skills.js?v=0.33';
import * as savegame from './savegame.js?v=0.33';
import { fetchTop10, formatTime } from './leaderboard.js?v=0.33';
import { logEvent, initErrorCapture, setTelemetryVersion } from './telemetry.js?v=0.33';

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

// Pantalla de leaderboard (TOP10 global, Supabase): se ve siempre al
// arrancar, justo después de cerrar las novedades. `fetchTop10()` nunca
// revienta (devuelve [] si falla la red) — el leaderboard es un extra, no
// debe bloquear el arranque del juego si Supabase no responde.
async function showLeaderboard() {
  const el = document.getElementById('leaderboard');
  const body = document.getElementById('leaderboardBody');
  el.classList.add('show');
  body.innerHTML = `<p class="lb-loading">${t('leaderboard.loading')}</p>`;
  const rows = await fetchTop10();
  if (!rows.length) {
    body.innerHTML = `<p class="lb-empty">${t('leaderboard.empty')}</p>`;
    return;
  }
  body.innerHTML = rows.map((r, i) => `
    <div class="lb-row">
      <span class="lb-rank">${i + 1}</span>
      <span class="lb-name">${escapeHtml(r.player_name)}</span>
      <span class="lb-time">${formatTime(r.time_ms)}</span>
    </div>`).join('');
}

// Escapado mínimo: los nombres los escribe cualquiera, nunca se insertan
// tal cual en innerHTML.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function boot() {
  // Idioma primero (los textos) y assets/datos en paralelo.
  onLangChange(() => { applyStaticText(); markLang(); markEnemySpeed(); renderSplash(); refreshInventoryTexts(); refreshSkillTexts(); });
  await loadLang(initialLang());

  const [events, cl] = await Promise.all([
    fetch(`./data/events.json?v=${VERSION}`).then(r => r.json()),
    fetch(`./data/changelog.json?v=${VERSION}`).then(r => r.json()).catch(() => ({ versions: [] })),
    loadAssets().catch(err => console.warn('Assets:', err.message)),
    loadSkillsData().catch(err => console.warn('Habilidades:', err.message)),
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

  let currentLevelName = null;   // nombre tal cual se le pasa a loadLevel/getLevel (p.ej. 'level1', 'cripta'...)
  setTelemetryVersion(VERSION);
  initErrorCapture(() => currentLevelName);

  // Busca una casilla caminable en/junto a (x,y) — la propia si ya lo es, si
  // no la más cercana en un anillo creciente (hasta 3 casillas). Se usa para
  // "aparecer junto a esta puerta" sin arriesgarse a caer encima de un
  // "mueble" no pisable (ver `arrive` en loadLevel más abajo).
  function findWalkableNear(x, y) {
    if (walkable(x, y)) return { x, y };
    for (let r = 1; r <= 3; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;   // solo el borde del anillo
          if (walkable(x + dx, y + dy)) return { x: x + dx, y: y + dy };
        }
      }
    }
    return null;
  }

  async function loadLevel(name, carry, arrive) {
    const level = await getLevel(name);
    // Antes de dejar la zona actual (si había una, y es de verdad distinta a
    // la nueva), le hacemos una foto: enemigos vivos/muertos, niebla
    // explorada, cofres/palancas usados, combate en curso... Sin esto, cada
    // cambio de zona (p.ej. entrar/salir de un mausoleo) recargaba la zona
    // de destino de fábrica y la que se dejaba atrás perdía todo el
    // progreso hecho en ella en cuanto se volvía.
    if (currentLevelName && currentLevelName !== name) savegame.snapshotZone(currentLevelName);
    // Reinicio de VERDAD, no solo el mapa: cooldowns de habilidades, buffs de
    // combate en marcha (Grito de Guerra, Forma Salvaje...), bendiciones de
    // altar, zonas de Círculo de Renacer y la música de combate de élite si
    // se estaba reiniciando a mitad de una emboscada. Antes de initGame() para
    // que ningún efecto de la partida anterior se cuele en el nivel nuevo.
    resetRunState();
    audio.stopEliteMusic();
    initGame(level, events);
    // Si ya se había visitado esta zona antes en la partida en curso, se
    // restaura tal cual se dejó (en vez de quedarse con lo recién puesto por
    // initGame(), que es siempre el estado de fábrica del nivel).
    const zoneSnap = savegame.getZoneSnapshot(name);
    if (zoneSnap) savegame.applyZoneSnapshot(zoneSnap);
    if (carry) Object.assign(state.hero, carry);        // arrastra vida/oro entre niveles (bajar de nivel)
    else {
      resetInventory(); state.hero.gold = savegame.getPersistedGold(); state.hero.totalKills = 0;
      // Cronómetro del leaderboard (tiempo en matar al Esqueleto Mago de la
      // cripta): arranca aquí, en partida nueva de verdad — NO al retomar
      // una guardada ni al bajar de nivel (eso ya lleva el runStartedAt
      // arrastrado, ver descend() más abajo).
      state.hero.runStartedAt = Date.now();
    }   // partida nueva de verdad: inventario limpio, oro = el que traías guardado (1000 la primera vez)
    if (arrive) {
      // Vuelta de un mausoleo (u otra salida de un solo tramo con
      // arriveX/arriveY): aparecer junto a la puerta por la que se entró, no
      // en el punto de inicio por defecto del nivel. La puerta en sí puede
      // no ser pisable (es "mueble", se interactúa desde al lado), así que
      // se busca la casilla caminable más cercana a su alrededor.
      const spot = findWalkableNear(arrive.x, arrive.y);
      if (spot) { state.hero.x = spot.x; state.hero.y = spot.y; }
    }
    applySkillBonuses(state.hero);
    currentLevelName = name;
    logEvent('level_start', { level: name, fresh: !carry, gold: state.hero.gold });
    anim.reset();
    recomputeFog();   // la niebla restaurada (o de fábrica) se recalcula ya con la posición final del héroe
    centerOnHero(true);
    hideVeil();
    startHeroTurn();
    syncHUD();
    syncInitiativeUI();
    log(t('log.intro'));
    savegame.saveGame(currentLevelName);
  }

  // Al arrancar: si hay una partida guardada, se retoma EXACTA (mismo nivel,
  // posición, vida, enemigos vivos/muertos, niebla explorada...); si no hay
  // guardado o algo falla al cargarlo (p.ej. un nivel que ya no existe), se
  // empieza una partida nueva normal en el nivel 1.
  // Se guarda ANTES de que bootLevel() decida nada, porque bootLevel() usa
  // loadLevel('level1') tanto para "de verdad no hay guardado" como para "el
  // guardado ha fallado al cargar" — aquí solo interesa el primer caso, para
  // saber si la tienda de habilidades debe aparecer tras la pantalla de
  // novedades (ver bindSplashContinue más abajo: partida nueva / muerte / fin
  // de nivel sí, retomar una partida en curso no).
  const isFreshBoot = !savegame.hasSave();
  async function bootLevel() {
    if (!savegame.hasSave()) return loadLevel('level1');
    const data = savegame.loadSave();
    try {
      const level = await getLevel(data.levelName);
      initGame(level, events);
      savegame.applySave(data);
      applySkillBonuses(state.hero);
      recomputeFog();
      computeReach();
      currentLevelName = data.levelName;
      anim.reset();
      centerOnHero(true);
      hideVeil();
      syncHUD();
      syncInitiativeUI();
      log(t('log.resumed'));
    } catch (err) {
      console.warn('No se pudo retomar la partida guardada, se empieza de nuevo:', err);
      savegame.clearSave();
      await loadLevel('level1');
    }
  }

  function newGame() {
    currentLevelName = null;   // que loadLevel no intente hacerle una foto a la zona anterior
    savegame.clearZoneSnapshots();
    loadLevel('level1').then(openSkillShop);
  }
  async function descend(to, arrive) {
    const c = { hp: state.hero.hp, maxHp: state.hero.maxHp, atk: state.hero.atk, gold: state.hero.gold, totalKills: state.hero.totalKills || 0, runStartedAt: state.hero.runStartedAt };
    try {
      audio.fx('descend');
      await loadLevel(to, c, arrive);
      log(t('log.descend'));
      // La tienda YA NO salta en ningún cambio de zona (cementerio, cripta,
      // mausoleo1, mausoleo2...): son zonas conectadas del mismo calabozo, no
      // niveles secuenciales — entrar en una por primera vez no es más "un
      // avance real" que volver a visitar otra ya conocida. Antes solo se
      // excluía "mausoleo" por prefijo, así que la primera vez que se entraba
      // en la Cripta desde el cementerio (sin `arrive`, al no venir de
      // "volver" de ningún sitio) seguía disparándola.
    } catch (err) {
      console.warn('No se pudo cargar el nivel de destino:', to, err);
      log(t('log.levelMissing'));
    }
  }

  bindAfterInteract(trig => { afterInteract(trig); savegame.saveGame(currentLevelName); });
  bindRestart(newGame);
  bindDescend(descend);
  bindAttemptDisarm(attemptDisarm);
  bindResolveAltar(rollAltar);
  bindResolveChest(pickChestEvent);
  bindApplyChest(applyChestEvent);
  bindOnLeverPulled(checkLeverBossSpawn);
  bindOnCorpseLooted(checkBossLooted);
  bindFullReset(newGame);   // "reiniciar progreso" en la tienda de habilidades también reinicia la mazmorra
  bindUseActiveSkill(useActiveSkill);
  bindGetSkillCooldownLeft(getSkillCooldownLeft);
  bindRefreshActionBar(renderActionBar);
  bindFoeBoxTap(tryUseArmedOnFoe);

  // Total de enemigos de TODAS las zonas conectadas (cementerio + cripta +
  // mausoleos), para que la victoria dependa de limpiar la mazmorra entera y
  // no de vaciar un único tramo (antes, entrar en el Mausoleo 1 y matar a
  // sus 2 esqueletos daba la partida entera por terminada).
  try {
    const zoneNames = ['level1', 'cripta', 'mausoleo1', 'mausoleo2'];
    let total = 0;
    for (const n of zoneNames) {
      const lvl = await getLevel(n);
      const foes = lvl.start.foes || (lvl.start.foe ? [lvl.start.foe] : []);
      total += foes.length;
    }
    total += 1;
    setTotalFoeCount(total);
  } catch (err) { console.warn('No se pudo calcular el total de enemigos de la mazmorra:', err); }

  initRenderer(document.getElementById('map'), (gx, gy) => {
    if (tryUseArmedOnTile(gx, gy)) return;   // había una habilidad activa armada esperando objetivo
    onTapTile(gx, gy);
  });
  initInventory();
  initSkillShop();
  startLoop();
  await bootLevel();

  // Autoguardado: red de seguridad para cambios que no pasan por un clic
  // directo (turnos de la IA, animaciones...). Además se guarda al cerrar o
  // esconder la pestaña, y en los puntos clave de arriba (interactuar, subir
  // de nivel, saltar turno).
  setInterval(() => savegame.saveGame(currentLevelName), 3000);
  window.addEventListener('beforeunload', () => savegame.saveGame(currentLevelName));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') savegame.saveGame(currentLevelName);
  });

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
  function skipTurn() {
    if (!state.busy && !isAITurnActive()) { log(t('log.turnSkipped')); endHeroTurn(); savegame.saveGame(currentLevelName); }
  }
  document.getElementById('endTurn').addEventListener('click', skipTurn);
  document.getElementById('recenter').addEventListener('click', () => centerOnHero(false));
  document.getElementById('hudRow').addEventListener('click', () => centerOnHero(false));
  document.getElementById('heroPanel').addEventListener('click', e => {
    e.stopPropagation();   // si no, el toque también recentraría la cámara (ver hudRow arriba)
    openInventory();
  });

  // Atajos de teclado (solo tienen sentido en PC, con teclado físico —
  // en móvil simplemente no se disparan). Se ignoran mientras se escribe en
  // un campo de texto, y las pulsaciones mantenidas no repiten la acción.
  document.addEventListener('keydown', e => {
    if (e.repeat) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.code === 'Space') {
      e.preventDefault();   // si no, la barra espaciadora también scrollea la página
      // Con la ventana de botín abierta, espacio coge todo y la cierra (más
      // rápido que ir al botón) — SOLO en ese caso; si no hay botín abierto,
      // sigue saltando turno como de costumbre.
      if (isLootOpen()) { lootAllNow(); return; }
      skipTurn();
      return;
    }
    if (e.key === 'i' || e.key === 'I') {
      if (isInventoryOpen()) { closeInventory(); return; }
      if (logHistoryOpen()) hideLogHistory();
      openInventory();
      return;
    }
    if (e.key === 'l' || e.key === 'L') {
      if (logHistoryOpen()) { hideLogHistory(); return; }
      if (isInventoryOpen()) closeInventory();
      showLogHistory();
    }
  });

  // Pantalla de novedades: el botón Continuar la cierra y muestra el
  // leaderboard (siempre, en cualquier arranque). De paso hace de primer
  // toque para desbloquear el audio (importante en móvil).
  document.getElementById('splashContinue').addEventListener('click', () => {
    document.getElementById('splash').classList.remove('show');
    audio.unlock();
    showLeaderboard();
  });

  // Leaderboard: "Continuar" lo cierra y, si es partida nueva de verdad,
  // abre la tienda de habilidades (retomar una partida en curso no debe
  // abrir la tienda — mismo criterio que ya había en las novedades).
  document.getElementById('leaderboardContinue').addEventListener('click', () => {
    document.getElementById('leaderboard').classList.remove('show');
    if (isFreshBoot) openSkillShop();
  });

  // Tienda de habilidades: "Terminar" pide confirmación y entra en el juego
  // (ya cargado en segundo plano desde el arranque, con el oro que se haya
  // gastado ya descontado — es el mismo state.hero.gold en todo momento).
  document.getElementById('shopFinishBtn').addEventListener('click', () => {
    showConfirm(t('confirm.finishShop.title'), t('confirm.finishShop.text'), () => {
      savegame.saveGame(currentLevelName);
      closeSkillShop();
    });
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

  // Ajustes de comodidad: Autolootear y Autopasar turno con 0 PA en combate
  // (persistidos, ver config.js). Casillas normales de HTML: su propio
  // ".checked" ya es la fuente de verdad, no hace falta sincronizar nada más
  // que al abrir el panel la primera vez.
  const autoLootInput = document.getElementById('autoLootCheck');
  const autoSkipZeroAPInput = document.getElementById('autoSkipZeroAPCheck');
  autoLootInput.checked = getAutoLoot();
  autoSkipZeroAPInput.checked = getAutoSkipZeroAP();
  autoLootInput.addEventListener('change', e => setAutoLoot(e.target.checked));
  autoSkipZeroAPInput.addEventListener('change', e => setAutoSkipZeroAP(e.target.checked));

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
const LAYOUT_IDS = ['hud', 'topright', 'bottomright', 'log', 'actionbar'];

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
