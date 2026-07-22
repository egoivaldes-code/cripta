// Guardado de partida — vive junto a la tienda de habilidades como parte del
// mismo sistema TEMPORAL de pruebas. Objetivo: si se cierra la app a mitad
// de una mazmorra, al volver a abrirla se retoma EXACTO (mismo nivel,
// posición, vida, enemigos vivos/muertos, niebla explorada, orden de
// combate...). Lo estático del nivel (tiles/elev/events) no se guarda: se
// vuelve a cargar siempre desde data/levels/<nivel>.json y solo se
// sobrescribe lo dinámico encima.
//
// El ORO es la excepción a propósito: vive en su propia clave persistida
// (GOLD_KEY), separada de la partida guardada (SAVE_KEY). Así sobrevive a un
// "Reiniciar partida" (que sí borra la mazmorra en curso) y es SIEMPRE el
// mismo número tanto en la tienda de habilidades como dentro de la mazmorra
// — no hay dos "bolsas" separadas.

import { state } from './state.js?v=0.21';

const SAVE_KEY = 'cripta.save';
const GOLD_KEY = 'cripta.gold';
const DEFAULT_GOLD = 1000;

// --- oro persistido (fuente única de verdad) -------------------------------

export function getPersistedGold() {
  try {
    const v = localStorage.getItem(GOLD_KEY);
    return v == null ? DEFAULT_GOLD : Math.max(0, parseInt(v, 10) || 0);
  } catch { return DEFAULT_GOLD; }
}

export function persistGold(n) {
  try { localStorage.setItem(GOLD_KEY, String(Math.max(0, Math.round(n)))); } catch {}
}

// --- partida guardada -------------------------------------------------------

export function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch {}
}

// Guarda todo lo dinámico del estado actual. `levelName` es el mismo string
// que se le pasa a loadLevel()/getLevel() en main.js (p.ej. 'level1',
// 'cripta', 'mausoleo1'...), para poder recargar el nivel correcto al volver.
export function saveGame(levelName) {
  if (!state.hero || !levelName) return;
  try {
    const foeIndex = f => state.foes.indexOf(f);
    const data = {
      levelName,
      hero: { ...state.hero },
      foes: state.foes.map(f => ({ ...f })),
      triggers: state.triggers.map(t => ({ ...t })),
      exit: state.exit ? { ...state.exit } : null,
      exits: state.exits.map(e => ({ ...e })),
      explored: state.explored.map(row => row.slice()),
      combat: {
        active: state.combat.active,
        idx: state.combat.idx,
        order: state.combat.order.map(o => ({
          ref: o.ref === 'hero' ? 'hero' : foeIndex(o.ref),
          initiative: o.initiative,
        })),
      },
      targetFoe: state.targetFoe ? foeIndex(state.targetFoe) : null,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    persistGold(state.hero.gold);
  } catch (err) { console.warn('No se pudo guardar la partida:', err); }
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// Aplica una partida guardada sobre un `state` recién inicializado con
// initGame(level, events) del MISMO nivel (mismo `levelName`). Sobrescribe
// todo lo dinámico; lo estático (tiles/elev/events/background) se queda tal
// cual lo dejó initGame. El oro SIEMPRE se toma de getPersistedGold(), nunca
// del bloque guardado, para que no puedan desincronizarse los dos.
export function applySave(data) {
  state.hero = { ...data.hero, gold: getPersistedGold() };
  state.foes = data.foes.map(f => ({ ...f }));
  state.triggers = data.triggers.map(t => ({ ...t }));
  state.exit = data.exit ? { ...data.exit } : null;
  state.exits = data.exits.map(e => ({ ...e }));
  state.explored = data.explored.map(row => row.slice());
  state.busy = false;
  state.targetFoe = data.targetFoe != null ? state.foes[data.targetFoe] || null : null;
  state.combat = {
    active: data.combat.active,
    idx: data.combat.idx,
    order: data.combat.order.map(o => ({
      ref: o.ref === 'hero' ? 'hero' : state.foes[o.ref],
      initiative: o.initiative,
    })).filter(o => o.ref),   // por si algún índice quedara huérfano (nivel editado entre sesiones)
  };
}
