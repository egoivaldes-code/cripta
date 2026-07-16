# Changelog

Esquema: `0.X` = cambio grande · `0.X.Y` = cambio pequeño / fix.

## 0.2.1 — fixes y rango de movimiento
- Fix: arrastrar la cámara y mover al héroe funcionan siempre (la animación del enemigo dentro de la niebla ya no bloqueaba la entrada).
- Movimiento por rango: el héroe se mueve hasta 3 casillas por turno, con el área alcanzable resaltada (rodea muros).

## 0.2 — pantalla completa, idiomas, niebla, daño y niveles
- Layout a pantalla completa: el mapa ocupa toda la pantalla y la UI flota en cajas encima.
- Escala de interfaz ajustable (deslizador en Ajustes, se recuerda).
- Ajustes (⚙ abajo-derecha): escala de interfaz, volumen de música y de efectos; efectos de sonido sintetizados.
- Multiidioma español/inglés: todos los textos en `data/i18n/` (nada hardcodeado).
- Cámara: arrastrar para explorar; recentrar con ⌖, tocando la ficha o el HUD; sigue al héroe.
- Mapa grande (casilla de tamaño fijo: en PC se ve más mapa).
- Niebla de guerra estilo AoE2: negro (nunca visto) y penumbra (explorado, sin ver al enemigo).
- Animación de daño: sacudida, destello rojo y números flotantes de daño/curación.
- Encadenar niveles: escalera de salida que carga el siguiente nivel arrastrando vida y oro.

## 0.1 — base jugable
- Arquitectura modular (módulos ES) + eventos y nivel en JSON.
- Tileset propio (suelo con variantes + muro).
- Sprites animados de héroe y enemigo (quieto, paso dcha/izq, ataque).
- Turnos, movimiento, combate y cartas de evento en HTML.
