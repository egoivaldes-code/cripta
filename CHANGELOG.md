# Changelog

Esquema: `0.X` = cambio grande · `0.X.Y` = cambio pequeño / fix.

## 0.9.1 — el cementerio, completo (fusión con el trabajo del otro chat)
- Este chat había avanzado en paralelo el cementerio (terreno pintado, 7 esqueletos, 2 trampas, salida) y el color de los bordes de altura relativo al héroe, mientras este otro chat avanzaba la 0.8 y la 0.9 (héroe a escena, objetivo e interfaz movible). Esta versión fusiona ambos: parte del código real de la 0.9 y le añade lo que faltaba.
- El cementerio ya tiene sus 7 esqueletos, 2 trampas y una salida (hacia "cripta_prueba"), colocados desde el editor de niveles. El terreno en sí ya coincidía en ambos chats.
- Los bordes de los escalones dejan de ser fijos (antes: lado alto siempre verde, lado bajo siempre rojo). Ahora dependen de dónde está el héroe: si está más bajo que ese escalón, se ve en ROJO (desventaja); en cuanto sube a esa altura o más, el mismo borde pasa a VERDE (ventaja).
- Protección nueva: si una salida apunta a un nivel que todavía no existe (como la actual, hacia "cripta_prueba"), el juego avisa con un mensaje en vez de quedarse colgado.
- Verificado por dentro: nadie cae en un muro, no hay solapes entre héroe/enemigos/trampas/salida, y todo es alcanzable desde el punto de partida.
- Retirado `assets/ui_kit/` del proyecto (era un banco de referencia de iconos sin recortar, pensado solo como consulta puntual, no para vivir en el repo; no lo usaba ningún código).

## 0.9.4 — cofre animado, eventos de ambientación, editor con numeración y arreglos de niebla
- Nuevo objeto animado de verdad: el **cofre** (idle=cerrado, se abre con su propia animación de 4 fotogramas y se queda abierto para siempre). Secuencia al interactuar: el héroe activa/inspecciona primero → se resuelve el evento o tarjeta que tenga (si tiene) → al resolverse, el héroe lootea y el cofre se abre visualmente.
- Primer sistema de "objetos con animación propia" en `anim.js` (`openProp`), reutilizable para futuros props que necesiten abrirse/activarse con su propia hoja de fotogramas.
- Blindaje: interactuar con un objeto que todavía no tiene un evento conectado en `events.json` (p.ej. un "Evento" recién colocado sin enlazar) ya no rompe el juego — muestra un mensaje neutro y no pasa nada más.
- Nuevo tipo de objeto **"Evento"** en el manifiesto: un marcador sin comportamiento propio, pensado para colocar y conectar más adelante.
- Nuevo tipo de disparo para objetos "Evento": `walkTrigger`. Si un trigger lo lleva, no bloquea su casilla y se activa solo al pisarla (como una trampa, pero sin daño) — hasta ahora todos los objetos no-trampa bloqueaban su casilla sin excepción. Además puede llevar `triggerColumn`: en vez de dispararse solo en su casilla exacta, se dispara al cruzar **cualquier casilla de su misma columna**, una sola vez aunque el camino la cruce varias veces en el mismo movimiento.
- Nueva tarjeta narrativa (imagen + texto, sin opciones): se cierra al tocarla. Pensada para momentos de ambientación ("escuchas ruidos...", pistas de lo que hay más adelante) con una ilustración propia y el texto colocado en su hueco de pergamino.
- Las cajas de vida de enemigos ya no aparecen si el enemigo está en niebla de guerra o en zona sin explorar (antes se veían igual estando despiertos aunque no los vieras).
- La guardia de combate del héroe ya no se activa por enemigos ocultos en niebla/zona negra — solo cuenta a los que realmente ves.
- Arreglada (de verdad esta vez) la dirección del esqueleto: su arte venía dibujado mirando hacia la izquierda de serie, al contrario que la convención asumida en el resto del código — por eso el espejo quedaba invertido. Añadida una tabla de corrección por tipo de personaje para este tipo de casos futuros.
- Editor de niveles: Entrada y Salida pasan a ser herramientas separadas y ya admiten colocar varias de cada una (antes era una sola combinada). Todo lo que se coloca por duplicado se numera solo (Cofre 1, Cofre 2, Evento 1, Evento 2, Entrada 1, Entrada 2, Salida 1, Salida 2...), tanto en el propio mapa como en el JSON que se exporta.
- Cementerio actualizado desde el editor: 8º esqueleto añadido, una segunda salida marcada (sin destino decidido aún, así que de momento no hace nada al pisarla) con un hueco nuevo en el muro norte para llegar hasta ella, y "Evento 1" conectado como primer evento de ambientación de prueba (se dispara al cruzar su columna). Verificado de nuevo: sin muros mal puestos, sin solapes, todo alcanzable.

