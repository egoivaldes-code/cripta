// Historial de eventos: guarda TODO lo que se va registrando con log()
// (no solo el último mensaje, que es lo único que se ve en el HUD), para
// poder abrir un historial completo y filtrarlo por categoría.
// Categorías: 'combat' (golpes, muertes, entrar/salir de combate),
// 'loot' (oro y objetos conseguidos), 'event' (todo lo demás: historia,
// trampas, avisos de la interfaz...).

const MAX_HISTORY = 300;   // tope para no crecer sin límite en partidas muy largas
export const CATEGORIES = ['combat', 'loot', 'event'];

let history = [];
let onEntryCb = null;

export function onLogEntry(fn) { onEntryCb = fn; }

export function pushHistory(text, category) {
  const entry = { text, category: CATEGORIES.includes(category) ? category : 'event', t: Date.now() };
  history.push(entry);
  if (history.length > MAX_HISTORY) history.shift();
  if (onEntryCb) onEntryCb(entry);
}

export function getHistory(filter = 'all') {
  const list = filter === 'all' ? history : history.filter(e => e.category === filter);
  return list.slice().reverse();   // más reciente primero
}

export function clearHistory() { history = []; }
