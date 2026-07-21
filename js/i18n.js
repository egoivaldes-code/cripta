// Multiidioma. Carga un archivo data/i18n/<lang>.json y traduce por clave.
// t('log.hitFoe', { dmg: 6 })  ->  "Golpeas al acechador. −6"
// Ningún texto visible debe estar en el código: todo pasa por aquí.

import { VERSION } from './config.js?v=0.17';

let dict = {};
let current = 'es';
const listeners = [];

export function onLangChange(fn) { listeners.push(fn); }

export function initialLang() {
  try { return localStorage.getItem('cripta.lang') || 'es'; } catch { return 'es'; }
}

export async function loadLang(lang) {
  const res = await fetch(`./data/i18n/${lang}.json?v=${VERSION}`);
  dict = await res.json();
  current = lang;
  try { localStorage.setItem('cripta.lang', lang); } catch {}
  document.documentElement.lang = lang;
  listeners.forEach(fn => fn());
}

export function getLang() { return current; }

export function t(key, params) {
  let s = dict[key] != null ? dict[key] : key;
  if (params) for (const k in params) s = s.split(`{${k}}`).join(params[k]);
  return s;
}

// Para mensajes con varias variantes de ambientación (p.ej. "log.hitHero.1",
// "log.hitHero.2"...): elige una al azar entre `count` y la traduce.
// "El esqueleto arquero te golpea con fuerza y te hace 8 de daño" en vez de
// repetir siempre la misma frase.
export function tRandom(baseKey, count, params) {
  const i = 1 + Math.floor(Math.random() * count);
  return t(`${baseKey}.${i}`, params);
}
