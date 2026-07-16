// Constantes de motor / render / combate. No dependen de los datos de nivel.

export const TILE = 56;        // píxeles por casilla (tamaño FIJO: en PC se ve más mapa)
export const SIGHT = 4.5;      // radio de visión del héroe (niebla de guerra)
export const CAMERA_MARGIN = 360; // margen extra (px) para que la cámara no se quede pegada al borde del mapa

// --- economía de puntos de acción (PA), estilo Descent/BG3 ---
export const AP_MAX = 4;       // acciones por turno
export const MOVE_COST = 1;    // coste de moverse 1 casilla
export const ATTACK_COST = 2;  // coste de atacar (depende del arma; por ahora fijo)

// --- versión (fuente única; también se usa para el cache-busting de assets) ---
export const VERSION = '0.3.1';
