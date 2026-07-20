// Capa de animación. Posición VISUAL por actor (separada de la lógica).
// Dos modos conviven mientras migramos el arte poco a poco:
//   · "legacy": el sistema de siempre (4 fotogramas fijos: quieto/paso dcha/paso izq/ataque).
//   · "animado": personajes con animaciones de verdad por nombre, cada una con su propio
//     número de fotogramas y velocidad (ver ANIM_CLIPS). El héroe además tiene DOS idles
//     (paz/combate) que cambian solas según haya un enemigo cerca, con una transición.
// Además: sacudida al recibir daño y números flotantes (daño/curación).

import { TILE } from './config.js?v=0.15';

const D_MOVE = 170;
const D_ATTACK_LEGACY = 220;
const D_HURT = 300;   // duración de la sacudida (todos los personajes)

// Animaciones de verdad disponibles, por tipo de sprite. Si un tipo NO aparece
// aquí, se dibuja con el sistema "legacy" de 4 fotogramas de siempre.
// Los nombres de clip coinciden EXACTAMENTE con las claves cargadas en assets.js.
export const ANIM_CLIPS = {
  chest: {
    idle: { frames: 1, fps: 1, loop: true  },
    open: { frames: 4, fps: 6, loop: false },
  },
  enemy1: {
    idle:   { frames: 6, fps: 1.8,  loop: true  },
    walk:   { frames: 8, fps: 10, loop: true  },
    attack: { frames: 8, fps: 14, loop: false },
    death:  { frames: 8, fps: 10, loop: false },
    cast:   { frames: 8, fps: 12, loop: false },   // guardado; sin efecto de juego asignado todavía
  },
  enemy4: {   // esqueleto arquero
    idle:   { frames: 6, fps: 1.8, loop: true  },
    walk:   { frames: 8, fps: 10,  loop: true  },
    attack: { frames: 8, fps: 14,  loop: false },
    death:  { frames: 9, fps: 10,  loop: false },
  },
  enemy5: {   // espectro
    idle:   { frames: 6, fps: 2,   loop: true  },
    walk:   { frames: 6, fps: 10,  loop: true  },
    attack: { frames: 7, fps: 12,  loop: false },
    death:  { frames: 8, fps: 10,  loop: false },
  },
  enemy6: {   // esqueleto mago
    idle:   { frames: 6, fps: 2,   loop: true  },
    walk:   { frames: 6, fps: 10,  loop: true  },
    attack: { frames: 6, fps: 10,  loop: false },
    death:  { frames: 6, fps: 10,  loop: false },
  },
  hero: {
    idlepeace:    { frames: 6, fps: 1.6, loop: true },
    idlecombat:   { frames: 6, fps: 2.6,  loop: true  },
    stancechange: { frames: 5, fps: 12, loop: false },
    walk:         { frames: 6, fps: 10, loop: true  },
    attack1:      { frames: 5, fps: 15, loop: false },
    attack2:      { frames: 6, fps: 15, loop: false },
    hit:          { frames: 4, fps: 12, loop: false },
    loot:         { frames: 6, fps: 9,  loop: false },
    activate:     { frames: 6, fps: 9,  loop: false },
    death:        { frames: 7, fps: 8,  loop: false },
    cast:         { frames: 6, fps: 10, loop: false },  // reservada, sin uso todavía
    potion:       { frames: 6, fps: 9,  loop: false },  // reservada, sin uso todavía
  },
};

// Qué clip hace de idle normal / idle de combate / transición, por tipo (solo el
// héroe tiene los dos idles; el esqueleto usa el mismo "idle" siempre).
export const IDLE_NAME = { enemy1: 'idle', enemy4: 'idle', enemy5: 'idle', enemy6: 'idle', hero: 'idlepeace', chest: 'idle' };
const IDLE_COMBAT_NAME = { hero: 'idlecombat' };
const STANCECHANGE_NAME = { hero: 'stancechange' };
// Variantes de ataque entre las que elegir al azar cada vez.
const ATTACK_VARIANTS = { enemy1: ['attack'], enemy4: ['attack'], enemy5: ['attack'], enemy6: ['attack'], hero: ['attack1', 'attack2'] };

const isAnimated = (kind) => !!ANIM_CLIPS[kind];

const actors = {};    // nombre -> { px, py, anim, phase, hurtT0, state, clipT0, facing, dying, stance, ... }
const floats = [];    // números flotantes { x, y, text, color, t0, dur }

