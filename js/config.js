// Constantes de motor / render / combate. No dependen de los datos de nivel.

export const TILE = 56;        // píxeles por casilla A ZOOM 1x (tamaño base de referencia)
export const SIGHT = 6.5;      // radio de visión iluminada del héroe (antes 4.5, +2 casillas)
export const SIGHT_DIM = SIGHT + 4;  // más allá, hasta aquí se ve en penumbra (niebla); más lejos, negro sin explorar
export const CAMERA_MARGIN = 360; // margen extra (px) para que la cámara no se quede pegada al borde del mapa

// --- cámara / zoom ---
export const ZOOM_MIN = 0.6;   // más alejado
export const ZOOM_MAX = 2.2;   // más cercano
export const ZOOM_DEFAULT = 1.0;

// --- ficha del personaje (cenital puro): alto en fracción de casilla ---
export const TOKEN_TALL = 1.15;  // tamaño base de un personaje (enemigos, etc.)
export const HERO_TALL = 1.58;   // el héroe va grande: la cabeza asoma a la casilla de arriba (bajado un punto desde 1.70)
export const PROP_TALL = TOKEN_TALL / 2;  // objetos pequeños (lápidas...): mitad de una persona, sin salirse de su casilla

// --- economía de puntos de acción (PA), estilo Descent/BG3 ---
export const AP_MAX = 4;       // acciones por turno
export const MOVE_COST = 1;    // coste de moverse 1 casilla (llano o bajar)
export const CLIMB_COST = 2;   // coste extra de subir un escalón de altura
export const MAX_CLIMB = 1;    // diferencia de altura máxima cruzable (más = precipicio)
export const DIFFICULT_EXTRA = 1;  // coste extra por entrar en terreno difícil (matorrales, escombros...)
export const ATTACK_COST = 2;  // coste de atacar (depende del arma; por ahora fijo)

// --- iniciativa (orden de turnos en combate) ---
// Cada tipo tiene un valor base; al entrar en combate se le suma una tirada de
// 1 a 6 (una sola vez por escaramuza, no cada ronda). El equipo del héroe podrá
// sumar un bonus aparte más adelante (hero.initiativeBonus, de momento en 0).
export const INITIATIVE_DIE = 6;
export const INITIATIVE_BASE = {
  hero: 8,
  enemy1: 6,   // esqueleto básico: lento
  enemy4: 9,   // arquero: rápido
  enemy5: 5,   // espectro: lento, pesado
  enemy6: 7,   // mago: medio
};
export const TURN_DELAY = 1000;  // ms de pausa entre el fin de un turno y el siguiente (héroe y NPCs)
export const COMBAT_ENTER_DELAY = 1000;  // ms de respiro al entrar en combate, antes de congelar el juego

// --- versión (fuente única; también se usa para el cache-busting de assets) ---
export const VERSION = '0.15';
