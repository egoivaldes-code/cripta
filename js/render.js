// Capa de dibujo (Canvas 2D). Lee de `state` y pinta; no conoce las reglas.
// Es la ÚNICA parte atada al canvas.
//
// Vista cenital pura (losetas tipo Descent). La casilla tiene un tamaño BASE
// (TILE) que se multiplica por el ZOOM actual; la cámara siempre se guarda en
// coordenadas de MUNDO (sin zoom), así que zoom y cámara no se pisan entre sí.
// La altura de cada casilla se pinta con un tinte y, en los escalones, un
// borde de color: VERDE en el lado alto, ROJO en el lado bajo (estilo Descent).

import { state, elevAt, pathTo, foeAt, blockingTriggerAt, exitAt, adjacent } from './state.js?v=0.21.1';
import { isAITurnActive } from './rules.js?v=0.21.1';
import { TILE, CAMERA_MARGIN, ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT, TOKEN_TALL, HERO_TALL, PROP_TALL } from './config.js?v=0.21.1';
import { images, ATLAS_TILE, SPRITE_TILE } from './assets.js?v=0.21.1';
import * as anim from './anim.js?v=0.21.1';

// Algunos artes vienen dibujados mirando a la izquierda de serie (en vez de a
// la derecha, que es lo que se asume en el resto del código al calcular hacia
// dónde debe mirar un personaje). Aquí se corrige por tipo: -1 = el arte nativo
// mira a la izquierda (hay que invertir el volteo), 1 = ya mira a la derecha.
const NATIVE_FACING = { enemy1: 1, enemy4: 1, enemy5: 1, enemy6: 1, hero: 1 };

function atlasCol(value, x, y) {
  if (value === 1) return 3;
  return (x * 31 + y * 17) % 3;
}

let ctx, canvas, VW = 0, VH = 0, pulse = 0, reduceMotion = false, onTap = () => {};
let gridOn = false;   // rejilla (malla) visible; se puede activar con su botón

// Alterna la malla visible/invisible y devuelve el nuevo estado (true = visible).
export function toggleGrid() { gridOn = !gridOn; return gridOn; }
export function isGridOn() { return gridOn; }

const camera = { x: 0, y: 0 };   // SIEMPRE en coordenadas de mundo (px a zoom 1)
let zoom = ZOOM_DEFAULT;
let camTween = null;
let userPanning = false;
let lastHeroX = -1, lastHeroY = -1;
const easeInOut = (t) => t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2;

// --- conversión mundo <-> pantalla (todo pasa por aquí; el resto no toca `zoom` a mano) ---
export function worldToScreen(wx, wy) { return { x: (wx - camera.x) * zoom, y: (wy - camera.y) * zoom }; }
export function screenToWorld(sx, sy) { return { x: sx / zoom + camera.x, y: sy / zoom + camera.y }; }
export function getZoom() { return zoom; }
function clampZoom(z) { return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)); }

// Clamp por eje en coordenadas de MUNDO: el viewport visible en mundo mide VW/zoom x VH/zoom.
function clampX(v) {
  const w = state.cols * TILE, vw = VW / zoom;
  return w <= vw ? (w - vw) / 2 : Math.max(-CAMERA_MARGIN, Math.min(v, w - vw + CAMERA_MARGIN));
}
function clampY(v) {
  const h = state.rows * TILE, vh = VH / zoom;
  return h <= vh ? (h - vh) / 2 : Math.max(-CAMERA_MARGIN, Math.min(v, h - vh + CAMERA_MARGIN));
}
function heroTarget() {
  const vw = VW / zoom, vh = VH / zoom;
  return { x: clampX(state.hero.x * TILE + TILE/2 - vw/2), y: clampY(state.hero.y * TILE + TILE/2 - vh/2) };
}
function tweenTo(t, dur = 260) { camTween = { fromX: camera.x, fromY: camera.y, toX: t.x, toY: t.y, t0: performance.now(), dur }; }

export function centerOnHero(instant = false) {
  const t = heroTarget();
  lastHeroX = state.hero.x; lastHeroY = state.hero.y; userPanning = false;
  if (instant) { camera.x = t.x; camera.y = t.y; camTween = null; }
  else tweenTo(t);
}