const center = (g) => g * TILE + TILE / 2;
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function ensure(name, gx, gy) {
  if (!actors[name]) actors[name] = {
    px: center(gx), py: center(gy), anim: null, phase: Math.random()*6, hurtT0: 0,
    state: 'idle', clipT0: performance.now(), facing: 1, dying: false,
    stance: 'peace', pendingStance: null, actionClip: null,
  };
  return actors[name];
}

export function reset() {
  for (const k in actors) delete actors[k];
  floats.length = 0;
}

// Asienta (deja fijada) la posición final de un movimiento/camino en curso.
// Evita que, al encadenar mover+atacar (o mover+morir) en el mismo turno, el
// sprite se quede clavado en la casilla anterior mientras su casilla lógica ya avanzó.
function commit(a) {
  if (!a || !a.anim) return;
  if (a.anim.type === 'move') { a.px = a.anim.to.x; a.py = a.anim.to.y; }
  else if (a.anim.type === 'path') { const p = a.anim.pts[a.anim.pts.length - 1]; a.px = p.x; a.py = p.y; }
  a.anim = null;
}

function setState(a, state) {
  if (a.state !== state) { a.state = state; a.clipT0 = performance.now(); }
}

export function move(name, fromGX, fromGY, toGX, toGY) {
  const a = ensure(name, fromGX, fromGY);
  commit(a);   // asienta cualquier animación previa sin terminar (evita saltos si se encadena)
  a.px = center(fromGX); a.py = center(fromGY);
  if (toGX !== fromGX) a.facing = toGX > fromGX ? 1 : -1;
  setState(a, 'walk');
  a.anim = { type: 'move', t0: performance.now(), dur: D_MOVE,
    from: { x: center(fromGX), y: center(fromGY) }, to: { x: center(toGX), y: center(toGY) } };
}

// Desliza por un camino de varias casillas (rango de movimiento). cells: [{x,y}...]
export function movePath(name, cells) {
  const a = ensure(name, cells[0].x, cells[0].y);
  commit(a);   // asienta cualquier animación previa sin terminar (evita saltos si se encadena)
  const pts = cells.map(c => ({ x: center(c.x), y: center(c.y) }));
  const dx = pts[pts.length-1].x - pts[0].x;
  if (dx !== 0) a.facing = dx > 0 ? 1 : -1;
  a.px = pts[0].x; a.py = pts[0].y;
  setState(a, 'walk');
  a.anim = { type: 'path', t0: performance.now(), segDur: 320, pts };
}

// `kind` (opcional) identifica el tipo de sprite: si tiene animaciones de verdad,
// se reproduce el clip correspondiente; si no, se usa el lunge de siempre.
export function attack(name, dx, dy, kind) {
  const a = actors[name];
  if (!a) return;
  commit(a);
  if (dx !== 0) a.facing = dx > 0 ? 1 : -1;
  if (isAnimated(kind) && ATTACK_VARIANTS[kind]) {
    a.actionClip = pick(ATTACK_VARIANTS[kind]);
    a.state = 'action'; a.clipT0 = performance.now();
    a.anim = null;
  } else {
    setState(a, 'attack');
    a.anim = { type: 'attack', t0: performance.now(), dur: D_ATTACK_LEGACY, dir: { x: dx, y: dy } };
  }
}

// Reproduce una acción de un solo uso (lootear/activar) y vuelve sola al idle al acabar.
// Si el tipo no tiene esa animación (personajes legacy), no hace nada visualmente.
function playOnce(name, kind, clipName) {
  const a = actors[name];
  if (!a || !isAnimated(kind) || !ANIM_CLIPS[kind][clipName]) return;
  commit(a);
  a.actionClip = clipName;
  a.state = 'action'; a.clipT0 = performance.now();
}
export function loot(name, kind) { playOnce(name, kind, 'loot'); }
export function activateAnim(name, kind) { playOnce(name, kind, 'activate'); }

// Dispara la animación de muerte (solo tiene efecto visual en personajes con
// clip "death"; en los "legacy" simplemente no se llama y se comportan como siempre).
export function die(name) {
  const a = actors[name];
  if (!a) return;
  commit(a);
  a.dying = true;
  setState(a, 'death');
  a.anim = null;
}

