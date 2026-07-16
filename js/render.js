// Capa de dibujo (Canvas 2D). Lee de `state` y pinta; no conoce las reglas.
// Es la ÚNICA parte atada al canvas.
//
// Pantalla completa: el canvas ocupa todo #game. La casilla es de tamaño fijo
// (TILE), así que en pantallas grandes se ve más mapa. La cámara se arrastra y
// se recentra en el héroe. Niebla de guerra de dos capas (negro / penumbra).

import { state, walkable } from './state.js';
import { TILE } from './config.js';
import { images, ATLAS_TILE, SPRITE_TILE } from './assets.js';
import * as anim from './anim.js';

function atlasCol(value, x, y) {
  if (value === 1) return 3;
  return (x * 31 + y * 17) % 3;
}

let ctx, canvas, VW = 0, VH = 0, pulse = 0, reduceMotion = false, onTap = () => {};

const camera = { x: 0, y: 0 };
let camTween = null;
let userPanning = false;
let lastHeroX = -1, lastHeroY = -1;
const easeInOut = (t) => t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2;

// Clamp por eje: si el mundo es más pequeño que el viewport, se centra.
function clampX(v) { const w = state.cols * TILE; return w <= VW ? (w - VW) / 2 : Math.max(0, Math.min(v, w - VW)); }
function clampY(v) { const h = state.rows * TILE; return h <= VH ? (h - VH) / 2 : Math.max(0, Math.min(v, h - VH)); }
function heroTarget() {
  return { x: clampX(state.hero.x * TILE + TILE/2 - VW/2), y: clampY(state.hero.y * TILE + TILE/2 - VH/2) };
}
function tweenTo(t) { camTween = { fromX: camera.x, fromY: camera.y, toX: t.x, toY: t.y, t0: performance.now(), dur: 260 }; }

export function centerOnHero(instant = false) {
  const t = heroTarget();
  lastHeroX = state.hero.x; lastHeroY = state.hero.y; userPanning = false;
  if (instant) { camera.x = t.x; camera.y = t.y; camTween = null; }
  else tweenTo(t);
}

export function initRenderer(canvasEl, tapHandler) {
  canvas = canvasEl;
  onTap = tapHandler;
  ctx = canvas.getContext('2d');
  reduceMotion = matchMedia('(prefers-reduced-motion:reduce)').matches;
  resize();
  window.addEventListener('resize', resize);
  bindPointer();
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  VW = Math.max(1, rect.width); VH = Math.max(1, rect.height);
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(VW * DPR);
  canvas.height = Math.round(VH * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);   // reinicia y escala (evita acumular)
  if (state.cols) { camera.x = clampX(camera.x); camera.y = clampY(camera.y); }
}

function bindPointer() {
  let p = null;
  canvas.addEventListener('pointerdown', e => {
    if (state.busy || anim.active()) return;
    canvas.setPointerCapture(e.pointerId);
    p = { id: e.pointerId, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, moved: false };
  });
  canvas.addEventListener('pointermove', e => {
    if (!p || e.pointerId !== p.id) return;
    const dx = e.clientX - p.lx, dy = e.clientY - p.ly;
    if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 8) {
      p.moved = true; userPanning = true; camTween = null;
      camera.x = clampX(camera.x - dx); camera.y = clampY(camera.y - dy);
    }
    p.lx = e.clientX; p.ly = e.clientY;
  });
  const finish = e => {
    if (!p || e.pointerId !== p.id) return;
    if (!p.moved) {
      const rect = canvas.getBoundingClientRect();
      const lx = (e.clientX - rect.left) + camera.x;
      const ly = (e.clientY - rect.top) + camera.y;
      const gx = Math.floor(lx / TILE), gy = Math.floor(ly / TILE);
      if (gx >= 0 && gy >= 0 && gx < state.cols && gy < state.rows) {
        if (gx === state.hero.x && gy === state.hero.y) centerOnHero(false);
        else onTap(gx, gy);
      }
    }
    userPanning = false; p = null;
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', () => { userPanning = false; p = null; });
}

export function startLoop() { requestAnimationFrame(loop); }
function loop(ts) { pulse = ts / 1000; draw(ts); requestAnimationFrame(loop); }

function updateCamera(ts) {
  if (!userPanning && (state.hero.x !== lastHeroX || state.hero.y !== lastHeroY)) {
    lastHeroX = state.hero.x; lastHeroY = state.hero.y; tweenTo(heroTarget());
  }
  if (camTween) {
    const e = easeInOut(Math.min(1, (ts - camTween.t0) / camTween.dur));
    camera.x = camTween.fromX + (camTween.toX - camTween.fromX) * e;
    camera.y = camTween.fromY + (camTween.toY - camTween.fromY) * e;
    if (e >= 1) camTween = null;
  }
}

