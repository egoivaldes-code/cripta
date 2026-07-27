// Leaderboard global de Cripta: TOP10 de los tiempos más rápidos en matar al
// Esqueleto Mago (jefe de la cripta), desde que se empieza una partida nueva.
//
// Backend: Supabase, proyecto compartido "cripta-habilidades" (mismo que
// otras apps del usuario — tabla propia `cripta_boss_leaderboard`, con
// políticas RLS que permiten lectura y escritura públicas sin autenticarse
// (no hay usuarios/login en Cripta). No se usa el SDK de supabase-js para no
// añadir una dependencia — el proyecto es vanilla JS sin build step, así que
// hablamos directo con la API REST (PostgREST) vía fetch().
//
// LIMITACIÓN CONOCIDA: al ser una web estática sin servidor propio, no hay
// forma de verificar de verdad que un tiempo enviado es legítimo (alguien
// podría mandar uno falso a mano desde las herramientas de desarrollador).
// Las políticas de la tabla solo comprueban que el nombre y el tiempo estén
// en un rango razonable — no es un sistema antitrampas de verdad.

const SUPABASE_URL = 'https://tyilsfxqctrgozlchwxc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_iW5vLkuWMvW7Vgoym-RYmw_tvweRYu4';
const TABLE = 'cripta_boss_leaderboard';

function headers(extra) {
  return { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, ...extra };
}

// Devuelve hasta 10 filas, ordenadas de más rápido a más lento. Si falla la
// red (sin conexión, Supabase caído...) devuelve un array vacío en vez de
// reventar — el leaderboard es un extra, nunca debe bloquear el juego.
export async function fetchTop10() {
  try {
    const url = `${SUPABASE_URL}/rest/v1/${TABLE}?select=player_name,time_ms,created_at&order=time_ms.asc&limit=10`;
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

// Envía un tiempo nuevo. Devuelve true/false según si se pudo guardar (el
// llamante decide qué hacer si falla — de momento solo avisar sin más).
export async function submitScore(playerName, timeMs, clientVersion) {
  try {
    const url = `${SUPABASE_URL}/rest/v1/${TABLE}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({ player_name: playerName, time_ms: timeMs, client_version: clientVersion }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ¿En qué puesto (1-10) quedaría `timeMs` dentro del TOP10 ya cargado?
// null si no entra en el top 10 (o si el top10 aún no tiene 10 y hay hueco,
// siempre entra). `top10` es el array ya ordenado que devuelve fetchTop10().
export function rankWithinTop10(top10, timeMs) {
  if (top10.length < 10) return top10.filter(r => r.time_ms < timeMs).length + 1;
  const worseThanAll = top10.every(r => r.time_ms <= timeMs);
  if (worseThanAll) return null;
  return top10.filter(r => r.time_ms < timeMs).length + 1;
}

// Formatea milisegundos como mm:ss.d (una cifra decimal, de sobra para un
// speedrun de un solo nivel).
export function formatTime(ms) {
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = (totalSec - m * 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}
