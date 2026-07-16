// Estado de la partida + consultas sobre el mapa (sin dibujar ni tocar el DOM).
// Incluye niebla de guerra (explored/visible) y el rango de movimiento (reach).

import { SIGHT, MOVE } from './config.js';

export const state = {
  cols: 0, rows: 0,
  tiles: [],
  hero: null, foe: null,
  triggers: [], exit: null,
  events: {},
  explored: [], visible: [],
  reach: { dist: [], from: [] },   // alcance de movimiento del héroe
  busy: false,
};

const DIRS = [[0,-1],[0,1],[-1,0],[1,0]];
function grid(rows, cols, val) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => val));
}

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
  computeReach();
}

export function inBounds(x, y) { return x >= 0 && y >= 0 && x < state.cols && y < state.rows; }
export function isWall(x, y) { return !inBounds(x, y) || state.tiles[y][x] === 1; }
export function walkable(x, y) {
  return inBounds(x, y) && state.tiles[y][x] === 0
    && !(state.foe.alive && state.foe.x === x && state.foe.y === y);
}
export function adjacent(a, x, y) { return Math.abs(a.x - x) + Math.abs(a.y - y) === 1; }
export function isVisible(x, y) { return inBounds(x, y) && state.visible[y][x]; }
export function isExplored(x, y) { return inBounds(x, y) && state.explored[y][x]; }

// --- niebla de guerra (línea de visión con Bresenham; los muros bloquean) ---
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
    if (state.tiles[y][x] === 1) return false;
  }
}
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

// --- rango de movimiento (BFS hasta MOVE casillas, rodeando muros/enemigo) ---
export function computeReach() {
  const { hero } = state;
  const dist = grid(state.rows, state.cols, -1);
  const from = grid(state.rows, state.cols, null);
  dist[hero.y][hero.x] = 0;
  const q = [[hero.x, hero.y]];
  while (q.length) {
    const [x, y] = q.shift();
    if (dist[y][x] >= MOVE) continue;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (inBounds(nx, ny) && state.tiles[ny][nx] === 0
        && !(state.foe.alive && state.foe.x === nx && state.foe.y === ny)
        && dist[ny][nx] === -1) {
        dist[ny][nx] = dist[y][x] + 1; from[ny][nx] = [x, y]; q.push([nx, ny]);
      }
    }
  }
  state.reach = { dist, from };
}
export function inRange(x, y) {
  const d = state.reach.dist;
  return inBounds(x, y) && d[y] && d[y][x] > 0;
}
// Camino desde el héroe hasta (x,y), o null si está fuera de rango.
export function pathTo(x, y) {
  const { dist, from } = state.reach;
  if (!inBounds(x, y) || !dist[y] || dist[y][x] <= 0) return null;
  const path = []; let cur = [x, y];
  while (cur) { path.push({ x: cur[0], y: cur[1] }); cur = from[cur[1]][cur[0]]; }
  return path.reverse();
}
