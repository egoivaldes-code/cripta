// Estado de la partida y consultas puras sobre el mapa.
// Este módulo NO dibuja ni toca el DOM: solo guarda y responde datos.

export const state = {
  cols: 0, rows: 0,
  tiles: [],
  hero: null,
  foe: null,
  triggers: [],
  events: {},
  busy: false,
};

// Arranca (o reinicia) una partida a partir de los datos cargados.
export function initGame(level, events) {
  state.tiles = level.tiles;
  state.rows = level.tiles.length;
  state.cols = level.tiles[0].length;
  state.hero = { ...level.start.hero };
  state.foe = { ...level.start.foe, alive: true };
  state.triggers = level.triggers.map(t => ({ ...t, used: false }));
  state.events = events;
  state.busy = false;
}

export function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < state.cols && y < state.rows;
}

export function isWall(x, y) {
  return !inBounds(x, y) || state.tiles[y][x] === 1;
}

// Casilla pisable: dentro, suelo, y sin el enemigo encima.
export function walkable(x, y) {
  return inBounds(x, y)
    && state.tiles[y][x] === 0
    && !(state.foe.alive && state.foe.x === x && state.foe.y === y);
}

export function adjacent(a, x, y) {
  return Math.abs(a.x - x) + Math.abs(a.y - y) === 1;
}
