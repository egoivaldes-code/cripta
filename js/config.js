// Constantes de motor / render / combate. No dependen de los datos de nivel.

export const TILE = 56;        // píxeles por casilla A ZOOM 1x (tamaño base de referencia)
export const SIGHT = 4.5;      // radio de visión del héroe (niebla de guerra)
export const CAMERA_MARGIN = 360; // margen extra (px) para que la cámara no se quede pegada al borde del mapa

// --- cámara / zoom ---
export const ZOOM_MIN = 0.6;   // más alejado
export const ZOOM_MAX = 2.2;   // más cercano
export const ZOOM_DEFAULT = 1.0;

// --- ficha del personaje (cenital puro): alto en fracción de casilla ---
export const TOKEN_TALL = 1.15;  // solo la cabeza asoma a la casilla de arriba
export const PROP_TALL = TOKEN_TALL / 2;  // objetos pequeños (lápidas...): mitad de una persona, sin salirse de su casilla

// --- economía de puntos de acción (PA), estilo Descent/BG3 ---
export const AP_MAX = 4;       // acciones por turno
export const MOVE_COST = 1;    // coste de moverse 1 casilla (llano o bajar)
export const CLIMB_COST = 2;   // coste extra de subir un escalón de altura
export const MAX_CLIMB = 1;    // diferencia de altura máxima cruzable (más = precipicio)
export const DIFFICULT_EXTRA = 1;  // coste extra por entrar en terreno difícil (matorrales, escombros...)
export const ATTACK_COST = 2;  // coste de atacar (depende del arma; por ahora fijo)

// --- versión (fuente única; también se usa para el cache-busting de assets) ---
export const VERSION = '0.5';
