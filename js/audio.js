// Audio (WebAudio). Efectos = muestras reales (mp3) mezcladas al vuelo; los menús
// usan un pitido suave sintetizado. De fondo: ambiente de bosque en bucle + ulular
// de búho de vez en cuando. En móvil el sonido solo arranca tras tocar -> unlock().

import { VERSION } from './config.js?v=0.21.1';

let ctx, master, fxGain, ambGain;
let ambSource = null, owlTimer = null;
let samplesLoaded = false;
let musicVol = load('cripta.vol.music', 0.6);
let fxVol = load('cripta.vol.fx', 0.7);

const AMB_MIX = 0.7; // el ambiente va algo por debajo del slider de música

function load(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : parseFloat(v); } catch { return def; } }
function save(k, v) { try { localStorage.setItem(k, v); } catch {} }

export function initialMusicVol() { return musicVol; }
export function initialFxVol() { return fxVol; }

// Muestras a decodificar. 'ambience' va en bucle; 'owl' se lanza suelto; el resto, efectos.
const SAMPLE_FILES = ['footsteps', 'swing', 'hit', 'grunt1', 'grunt2', 'crit', 'coins', 'owl', 'ambience', 'combatstart'];
const buffers = {};

// Evento del juego -> cómo suena.
const CUES = {
  move:   { one: 'footsteps', gain: 0.55 },
  attack: { seq: [['swing', 0, 0.9], ['hit', 60, 1.0]] },
  kill:   { seq: [['swing', 0, 0.9], ['crit', 40, 1.0]] },
  hurt:   { pool: ['grunt1', 'grunt2'], gain: 0.9 },
  coins:  { one: 'coins', gain: 0.8 },
  combatstart: { one: 'combatstart', gain: 0.85 },   // entrada en combate (antes era un pitido)
};

export function unlock() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    startAmbience(); if (!owlTimer) scheduleOwl();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.connect(ctx.destination);
  fxGain = ctx.createGain(); fxGain.gain.value = fxVol; fxGain.connect(master);
  ambGain = ctx.createGain(); ambGain.gain.value = musicVol * AMB_MIX; ambGain.connect(master);
  loadSamples().then(() => { startAmbience(); if (!owlTimer) scheduleOwl(); });
}

async function loadSamples() {
  if (samplesLoaded) return;
  samplesLoaded = true;
  await Promise.all(SAMPLE_FILES.map(async name => {
    try {
      const res = await fetch(`./assets/audio/${name}.mp3?v=${VERSION}`);
      const arr = await res.arrayBuffer();
      buffers[name] = await ctx.decodeAudioData(arr);
    } catch (e) { /* si una muestra falla, el juego sigue sin ella */ }
  }));
}

// Ambiente de bosque en bucle continuo.
function startAmbience() {
  if (ambSource || !ctx || !buffers.ambience) return;
  ambSource = ctx.createBufferSource();
  ambSource.buffer = buffers.ambience;
  ambSource.loop = true;
  ambSource.connect(ambGain);
  ambSource.start();
}

// Ulular de búho a intervalos aleatorios (22–52 s).
function scheduleOwl() {
  const wait = 22000 + Math.random() * 30000;
  owlTimer = setTimeout(() => {
    if (ctx && fxVol > 0 && buffers.owl) playBuffer('owl', 0.6, 0);
    scheduleOwl();
  }, wait);
}

export function setMusicVol(v) {
  musicVol = v; save('cripta.vol.music', v);
  if (ambGain) ambGain.gain.value = v * AMB_MIX;
}
export function setFxVol(v) { fxVol = v; save('cripta.vol.fx', v); if (fxGain) fxGain.gain.value = v; }

function playBuffer(name, gain, delayMs) {
  const buf = buffers[name];
  if (!buf) return;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const g = ctx.createGain(); g.gain.value = gain == null ? 1 : gain;
  src.connect(g); g.connect(fxGain);
  src.start(ctx.currentTime + (delayMs || 0) / 1000);
}

// Pitido suave para menús (ui) y momentos sin muestra propia (event, descend).
const BLIP = {
  event:   [660, 0.14, 'sine'],
  descend: [240, 0.30, 'sine'],
  ui:      [520, 0.04, 'square'],
};
function blip(name) {
  const [freq, dur, type] = BLIP[name] || BLIP.ui;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  const t = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  if (name === 'descend') o.frequency.exponentialRampToValueAtTime(90, t + dur);
  o.connect(g); g.connect(fxGain); o.start(t); o.stop(t + dur + 0.03);
}

export function fx(name) {
  if (!ctx || fxVol <= 0) return;
  const cue = CUES[name];
  if (cue) {
    if (cue.one) playBuffer(cue.one, cue.gain, 0);
    else if (cue.pool) playBuffer(cue.pool[Math.floor(Math.random() * cue.pool.length)], cue.gain, 0);
    else if (cue.seq) for (const [n, delay, g] of cue.seq) playBuffer(n, g, delay);
    return;
  }
  blip(name);
}
