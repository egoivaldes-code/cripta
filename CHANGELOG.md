# Changelog

Esquema: `0.X` = cambio grande · `0.X.Y` = cambio pequeño / fix.

## 0.3 — combate táctico por Puntos de Acción (PA)
- Sistema de PA estilo Descent 2 / BG3: 4 acciones por turno. Moverse 1 casilla = 1 PA. Atacar = 2 PA (así, con 4 PA, caben dos ataques seguidos). Interactuar con un objeto cuesta entre 1 y 3 PA según cuál sea.
- HUD con PA visibles (puntitos que se llenan/vacían) y botón "Fin de turno" para pasar voluntariamente.
- Los NPCs usan el mismo sistema de PA pero como presupuesto interno (no se muestra en pantalla): se acercan y atacan según les rinda, pudiendo encadenar ataques igual que el héroe.
- Objetos "mueble" (cofre, altar, palanca, orbe, mesa): ocupan su propia casilla (no se camina sobre ellos); para interactuar hay que estar al lado y pagar su coste en PA.
- Inspección a distancia: si un objeto está a la vista pero lejos, tocarlo da una pista ambigua y gratuita (a veces no aclara si es bueno o malo) para decidir si merece la pena acercarse.
- Nuevo tipo de objeto: trampa. Da pista a distancia igual que el resto; adyacente se puede desarmar (gasta PA); si se camina sobre ella (incluso de paso hacia otro sitio) sin haberla desarmado, se activa sola.
- Incluye el fix de la 0.2.2 (un desajuste de reloj entre el toque y el fotograma podía congelar el juego al mover una sola casilla).

## 0.2.1 — fixes y rango de movimiento
- Fix: arrastrar la cámara y mover al héroe funcionan siempre (la animación del enemigo dentro de la niebla ya no bloqueaba la entrada).
- (Sustituido en 0.3 por el sistema de PA; el rango fijo de 3 casillas ya no existe como tal.)

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
