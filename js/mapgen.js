// Ensamblador de mapas por LOSETAS (estilo Descent): piezas con paredes de
// borde y aberturas (conectores). Se colocan encajando conector con conector,
// sin solaparse, hasta llegar a un número de piezas. Cada pieza tiene una ALTURA;
// en las aberturas la diferencia de altura es como mucho 1 (para poder cruzar).
//
// Salida: { cols, rows, tiles[][](0 suelo/1 muro), elev[][](altura por casilla),
//           heroStart{x,y}, foeSpots[{x,y}], doorways[{x,y}] }
//
// Sin DOM ni dependencias: se puede probar en node.

const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
const DELTA = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

// Construye una sala rectangular con muros de borde y una abertura (suelo) en
// el centro de cada lado indicado. Devuelve celdas y la posición local de cada abertura.
function room(w, h, sides) {
  const cells = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      const border = (x === 0 || y === 0 || x === w - 1 || y === h - 1);
      row.push(border ? 1 : 0);
    }
    cells.push(row);
  }
  const openings = [];
  for (const s of sides) {
    let ox, oy;
    if (s === 'N') { ox = (w >> 1); oy = 0; }
    else if (s === 'S') { ox = (w >> 1); oy = h - 1; }
    else if (s === 'W') { ox = 0; oy = (h >> 1); }
    else { ox = w - 1; oy = (h >> 1); }
    cells[oy][ox] = 0;                 // abrir el muro
    openings.push({ side: s, ox, oy });
  }
  return { w, h, cells, openings, platform: null };
}

// Sala con una plataforma elevada (+1) en el centro: se ve la altura DENTRO de la pieza.
function roomPlatform(w, h, sides) {
  const r = room(w, h, sides);
  const px0 = 2, py0 = 2, px1 = w - 3, py1 = h - 3;
  r.platform = { x0: px0, y0: py0, x1: px1, y1: py1 };  // celdas locales +1 de altura
  return r;
}

// Catálogo de piezas (cada una puede aparecer varias veces, con altura variable).
function catalog() {
  return {
    entrance:  room(5, 5, ['N', 'S', 'E', 'W']),
    hall:      room(6, 6, ['N', 'S', 'E', 'W']),
    chamber:   room(5, 5, ['N', 'E', 'W']),
    cell:      room(4, 4, ['N', 'S']),
    corridorH: room(4, 3, ['E', 'W']),
    corridorV: room(3, 4, ['N', 'S']),
    platform:  roomPlatform(6, 6, ['S', 'E', 'W']),
  };
}

function rngFrom(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

export function assemble(opts = {}) {
  const rng = rngFrom(opts.seed != null ? opts.seed : (Date.now() & 0xffffffff));
  const targetPieces = opts.pieces || 8;
  const cat = catalog();

  const placed = [];                 // { key, x0, y0, w, h, height, def }
  const occ = new Map();             // "x,y" -> true (celdas ocupadas por cualquier pieza)
  const open = [];                   // conectores libres: { wx, wy, side, height }
  const doorways = [];

  const rect = (x0, y0, w, h) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (occ.has(x + ',' + y)) return false;
    return true;
  };
  function stamp(key, def, x0, y0, height) {
    for (let y = 0; y < def.h; y++) for (let x = 0; x < def.w; x++) occ.set((x0 + x) + ',' + (y0 + y), true);
    const p = { key, def, x0, y0, w: def.w, h: def.h, height };
    placed.push(p);
    for (const o of def.openings) {
      open.push({ wx: x0 + o.ox, wy: y0 + o.oy, side: o.side, height });
    }
    return p;
  }

  // Pieza inicial: la entrada, altura 0.
  stamp('entrance', cat.entrance, 0, 0, 0);

  let tries = 0;
  while (placed.length < targetPieces && open.length && tries < 400) {
    tries++;
    const ci = Math.floor(rng() * open.length);
    const c = open[ci];
    const keys = Object.keys(cat).filter(k => k !== 'entrance');
    const key = pick(rng, keys);
    const def = cat[key];
    // Necesitamos una abertura del lado OPUESTO en la pieza nueva.
    const need = OPP[c.side];
    const cand = def.openings.filter(o => o.side === need);
    if (!cand.length) continue;
    const o = pick(rng, cand);
    // Colocar para que la abertura nueva quede justo al lado de la del conector.
    const [dx, dy] = DELTA[c.side];
    const targetX = c.wx + dx, targetY = c.wy + dy;    // celda donde debe caer la abertura nueva
    const x0 = targetX - o.ox, y0 = targetY - o.oy;
    if (!rect(x0, y0, def.w, def.h)) continue;
    // Altura de la pieza nueva: como mucho ±1 respecto al conector (para poder cruzar).
    const height = c.height + pick(rng, [-1, 0, 0, 1]);
    stamp(key, def, x0, y0, height);
    open.splice(ci, 1);                                 // conector usado
    // quitar de "open" la abertura recién casada de la pieza nueva
    const usedIdx = open.findIndex(k => k.wx === targetX && k.wy === targetY);
    if (usedIdx >= 0) open.splice(usedIdx, 1);
    doorways.push({ x: c.wx, y: c.wy }, { x: targetX, y: targetY });
  }

  // Normalizar a una rejilla con margen de 1 (muro) alrededor.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of placed) { minX = Math.min(minX, p.x0); minY = Math.min(minY, p.y0); maxX = Math.max(maxX, p.x0 + p.w); maxY = Math.max(maxY, p.y0 + p.h); }
  const pad = 1;
  const cols = (maxX - minX) + pad * 2, rows = (maxY - minY) + pad * 2;
  const shift = (x, y) => [x - minX + pad, y - minY + pad];

  const tiles = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 1));
  const elev  = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
  for (const p of placed) {
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      const [gx, gy] = shift(p.x0 + x, p.y0 + y);
      let h = p.height, t = p.def.cells[y][x];
      if (t === 0 && p.def.platform) {
        const pf = p.def.platform;
        if (x >= pf.x0 && x <= pf.x1 && y >= pf.y0 && y <= pf.y1) h = p.height + 1;
      }
      // el suelo gana al muro cuando dos piezas comparten abertura
      if (t === 0) { tiles[gy][gx] = 0; elev[gy][gx] = h; }
      else if (tiles[gy][gx] !== 0) { tiles[gy][gx] = 1; elev[gy][gx] = h; }
    }
  }
  // Asegurar que las puertas quedan como suelo.
  const dshift = doorways.map(d => { const [x, y] = shift(d.x, d.y); return { x, y }; });
  for (const d of dshift) { tiles[d.y][d.x] = 0; }

  // Puntos de aparición: héroe en el centro de la entrada; enemigos en centros de otras piezas.
  const ent = placed[0];
  const [hx, hy] = shift(ent.x0 + (ent.w >> 1), ent.y0 + (ent.h >> 1));
  const heroStart = { x: hx, y: hy };
  const foeSpots = [];
  for (let i = 1; i < placed.length; i++) {
    const p = placed[i];
    const [cx, cy] = shift(p.x0 + (p.w >> 1), p.y0 + (p.h >> 1));
    if (tiles[cy][cx] === 0) foeSpots.push({ x: cx, y: cy });
  }

  return { cols, rows, tiles, elev, heroStart, foeSpots, doorways: dshift, pieces: placed.length };
}
