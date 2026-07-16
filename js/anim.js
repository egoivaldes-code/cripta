// Capa de animación. Posición VISUAL por actor (separada de la lógica).
// Fotogramas: 0 quieto · 1 paso dcha · 2 paso izq · 3 ataque
// Además: sacudida al recibir daño y números flotantes (daño/curación).

import { TILE } from './config.js?v=0.3.1';

const D_MOVE = 170;
const D_ATTACK = 220;
const D_HURT = 300;   // duración de la sacudida

const actors = {};    // 'hero' | 'foe' -> { px, py, anim, phase, hurtT0 }
const floats = [];    // números flotantes { x, y, text, color, t0, dur }

const center = (g) => g * TILE + TILE / 2;
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2;

function ensure(name, gx, gy) {
  if (!actors[name]) actors[name] = { px: center(gx), py: center(gy), anim: null, phase: Math.random()*6, hurtT0: 0 };
  return actors[name];
}

export function reset() {
  for (const k in actors) delete actors[k];
  floats.length = 0;
}

export function move(name, fromGX, fromGY, toGX, toGY) {
  const a = ensure(name, fromGX, fromGY);
  a.px = center(fromGX); a.py = center(fromGY);
  a.anim = { type: 'move', t0: performance.now(), dur: D_MOVE,
    from: { x: center(fromGX), y: center(fromGY) }, to: { x: center(toGX), y: center(toGY) } };
}

export function attack(name, dx, dy) {
  const a = actors[name];
  if (a) a.anim = { type: 'attack', t0: performance.now(), dur: D_ATTACK, dir: { x: dx, y: dy } };
}

// Desliza por un camino de varias casillas (rango de movimiento). cells: [{x,y}...]
export function movePath(name, cells) {
  const a = ensure(name, cells[0].x, cells[0].y);
  const pts = cells.map(c => ({ x: center(c.x), y: center(c.y) }));
  a.px = pts[0].x; a.py = pts[0].y;
  a.anim = { type: 'path', t0: performance.now(), segDur: 145, pts };
}

export function hurt(name) {
  const a = actors[name];
  if (a) a.hurtT0 = performance.now();
}

// Número flotante sobre una casilla (p.ej. "−6" en rojo, "+10" en verde).
export function floatAt(gx, gy, text, color) {
  floats.push({ x: center(gx), y: gy * TILE + TILE * 0.25, text, color, t0: performance.now(), dur: 850 });
}

export function active() {
  return Object.values(actors).some(a => a.anim);
}

// Devuelve { cx, cy, frame, hurt } para dibujar. gx,gy = casilla lógica.
export function resolve(name, gx, gy, ts) {
  const a = ensure(name, gx, gy);

  // Sacudida por daño (se suma encima de cualquier estado).
  let sx = 0, sy = 0, hurt = 0;
  if (a.hurtT0) {
    const hp = (ts - a.hurtT0) / D_HURT;
    if (hp >= 1) a.hurtT0 = 0;
    else { hurt = 1 - hp; sx = Math.sin(hp * 42) * 3 * hurt; sy = Math.cos(hp * 37) * 2 * hurt; }
  }

  const an = a.anim;
  if (an) {
    if (an.type === 'path') {
      const n = an.pts.length - 1, total = an.segDur * n, e = Math.max(0, ts - an.t0);
      if (e >= total) { a.px = an.pts[n].x; a.py = an.pts[n].y; a.anim = null; }
      else {
        const seg = Math.max(0, Math.min(n - 1, Math.floor(e / an.segDur)));
        const lt = Math.min(1, (e - seg * an.segDur) / an.segDur);
        const p0 = an.pts[seg], p1 = an.pts[seg + 1];
        return { cx: lerp(p0.x, p1.x, lt) + sx, cy: lerp(p0.y, p1.y, lt) + sy, frame: seg % 2 === 0 ? 1 : 2, hurt };
      }
    } else {
      const p = Math.max(0, (ts - an.t0) / an.dur);
      if (p >= 1) { if (an.type === 'move') { a.px = an.to.x; a.py = an.to.y; } a.anim = null; }
      else if (an.type === 'move') {
        const e = easeInOut(p);
        return { cx: lerp(an.from.x, an.to.x, e) + sx, cy: lerp(an.from.y, an.to.y, e) + sy, frame: p < 0.5 ? 1 : 2, hurt };
      } else { // attack
        const k = Math.sin(p * Math.PI);
        return { cx: a.px + an.dir.x * TILE * 0.42 * k + sx, cy: a.py + an.dir.y * TILE * 0.42 * k + sy, frame: 3, hurt };
      }
    }
  }

  const bob = Math.sin(ts / 480 + a.phase) * 1.5;
  return { cx: a.px + sx, cy: a.py + bob + sy, frame: 0, hurt };
}

// Números flotantes activos, con su posición y opacidad ya calculadas.
export function floatsNow(ts) {
  const out = [];
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i];
    const p = (ts - f.t0) / f.dur;
    if (p >= 1) { floats.splice(i, 1); continue; }
    out.push({ x: f.x, y: f.y - p * 22, alpha: 1 - p, text: f.text, color: f.color });
  }
  return out;
}
