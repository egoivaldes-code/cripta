// Capa de dibujo (Canvas 2D). Lee de `state` y pinta; no conoce las reglas.
// Es la ÚNICA parte atada al canvas: para migrar a Phaser, reescribe solo esto.

import { state, walkable } from './state.js';
import { TILE } from './config.js';
import { images, ATLAS_TILE, SPRITE_TILE } from './assets.js';
import * as anim from './anim.js';

// Columna del tileset para cada casilla.
// Muro (valor 1) -> col 3. Suelo (valor 0) -> una de 3 variantes,
// elegida por posición para romper la repetición del patrón.
function atlasCol(value, x, y) {
  if (value === 1) return 3;
  return (x * 31 + y * 17) % 3;
}

let ctx, canvas, W, H, pulse = 0, reduceMotion = false, onTap = () => {};

export function initRenderer(canvasEl, tapHandler) {
  canvas = canvasEl;
  onTap = tapHandler;

  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = state.cols * TILE;
  H = state.rows * TILE;
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  canvas.style.aspectRatio = `${state.cols}/${state.rows}`;

  ctx = canvas.getContext('2d');
  ctx.scale(DPR, DPR);
  reduceMotion = matchMedia('(prefers-reduced-motion:reduce)').matches;

  // Toque -> casilla. Convierte píxeles de pantalla a coordenadas del buffer.
  canvas.addEventListener('pointerdown', e => {
    if (state.busy || anim.active()) return;
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * (W / r.width);
    const y = (e.clientY - r.top) * (H / r.height);
    const gx = Math.floor(x / TILE), gy = Math.floor(y / TILE);
    if (gx < 0 || gy < 0 || gx >= state.cols || gy >= state.rows) return;
    onTap(gx, gy);
  });
}

export function startLoop() { requestAnimationFrame(loop); }
function loop(ts) { pulse = ts / 1000; draw(ts); requestAnimationFrame(loop); }

// --- helpers de dibujo ---
function disc(cx, cy, r, fill) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); }
function ring(cx, cy, r, color, w) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke(); }
function glyph(cx, cy, ch, color, size) {
  ctx.fillStyle = color; ctx.font = `bold ${size}px Georgia, serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ch, cx, cy);
}

// Dibuja un actor a partir de su hoja de sprites (o un disco de reserva).
function drawActor(name, sheet, gx, gy, ts, fallback) {
  const { cx, cy, frame } = anim.resolve(name, gx, gy, ts);
  if (sheet) {
    const size = TILE * 1.28;                 // el personaje desborda un poco la casilla
    ctx.drawImage(sheet, frame * SPRITE_TILE, 0, SPRITE_TILE, SPRITE_TILE,
                  cx - size / 2, cy - size * 0.6, size, size);
  } else {
    disc(cx, cy + 3, 16, 'rgba(0,0,0,.35)');
    disc(cx, cy, 15, fallback.body); ring(cx, cy, 15, fallback.edge, 2);
    glyph(cx, cy, fallback.mark, fallback.ink, 18);
  }
}

function draw(ts) {
  const { hero, foe, triggers, tiles } = state;
  ctx.clearRect(0, 0, W, H);

  // Suelo y muros: se pintan desde el tileset. Si no cargó, color plano.
  const atlas = images.tiles;
  for (let y = 0; y < state.rows; y++) for (let x = 0; x < state.cols; x++) {
    const px = x * TILE, py = y * TILE, value = tiles[y][x];
    if (atlas) {
      const sx = atlasCol(value, x, y) * ATLAS_TILE;
      ctx.drawImage(atlas, sx, 0, ATLAS_TILE, ATLAS_TILE, px, py, TILE, TILE);
    } else {
      ctx.fillStyle = value === 1 ? '#0e1016' : '#1b2029';
      ctx.fillRect(px, py, TILE, TILE);
    }
    // Rejilla: junta fina por código (se mantiene nítida a cualquier escala).
    ctx.strokeStyle = 'rgba(0,0,0,.28)'; ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
  }

  // Casillas alcanzables (guía de movimiento). Se ocultan mientras algo anima.
  if (!state.busy && !anim.active()) for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const nx = hero.x + dx, ny = hero.y + dy;
    const attack = foe.alive && foe.x === nx && foe.y === ny;
    if (walkable(nx, ny) || attack) {
      ctx.strokeStyle = attack ? '#b5443a' : '#e08a3c'; ctx.lineWidth = 2;
      ctx.strokeRect(nx * TILE + 4.5, ny * TILE + 4.5, TILE - 9, TILE - 9);
    }
  }

  // Puntos de evento (acento ámbar, brillo suave)
  const glow = reduceMotion ? 0.6 : 0.5 + 0.5 * Math.sin(pulse * 2.6);
  for (const t of triggers) {
    if (t.used) continue;
    const cx = t.x * TILE + TILE / 2, cy = t.y * TILE + TILE / 2;
    disc(cx, cy, 20, `rgba(224,138,60,${0.10 + 0.10 * glow})`);
    ring(cx, cy, 14, 'rgba(224,138,60,0.85)', 2);
    glyph(cx, cy, t.id === 'cofre' ? '▪' : '◆', '#e08a3c', 20);
  }

  // Actores (sprites). El enemigo se pinta primero para que el héroe quede encima.
  if (foe.alive) drawActor('foe', images.enemy, foe.x, foe.y, ts,
    { body: '#b5443a', edge: '#7d2a24', ink: '#2a0f0d', mark: '✕' });
  drawActor('hero', images.hero, hero.x, hero.y, ts,
    { body: '#6f9c5a', edge: '#4d6f3d', ink: '#12200c', mark: '◊' });
}