## 0.9.3 — retoques de HUD, rejilla y escala del héroe
- Arreglado: la barra de vida del héroe no bajaba visualmente (aunque el número sí cambiaba). Era un efecto colateral del número dentro de la barra: una regla de color le aplicaba fondo verde también al texto, que tapaba la barra real por encima. El número además se pone en rojo por debajo del 25% de vida.
- La rejilla táctica empieza **apagada** por defecto, y aunque se active, ya no se dibuja sobre casillas en penumbra (solo sobre las que ves directamente).
- Arreglado el desajuste de escala entre las animaciones del héroe: `idlecombat` medía visiblemente más pequeño que `idlepeace`/`caminar`/`activar` (herencia de un reprocesado en otro chat). Reescaladas todas las animaciones a la escala de `idlecombat`.
- Los enemigos (dormidos o despiertos) ahora miran siempre hacia el héroe.
- Cajas de vida de enemigos más grandes y anchas, con una fila reservada encima (buffos) y debajo (debuffos) de la vida, vacías por ahora.
- Nuevo marcador de objetivo, más nítido que el anterior (que se veía mal recortado).
- Arreglado el "teletransporte" del héroe al moverse varias casillas: la cámara perseguía al héroe siempre en 260ms fijos, sin importar cuántas casillas recorriera; si el propio recorrido tardaba más (320ms por casilla), la cámara llegaba antes que el personaje y daba la sensación de salto. Ahora la cámara tarda lo mismo que el recorrido real.
- Reforzado `move`/`movePath` con el mismo "asentado" de posición que ya tenían `atacar`/`golpear`/etc., por si dos acciones llegan a solaparse.
- Reafirmada (y verificada con una prueba) la orientación de los enemigos hacia el héroe.
- Arreglado de verdad el temblor del esqueleto básico en "quieto": el arreglo anterior centraba por el CUERPO ENTERO (incluida la espada), y como el brazo compensaba, el promedio salía centrado aunque la CABEZA se desplazara hasta 8px de un fotograma a otro — eso es lo que se veía como "bailar". Recentrado ahora por la posición real de la cabeza (mucho más estable que el cuerpo completo con un arma que se mueve). Mismo arreglo aplicado a "caminar" y "castear", que tenían el mismo problema.

## 0.9.2 — trampas invisibles, ritmo de la IA y limpieza del HUD
- Documento `AGENTS.md` ampliado con el protocolo anti-desincronización entre chats, el editor de niveles (antes no aparecía), las protecciones de artifacts (prompt/confirm bloqueados) y el protocolo de pruebas obligatorio.
- Las cajas de vida de enemigos ahora muestran su nombre real (p.ej. "Esqueleto") en vez de una etiqueta genérica, y solo aparecen los enemigos ya despiertos/en combate (los dormidos no se ven hasta que despiertan).
- La barra de vida del héroe muestra el valor numérico (p.ej. "18/26") dentro de la propia barra; las de los enemigos no llevan número.
- Nuevo marcador de objetivo (el anterior se veía mal recortado).
- Los turnos de los enemigos ya no parecen instantáneos cuando encadenan varias acciones seguidas (acercarse y atacar, por ejemplo): cada acción espera un poco a que se vea antes de pasar a la siguiente. Se bloquean los toques del jugador mientras la IA está actuando.
- Las trampas son invisibles hasta que el héroe termina un movimiento justo al lado (arriba/abajo/izquierda/derecha; en diagonal no se descubren). Al revelarse, tocarlas abre una tarjeta de confirmación ("¿Intentar desactivar el mecanismo?"): 50% de acierto la quita sin más, 50% de fallo hace la mitad del daño de pisarla. Pisarla directamente sin haberla revelado sigue haciendo el daño completo, como siempre.

