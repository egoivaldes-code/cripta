// Telemetría de Cripta: errores de verdad (para depurar) + eventos sueltos
// de partida (para estadísticas agregadas). Mismo proyecto de Supabase que
// el leaderboard ("cripta-habilidades"), dos tablas nuevas propias:
// `cripta_error_log` y `cripta_events`. A diferencia del leaderboard, estas
// tablas NO son de lectura pública — solo escritura; los datos se consultan
// desde el panel de Supabase (o con la service role), nunca desde el propio
// juego.
//
// Nada de esto debe poder romper ni ralentizar el juego: cualquier fallo de
// red o de Supabase se traga en silencio (try/catch + no esperar respuesta
// antes de seguir jugando).
//
// Privacidad: no hay login ni nada identificable. `sessionId` es un ID
// aleatorio que se genera de nuevo cada vez que se abre el juego (no se
// guarda en localStorage) — sirve para agrupar los eventos de UNA sesión de
// juego entre sí (p.ej. "cuánto tardó esta partida en llegar al jefe"), no
// para reconocer al mismo jugador entre visitas distintas.

const SUPABASE_URL = 'https://tyilsfxqctrgozlchwxc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_iW5vLkuWMvW7Vgoym-RYmw_tvweRYu4';

const sessionId = (crypto && crypto.randomUUID) ? crypto.randomUUID()
  : 'sess-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);

let clientVersion = null;
export function setTelemetryVersion(v) { clientVersion = v; }

function headers() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };
}

function post(table, body) {
  try {
    fetch(`${SUPABASE_URL}/rest/v1/${table}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) })
      .catch(() => {});   // sin conexión, Supabase caído... da igual, nunca debe afectar al juego
  } catch { /* nunca debe reventar el juego por esto */ }
}

// Evita mandar el MISMO error una y otra vez si se repite en bucle (p.ej. un
// error que salta en cada fotograma) — como mucho una vez cada 10s por
// mensaje de error idéntico.
const recentErrors = new Map();
export function logError(message, extra) {
  const key = String(message).slice(0, 200);
  const now = Date.now();
  const last = recentErrors.get(key);
  if (last && now - last < 10000) return;
  recentErrors.set(key, now);
  post('cripta_error_log', {
    session_id: sessionId,
    client_version: clientVersion,
    message: key,
    stack: extra && extra.stack ? String(extra.stack).slice(0, 4000) : null,
    level_name: extra && extra.levelName ? extra.levelName : null,
    extra: extra && extra.data ? extra.data : null,
  });
}

// Engancha window.onerror y las promesas rechazadas sin capturar. Se llama
// una vez al arrancar (ver main.js). `getLevelName` es una función que
// devuelve el nivel actual en el momento del error (closure hacia
// currentLevelName en main.js, que cambia con cada loadLevel()).
export function initErrorCapture(getLevelName) {
  window.addEventListener('error', (e) => {
    logError(e.message || 'Error desconocido', { stack: e.error && e.error.stack, levelName: getLevelName() });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    const message = (reason && reason.message) ? reason.message : String(reason);
    logError('Promesa rechazada: ' + message, { stack: reason && reason.stack, levelName: getLevelName() });
  });
}

// Evento suelto de partida (empezar nivel, morir, ganar, comprar
// habilidad...). `payload` es cualquier objeto plano serializable.
export function logEvent(eventType, payload) {
  post('cripta_events', {
    session_id: sessionId,
    client_version: clientVersion,
    event_type: eventType,
    payload: payload || null,
  });
}