// Centra la cámara en cualquier casilla (se usa para seguir al enemigo que
// le toca actuar durante su turno). No toca userPanning: si el jugador
// arrastra el mapa durante el turno de un NPC, no se le "pelea" la cámara,
// pero al empezar el siguiente turno del héroe vuelve a centrarse en él.
export function centerOnTile(x, y, instant = false) {
  const vw = VW / zoom, vh = VH / zoom;
  const t = { x: clampX(x * TILE + TILE/2 - vw/2), y: clampY(y * TILE + TILE/2 - vh/2) };
  if (instant) { camera.x = t.x; camera.y = t.y; camTween = null; }
  else tweenTo(t);
}

// Aplica un nuevo zoom manteniendo fijo, en pantalla, el punto de mundo bajo (sx,sy).
function zoomAt(sx, sy, newZoom) {
  const before = screenToWorld(sx, sy);
  zoom = clampZoom(newZoom);
  camera.x = before.x - sx / zoom;
  camera.y = before.y - sy / zoom;
  camera.x = clampX(camera.x); camera.y = clampY(camera.y);
}

let hoverGX = -1, hoverGY = -1, hoverIsMouse = false;   // casilla bajo el ratón (PC); en táctil no se usa

// Cursor en PC: puntero (mano) sobre cualquier casilla donde tocar haga algo
// (moverse dentro del alcance, atacar a un enemigo pegado, interactuar con un
// objeto); "agarrar" en el resto, que es el gesto de mover la cámara.
function updateCursor() {
  if (!hoverIsMouse) return;
  let actionable = false;
  if (hoverGX >= 0 && !state.busy && !anim.active() && !isAITurnActive() && !userPanning) {
    const { hero } = state;
    if (hoverGX === hero.x && hoverGY === hero.y) actionable = true;               // recentrar
    else if (foeAt(hoverGX, hoverGY) && adjacent(hero, hoverGX, hoverGY)) actionable = true; // atacar
    else if (state.reach.dist[hoverGY] && state.reach.dist[hoverGY][hoverGX] > 0) actionable = true; // moverse
    else { const tr = blockingTriggerAt(hoverGX, hoverGY) || exitAt(hoverGX, hoverGY); if (tr && Math.max(Math.abs(hero.x-hoverGX),Math.abs(hero.y-hoverGY))<=1) actionable = true; }
  }
  canvas.style.cursor = actionable
    ? "url('./assets/ui/cursor_action.png') 4 4, pointer"
    : (userPanning ? 'grabbing' : 'grab');
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

// --- entrada: arrastrar/tocar con 1 dedo, pellizcar con 2, rueda en PC ---
function bindPointer() {
  const pts = new Map();   // pointerId -> {x,y}
  let p = null;            // seguimiento de 1 dedo (pan / tap)
  let pinch = null;        // { startDist, startZoom, midX, midY }

  function twoPointerInfo() {
    const arr = [...pts.values()];
    const dx = arr[0].x - arr[1].x, dy = arr[0].y - arr[1].y;
    return { dist: Math.hypot(dx, dy), midX: (arr[0].x + arr[1].x) / 2, midY: (arr[0].y + arr[1].y) / 2 };
  }

  canvas.addEventListener('pointerleave', e => {
    if (e.pointerType === 'mouse') { hoverGX = -1; hoverGY = -1; updateCursor(); }
  });

  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      p = null;   // dos dedos: se acabó el pan de 1 dedo, empieza el pellizco
      const info = twoPointerInfo();
      const rect = canvas.getBoundingClientRect();
      pinch = { startDist: info.dist, startZoom: zoom, mx: info.midX - rect.left, my: info.midY - rect.top };
    } else if (pts.size === 1) {
      p = { id: e.pointerId, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, moved: false };
    }
  });

  canvas.addEventListener('pointermove', e => {
    // Vista previa de camino + cursor: solo con ratón real (no con el dedo,
    // que no tiene "hover" y donde tocar ya es la acción).
    if (e.pointerType === 'mouse') {
      hoverIsMouse = true;
      const rect = canvas.getBoundingClientRect();
      const w = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      const gx = Math.floor(w.x / TILE), gy = Math.floor(w.y / TILE);
      if (gx >= 0 && gy >= 0 && gx < state.cols && gy < state.rows) { hoverGX = gx; hoverGY = gy; }
      else { hoverGX = -1; hoverGY = -1; }
      updateCursor();
    }
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pts.size >= 2 && pinch) {
      const info = twoPointerInfo();
      const ratio = info.dist / Math.max(1, pinch.startDist);
      userPanning = true; camTween = null;
      zoomAt(pinch.mx, pinch.my, pinch.startZoom * ratio);
      return;
    }
    if (!p || e.pointerId !== p.id) return;
    const dx = e.clientX - p.lx, dy = e.clientY - p.ly;
    if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 8) {
      p.moved = true; userPanning = true; camTween = null;
      camera.x = clampX(camera.x - dx / zoom); camera.y = clampY(camera.y - dy / zoom);
    }
    p.lx = e.clientX; p.ly = e.clientY;
  });

  const finish = e => {
    pts.delete(e.pointerId);
    if (pinch && pts.size < 2) pinch = null;
    if (p && e.pointerId === p.id) {
      if (!p.moved && !state.busy && !anim.active() && !isAITurnActive() && pts.size === 0) {   // toque limpio
        const rect = canvas.getBoundingClientRect();
        const w = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        const gx = Math.floor(w.x / TILE), gy = Math.floor(w.y / TILE);
        if (gx >= 0 && gy >= 0 && gx < state.cols && gy < state.rows) {
          if (gx === state.hero.x && gy === state.hero.y) centerOnHero(false);
          else onTap(gx, gy);
        }
      }
      p = null;
    }
    if (pts.size === 0) userPanning = false;
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);

  // Rueda del ratón en PC (Ctrl+rueda también, por si el navegador la usa para zoom de página).
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const factor = Math.pow(1.0015, -e.deltaY);
    userPanning = true; camTween = null;
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, zoom * factor);
  }, { passive: false });
}

