// Capa de animación. Mantiene una posición VISUAL por actor, separada de la
// lógica (que es instantánea). render.js pregunta aquí qué fotograma y en qué
// píxel dibujar; rules.js avisa cuándo alguien se mueve o ataca.
//
// Fotogramas del sprite: 0 quieto · 1 paso dcha · 2 paso izq · 3 ataque

import { TILE } from './config.js';

const D_MOVE = 170;    // ms que dura el deslizamiento entre casillas
const D_ATTACK = 220;  // ms que dura el lunge de ataque

const actors = {}; // 'hero' | 'foe' -> { px, py, anim, phase }
const center = (g) => g * TILE + TILE / 2;
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2;

function ensure(name, gx, gy) {
  if (!actors[name]) {
    actors[name] = { px: center(gx), py: center(gy), anim: null, phase: Math.random()*6 };
  }
  return actors[name];
}

// Reinicia todo (nueva partida): los sprites aparecen ya colocados, sin deslizar.
export function reset() { for (const k in actors) delete actors[k]; }

// Deslizar de una casilla a otra.
export function move(name, fromGX, fromGY, toGX, toGY) {
  const a = ensure(name, fromGX, fromGY);
  a.px = center(fromGX); a.py = center(fromGY);
  a.anim = {
    type: 'move', t0: performance.now(), dur: D_MOVE,
    from: { x: center(fromGX), y: center(fromGY) },
    to:   { x: center(toGX),   y: center(toGY) },
  };
}

// Lunge de ataque en una dirección (dx,dy ∈ {-1,0,1}).
export function attack(name, dx, dy) {
  const a = actors[name];
  if (!a) return;
  a.anim = { type: 'attack', t0: performance.now(), dur: D_ATTACK, dir: { x: dx, y: dy } };
}

export function active() {
  return Object.values(actors).some(a => a.anim);
}

// Devuelve { cx, cy, frame } para dibujar. gx,gy = casilla lógica en reposo.
export function resolve(name, gx, gy, ts) {
  const a = ensure(name, gx, gy);
  const an = a.anim;

  if (an) {
    const p = (ts - an.t0) / an.dur;
    if (p >= 1) {
      if (an.type === 'move') { a.px = an.to.x; a.py = an.to.y; }
      a.anim = null;
    } else if (an.type === 'move') {
      const e = easeInOut(p);
      const frame = p < 0.5 ? 1 : 2;           // paso dcha -> paso izq
      return { cx: lerp(an.from.x, an.to.x, e), cy: lerp(an.from.y, an.to.y, e), frame };
    } else { // attack
      const k = Math.sin(p * Math.PI);          // 0 -> 1 -> 0 (ida y vuelta)
      return { cx: a.px + an.dir.x * TILE * 0.42 * k, cy: a.py + an.dir.y * TILE * 0.42 * k, frame: 3 };
    }
  }

  // Reposo: fotograma quieto con una leve respiración.
  const bob = Math.sin(ts / 480 + a.phase) * 1.5;
  return { cx: a.px, cy: a.py + bob, frame: 0 };
}