// Para OBJETOS (no personajes): se reproduce el clip "open" una vez y se
// queda congelado en el último fotograma para siempre (el cofre se ve abierto
// desde entonces). Si el tipo no tiene clip "open", no hace nada.
export function openProp(name, kind) {
  const a = ensure(name, 0, 0);
  if (!isAnimated(kind) || !ANIM_CLIPS[kind].open || a.opened) return;
  commit(a);
  a.opened = true;
  setState(a, 'open');
}

// Marca la sacudida de daño (todos los personajes) y, si el tipo tiene clip "hit",
// además reproduce la animación de encajar el golpe.
export function hurt(name, kind) {
  const a = actors[name];
  if (!a) return;
  a.hurtT0 = performance.now();
  if (isAnimated(kind) && ANIM_CLIPS[kind].hit && a.state !== 'death') {
    commit(a);
    a.actionClip = 'hit';
    a.state = 'action'; a.clipT0 = performance.now();
  }
}

// Cambia entre idle de paz/combate. Solo tiene efecto en tipos con idle de combate
// (por ahora, el héroe). Al pasar a combate se reproduce la transición una vez;
// al volver a paz, se cambia directo (no hay clip de vuelta todavía).
export function setStance(name, stance, kind) {
  const a = actors[name];
  if (!a || !IDLE_COMBAT_NAME[kind] || a.stance === stance) return;
  if (stance === 'combat' && STANCECHANGE_NAME[kind] && (a.state === 'idle' || a.state === 'walk')) {
    a.pendingStance = 'combat';
    a.actionClip = STANCECHANGE_NAME[kind];
    setState(a, 'stancechange');
  } else {
    a.stance = stance;   // vuelta a paz (o cambio inmediato si no estaba en idle/walk)
  }
}

// Orienta a un actor hacia una dirección (1 = derecha, -1 = izquierda) sin lanzar
// ninguna animación. Se usa para que los enemigos miren al héroe mientras combaten.
// No toca a un actor que está muriendo (para no voltear el cadáver).
export function face(name, dir) {
  const a = actors[name];
  if (!a || !dir || a.dying) return;
  a.facing = dir;
}



// Número flotante sobre una casilla (p.ej. "−6" en rojo, "+10" en verde).
// static=true lo deja quieto en su sitio un rato (en vez de subir y
// desvanecerse como el resto) para que destaque — pensado para el crítico.
export function floatAt(gx, gy, text, color, opts = {}) {
  const dur = opts.static ? 1100 : 1400;
  floats.push({ x: center(gx), y: gy * TILE + TILE * 0.25, text, color, t0: performance.now(), dur, static: !!opts.static });
}

export function active() {
  return Object.values(actors).some(a => a.anim);
}

// ¿Está este actor en mitad de un desplazamiento animado ahora mismo? Se usa
// para no interrumpir el caminar con un cambio de postura (ver setStance):
// si se interrumpe a medio camino, el sprite se queda clavado hasta que el
// movimiento "termina" de golpe (efecto teletransporte).
export function isMoving(name) {
  const a = actors[name];
  return !!(a && a.anim && (a.anim.type === 'move' || a.anim.type === 'path'));
}

// Devuelve { cx, cy, frame, hurt, facing, clip, dead } para dibujar.
// gx,gy = casilla lógica. `kind` = tipo de sprite (para saber si tiene
// animaciones de verdad o usa el sistema legacy de 4 fotogramas).
export function resolve(name, gx, gy, ts, kind) {
  const a = ensure(name, gx, gy);

  // Sacudida por daño (se suma encima de cualquier estado, en ambos modos).
  let sx = 0, sy = 0, hurt = 0;
  if (a.hurtT0) {
    const hp = (ts - a.hurtT0) / D_HURT;
    if (hp >= 1) a.hurtT0 = 0;
    else { hurt = 1 - hp; sx = Math.sin(hp * 42) * 3 * hurt; sy = Math.cos(hp * 37) * 2 * hurt; }
  }

  const clips = ANIM_CLIPS[kind];
  if (clips) return resolveAnimated(a, clips, kind, ts, sx, sy, hurt);
  return resolveLegacy(a, ts, sx, sy, hurt);
}

