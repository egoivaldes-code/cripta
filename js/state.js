// Estado de la partida + consultas sobre el mapa (sin dibujar ni tocar el DOM).
// Incluye niebla de guerra (explored/visible) y el alcance de movimiento
// ligado a los Puntos de Acción (PA) restantes del héroe.

import { SIGHT, SIGHT_DIM, AP_MAX, CLIMB_COST, MAX_CLIMB, DIFFICULT_EXTRA } from './config.js?v=0.13.1';

export const state = {
  cols: 0, rows: 0,
  tiles: [],
  elev: [],                  // altura por casilla (0 = normal; +/- = escalones)
  difficult: [],             // terreno difícil (matorrales, escombros...): true = cuesta más cruzarlo
  background: null,          // { key } si el nivel usa una imagen de fondo pintada, en vez de losetas
  hero: null, foes: [],      // hero.ap = PA restantes este turno; .apMax = PA por turno
  triggers: [], exit: null,
  events: {},
  explored: [], visible: [],
  reach: { dist: [], from: [] },   // alcance de movimiento según PA restantes
  busy: false,
  targetFoe: null,           // enemigo marcado como objetivo (referencia directa; null = ninguno)
  // --- Iniciativa: quién ha entrado en combate y en qué orden actúa. ---
  // order: array de { ref: 'hero' | foe, initiative: number }, ordenado de
  // mayor a menor. idx: posición del próximo que le toca actuar. Un recién
  // llegado se cuela en su hueco si su tirada gana a alguien que aún no ha
  // actuado esta ronda; si no, espera a la ronda siguiente (ver rules.js).
  combat: { active: false, order: [], idx: 0 },
};

const DIRS = [[0,-1],[0,1],[-1,0],[1,0]];
const DIAG = [[-1,-1],[1,-1],[-1,1],[1,1]];
const DIRS8 = [...DIRS, ...DIAG];   // 4 rectas + 4 diagonales
function grid(rows, cols, val) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => val));
}

export function initGame(level, events) {
  state.tiles = level.tiles;
  state.rows = level.tiles.length;
  state.cols = level.tiles[0].length;
  state.elev = level.elev || grid(state.rows, state.cols, 0);
  state.difficult = level.difficult || grid(state.rows, state.cols, false);
  state.background = level.background || null;
  state.hero = {
    critChance: 0.01, dodgeChance: 0.01, armor: 0.10,
    hasShield: true, blockChance: 0.20,
    resist: { fire: 0, cold: 0, nature: 0, shadow: 0, holy: 0 },
    ...level.start.hero, ap: AP_MAX, apMax: AP_MAX,
  };
  const foeList = level.start.foes || (level.start.foe ? [level.start.foe] : []);
  state.foes = foeList.map((f, i) => ({
    ...f, alive: true, apMax: f.apMax != null ? f.apMax : AP_MAX,
    anim: 'foe' + i,                       // nombre único para su animación
    sprite: f.sprite || 'enemy',           // qué imagen usa
    dormant: f.dormant === true,           // empieza quieto hasta que te acercas
    wakeR: f.wakeR != null ? f.wakeR : 3,  // a cuántas casillas despierta
  }));
  state.triggers = level.triggers.map(t => ({ ...t, used: false }));
  state.exit = level.exit ? { ...level.exit } : null;
  state.events = events;
  state.explored = grid(state.rows, state.cols, false);
  state.visible = grid(state.rows, state.cols, false);
  state.busy = false;
  state.targetFoe = null;
  state.combat = { active: false, order: [], idx: 0 };
  recomputeFog();
  computeReach();
}

export function inBounds(x, y) { return x >= 0 && y >= 0 && x < state.cols && y < state.rows; }
export function isWall(x, y) { return !inBounds(x, y) || state.tiles[y][x] === 1; }

// Un trigger "mueble" (todo salvo trampa) ocupa su casilla: no se puede pisar,
// se interactúa desde al lado. La trampa es un peligro de SUELO: sí se pisa.
export function blockingTriggerAt(x, y) {
  return state.triggers.find(t => !t.used && t.type !== 'trap' && !t.walkTrigger && t.x === x && t.y === y);
}
export function trapAt(x, y) {
  return state.triggers.find(t => !t.used && t.type === 'trap' && t.x === x && t.y === y);
}
// Objetos marcados como walkTrigger (p.ej. un evento de ambientación): no
// bloquean su casilla y se disparan solos al pisarlos, como una trampa pero
// sin daño — el efecto concreto lo decide quien lo dispare (ver rules.js).
// Si además llevan triggerColumn, se disparan al cruzar CUALQUIER casilla de
// su misma columna (x), no solo su casilla exacta.
export function walkTriggerAt(x, y) {
  return state.triggers.find(t => !t.used && t.walkTrigger &&
    (t.triggerColumn ? t.x === x : (t.x === x && t.y === y)));
}

export function walkable(x, y) {
  const trap = trapAt(x, y);
  return inBounds(x, y) && state.tiles[y][x] === 0
    && !state.foes.some(f => f.alive && f.x === x && f.y === y)
    && !blockingTriggerAt(x, y)
    && !(trap && trap.revealed);   // ya descubierta: bloquea como un mueble, no se cruza por encima
}
// Consultas sobre los enemigos.
export function livingFoes() { return state.foes.filter(f => f.alive); }
export function foeAt(x, y) { return state.foes.find(f => f.alive && f.x === x && f.y === y) || null; }
export function nearestFoe() {
  const { hero } = state; let best = null, bd = Infinity;
  for (const f of state.foes) { if (!f.alive) continue; const d = distTo(f, hero.x, hero.y); if (d < bd) { bd = d; best = f; } }
  return best;
}
// "Al lado" ahora incluye las diagonales (distancia de Chebyshev = 1), así que
// se puede atacar y usar objetos también en diagonal.
export function adjacent(a, x, y) { return Math.max(Math.abs(a.x - x), Math.abs(a.y - y)) === 1; }
export function distTo(a, x, y) { return Math.max(Math.abs(a.x - x), Math.abs(a.y - y)); }