export function startLoop() { requestAnimationFrame(loop); }
function loop(ts) {
  pulse = ts / 1000;
  try { draw(ts); }
  catch (err) { console.error('Fallo al dibujar (se ignora este fotograma):', err); }
  requestAnimationFrame(loop);   // SIEMPRE se reprograma, aunque draw() falle
}

function updateCamera(ts) {
  if (!userPanning && (state.hero.x !== lastHeroX || state.hero.y !== lastHeroY)) {
    // Distancia real recorrida (con diagonales cuenta como 1 casilla, igual que el sprite):
    // así la cámara tarda lo mismo en llegar que el propio personaje, en vez de adelantarse.
    const steps = Math.max(Math.abs(state.hero.x - lastHeroX), Math.abs(state.hero.y - lastHeroY));
    const dur = Math.min(1400, Math.max(260, steps * 320));
    lastHeroX = state.hero.x; lastHeroY = state.hero.y; tweenTo(heroTarget(), dur);
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
function glyphFor(type) {
  switch (type) {
    case 'chest': return '▪';
    case 'altar': return '◆';
    case 'lever': return '/';
    case 'orb':   return '●';
    case 'table': return '▦';
    case 'trap':  return '▲';
    case 'grave': return '†';
    case 'crypt': return '⌂';
    case 'event': return '!';
    default:      return '?';
  }
}

// Tinte de altura: más claro cuanto más alto, más oscuro cuanto más bajo (relativo a 0).
function elevTint(h, strength = 1) {
  if (h > 0) return `rgba(255,255,255,${Math.min(0.22, h * 0.11) * strength})`;
  if (h < 0) return `rgba(0,0,0,${Math.min(0.38, -h * 0.14) * strength})`;
  return null;
}

function drawActor(name, sheet, gx, gy, ts, fallback, show = true, kind = 'legacy', tall = TOKEN_TALL) {
  const a = anim.resolve(name, gx, gy, ts, kind);   // SIEMPRE avanza la animación...
  if (!show) return;                                 // ...aunque el actor esté en niebla y no se pinte
  const s = worldToScreen(a.cx, a.cy);
  const T = TILE * zoom;
  const size = T * (a.dead ? tall * 0.5 : tall);   // el cadáver se queda a la mitad de tamaño que el personaje vivo
  if (sheet && typeof sheet.width === 'number') {
    // Sistema "legacy": una sola hoja de 4 fotogramas fijos.
    ctx.drawImage(sheet, a.frame * SPRITE_TILE, 0, SPRITE_TILE, SPRITE_TILE,
                  s.x - size/2, s.y + T*0.40 - size, size, size);
  } else if (sheet && sheet[a.clip]) {
    // Personaje con animaciones de verdad: la hoja del clip activo (idle/walk/attack/death),
    // volteada horizontalmente si mira a la izquierda.
    const img = sheet[a.clip];
    const facing = (a.facing || 1) * (NATIVE_FACING[kind] || 1);
    ctx.save();
    ctx.translate(s.x, s.y + T*0.40 - size/2);
    ctx.scale(facing, 1);
    ctx.drawImage(img, a.frame * SPRITE_TILE, 0, SPRITE_TILE, SPRITE_TILE, -size/2, -size/2, size, size);
    ctx.restore();
  } else {
    disc(s.x, s.y + 3, 16*zoom, 'rgba(0,0,0,.35)');
    disc(s.x, s.y, 15*zoom, fallback.body); ring(s.x, s.y, 15*zoom, fallback.edge, 2);
    glyph(s.x, s.y, fallback.mark, fallback.ink, 18*zoom);
  }
  if (a.hurt > 0) disc(s.x, s.y - 4*zoom, T * 0.42, `rgba(210,60,50,${0.35 * a.hurt})`);
}

// Fondo de "vacío" tipo Terraria: se ve por detrás del nivel, en los bordes
// del mapa donde antes solo había negro liso. Se mueve con la cámara pero
// MUY poco (factor 0.15) para dar sensación de profundidad, en vez de ir
// pegado 1:1 al resto del mundo (que se notaría raro, como si fuera parte
// del propio nivel). No escala con el zoom, igual que un fondo de cielo.
// Cada nivel elige cuál usar con `"biome": "forest"` o `"underground"` en su
// JSON (ver data/levels/*.json); si no lo indica, se asume subterráneo (la
// mayoría de mazmorras lo son) — solo El Cementerio es de exterior por ahora.
const VOID_PARALLAX = 0.15;
const VOID_BY_BIOME = { forest: 'void_forest', underground: 'void_underground' };

function drawVoidBackground() {
  const key = VOID_BY_BIOME[state.biome] || VOID_BY_BIOME.underground;
  const img = images[key];
  if (!img || !img.complete || !img.naturalWidth) return;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const offX = ((camera.x * VOID_PARALLAX) % iw + iw) % iw;
  const offY = ((camera.y * VOID_PARALLAX) % ih + ih) % ih;
  for (let y = -offY; y < VH; y += ih) {
    for (let x = -offX; x < VW; x += iw) {
      ctx.drawImage(img, x, y, iw, ih);
    }
  }
  // Un velo oscuro por encima para que no destaque más que el propio nivel
  // (que se dibuja justo a continuación, tapándolo donde exista mapa real).
  ctx.fillStyle = 'rgba(2,3,6,.45)';
  ctx.fillRect(0, 0, VW, VH);
}

function draw(ts) {
  if (!state.cols) return;
  const { hero, triggers, tiles, elev } = state;
  updateCamera(ts);
  ctx.clearRect(0, 0, VW, VH);
  drawVoidBackground();
  const T = TILE * zoom;

  const atlas = images.tiles;
  const bgImg = state.background && images[state.background.key];
  const x0 = Math.max(0, Math.floor(camera.x / TILE));
  const y0 = Math.max(0, Math.floor(camera.y / TILE));
  const x1 = Math.min(state.cols - 1, Math.floor((camera.x + VW/zoom) / TILE));
  const y1 = Math.min(state.rows - 1, Math.floor((camera.y + VH/zoom) / TILE));

  // Si el nivel tiene un fondo pintado a mano, se dibuja UNA vez, estirado a toda
  // la rejilla; si no, se dibujan las losetas del atlas casilla a casilla.
  if (bgImg) {
    const s0 = worldToScreen(0, 0), s1 = worldToScreen(state.cols * TILE, state.rows * TILE);
    ctx.drawImage(bgImg, s0.x, s0.y, s1.x - s0.x, s1.y - s0.y);
  }

  // Pequeño solape entre casillas adyacentes: sin esto, el redondeo de la
  // cámara/zoom deja huecos de menos de 1px entre rellenos contiguos que se
  // ven como una "malla fantasma" (sobre todo en la niebla y la penumbra),
  // independiente de la rejilla real y de si está activada o no.
  const SEAM = 0.75;

  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const s = worldToScreen(x * TILE, y * TILE);
    const value = tiles[y][x];
    if (!bgImg) {
      if (atlas) ctx.drawImage(atlas, atlasCol(value, x, y) * ATLAS_TILE, 0, ATLAS_TILE, ATLAS_TILE, s.x, s.y, T, T);
      else { ctx.fillStyle = value === 1 ? '#0e1016' : '#1b2029'; ctx.fillRect(s.x - SEAM, s.y - SEAM, T + SEAM*2, T + SEAM*2); }
    }
    if (value === 0) {
      // Tinte por altura (más suave sobre fondo pintado, para no tapar el arte).
      const tint = elevTint(elev[y] ? elev[y][x] : 0, bgImg ? 0.55 : 1);
      if (tint) { ctx.fillStyle = tint; ctx.fillRect(s.x - SEAM, s.y - SEAM, T + SEAM*2, T + SEAM*2); }
    }
    if (gridOn && state.visible[y][x]) {
      ctx.strokeStyle = bgImg ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.28)'; ctx.lineWidth = 1;
      ctx.strokeRect(s.x + 0.5, s.y + 0.5, T - 1, T - 1);
    }
    if (!state.visible[y][x]) { ctx.fillStyle = 'rgba(6,8,13,.62)'; ctx.fillRect(s.x - SEAM, s.y - SEAM, T + SEAM*2, T + SEAM*2); } // penumbra
  }

  // Bordes de escalón: el color depende de dónde está el HÉROE ahora mismo, no
  // de qué lado del borde se mire. Si el héroe está más bajo que el lado alto
  // de ese escalón, es una desventaja táctica (ROJO); si ya está a esa altura
  // o más, tiene la ventaja (VERDE). Estilo Descent, pero relativo al jugador.
  const heroElev = elevAt(hero.x, hero.y);
  const bt = Math.max(2, 4 * zoom);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (tiles[y][x] !== 0) continue;
    const h = elev[y] ? elev[y][x] : 0;
    const s = worldToScreen(x * TILE, y * TILE);
    const edges = [[1,0],[-1,0],[0,1],[0,-1]];
    for (const [dx, dy] of edges) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= state.cols || ny >= state.rows || tiles[ny][nx] !== 0) continue;
      const hh = elev[ny] ? elev[ny][nx] : 0;
      if (h === hh) continue;
      const highSide = Math.max(h, hh);
      ctx.fillStyle = heroElev >= highSide ? 'rgba(90,200,90,.9)' : 'rgba(210,70,60,.9)';
      if (dx === 1) ctx.fillRect(s.x + T - bt, s.y + 2, bt, T - 4);
      if (dx === -1) ctx.fillRect(s.x, s.y + 2, bt, T - 4);
      if (dy === 1) ctx.fillRect(s.x + 2, s.y + T - bt, T - 4, bt);
      if (dy === -1) ctx.fillRect(s.x + 2, s.y, T - 4, bt);
    }
  }

  // Rango de movimiento (relleno ámbar) y enemigo atacable.
  if (!state.busy && !anim.active() && !isAITurnActive() && !userPanning) {
    const d = state.reach.dist;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (d[y] && d[y][x] > 0) {
        const s = worldToScreen(x * TILE, y * TILE);
        const isDifficult = state.difficult[y] && state.difficult[y][x];
        ctx.fillStyle = isDifficult ? 'rgba(155,89,182,.28)' : 'rgba(224,138,60,.12)';
        ctx.fillRect(s.x + 2, s.y + 2, T - 4, T - 4);
        ctx.strokeStyle = isDifficult ? 'rgba(155,89,182,.65)' : 'rgba(224,138,60,.5)'; ctx.lineWidth = 1.5;
        ctx.strokeRect(s.x + 3.5, s.y + 3.5, T - 7, T - 7);
      }
    }

    for (const foe of state.foes) {
      if (foe.alive && Math.max(Math.abs(foe.x - hero.x), Math.abs(foe.y - hero.y)) === 1
          && state.visible[foe.y] && state.visible[foe.y][foe.x]) {
        const s = worldToScreen(foe.x * TILE, foe.y * TILE);
        ctx.strokeStyle = '#b5443a'; ctx.lineWidth = 2;
        ctx.strokeRect(s.x + 4.5, s.y + 4.5, T - 9, T - 9);
      }
    }

    // Vista previa del camino (ratón en PC): línea punteada de casilla en
    // casilla hasta donde llegaría el héroe si tocaras ahí ahora mismo.
    if (hoverIsMouse && hoverGX >= 0 && !(hoverGX === hero.x && hoverGY === hero.y) && !foeAt(hoverGX, hoverGY)) {
      const path = pathTo(hoverGX, hoverGY);
      if (path && path.length > 1) {
        ctx.save();
        ctx.strokeStyle = 'rgba(224,138,60,.85)'; ctx.lineWidth = Math.max(2, 2.5 * zoom / ZOOM_DEFAULT);
        ctx.setLineDash([6, 5]); ctx.lineCap = 'round';
        ctx.beginPath();
        path.forEach((p, i) => {
          const c = worldToScreen(p.x * TILE + TILE/2, p.y * TILE + TILE/2);
          if (i === 0) ctx.moveTo(c.x, c.y); else ctx.lineTo(c.x, c.y);
        });
        ctx.stroke();
        ctx.restore();
        const last = path[path.length - 1];
        const c = worldToScreen(last.x * TILE + TILE/2, last.y * TILE + TILE/2);
        ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(3, 3.5 * zoom / ZOOM_DEFAULT), 0, Math.PI*2);
        ctx.fillStyle = 'rgba(224,138,60,.9)'; ctx.fill();
      }
    }
  }

  // Puntos de evento (lápidas, criptas...) — billboard con arte real si lo hay.
  const glow = reduceMotion ? 0.6 : 0.5 + 0.5 * Math.sin(pulse * 2.6);
  for (const tr of triggers) {
    if (tr.walkTrigger) continue;   // ambientación pura: invisible, salta solo al pisar/cruzar
    const isChest = tr.type === 'chest';
    if ((tr.used && !isChest) || !state.explored[tr.y][tr.x]) continue;
    if (tr.type === 'trap' && !tr.revealed) continue;   // invisible hasta que se descubre
    const s = worldToScreen(tr.x * TILE + TILE/2, tr.y * TILE + TILE/2);
    const on = state.visible[tr.y][tr.x];
    const art = tr.sprite ? images[tr.sprite] : null;
    if (art && typeof art.width === 'number') {
      // Objeto estático de una sola imagen (tumba, cripta...).
      const th = (tr.tall || PROP_TALL) * T, w = art.width * th / art.height;
      ctx.save();
      if (!on) ctx.globalAlpha = 0.55;
      ctx.drawImage(art, s.x - w/2, s.y - th + T*0.42, w, th);
      ctx.restore();
    } else if (art) {
      // Objeto con animación de verdad (cofre: idle/open). Una vez abierto
      // (tr.used) se queda congelado en el último fotograma para siempre.
      const propName = `prop:${tr.x}:${tr.y}`;
      const a = anim.resolve(propName, tr.x, tr.y, ts, tr.sprite);
      if (tr.used && !a.opened) anim.openProp(propName, tr.sprite);
      const img = art[a.clip];
      const th = (tr.tall || PROP_TALL) * T, w = img.width * th / img.height;
      ctx.save();
      if (!on) ctx.globalAlpha = 0.55;
      ctx.drawImage(img, a.frame * SPRITE_TILE, 0, SPRITE_TILE, SPRITE_TILE, s.x - w/2, s.y - th + T*0.42, w, th);
      ctx.restore();
    } else {
      disc(s.x, s.y, 20*zoom, `rgba(224,138,60,${(on ? 0.10 : 0.05) + 0.10 * glow})`);
      ring(s.x, s.y, 14*zoom, on ? 'rgba(224,138,60,0.85)' : 'rgba(224,138,60,0.4)', 2);
      glyph(s.x, s.y, glyphFor(tr.type), on ? '#e08a3c' : '#8a6a44', 20*zoom);
    }
  }

  // Salidas (formato nuevo, varias por nivel): mismo trato visual que el
  // resto de objetos — un color si están abiertas, otro (apagado) si siguen
  // bloqueadas a la espera de algo (p.ej. una palanca).
  for (const ex of state.exits) {
    if (!state.explored[ex.y] || !state.explored[ex.y][ex.x]) continue;
    const s = worldToScreen(ex.x * TILE + TILE/2, ex.y * TILE + TILE/2);
    const on = state.visible[ex.y][ex.x];
    const col = ex.blocked ? '#8a5a4a' : '#5aa9c9';
    disc(s.x, s.y, 20*zoom, `rgba(${ex.blocked ? '138,90,74' : '90,169,201'},${(on ? 0.10 : 0.05) + 0.10 * glow})`);
    ring(s.x, s.y, 14*zoom, on ? col : col + '99', 2);
    glyph(s.x, s.y, ex.blocked ? '▮' : '▯', on ? col : '#6a6a6a', 20*zoom);
  }

  // Enemigos: cada uno con su sprite; su animación siempre avanza; se dibuja si está a la vista.
  for (const foe of state.foes) {
    if (!foe.alive && !foe.deathPlaying) continue;   // legacy: desaparece al instante, como siempre
    // El enemigo siempre mira hacia el héroe (dormido o despierto).
    if (foe.alive) {
      const fdx = hero.x - foe.x;
      if (fdx !== 0) anim.face(foe.anim, fdx > 0 ? 1 : -1);
    }
    const vis = state.visible[foe.y] && state.visible[foe.y][foe.x];
    drawActor(foe.anim, images[foe.sprite] || images.enemy, foe.x, foe.y, ts,
              { body:'#b5443a', edge:'#7d2a24', ink:'#2a0f0d', mark:'✕' }, vis, foe.sprite);

    // Marcador de objetivo: el enemigo elegido en las cajas de vida (ui.js).
    if (foe === state.targetFoe && foe.alive && vis && images.target) {
      const s = worldToScreen(foe.x * TILE + TILE/2, foe.y * TILE + TILE/2);
      const markW = T * 0.5, markH = markW * (images.target.height / images.target.width);
      ctx.drawImage(images.target, s.x - markW/2, s.y - T*TOKEN_TALL - markH * 0.55, markW, markH);
    }
  }

  // Héroe (siempre visible).
  // Postura del héroe: guardia si hay un enemigo vivo a 3 casillas o menos (Chebyshev).
  let nearestFoeDist = Infinity;
  for (const foe of state.foes) {
    if (!foe.alive) continue;
    if (!state.visible[foe.y] || !state.visible[foe.y][foe.x]) continue;   // en niebla/sin explorar: no cuenta
    const d = Math.max(Math.abs(foe.x - hero.x), Math.abs(foe.y - hero.y));
    if (d < nearestFoeDist) nearestFoeDist = d;
  }
  if (!anim.isMoving('hero')) anim.setStance('hero', nearestFoeDist <= 3 ? 'combat' : 'peace', 'hero');
  drawActor('hero', images.hero, hero.x, hero.y, ts, { body:'#6f9c5a', edge:'#4d6f3d', ink:'#12200c', mark:'◊' }, true, 'hero', HERO_TALL);

  // Números flotantes de daño/curación.
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const f of anim.floatsNow(ts)) {
    const s = worldToScreen(f.x, f.y);
    ctx.font = `bold ${18*zoom}px ui-monospace, monospace`;
    ctx.globalAlpha = f.alpha;
    ctx.fillStyle = '#000'; ctx.fillText(f.text, s.x + 1, s.y + 1);
    ctx.fillStyle = f.color; ctx.fillText(f.text, s.x, s.y);
    ctx.globalAlpha = 1;
  }
}
