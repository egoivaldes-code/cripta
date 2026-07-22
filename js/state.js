// Estado de la partida + consultas sobre el mapa (sin dibujar ni tocar el DOM).
// Incluye niebla de guerra (explored/visible) y el alcance de movimiento
// ligado a los Puntos de Acción (PA) restantes del héroe.

import { SIGHT, SIGHT_DIM, AP_MAX, CLIMB_COST, MAX_CLIMB, DIFFICULT_EXTRA } from './config.js?v=0.20';

export const state = {
  cols: 0, rows: 0,
  tiles: [],
  elev: [],                  // altura por casilla (0 = normal; +/- = escalones)
  difficult: [],             // terreno difícil (matorrales, escombros...): true = cuesta más cruzarlo
  background: null,          // { key } si el nivel usa una imagen de fondo pintada, en vez de losetas
  hero: null, foes: [],      // hero.ap = PA restantes este turno; .apMax = PA por turno
  triggers: [], exit: null, exits: [],
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
  state.biome = level.biome || 'underground';   // 'forest' | 'underground' -> qué fondo de vacío usar (ver render.js)
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
  // Formato nuevo: varias salidas por nivel, cada una "mueble" (no se anda
  // encima, se interactúa desde al lado) y opcionalmente bloqueada hasta que
  // algo la desbloquee (p.ej. una palanca). Convive con `exit` (el formato
  // antiguo de una sola salida transitable) para no tocar los niveles que ya
  // lo usan así.
  state.exits = (level.exits || []).map(e => ({ ...e, blocked: !!e.blocked }));
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
// Salida (formato nuevo, con id): ocupa su casilla igual que un objeto
// "mueble" — no se anda por encima, se interactúa desde al lado (portón,
// verja...), esté o no bloqueada.
export function exitAt(x, y) {
  return state.exits.find(e => e.x === x && e.y === y) || null;
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
    && !exitAt(x, y)
    && !(trap && trap.revealed);   // ya descubierta: bloquea como un mueble, no se cruza por encima
}
// Consultas sobre los enemigos.
export function livingFoes() { return state.foes.filter(f => f.alive); }
export function foeAt(x, y) { return state.foes.find(f => f.alive && f.x === x && f.y === y) || null; }
// Un "cadáver" es un enemigo muerto cuyo último fotograma sigue en pantalla
// (deathPlaying) y todavía tiene loot sin coger — deja de contar en cuanto
// se vacía (ver lootAll/lootItem en rules.js), aunque el sprite siga un
// instante más en pantalla mientras se cierra la ventana.
export function corpseAt(x, y) {
  return state.foes.find(f => !f.alive && f.deathPlaying && f.x === x && f.y === y && f.loot && f.loot.length > 0) || null;
}
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
// `passFoes`: si es true, las casillas ocupadas por OTROS enemigos no
// bloquean el paso (se puede atravesar, aunque no se pueda terminar el
// movimiento ahí) — igual que en Descent: Journeys in the Dark, donde una
// figura puede pasar a través de figuras aliadas pero nunca acabar su
// movimiento sobre ellas. Lo usan los propios enemigos para calcular su
// camino "ideal" hacia el héroe (ver findApproachPath más abajo).
export function stepNeighbors(x, y, passFoes = false) {
  const out = [];
  for (const [dx, dy] of DIRS8) {
    const nx = x + dx, ny = y + dy;
    const trap = trapAt(nx, ny);
    const passableTerrain = inBounds(nx, ny) && state.tiles[ny][nx] === 0
      && !blockingTriggerAt(nx, ny) && !exitAt(nx, ny) && !(trap && trap.revealed);
    const foeHere = state.foes.some(f => f.alive && f.x === nx && f.y === ny);
    if (!passableTerrain || (foeHere && !passFoes)) continue;
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
// Camino real (Dijkstra) desde CUALQUIER casilla de origen hasta el destino,
// rodeando muros y objetos — no solo "el primer paso que acerque en línea
// recta" (eso se quedaba atascado en cuellos de botella: un paso lateral que
// aumenta la distancia un momento, para luego rodear, nunca se elegía). Lo
// usan los enemigos para acercarse de verdad. Sin límite de PA (el que llama
// decide cuántos pasos del camino puede permitirse pagar este turno).
export function findPath(fromX, fromY, toX, toY, passFoes = false) {
  if (fromX === toX && fromY === toY) return [{ x: fromX, y: fromY }];
  const dist = grid(state.rows, state.cols, -1);
  const from = grid(state.rows, state.cols, null);
  dist[fromY][fromX] = 0;
  const pq = [[0, fromX, fromY]];
  while (pq.length) {
    pq.sort((a, b) => a[0] - b[0]);
    const [d, x, y] = pq.shift();
    if (d > dist[y][x]) continue;
    if (x === toX && y === toY) break;
    for (const [nx, ny, cost] of stepNeighbors(x, y, passFoes)) {
      const nd = d + cost;
      if (dist[ny][nx] === -1 || nd < dist[ny][nx]) {
        dist[ny][nx] = nd; from[ny][nx] = [x, y]; pq.push([nd, nx, ny]);
      }
    }
  }
  if (dist[toY][toX] === -1) return null;   // no hay camino posible
  const path = []; let cur = [toX, toY];
  while (cur) { path.push({ x: cur[0], y: cur[1] }); cur = from[cur[1]][cur[0]]; }
  return path.reverse();
}

export function inRange(x, y) {
  const d = state.reach.dist;
  return inBounds(x, y) && d[y] && d[y][x] > 0;
}

// Cuando NO hay camino directo hasta (toX,toY) — típicamente porque un
// aliado ocupa la única casilla de paso en un pasillo estrecho — esto
// calcula el camino MÁS CORTO real como si los aliados no bloquearan en
// absoluto (igual que en Descent: Journeys in the Dark, donde una figura
// puede atravesar a un aliado pero nunca terminar su movimiento sobre él),
// y luego lo recorta justo antes del primer aliado que de verdad encuentre.
// Así, el enemigo se coloca en la mejor posición real posible — típicamente
// justo detrás de su aliado — en vez de quedarse quieto, y sigue eligiendo
// bien incluso en pasillos que serpentean o tienen ramificaciones.
export function findApproachPath(fromX, fromY, toX, toY) {
  const idealPath = findPath(fromX, fromY, toX, toY, true);   // passFoes=true: como si los aliados no estuvieran
  if (!idealPath || idealPath.length < 2) return null;

  let stopIndex = idealPath.length - 1;
  for (let i = 1; i < idealPath.length; i++) {
    const { x, y } = idealPath[i];
    if (x === toX && y === toY) break;   // el propio objetivo (el héroe) no cuenta como bloqueo
    if (state.foes.some(f => f.alive && f.x === x && f.y === y)) { stopIndex = i - 1; break; }
  }
  if (stopIndex < 1) return null;   // el aliado está pegado desde el primer paso: no se avanza nada
  return idealPath.slice(0, stopIndex + 1);
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