// Casillas a las que se puede dar UN paso desde (x,y): las 4 rectas siempre;
// las 4 diagonales solo si no se corta la esquina de un muro (las dos casillas
// rectas contiguas tienen que estar libres). Así no te cuelas entre dos paredes.
// Además, un desnivel de altura mayor que MAX_CLIMB es un precipicio: no se cruza.
// Subir un escalón cuesta CLIMB_COST extra; bajar o llano cuesta 1 (MOVE_COST).
function diagOpen(x, y, dx, dy) { return !isWall(x + dx, y) && !isWall(x, y + dy); }
export function elevAt(x, y) { return (state.elev[y] && state.elev[y][x]) || 0; }
export function isDifficult(x, y) { return !!(state.difficult[y] && state.difficult[y][x]); }
export function stepCost(x, y, nx, ny) {
  const diff = elevAt(nx, ny) - elevAt(x, y);
  if (Math.abs(diff) > MAX_CLIMB) return -1;         // precipicio: infranqueable
  let cost = 1 + (diff > 0 ? CLIMB_COST - 1 : 0);     // subir cuesta más; bajar/llano = 1
  if (isDifficult(nx, ny)) cost += DIFFICULT_EXTRA;    // terreno difícil: cuesta más, pero no bloquea
  return cost;
}
export function stepNeighbors(x, y) {
  const out = [];
  for (const [dx, dy] of DIRS8) {
    const nx = x + dx, ny = y + dy;
    if (!walkable(nx, ny)) continue;
    if (dx !== 0 && dy !== 0 && !diagOpen(x, y, dx, dy)) continue;
    const cost = stepCost(x, y, nx, ny);
    if (cost < 0) continue;                            // precipicio
    out.push([nx, ny, cost]);
  }
  return out;
}
export function isVisible(x, y) { return inBounds(x, y) && state.visible[y][x]; }
export function isExplored(x, y) { return inBounds(x, y) && state.explored[y][x]; }

// --- niebla de guerra (línea de visión con Bresenham; los muros bloquean) ---
// Exportada porque el arquero la usa para saber si tiene el tiro despejado.
export function losClear(x0, y0, x1, y1) {
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
  // Dos anillos concéntricos: dentro de SIGHT se ve iluminado del todo (visible);
  // entre SIGHT y SIGHT_DIM se marca como "explorado" (queda en penumbra/niebla,
  // memoria del terreno) aunque no esté iluminado; más allá sigue siendo negro
  // sin explorar hasta que el héroe se acerque más.
  const R = SIGHT, R2 = R * R;
  const RD = SIGHT_DIM, RD2 = RD * RD;
  const x0 = Math.max(0, Math.floor(hero.x - RD)), x1 = Math.min(state.cols - 1, Math.ceil(hero.x + RD));
  const y0 = Math.max(0, Math.floor(hero.y - RD)), y1 = Math.min(state.rows - 1, Math.ceil(hero.y + RD));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const ddx = x - hero.x, ddy = y - hero.y;
    const d2 = ddx * ddx + ddy * ddy;
    if (d2 > RD2) continue;
    if (!losClear(hero.x, hero.y, x, y)) continue;
    if (d2 <= R2) state.visible[y][x] = true;
    state.explored[y][x] = true;
  }
}

// --- alcance de movimiento (Dijkstra hasta los PA restantes: subir cuesta más,
// un desnivel grande es un precipicio infranqueable; rodea muros/muebles) ---
export function computeReach() {
  const { hero } = state;
  const dist = grid(state.rows, state.cols, -1);
  const from = grid(state.rows, state.cols, null);
  dist[hero.y][hero.x] = 0;
  // Cola de prioridad simple (los PA por turno son pocos, así que un array basta).
  const pq = [[0, hero.x, hero.y]];
  while (pq.length) {
    pq.sort((a, b) => a[0] - b[0]);
    const [d, x, y] = pq.shift();
    if (d > dist[y][x]) continue;               // entrada obsoleta
    if (d >= hero.ap) continue;
    for (const [nx, ny, cost] of stepNeighbors(x, y)) {
      const nd = d + cost;
      if (nd > hero.ap) continue;                // no llega con los PA de este turno
      if (dist[ny][nx] === -1 || nd < dist[ny][nx]) {
        dist[ny][nx] = nd; from[ny][nx] = [x, y]; pq.push([nd, nx, ny]);
      }
    }
  }
  state.reach = { dist, from };
}
export function inRange(x, y) {
  const d = state.reach.dist;
  return inBounds(x, y) && d[y] && d[y][x] > 0;
}
// Coste real en PA (ya con la altura aplicada) para llegar a (x,y), o -1 si no está en rango.
export function reachCost(x, y) {
  const d = state.reach.dist;
  return (inBounds(x, y) && d[y] && d[y][x] > 0) ? d[y][x] : -1;
}
// Camino desde el héroe hasta (x,y) dentro del alcance, o null si no llega.
export function pathTo(x, y) {
  const { dist, from } = state.reach;
  if (!inBounds(x, y) || !dist[y] || dist[y][x] <= 0) return null;
  const path = []; let cur = [x, y];
  while (cur) { path.push({ x: cur[0], y: cur[1] }); cur = from[cur[1]][cur[0]]; }
  return path.reverse();
}
