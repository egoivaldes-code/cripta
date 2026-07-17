# Changelog

Esquema: `0.X` = cambio grande · `0.X.Y` = cambio pequeño / fix.

## 0.5 — cenital puro, zoom, altura real y mapas pintados a mano
- Vista cenital pura (se abandona el 2.5D): el cementerio ahora tiene un fondo pintado a mano real, con la rejilla táctica encima.
- Zoom con límites: pellizco de 2 dedos en móvil, rueda del ratón en PC. El punto bajo el dedo/cursor se queda fijo.
- Altura de verdad: subir un escalón cuesta el doble de PA; un desnivel de 2+ es un precipicio infranqueable. Los bordes de las casillas muestran verde (lado alto) y rojo (lado bajo), estilo Descent.
- Terreno difícil (matorrales, escombros...): no bloquea el paso pero cuesta más PA cruzarlo; se marca con un tinte morado.
- Personajes reescalados: solo la cabeza asoma a la casilla de arriba (antes ocupaban más).
- Objetos pequeños (lápidas...) ahora miden la mitad que un personaje y no invaden la casilla de al lado.
- Nueva herramienta de edición de terreno (fuera del juego): permite pintar transitable/obstáculo/elevado/difícil directamente sobre la imagen de cualquier mapa, para preparar niveles fijos con rapidez.
- Por dentro: motor de losetas modulares (tipo Descent, con conectores) listo y probado para futuros niveles ALEATORIOS; el cementerio de esta versión es un mapa FIJO, pero ambos sistemas conviven.
- Aparcado: la cripta isométrica (arte antiguo) deja de cargarse por ahora, ya que el cementerio usa su propio fondo pintado; se retomará con arte a juego cuando toque.

## 0.4.1 — fix del desfase enemigo/casilla
- Arreglado: cuando un enemigo se acercaba y atacaba en el mismo turno, el muñeco se quedaba clavado en la casilla anterior mientras el recuadro rojo (su casilla real) ya estaba en la nueva. Ahora el sprite se asienta en su casilla correcta antes de atacar, así que muñeco y recuadro coinciden.

## 0.4 — el cementerio
- Nuevo escenario: un cementerio con muro de piedra alrededor, hierba, lápidas y dos criptas, todo con arte pintado a mano (estética Ultima Online).
- 3 esqueletos distintos (sin arma, con espada y escudo, con armadura) que empiezan quietos y despiertan al acercarte; luego van a por ti.
- El motor ahora maneja varios enemigos a la vez.
- Lápidas y criptas son obstáculos que puedes registrar: las tumbas a veces guardan monedas; las criptas están selladas por ahora.
- Se gana al derrotar a los tres esqueletos.
- Personajes en pose fija (idle) que se deslizan por el mapa; las animaciones de andar/atacar/morir llegarán cuando tengamos esos fotogramas.
- Pendiente para la V0.4.1: entrar en las criptas y que se abra el tejado.

## 0.3.2 — movimiento en diagonal y sonido real
- Movimiento en 8 direcciones: además de las 4 rectas, ahora te mueves y atacas también en diagonal. La diagonal cuesta 1 PA (igual que un paso recto), así que cubres más terreno. Los esqueletos también usan las diagonales para acercarse.
- Regla de esquinas: no se puede cruzar en diagonal rozando la esquina de un muro (para rodear una pared se da el paso recto), así el personaje nunca se solapa con las paredes.
- Sonido real (antes eran pitidos): pasos al mover, espadazo + golpe al atacar, espadazo + crítico al rematar, gruñido de dolor (alterna dos) al recibir daño, y monedas al abrir cofres/altares. Los menús mantienen un clic suave.
- Ambiente: fondo de bosque nocturno en bucle + ulular de búho a intervalos aleatorios (22–52 s). El volumen del ambiente va en el slider de "Música"; el resto de efectos, en "Efectos".
- Limpieza: eliminadas carpetas sobrantes de experimentos anteriores (artifacts, lib, scripts) que el juego no usaba.

## 0.3.1 — ajustes de cámara/UI y anticaché
- Cámara: 360px de margen extra alrededor del mapa, así el personaje ya no se queda pegado justo al borde de la pantalla al llegar a una esquina del mapa.
- El botón de turno ahora es un botón de texto "Saltar turno" (antes icono ⏭), colocado justo debajo de la vida en el HUD, sin solapes.
- Número de versión visible en la partida (abajo a la derecha, a la izquierda de Ajustes y Centrar) y en el panel de Ajustes, ambos desde una única fuente (ya no hay que recordar actualizarlo a mano en varios sitios).
- Sistema anticaché: cada archivo (JS, CSS, JSON, imágenes) se carga con un parámetro de versión (`?v=0.3.1`). Al subir una versión nueva, el juego se actualiza solo con una recarga normal — ya no hace falta modo incógnito ni borrar caché a mano.

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
