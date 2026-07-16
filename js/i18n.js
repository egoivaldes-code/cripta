// Multiidioma. Carga un archivo data/i18n/<lang>.json y traduce por clave.
// t('log.hitFoe', { dmg: 6 })  ->  "Golpeas al acechador. −6"
// Ningún texto visible debe estar en el código: todo pasa por aquí.

let dict = {};
let current = 'es';
const listeners = [];

export function onLangChange(fn) { listeners.push(fn); }

export function initialLang() {
  try { return localStorage.getItem('cripta.lang') || 'es'; } catch { return 'es'; }
}

export async function loadLang(lang) {
  const res = await fetch(`./data/i18n/${lang}.json`);
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