// --- personajes con animaciones de verdad ---
function resolveAnimated(a, clips, kind, ts, sx, sy, hurt) {
  // Muerte: se reproduce una vez y se queda congelado en el último fotograma
  // (queda como decoración permanente en el suelo).
  if (a.dying) {
    const c = clips.death || { frames: 1, fps: 1 };
    const frame = Math.min(c.frames - 1, Math.max(0, Math.floor((ts - a.clipT0) * c.fps / 1000)));
    return { cx: a.px + sx, cy: a.py + sy, clip: 'death', frame, hurt, facing: a.facing, dead: true };
  }

  // Objeto (cofre...) ya abierto: se reproduce el clip "open" una vez y se
  // queda congelado en su último fotograma para siempre.
  if (a.opened) {
    const c = clips.open || { frames: 1, fps: 1 };
    const frame = Math.min(c.frames - 1, Math.max(0, Math.floor((ts - a.clipT0) * c.fps / 1000)));
    return { cx: a.px + sx, cy: a.py + sy, clip: 'open', frame, hurt, facing: a.facing };
  }

  const an = a.anim;
  if (an && (an.type === 'move' || an.type === 'path')) {
    let cx, cy;
    if (an.type === 'path') {
      const n = an.pts.length - 1, total = an.segDur * n, e = Math.max(0, ts - an.t0);
      if (e >= total) { a.px = an.pts[n].x; a.py = an.pts[n].y; a.anim = null; setState(a, 'idle'); cx = a.px; cy = a.py; }
      else {
        const seg = Math.max(0, Math.min(n - 1, Math.floor(e / an.segDur)));
        const lt = Math.min(1, (e - seg * an.segDur) / an.segDur);
        const p0 = an.pts[seg], p1 = an.pts[seg + 1];
        cx = lerp(p0.x, p1.x, lt); cy = lerp(p0.y, p1.y, lt);
      }
    } else {
      const p = Math.max(0, (ts - an.t0) / an.dur);
      if (p >= 1) { a.px = an.to.x; a.py = an.to.y; a.anim = null; setState(a, 'idle'); cx = a.px; cy = a.py; }
      else { const e = easeInOut(p); cx = lerp(an.from.x, an.to.x, e); cy = lerp(an.from.y, an.to.y, e); }
    }
    if (a.state === 'walk') {
      const c = clips.walk;
      const raw = Math.floor((ts - a.clipT0) * c.fps / 1000);
      const frame = ((raw % c.frames) + c.frames) % c.frames;
      return { cx: cx + sx, cy: cy + sy, clip: 'walk', frame, hurt, facing: a.facing };
    }
    // el movimiento acaba de terminar en este mismo fotograma: cae a los estados de abajo
  }

  if (a.state === 'stancechange') {
    const name = a.actionClip, c = clips[name];
    const frame = Math.max(0, Math.floor((ts - a.clipT0) * c.fps / 1000));
    if (frame >= c.frames) { a.stance = a.pendingStance || 'combat'; a.pendingStance = null; setState(a, 'idle'); }
    else return { cx: a.px + sx, cy: a.py + sy, clip: name, frame, hurt, facing: a.facing };
  }

  if (a.state === 'action') {
    const name = a.actionClip, c = clips[name];
    const frame = Math.max(0, Math.floor((ts - a.clipT0) * c.fps / 1000));
    if (frame >= c.frames) { setState(a, 'idle'); }
    else return { cx: a.px + sx, cy: a.py + sy, clip: name, frame, hurt, facing: a.facing };
  }

  // Idle (en bucle continuo): paz o combate según la postura actual.
  const idleName = (a.stance === 'combat' && IDLE_COMBAT_NAME[kind]) ? IDLE_COMBAT_NAME[kind] : IDLE_NAME[kind];
  const c = clips[idleName];
  const raw = Math.floor((ts - a.clipT0) * c.fps / 1000);
  const frame = ((raw % c.frames) + c.frames) % c.frames;
  return { cx: a.px + sx, cy: a.py + sy, clip: idleName, frame, hurt, facing: a.facing };
}

// --- personajes "legacy": el sistema de siempre, 4 fotogramas fijos ---
function resolveLegacy(a, ts, sx, sy, hurt) {
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
    if (f.static) {
      // quieto en su sitio; se mantiene a máxima opacidad y solo se desvanece
      // en el último tramo, en vez de subir y apagarse todo el rato como el resto.
      const fadeStart = 0.7;
      const alpha = p < fadeStart ? 1 : 1 - (p - fadeStart) / (1 - fadeStart);
      out.push({ x: f.x, y: f.y, alpha, text: f.text, color: f.color });
    } else {
      out.push({ x: f.x, y: f.y - p * 30, alpha: 1 - p, text: f.text, color: f.color });
    }
  }
  return out;
}
