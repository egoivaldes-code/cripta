// Estado de la partida + consultas sobre el mapa (sin dibujar ni tocar el DOM).
// Incluye la niebla de guerra: `explored` (permanente) y `visible` (según la
// vista actual del héroe, con línea de visión que respeta los muros).

import { SIGHT } from './config.js';

export const state = {
  cols: 0, rows: 0,
  tiles: [],
  hero: null,
  foe: null,
  triggers: [],
  exit: null,
  events: {},
  explored: [],   // bool[y][x] — casillas vistas alguna vez
  visible: [],    // bool[y][x] — casillas a la vista ahora mismo
  busy: false,
};

function grid(rows, cols, val) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => val));
}

// Arranca (o reinicia) una partida a partir de los datos cargados.
export function initGame(level, events) {
  state.tiles = level.tiles;
  state.rows = level.tiles.length;
  state.cols = level.tiles[0].length;
  state.hero = { ...level.start.hero };
  state.foe = { ...level.start.foe, alive: true };
  state.triggers = level.triggers.map(t => ({ ...t, used: false }));
  state.exit = level.exit ? { ...level.exit } : null;
  state.events = events;
  state.explored = grid(state.rows, state.cols, false);
  state.visible = grid(state.rows, state.cols, false);
  state.busy = false;
  recomputeFog();
}

export function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < state.cols && y < state.rows;
}
export function isWall(x, y) {
  return !inBounds(x, y) || state.tiles[y][x] === 1;
}
export function walkable(x, y) {
  return inBounds(x, y) && state.tiles[y][x] === 0
    && !(state.foe.alive && state.foe.x === x && state.foe.y === y);
}
export function adjacent(a, x, y) {
  return Math.abs(a.x - x) + Math.abs(a.y - y) === 1;
}
export function isVisible(x, y) { return inBounds(x, y) && state.visible[y][x]; }
export function isExplored(x, y) { return inBounds(x, y) && state.explored[y][x]; }

// Línea de visión (Bresenham): true si no hay muro ESTRICTAMENTE entre origen
// y destino. El muro de destino sí se ve (para poder pintar las paredes).
function losClear(x0, y0, x1, y1) {
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  while (true) {
    if (x === x1 && y === y1) return true;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
    if (x === x1 && y === y1) return true;
    if (state.tiles[y][x] === 1) return false; // muro intermedio bloquea
  }
}

// Recalcula qué ve el héroe ahora (se llama al moverse y al cargar nivel).
export function recomputeFog() {
  const { hero } = state;
  for (let y = 0; y < state.rows; y++) for (let x = 0; x < state.cols; x++) state.visible[y][x] = false;
  const R = SIGHT, R2 = R * R;
  const x0 = Math.max(0, Math.floor(hero.x - R)), x1 = Math.min(state.cols - 1, Math.ceil(hero.x + R));
  const y0 = Math.max(0, Math.floor(hero.y - R)), y1 = Math.min(state.rows - 1, Math.ceil(hero.y + R));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const ddx = x - hero.x, ddy = y - hero.y;
    if (ddx * ddx + ddy * ddy > R2) continue;
    if (losClear(hero.x, hero.y, x, y)) { state.visible[y][x] = true; state.explored[y][x] = true; }
  }
}