## 0.9 — objetivo y interfaz movible
- La vida de los enemigos ya no es una sola barra genérica: cada enemigo vivo tiene su propia caja con su barra de vida, apiladas horizontalmente bajo el botón "Fin de turno".
- Tocar una caja marca a ese enemigo como objetivo: aparece un icono de retícula sobre su cabeza en el mapa.
- Nuevo pool de assets de interfaz estilo Diablo (`assets/ui_kit/`, con índice en `INDEX.md`) para ir sacando piezas en el futuro; el icono de objetivo ya sale de ahí.
- Nueva función "Reposicionar interfaz" (en Ajustes): desbloquea todos los bloques de la interfaz, que se tiñen de verde y se pueden arrastrar donde se quiera (en móvil y PC). Un botón "Aplicar y cerrar" flotante ancla la nueva posición. Se recuerda entre partidas.

## 0.8 — el héroe, a escena
- El héroe es notablemente más grande: la cabeza sobresale bien a la casilla de arriba.
- Los idles (héroe y esqueleto) van más lentos y pausados en general.
- Caminar entre casillas con el héroe ahora es más lento y pausado (solo afecta al héroe, no a los enemigos).
- Arreglado el esqueleto básico: su animación de "quieto" tenía los fotogramas descuadrados (el personaje temblaba de lado a lado); recentrados con la misma técnica ya usada en los sprites del héroe.
- Comprobado: los enemigos despiertos siempre miran hacia el héroe en combate (ya funcionaba, no hacía falta tocar código).
- Nuevo botón (abajo a la derecha, junto a Ajustes y Centrar) para mostrar u ocultar la rejilla táctica.
- Nueva pantalla de novedades al arrancar: muestra las notas de cada versión (de más nueva a más vieja), con scroll propio y un botón "Continuar" anclado arriba que también desbloquea el audio en móvil.

## 0.7 — el héroe cobra vida
- El héroe ya tiene animaciones de verdad: idle normal, idle de combate, transición al entrar en guardia, caminar, dos ataques distintos (se alternan al azar), encajar un golpe, morir, lootear y activar (diferenciados: cofre/tumba/ítem usan lootear; palanca/altar/orbe/mesa usan activar).
- Nueva "postura": el héroe pasa a guardia de combate en cuanto un enemigo vivo queda a 3 casillas o menos, con una animación de transición; vuelve a la postura de paz al alejarse.
- Se guardan también las animaciones de "casteo" y "poción" del héroe, aunque todavía no están enganchadas a ningún efecto de juego.
- Motor de animación ampliado para soportar acciones encadenadas sin que se pisen entre sí (por ejemplo, interrumpir un lootear con un activar).
- Limpieza: retirados los sprites antiguos del héroe y del esqueleto básico que ya no se usaban.

## 0.6 — animaciones de verdad para el esqueleto básico
- Nuevo sistema de animación con nombre (idle, andar, atacar, morir), con distinto número de fotogramas y velocidad cada una; convive con el sistema antiguo de 4 poses (que sigue usando el héroe por ahora).
- El esqueleto básico ("sin arma") ya anda, ataca y muere de verdad, dejando un montón de huesos permanente en el suelo tras la animación de muerte.
- Los otros dos tipos de esqueleto (espada y escudo / con armadura) quedan reservados para más adelante como enemigos más fuertes; de momento el cementerio solo usa el esqueleto básico.
- Se guarda también la animación de "casteo" del esqueleto, aunque todavía no está enganchada a ningún efecto de juego.
- Nuevo `data/manifest.json`: lista de monstruos/objetos disponibles en esta versión, pensada para que el editor de niveles la lea en directo sin tener que regenerar la herramienta cada vez que cambie el contenido.
- Los sprites de animación se giran automáticamente según hacia dónde se mueve o ataca el personaje (antes solo cambiaba de pose).

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