function disc(cx, cy, r, fill) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); }
function ring(cx, cy, r, color, w) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke(); }
function glyph(cx, cy, ch, color, size) {
  ctx.fillStyle = color; ctx.font = `bold ${size}px Georgia, serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ch, cx, cy);
}

function drawActor(name, sheet, gx, gy, ts, fallback) {
  const a = anim.resolve(name, gx, gy, ts);
  const cx = a.cx - camera.x, cy = a.cy - camera.y;
  if (sheet) {
    const size = TILE * 1.28;
    ctx.drawImage(sheet, a.frame * SPRITE_TILE, 0, SPRITE_TILE, SPRITE_TILE, cx - size/2, cy - size*0.6, size, size);
  } else {
    disc(cx, cy + 3, 16, 'rgba(0,0,0,.35)');
    disc(cx, cy, 15, fallback.body); ring(cx, cy, 15, fallback.edge, 2);
    glyph(cx, cy, fallback.mark, fallback.ink, 18);
  }
  if (a.hurt > 0) { disc(cx, cy - 4, TILE * 0.42, `rgba(210,60,50,${0.35 * a.hurt})`); } // destello rojo
}

function draw(ts) {
  if (!state.cols) return;
  const { hero, foe, triggers, tiles, exit } = state;
  updateCamera(ts);
  const camX = camera.x, camY = camera.y;
  ctx.clearRect(0, 0, VW, VH);

  const atlas = images.tiles;
  const x0 = Math.max(0, Math.floor(camX / TILE));
  const y0 = Math.max(0, Math.floor(camY / TILE));
  const x1 = Math.min(state.cols - 1, Math.floor((camX + VW) / TILE));
  const y1 = Math.min(state.rows - 1, Math.floor((camY + VH) / TILE));

  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = x * TILE - camX, py = y * TILE - camY;
    if (!state.explored[y][x]) { ctx.fillStyle = '#05060a'; ctx.fillRect(px, py, TILE, TILE); continue; } // niebla negra
    const value = tiles[y][x];
    if (atlas) {
      ctx.drawImage(atlas, atlasCol(value, x, y) * ATLAS_TILE, 0, ATLAS_TILE, ATLAS_TILE, px, py, TILE, TILE);
    } else {
      ctx.fillStyle = value === 1 ? '#0e1016' : '#1b2029'; ctx.fillRect(px, py, TILE, TILE);
    }
    ctx.strokeStyle = 'rgba(0,0,0,.28)'; ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
    if (!state.visible[y][x]) { ctx.fillStyle = 'rgba(6,8,13,.62)'; ctx.fillRect(px, py, TILE, TILE); } // penumbra
  }

  // Escalera de salida (si ya se ha visto)
  if (exit && state.explored[exit.y][exit.x]) {
    const cx = exit.x * TILE + TILE/2 - camX, cy = exit.y * TILE + TILE/2 - camY;
    const on = state.visible[exit.y][exit.x];
    ring(cx, cy, 15, on ? 'rgba(140,190,210,.9)' : 'rgba(140,190,210,.4)', 2);
    glyph(cx, cy, '▼', on ? '#a9d4e4' : '#5f7d88', 20);
  }

  // Casillas alcanzables (guía). Ocultas al animar/desplazar.
  if (!state.busy && !anim.active() && !userPanning) for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
    const nx = hero.x + dx, ny = hero.y + dy;
    const attack = foe.alive && foe.x === nx && foe.y === ny && state.visible[ny] && state.visible[ny][nx];
    if (walkable(nx, ny) || attack) {
      ctx.strokeStyle = attack ? '#b5443a' : '#e08a3c'; ctx.lineWidth = 2;
      ctx.strokeRect(nx * TILE - camX + 4.5, ny * TILE - camY + 4.5, TILE - 9, TILE - 9);
    }
  }

  // Puntos de evento (si ya se han visto)
  const glow = reduceMotion ? 0.6 : 0.5 + 0.5 * Math.sin(pulse * 2.6);
  for (const tr of triggers) {
    if (tr.used || !state.explored[tr.y][tr.x]) continue;
    const cx = tr.x * TILE + TILE/2 - camX, cy = tr.y * TILE + TILE/2 - camY;
    const on = state.visible[tr.y][tr.x];
    disc(cx, cy, 20, `rgba(224,138,60,${(on ? 0.10 : 0.05) + 0.10 * glow})`);
    ring(cx, cy, 14, on ? 'rgba(224,138,60,0.85)' : 'rgba(224,138,60,0.4)', 2);
    glyph(cx, cy, tr.id === 'cofre' ? '▪' : '◆', on ? '#e08a3c' : '#8a6a44', 20);
  }

  // Enemigo: solo si está a la vista ahora mismo.
  if (foe.alive && state.visible[foe.y] && state.visible[foe.y][foe.x])
    drawActor('foe', images.enemy, foe.x, foe.y, ts, { body:'#b5443a', edge:'#7d2a24', ink:'#2a0f0d', mark:'✕' });

  // Héroe (siempre visible).
  drawActor('hero', images.hero, hero.x, hero.y, ts, { body:'#6f9c5a', edge:'#4d6f3d', ink:'#12200c', mark:'◊' });

  // Números flotantes de daño/curación.
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const f of anim.floatsNow(ts)) {
    ctx.font = 'bold 18px ui-monospace, monospace';
    ctx.globalAlpha = f.alpha;
    ctx.fillStyle = '#000'; ctx.fillText(f.text, f.x - camX + 1, f.y - camY + 1);
    ctx.fillStyle = f.color; ctx.fillText(f.text, f.x - camX, f.y - camY);
    ctx.globalAlpha = 1;
  }
}
