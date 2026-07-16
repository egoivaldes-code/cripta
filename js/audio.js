// Audio ligero (WebAudio). Los efectos se sintetizan al vuelo (no hay archivos).
// La música aún no tiene pista: su volumen se guarda para cuando la añadamos.
// En móvil el audio solo puede arrancar tras una interacción -> unlock().

let ctx, master, musicGain, fxGain;
let musicVol = load('cripta.vol.music', 0.6);
let fxVol = load('cripta.vol.fx', 0.7);

function load(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : parseFloat(v); } catch { return def; } }
function save(k, v) { try { localStorage.setItem(k, v); } catch {} }

export function initialMusicVol() { return musicVol; }
export function initialFxVol() { return fxVol; }

export function unlock() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.connect(ctx.destination);
  musicGain = ctx.createGain(); musicGain.gain.value = musicVol; musicGain.connect(master);
  fxGain = ctx.createGain(); fxGain.gain.value = fxVol; fxGain.connect(master);
}

export function setMusicVol(v) { musicVol = v; save('cripta.vol.music', v); if (musicGain) musicGain.gain.value = v; }
export function setFxVol(v) { fxVol = v; save('cripta.vol.fx', v); if (fxGain) fxGain.gain.value = v; }

// [frecuencia, duración, forma de onda]
const BLIP = {
  move:    [330, 0.05, 'triangle'],
  hit:     [150, 0.12, 'sawtooth'],
  event:   [660, 0.14, 'sine'],
  descend: [240, 0.30, 'sine'],
  ui:      [520, 0.04, 'square'],
};

export function fx(name) {
  if (!ctx || fxVol <= 0) return;
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
