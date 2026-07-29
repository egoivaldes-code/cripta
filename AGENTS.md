# AGENTS.md — guía rápida para trabajar en Cripta

Este archivo es para que cualquier IA (o persona) que abra este proyecto por
primera vez entienda rápido cómo está montado, sin tener que releer todo el
código. Si cambias algo estructural (arquitectura, convenciones, herramientas
nuevas), actualiza también este archivo.

## ⚠️ Protocolo anti-desincronización (léelo primero, en serio)

El usuario a veces trabaja el mismo proyecto en **varios chats en paralelo**.
Ya ha pasado una vez que dos chats avanzaran versiones distintas desde el
mismo punto (uno hizo 0.7.1→0.7.3 con el cementerio y la altura relativa;
otro hizo 0.8→0.9 con el héroe a escena y la interfaz movible) sin que
ninguno de los dos supiera del otro, y hubo que fusionar a mano.

Para no repetirlo:

1. **Al empezar a trabajar en una versión nueva, pregunta primero si esta es
   la última realmente subida al repo**, sobre todo si el usuario lleva un
   rato sin mandar un zip nuevo o si retoma la conversación tras una pausa
   larga. Un simple "¿esto sigue siendo lo último o has tocado algo en otro
   chat?" ahorra mucho lío.
2. **Si el usuario sube un zip nuevo diciendo "vamos por la X.X"**, trátalo
   como la fuente de verdad: compara con lo que tengas en local (`diff -rq`),
   identifica qué cambió, y fusiona explícitamente lo que solo exista en tu
   copia hacia esa base nueva. No asumas que tu copia estaba al día.
3. **Este archivo (`AGENTS.md`) y `CHANGELOG.md` son el punto de partida
   seguro.** Si te incorporas a este proyecto sin más contexto, léelos
   enteros antes de tocar nada. Mantenlos actualizados según avances: si
   creas una herramienta, una convención o una protección nueva, se anota
   aquí en el mismo turno en que la creas, no "para luego".
4. Después de fusionar o de cualquier cambio de bulto, **corre la batería de
   pruebas de conectividad/solapes** (ver más abajo) sobre el resultado final
   antes de empaquetar, aunque ya la hubieras corrido antes en una rama
   distinta.

## Qué es esto

Cripta es un juego de rol táctico cenital (rejilla, estilo Descent 2), con
eventos de decisión en HTML, para **móvil y PC**, **multiidioma** (es/en).
Web estática (HTML/CSS/JS con **módulos ES nativos, sin build step**),
alojada en GitHub Pages (`egoivaldes-code/cripta`). El usuario trabaja desde
el móvil, no programa, y no conoce jerga técnica — cualquier explicación va
en español llano.

De cara al futuro: la idea es que compilarlo a app (Capacitor/Electron,
.apk/.exe) sea solo cambiar el "launcher" alrededor y pegar estos mismos
archivos, sin tocar el juego en sí. Por eso: **rutas siempre relativas**,
nunca nada atado a un dominio o a GitHub Pages, y toda la carga de datos vía
`fetch()`/`import` normal (nada de asumir `file://`).

## El editor de niveles (herramienta aparte, fuera del juego)

Existe un archivo HTML independiente (`cripta_editor_niveles.html`, generado
por Claude, NO vive en el repo del juego) que el usuario abre en su móvil
para preparar niveles sin escribir código. No es parte del juego: es un
artifact que se regenera cada vez que hace falta ampliarlo.

**Qué hace:**
- Pinta terreno sobre la imagen real de un mapa (transitable / obstáculo /
  elevado / difícil), casilla a casilla.
- Coloca/quita héroe, enemigos (con desplegable de tipo), y objetos (tumba,
  cofre, altar, palanca, orbe, mesa, ítem, trampa, entrada/salida).
- Permite subir mapas nuevos (calcula sola la rejilla a partir de una celda
  "cómoda", sin depender de que el tamaño de casilla encaje exacto en píxeles).
- Todo se guarda solo (persistent storage del artifact), incluidos los mapas
  subidos.
- Lee `data/manifest.json` **en directo** desde la web publicada
  (`egoivaldes-code.github.io/cripta/data/manifest.json`) para saber qué
  enemigos/objetos existen en la versión actual, con una copia de respaldo
  embebida por si no hay conexión. Así, cuando se añade un monstruo u objeto
  nuevo al juego, solo hay que actualizar ese único archivo — no hay que
  regenerar la herramienta entera cada vez.

**Flujo de trabajo:**
1. El usuario pinta/coloca en la herramienta.
2. Pulsa "Exportar" → "Copiar JSON" → pega el resultado en el chat.
3. Claude convierte ese JSON (`grid` + `entities`) al formato real de
   `data/levels/<nombre>.json` (tiles/elev/difficult/background/start.hero/
   start.foes/triggers/exit), y **siempre** corre la batería de pruebas de
   conectividad antes de dar nada por bueno (ver más abajo).

**Numeración de entidades**: cada objeto colocado por duplicado (cofre,
evento, tumba, entrada, salida...) se numera solo en el propio mapa y en el
JSON exportado (`Cofre 1`, `Cofre 2`...), calculado por orden de colocación
dentro de su mismo tipo (y subtipo, en el caso de los enemigos). El héroe no
se numera (siempre hay uno). Entrada y Salida son herramientas separadas y
ambas admiten varias unidades — desde la V0.19 el motor real también soporta
**varias salidas por nivel** (`state.exits[]`, formato "mueble": ocupa su
casilla, se interactúa desde al lado, opcionalmente `blocked`), además del
formato antiguo de una sola salida (`level.exit`, que Cripta/Mausoleo1/
Mausoleo2/level2 siguen usando sin problema — el motor acepta los dos).

**Objetos sin evento conectado**: el motor real (`rules.js`) comprueba si
existe `state.events[tr.id]` antes de abrir la tarjeta; si un objeto (p.ej.
un "Evento" recién colocado, o un cofre al que aún no le has puesto datos en
`events.json`) no tiene nada conectado, se muestra un mensaje neutro y no
pasa nada más — no revienta el juego. Ten esto en cuenta al añadir objetos
nuevos desde el editor: colócalos primero, pruébalos si quieres, y dile a
Claude qué debe pasar en cada uno cuando quieras conectarlos de verdad.

**Objetos que no bloquean y se disparan solos (`walkTrigger`)**: por defecto,
cualquier trigger que no sea una trampa bloquea su casilla (hay que
interactuar desde al lado). Si un trigger concreto lleva `walkTrigger:true`
en el nivel, se comporta como una trampa (no bloquea, se activa solo al
pisarlo) pero sin el mecanismo de daño/desarme — el efecto lo decide
`triggerWalkEvent()` en `rules.js` según `state.events[tr.id].type`. Se usa
para eventos de ambientación (tarjeta con imagen + texto, sin opciones, se
cierra al tocarla — ver `openStoryCard`/`renderStoryCard` en `ui.js`), pero
sirve para cualquier cosa que deba dispararse sola al pasar por encima.

**Protecciones importantes descubiertas al construirla** (aplican a
cualquier artifact HTML que se construya para este proyecto):
- **`prompt()`, `confirm()` y `alert()` nativos del navegador NO funcionan**
  dentro del entorno donde corren los artifacts (sandboxed iframe, sin
  `allow-modals`). Si necesitas pedir texto o confirmar algo, hay que
  construir un modal propio con HTML/CSS/JS (ver `#modalBack`/`#modalBox` en
  la herramienta como referencia). Un `prompt()` ahí simplemente no hace
  nada — no falla con un error visible, así que este bug puede pasar
  desapercibido si no se prueba explícitamente esa función.
- **Pintar/tocar vs arrastrar cámara**: si un `pointerdown` dispara la acción
  inmediatamente, el primer toque de cualquier intento de arrastre se
  interpreta como pintura. Solución: no actuar hasta `pointerup`, y solo si
  el movimiento desde el `pointerdown` fue menor a un umbral; si se superó,
  se entiende que el usuario quería mover la cámara, no pintar. **Ojo con el
  valor del umbral**: empezó en 10px, pero un toque real con el dedo casi
  siempre tiembla más que eso — con 10px, el editor interpretaba tocar como
  arrastrar y no colocaba nada, sin avisar (no es un error visible, así que
  pasa desapercibido si no se prueba tocando de verdad en un móvil). Subido
  a 20px en la v0.12.4.
- **Layout en móvil**: mejor un `body` en columna flex a pantalla completa
  (`height:100dvh`) con las barras como `flex:none` y el área de mapa como
  `flex:1`, que calcular alturas fijas a mano — se adapta solo si cambia el
  contenido de las barras.

## Novedades del editor (hasta v0.12.6) y del motor (V0.22)

**Editor — mapas incluidos protegidos**: Cementerio, Mausoleo 1 y Mausoleo 2
ahora viven "horneados" dentro del propio archivo HTML (`MAPS.cemetery`,
`MAPS.mausoleo1`, `MAPS.mausoleo2`), no solo en el almacenamiento del
artifact. Esto evita que desaparezcan si Android separa el guardado entre
archivos HTML distintos (ya pasó una vez con Mausoleo 1 y 2). El botón de
borrar mapa está bloqueado para cualquier mapa `builtin:true`, sin excepción,
aunque también sea `custom:true` (necesario para poder calibrar su rejilla).

**Editor — sincronizar desde el juego publicado**: botón "🔄 Actualizar" por
mapa, que descarga `data/levels/<nombre>.json` en vivo y sustituye terreno/
enemigos/objetos/salidas, conservando notas y eventos extra que solo existan
en el editor. Comprueba que `cols`/`rows` coincidan antes de sobrescribir
nada. Útil para refrescar un mapa builtin tras cambios hechos a mano en el
repo (como el recorte de columnas de Mausoleo 2, ver más abajo).

**Editor — `allowDuplicateId`**: el editor exige normalmente IDs únicos por
marcador (`ensureEntityIds` renombra en solitario cualquier duplicado). La
emboscada de Mausoleo 2 necesita justo lo contrario: sus dos puntos
comparten literalmente el mismo id (`mausoleo2_ambush`) a propósito, para que
activar cualquiera de los dos marque ambos como usados. Un trigger/entidad
con `allowDuplicateId: true` queda exento de ese renombrado automático y de
la validación de "ID duplicado" al exportar. Si se añade en el futuro otro
mecanismo con el mismo patrón (un id compartido entre varios marcadores),
usar este mismo campo en vez de inventar otro.

**Editor — calibración de rejilla (`_editorMap`)**: en mapas propios
(`custom:true`), el editor deja ajustar tamaño de celda y desfase X/Y de la
rejilla sobre la imagen real (nudge + botones +/-). Al exportar, si el mapa
tiene calibración, se incluye `_editorMap: {image, width, height, cols, rows,
cellSize, originX, originY}` en el JSON. **Ojo**: los botones de tamaño de
celda recalculan `cols`/`rows` a partir de `w/cellPx` y recortan/rellenan la
rejilla — si se reduce una columna/fila que tenía marcadores, se pierden
(avisa cuántos). Revisar siempre que las dimensiones resultantes sigan
coincidiendo con lo que se quiere publicar antes de pegar el JSON en el
juego.

**Motor — el fondo pintado ya respeta `_editorMap`** (`state.js`/
`render.js`): antes, el motor SIEMPRE estiraba la imagen de fondo completa
para llenar exactamente `cols*TILE × rows*TILE`, dando por hecho que la
imagen, de borde a borde, encajaba con la rejilla sin márgenes. Si el nivel
trae `_editorMap`, ahora se recorta exactamente esa región de la imagen
(`originX, originY, cellSize*cols, cellSize*rows`) antes de estirarla sobre
la rejilla — el mismo recorte que ve el usuario en el editor. Si un nivel no
trae `_editorMap` (los de siempre), se comporta exactamente igual que antes
(compatible hacia atrás). Mausoleo 2 es el primer nivel con esta calibración
real; si el desfase queda ligeramente fuera de los bordes de la imagen
(`originX`/`originY` negativos, o `cellSize*rows` mayor que el alto real),
el canvas simplemente recorta esa parte y se ve un hueco vacío ahí — no
revienta, pero puede notarse visualmente y merece un repaso fino.

**Motor — velocidad de juego centralizada en `config.js`**: `getGameSpeed`/
`setGameSpeed`/`speedMult`/`moveDurationMs` viven en `config.js` (antes el
multiplicador vivía solo dentro de `rules.js` y solo afectaba a las pausas
de la IA, nunca a la animación de movimiento en sí). `anim.js` y `rules.js`
importan estas funciones desde `config.js` para no crear un import
circular entre ellos. `rules.js` sigue exportando `getEnemySpeed`/
`setEnemySpeed` (usadas por `main.js`) como wrappers finos sobre las de
`config.js`, para no tener que tocar `main.js`. Multiplicadores actuales:
`slow: 1.5, normal: 1, fast: 0.2`, con `moveDurationMs()` puesto a un mínimo
de 60ms para que la velocidad rápida no se vea como un salto roto.

**Motor — patrón de "tarjeta cómic con opciones" para mecanismos** (`ui.js`:
`renderLeverCard`, css: `.card.story .storychoices`): mismo molde visual que
la tarjeta narrativa (`openStoryCard`/`.card.story`), pero con kicker/título/
pregunta y botones Sí/No en el hueco de pergamino en vez de solo texto. Se
activa automáticamente si el evento del mecanismo trae `image` (clave
registrada en `assets.js`); si no la trae, sigue funcionando con el menú de
texto plano de siempre — no hace falta tocar el motor para futuras palancas
sin arte todavía, solo añadir `image` en `events.json` cuando la tengan. El
recuadro de texto/opciones se posiciona a mano por porcentajes sobre la
imagen (pensado para ilustraciones con la escena a la izquierda y hueco de
pergamino en blanco a la derecha, como las de ambientación) — si la próxima
imagen tiene el hueco en otro sitio, hay que reajustar esos porcentajes a
ojo (o medir con Python/PIL dónde termina el dibujo, como se hizo para la
palanca del cementerio).

## Novedades V0.32.1 — IA enemiga y foto por zona

**Camino real generalizado (`stepToward`, `rules.js`)**: `approachStep` (que
antes solo sabía ir hacia el héroe) se dividió en `stepToward(foe, ap, tx,
ty)` — genérico, con cualquier destino — y `approachStep(foe, ap)` como
envoltorio fino que llama a `stepToward` con las coordenadas del héroe. El
espectro (`spectreTurn`) usaba en su lugar un cálculo propio y más simple
(solo miraba la casilla vecina inmediata, sin rodear obstáculos de verdad),
lo que le hacía quedarse plantado en cuanto acercarse de verdad exigía un
rodeo. Ahora usa `stepToward` igual que el resto, tanto para ir al héroe
como para ir hacia un aliado (cuando está aislado y busca compañía).

**Nunca pisar la casilla del héroe (`stepToward`)**: fallo real confirmado
con prueba de regresión (se reproducía 10/10 veces con el código viejo). Si
el primer paso del camino calculado cae justo sobre la casilla del héroe
—típicamente porque el enemigo ya está adyacente pero le faltan PA para
atacar/disparar ese turno, y le sobran para "otro paso"— `stepToward`
devuelve `null` en vez de ese paso. Afecta a los 4 usos de `approachStep`
(mago, arquero, golem, cuerpo a cuerpo genérico) de una vez, al estar
centralizado en un único punto.

**Velocidad de IA adaptativa a la cantidad de enemigos activos**:
`crowdSpeedFactor()` (rules.js) mira `state.combat.order` (solo los ya
metidos en la escaramuza, no los dormidos en otra punta del mapa) y aplica
un multiplicador extra a `enemySleep` por debajo del ajuste manual de
velocidad de los Ajustes: 6+ activos → ×0.65, 10+ → ×0.4, 16+ → ×0.25. Pensado
para que Llamada Sepulcral (que reúne a todo lo que pueda del nivel, alcance
sin tocar a petición del usuario) no deje un turno enemigo eterno. No toca
`moveDurationMs()` (eso es la animación de movimiento en sí, compartida con
el héroe) — solo las pausas entre acciones/turnos de la IA.

**Foto por zona (`savegame.js`: `snapshotZone`/`getZoneSnapshot`/
`applyZoneSnapshot`/`clearZoneSnapshots`)**: hueco de arquitectura real, no
un detalle — antes solo existía UN hueco de partida guardada (`SAVE_KEY`,
para la zona activa), así que cambiar de zona (entrar/salir de un
mausoleo) sobrescribía ese hueco y la zona que se dejaba atrás no tenía
dónde quedar guardada; al volver, se recargaba de fábrica (initGame). Ahora
`loadLevel` (main.js) hace lo siguiente en cada cambio de zona:
1. Si había una zona activa distinta de la nueva, `snapshotZone(nombre)` le
   hace una foto (enemigos, triggers, exit/exits, explored, combat,
   targetFoe — todo salvo el héroe, que viaja aparte vía `carry`).
2. Tras `initGame(level, events)` (que deja el nivel de fábrica), si
   `getZoneSnapshot(name)` encuentra una foto previa de esa zona, se aplica
   con `applyZoneSnapshot` — sobrescribiendo lo de fábrica con lo que había
   de verdad.
3. Se llama a `recomputeFog()` otra vez tras posicionar al héroe (por
   `arrive` o por defecto), porque la que hace `initGame()` internamente usa
   la posición de partida del nivel, no la posición final tras `arrive`.

Las fotos se persisten en `localStorage` (`cripta.zoneSnapshots`), separado
de `SAVE_KEY`, así que sobreviven a cerrar la app. `newGame()` (botón
Reiniciar / "reiniciar progreso" de la tienda) llama a
`clearZoneSnapshots()` y pone `currentLevelName = null` antes de cargar
`level1`, para que una partida nueva de verdad no arrastre fotos de zona de
la partida anterior.

**Velo azul en PC (reportado, sin cambios)**: investigado a fondo (color
medio de `void_underground.jpg` comprobado por píxel: es marrón oscuro, no
azul) y descartado por el propio usuario tras pedirle una captura de
pantalla real — la foto que mandó era una foto de móvil a la pantalla del
PC, y el tono azulado era un artefacto de la cámara sobre la niebla de
guerra normal, no un fallo del juego. Sin cambios de código.

**Héroe atascado del todo en terreno difícil/con desnivel, fuera de combate
(`ui.js`, `syncHUD`)**: el botón `#endTurn` (y el contador `#apPips`) se
escondían con `!state.combat.active` a secas — la idea original era que
fuera de combate no hacen falta (el PA se refresca solo al llegar a 0, ver
`walkTo`/`endHeroTurn` en `rules.js`). El hueco: terreno difícil
(`DIFFICULT_EXTRA`) o subir un escalón (`CLIMB_COST`) pueden dejar un resto
de PA que NO es 0 pero tampoco alcanza para ningún paso más (p.ej. 1 PA con
el siguiente paso costando 2) — ese resto nunca dispara el auto-refresco
(que solo mira `ap<=0`), y sin el botón visible no hay ninguna otra forma de
saltar el turno a mano. Root cause puramente de interfaz, no del cálculo de
terreno en sí (revisado a fondo antes de encontrar esto: sin desconexiones
reales en los 4 niveles, ni casillas matemáticamente aisladas). Arreglo:
ambos elementos ahora también se muestran fuera de combate mientras
`hero.ap < hero.apMax` (no solo con combate activo) — `skipTurn()` (main.js)
ya llamaba a `endHeroTurn()` sin mirar el combate, así que solo hacía falta
arreglar la visibilidad, no la lógica de refresco en sí. Probado con una
prueba de extremo a extremo: entrar en una casilla difícil que deja 1 PA de
resto (fuera de combate), confirmar que el botón aparece, confirmar que NO
se puede seguir moviendo con ese resto, pulsar Fin de turno y confirmar que
el PA se refresca y el héroe puede seguir jugando con normalidad.

## Protocolo de pruebas antes de empaquetar (obligatorio)

Antes de dar cualquier cambio de nivel, mapa o lógica de juego por bueno,
verificar con un script de Node (no hace falta navegador para esto) copiando
el módulo relevante y quitando los `?v=X.X` de los imports:

- **Cualquier nivel nuevo o editado**: héroe/enemigos/trampas/salida no caen
  en un muro, no se solapan entre sí, y son alcanzables desde el punto de
  partida (BFS/Dijkstra con las reglas reales de `stepNeighbors`, no un BFS
  ingenuo — la regla de no cortar esquinas en diagonal puede dejar rincones
  inalcanzables que un BFS simple no detectaría).
- **Cambios en `anim.js`**: probar el ciclo completo de cada animación
  (idle en bucle, transición de postura, ataque que vuelve solo a idle,
  golpe que interrumpe correctamente otra acción en curso, muerte que se
  congela para siempre) usando el reloj real (`performance.now()`), no
  marcas de tiempo inventadas — desincronizan el test consigo mismo.
- **Cambios de movimiento/altura**: verificar que subir cuesta más PA, que
  un desnivel de sobra bloquea, y que la diagonal no corta esquinas.
- Repetir la batería completa (no solo el test nuevo) tras cualquier fusión
  entre versiones divergentes, como recuerda el protocolo anti-desincronización.

## Mapa de módulos (`js/`)

Cada archivo tiene una responsabilidad única. Antes de tocar algo, mira aquí
qué módulo le corresponde:

| Archivo | Responsabilidad |
|---|---|
| `config.js` | Constantes: tamaño de casilla, zoom, PA, escala de personajes, **VERSION** (fuente única). |
| `i18n.js` | Carga `data/i18n/<lang>.json` y traduce por clave con `t()`. |
| `assets.js` | Precarga de imágenes y hojas de animación. |
| `state.js` | Estado de la partida, mapa, altura, terreno difícil, niebla de guerra, alcance (Dijkstra). No dibuja ni toca el DOM. |
| `anim.js` | Motor de animación: posición visual por actor, separado de la lógica. Dos sistemas conviven (ver abajo). |
| `render.js` | Todo el dibujo en Canvas: cámara, zoom, tiles, bordes de altura, actores. Es la ÚNICA parte atada al canvas. |
| `rules.js` | Turnos, combate, interacción, IA enemiga. Agnóstico del dibujo. |
| `ui.js` | HUD, cartas de evento, ajustes, fin de partida. Todo el texto pasa por `t()`. |
| `mapgen.js` | Ensamblador de losetas tipo Descent para mapas **aleatorios**. Probado pero sin usar en ningún nivel activo (reserva para el futuro). |
| `main.js` | Punto de entrada: carga idioma/datos, cablea módulos, arranca el bucle. |
| `skills.js` | Tienda de habilidades (SISTEMA TEMPORAL de pruebas, ver sección propia más abajo) + barra de acción. Mismo patrón que `inventory.js`: datos + estado + render + interacción en un solo módulo autocontenido. |
| `savegame.js` | Guardado/resume de partida (ver sección propia) + oro persistido. No dibuja ni toca el DOM. |

Datos en `data/`: `events.json` (objetos/eventos), `i18n/es.json` y
`en.json` (todo el texto del juego), `levels/*.json` (mapas), `manifest.json`
(monstruos/objetos disponibles en esta versión, lo lee el editor de niveles
en directo) y `changelog.json` (notas de versión para la pantalla de
novedades al arrancar — distinto del `CHANGELOG.md` de la raíz, que es para
desarrollo).

## Convenciones que hay que respetar siempre

- **Nunca texto hardcodeado.** Todo lo que vea el jugador va en
  `data/i18n/es.json` **y** `en.json`, con la misma clave en los dos. Se
  traduce con `t('clave', {params})`.
- **La versión vive en un único sitio**: `VERSION` en `js/config.js`. De ahí
  sale el `?v=X.X.X` que se añade a todos los `import`, `fetch()` e imágenes,
  para que el navegador no sirva versiones viejas cacheadas.
  **No lo edites a mano**: usa `tools/bump_version.py` (ver más abajo).
- **Esquema de versión**: `V0.XX` para cambios grandes, `V0.XX.X` para
  parches/fixes pequeños. Cada entrega es un `.zip` completo
  (`CriptaV0.XX.zip`) que sustituye entero al proyecto anterior.
- Cada entrega al usuario incluye, aparte del zip: un prompt de Replit
  (que SIEMPRE debe decir explícitamente que descomprima el zip sustituyendo
  los archivos existentes) y un prompt de Jules, copiables enteros por
  separado, y el prompt de Replit debe terminar con el mensaje de commit de
  esa versión.
- **Siempre preguntar antes de empaquetar** el zip final, por si se quiere
  meter algo más en la misma versión.

## El sistema de animación (`anim.js`)

Conviven dos sistemas mientras se migra el arte poco a poco:

- **"legacy"**: el de siempre, una hoja de 4 fotogramas fijos (quieto, paso
  dcha/izq, ataque). Lo siguen usando los tipos que no aparecen en
  `ANIM_CLIPS`.
- **"animado"**: personajes con animaciones de verdad por nombre (`idle`,
  `walk`, `attack`, `death`, etc.), cada una con su número de fotogramas y
  velocidad, definidas en `ANIM_CLIPS`. El héroe además tiene dos idles
  (paz/combate) que cambian solas según haya un enemigo cerca.

Para saber si un tipo de sprite usa animaciones de verdad, mira si aparece
como clave en `ANIM_CLIPS` (en `anim.js`).

**Objetos con animación propia (no personajes)**: el mismo sistema sirve para
props como el cofre (`idle`=cerrado, `open`=se abre y se queda abierto para
siempre). Se usa `anim.openProp(nombre, tipo)` en vez de `anim.die()`, con el
mismo patrón de "se congela en el último fotograma para siempre" (`a.opened`,
paralelo a `a.dying`). El nombre del actor para un objeto de mapa es
`` `prop:${x}:${y}` `` (estable mientras el objeto no se mueva de casilla).
`render.js` dibuja el objeto igual que a un personaje (resolviendo por
`anim.resolve`) si su sprite tiene clips; si es una imagen suelta (tumba,
cripta), sigue el camino estático de siempre.

**Corrección de orientación nativa**: no todo el arte viene dibujado mirando
hacia la derecha por defecto (la convención que asume el resto del código al
decidir hacia dónde debe mirar un personaje). Si un personaje queda mirando
siempre al lado contrario del que debería, antes de tocar la lógica de
`facing`, comprueba si el ARTE en sí mira a la izquierda de serie — en ese
caso, el arreglo es añadir una entrada a `NATIVE_FACING` en `render.js`
(no tocar `anim.js`, que calcula la dirección "lógica" correctamente; el
problema está solo en cómo se traduce esa dirección al volteo del dibujo).

## Técnica: procesar hojas de animación nuevas (Nano Banana → juego)

El usuario genera arte con Nano Banana (fondo magenta `#FF00FF`, varias poses
en fila). Antes de meterlo al juego, el proceso que ha demostrado ser fiable:

1. **Quitar el magenta** por color (no por transparencia, Nano Banana no la
   da): `r>140 and b>70 and g<115 and (r-g)>55`.
2. **Nunca recortar por ancho igual** (`i*ancho/N`). Las espadas, capas y
   miembros de una pose casi siempre invaden el hueco del vecino, y un corte
   recto se lleva un trozo ajeno o dispersa el propio. En su lugar, **recortar
   por pieza conectada** (`scipy.ndimage.label`): cada figura es su propia
   isla de píxeles. Si el nº de piezas detectadas no coincide con el nº de
   poses esperado, casi siempre es porque dos piezas se tocan (un cruce de
   espadas) — separar visualmente esos casos a mano si hace falta.
3. **Enmascarar, no solo recortar el rectángulo**: al recortar la caja de una
   pieza, poner a transparente cualquier píxel de la caja que pertenezca a
   OTRA etiqueta (puede haber solape de cajas aunque las piezas no se toquen).
4. **Una sola escala para todo el personaje**, nunca "ajustar cada fotograma
   a la misma altura de destino". Si se hace lo segundo, agacharse/alzar la
   espada por encima de la cabeza *cambia el tamaño aparente* del personaje
   entre fotogramas (la pose más alta se ve "más pequeña" al forzarla al
   mismo alto). Se mide la altura del cuerpo en una pose neutral (p.ej. el
   primer fotograma del idle) UNA vez, y esa misma escala se aplica a todos
   los fotogramas de todas las animaciones de ese personaje.
5. Animaciones especiales en 2 filas (p.ej. una secuencia de muerte con
   "de pie" arriba y "tumbado" abajo): la frontera real entre filas casi
   nunca es exactamente la mitad del alto de la imagen; buscarla por la
   franja de filas con cobertura de píxeles ≈0 más cercana a la mitad.
6. Verificación automática antes de mirar nada a ojo: ningún fotograma con
   cobertura de píxeles casi nula (recorte vacío) ni que toque el borde del
   lienzo de 128×128 (indicio de recorte real, salvo que sea justo el borde
   exacto sin perder píxeles — comprobar visualmente ese caso límite).

## Técnica: arreglar sprites que "tiemblan"

Si un personaje oscila de lado a lado durante una animación en bucle (sobre
todo el idle), casi siempre es porque los fotogramas de esa hoja no están
recortados en el mismo sitio dentro de su celda (el centro del personaje
varía de una columna a otra). Se diagnostica y arregla así:

```
python3 tools/recenter_sprite.py assets/sprites/TIPO/CLIP.png --frames N --dry-run
```

Eso enseña el centro (`cx`) y la base (`bottom`) de cada fotograma. Si varían
entre fotogramas que deberían estar alineados, quita `--dry-run` para
recentrar de verdad (ver `tools/recenter_sprite.py` para más opciones, como
`--vertical` si además hay que alinear la base).

**Ojo con centrar por el CUERPO ENTERO cuando hay un arma o un brazo que se
mueve.** Si el personaje sostiene algo (espada, escudo) que se balancea de
un lado a otro entre fotogramas, el centro de la caja del cuerpo ENTERO
puede salir "centrado" de casualidad porque el arma compensa el desplazamiento
real del torso/cabeza — y aun así se ve temblar, porque lo que el ojo
sigue es la cabeza, no el promedio de toda la silueta. Si el arreglo de arriba
no elimina el temblor del todo, mide el centro de solo la CABEZA (la franja
superior del contenido, no toda la caja) fotograma a fotograma, y recentra
por ahí en su lugar. Además: este truco falla en poses que cambian mucho de
postura dentro del mismo clip (una embestida, una caída) — ahí "la cabeza"
puede no ser detectable de forma fiable con una franja fija, y forzar un
recentrado agresivo puede cortar contenido por el borde. Comprueba siempre
cobertura de píxeles y bordes tras recentrar (como en el resto de la hoja) y,
si un fotograma sale mal, mejor no tocarlo que arriesgarse a romperlo.

## Técnica: que los turnos de la IA no parezcan instantáneos

Si una función de turno de enemigo hace varias acciones seguidas (moverse
varias veces, acercarse y atacar) todas en la misma función síncrona, cada
`anim.move()`/`anim.attack()` **pisa** la animación anterior antes de que el
siguiente fotograma llegue a pintarla — visualmente parece que todo pasa
de golpe. La solución es hacer la función de turno `async` y meter un
`await sleep(ms)` entre acción y acción (ver `enemyAITurn` en `rules.js`),
con un flag tipo `aiTurnActive` que bloquee los toques del jugador mientras
tanto (además de los ya existentes `state.busy`/`anim.active()`).

## Referencia de diseño: la IA de movimiento de Descent (Viaje a las Tinieblas)

Descent: Journeys in the Dark (2ª edición) y su app-compañera Road to Legend
(la que hace de "game master" automático) llevan más de una década puliendo
reglas de movimiento e IA para un dungeon crawler por turnos y casillas —
muy parecido a lo que es Cripta. Antes de inventar una regla de movimiento
nueva desde cero, merece la pena mirar aquí primero. Fuente principal: la
Community Rules Reference Guide (CRRG) de Descent 2E, sección "Movement",
"Engage", "Direction" y "Retreat" (descent-community.org).

**Ideas ya adoptadas en Cripta:**

- **"Engage"**: un enemigo que se acerca simplemente pathea hacia el
  objetivo y se para en cuanto queda adyacente o se le acaba el PA. Es
  literalmente `approachStep()` en `rules.js`.
- **Regla de "Toward"**: al acercarse, una figura puede alejarse *un
  momento* del objetivo si el resultado final la deja más cerca (rodear un
  muro). Por eso `approachStep`/`findPath` usan Dijkstra real y no "dar
  siempre el paso que acerca en línea recta", que se atasca en cualquier
  esquina.
- **Atravesar aliados, pero no terminar encima de ellos**: en Descent, una
  figura puede *pasar a través* de casillas ocupadas por figuras aliadas al
  moverse — solo no puede *acabar* su movimiento ahí. Cripta lo implementa
  en `stepNeighbors(x, y, passFoes)` (`state.js`): con `passFoes=true`, los
  enemigos vivos no bloquean el paso, solo el terreno/objetos de verdad.
  `findApproachPath()` calcula así el camino MÁS CORTO real "como si los
  aliados no estuvieran" y lo recorta justo antes del primer aliado que
  encuentra de verdad — así, en un pasillo estrecho (recto o con esquinas),
  el enemigo se coloca en la mejor posición real posible (típicamente,
  justo detrás de su compañero) en vez de quedarse quieto sin más. Antes de
  esto, un enemigo bloqueado por otro en el único paso hacia el héroe se
  congelaba sin hacer nada (bug real, arreglado en v0.17/v0.18).
- **Huir rompiendo línea de visión, no solo maximizando distancia**: la
  condición "Terrified" de Descent hace que el monstruo termine su
  movimiento *fuera de la vista* del objetivo con prioridad sobre
  simplemente alejarse el máximo posible. `fleeStep()` en `rules.js` le da
  a esconderse detrás de una esquina un bonus de puntuación (+500) muy por
  encima de lo que puede aportar la distancia bruta, así que un arquero
  prefiere una casilla más cercana pero oculta a otra más lejana pero a la
  vista. Ojo con el efecto secundario que esto destapó: si el enemigo huye
  y queda sin línea de visión, la siguiente comprobación del propio turno
  ("lejos o sin visión: acercarse") deshacía la huida en el mismo turno —
  hay que recordar con una bandera (`fledThisTurn`) que ya ha huido este
  turno y no dejar que la lógica de "acercarse para recuperar visión" lo
  contradiga en la misma activación.

**Ideas que todavía NO están implementadas, por si hacen falta más adelante:**

- **Selección de objetivo por prioridad + desempate por distancia**: con
  varios héroes o aliados jugables, Road to Legend elige objetivo según una
  prioridad fija por tipo de monstruo (p.ej. "el que más daño ha recibido"),
  y solo si hay empate elige al más cercano. Útil el día que haya más de un
  personaje controlable.
- **Lista de acciones por prioridad, con "saltar si no aplica"**: cada tipo
  de monstruo en Road to Legend tiene una lista ordenada de acciones
  candidatas (atacar, usar habilidad, moverse...); se recorre de arriba a
  abajo, se salta lo que no se puede hacer, y se repite hasta agotar las
  acciones del turno. Es un árbol de comportamiento simple pero muy
  legible — podría ser una forma más mantenible de reescribir
  `meleeTurn`/`archerTurn`/`spectreTurn`/`mageTurn` como datos (una lista de
  reglas por tipo) en vez de código imperativo a medida, si el roster de
  enemigos crece mucho más.
- **"Blocked space" también bloquea línea de visión para el propio
  monstruo**: Descent distingue explícitamente cuándo un espacio bloquea
  movimiento, línea de visión, o ambos (muros bloquean los dos; figuras
  aliadas solo el movimiento para terminar ahí, no la línea de visión). Si
  Cripta añade más tipos de terreno especial, merece la pena mantener esa
  misma distinción explícita en vez de un único concepto de "bloqueado".

## Subir de versión

```
python3 tools/bump_version.py 0.9          # cambio grande
python3 tools/bump_version.py 0.8.2        # parche pequeño
```

Esto actualiza `VERSION`, `js/config.js` y todos los `?v=` del proyecto de
una sola vez. Después, a mano: escribe el contenido de `CHANGELOG.md` (dev)
y `data/changelog.json` (splash del juego, en es/en) para esa versión.

## Qué NO hacer sin comentarlo antes

- No añadir un bundler/build step (rompe el "sin build step" y complica
  Replit). Si algún día compensa por el tamaño del proyecto, coméntalo
  primero.
- No reestructurar carpetas de `js/` en subcarpetas mientras el proyecto sea
  de este tamaño (~2000 líneas): con 10 módulos de una sola responsabilidad
  cada uno, ya está razonablemente organizado.
- No asumir rutas absolutas ni nada específico de GitHub Pages (de cara a
  Capacitor/Electron más adelante).

## Guardado de partida (junto a la tienda de habilidades)

Desde la v0.20, cerrar la app a mitad de una mazmorra y volver a abrirla
**retoma exacto donde se dejó**: mismo nivel, posición, vida, PA restantes,
enemigos vivos/muertos, niebla explorada y el orden de combate en curso. Vive
en `js/savegame.js`, aparte de `state.js`/`rules.js` a propósito (mismo
espíritu que `skills.js`): guarda/restaura el estado por fuera, sin que el
motor necesite saber que existe un sistema de guardado.

**Qué se guarda y qué no:** todo lo DINÁMICO de `state` (héroe completo,
enemigos, triggers, salidas, niebla explorada, combate/targetFoe). Lo
ESTÁTICO de cada nivel (tiles, elevación, terreno difícil, `events.json`) NO
se guarda — se vuelve a cargar siempre desde `data/levels/<nivel>.json` y el
guardado se aplica ENCIMA. El inventario de equipo no se guarda aparte
porque, de momento, solo refleja el oro (no hay objetos de verdad todavía);
en cuanto haya equipo real habrá que añadirlo aquí.

**El oro es la única excepción**: vive en su propia clave (`cripta.gold`),
separada de la partida guardada (`cripta.save`), y es **un único número
compartido de verdad** entre la tienda de habilidades y `state.hero.gold` —
nunca dos bolsas distintas. Por eso sobrevive a un "Reiniciar partida" (que
sí borra la mazmorra en curso) y por eso lo que se gana o gasta dentro de la
mazmorra ya está disponible la próxima vez que se abre la tienda.

**Cuándo se guarda** (para que cerrar la app en cualquier momento pierda lo
mínimo posible): al cargar cualquier nivel, tras interactuar con un objeto,
al saltar turno, cada 3 segundos como red de seguridad (cubre turnos de la
IA y animaciones que no pasan por un clic directo), y al esconderse/cerrarse
la pestaña (`visibilitychange`/`beforeunload`). Limitación conocida: si se
guarda justo a mitad de una animación o de un turno de IA, el resume puede
no ser pixel-perfect en ese instante concreto (por ejemplo, un enemigo a
mitad de un desplazamiento) — no es grave, solo un pequeño salto visual, y
mejorar esto más no compensa mientras el sistema siga siendo temporal.

**"Reiniciar partida"** (botón de ajustes) y **"reiniciar progreso"** (botón
de la tienda de habilidades) hacen lo mismo con la mazmorra: la vuelven a
crear desde cero en el nivel 1 (mismo `newGame()` de `main.js`, enganchado a
la tienda con `bindFullReset`). La diferencia es el oro y las habilidades:
"Reiniciar partida" las conserva tal cual; "reiniciar progreso" también los
pone a cero (1000 de oro, ninguna habilidad).

## Efectos reales de las habilidades (V0.21)

Desde la v0.21, las 10 habilidades de la tienda **hacen de verdad lo que
dicen** en combate (antes eran solo catálogo/tienda, sin efecto real). Vive
repartido así:

- **`data/skills.json`**: cada tier trae un bloque `power` con los números
  reales (`critBonus`, `armorBonus`, `dodgeBonus`, `healChance`/`healPct`,
  `dmgPerKillPct`, `dmgMult`, `atkBuffPct`/`turns`...). Ya no son solo texto.
- **Pasivas de estadística plana** (Precisión carnicera→crítico, Piel de
  hierro→armadura, Reflejos felinos→esquiva): `skills.js` expone
  `getSkillBonuses()` y `applySkillBonuses(hero)`. Esta última se llama
  desde `main.js` cada vez que el héroe se (re)prepara — nivel nuevo, carry
  entre niveles, o partida retomada — y **siempre recalcula desde la base**
  (nunca suma sobre sí misma), así que es segura de llamar varias veces.
  `inventory.js` usa `getSkillBonuses()` para pintar en verde (`--moss`) la
  estadística que esté subida por una habilidad.
- **Pasivas de combate** (Golpes de fe, Sed de sangre) y los multiplicadores
  de las activas (Grito de guerra) viven en `rules.js` como estado de
  COMBATE en marcha (no de la tienda): `skillCooldowns`, `warCryTurnsLeft`/
  `warCryPct`, `bloodlustStacks`. Se resetean/decrementan en
  `checkCombatEnd()` (cooldowns bajan 1 combate; Sed de sangre vuelve a 0) y
  en `startHeroTurn()` (Grito de guerra decae 1 turno).
- **Habilidades activas**: `rules.js` exporta `useActiveSkill(id, gx, gy)`.
  `skills.js` gestiona el "armado" (tocar un icono de la barra de acción lo
  arma; el siguiente toque en el mapa dispara `tryUseArmedOnTile`, enganchado
  en `main.js` ANTES de `onTapTile` normal). Las de auto-lanzamiento
  (`range:0`, como Grito de guerra) se usan al toque, sin esperar objetivo.
  Como `rules.js` ya importaba cosas de `skills.js` (para leer tiers), la
  conexión inversa (skills.js -> rules.js) se hace con un **bind**
  (`bindUseActiveSkill`) para no crear un ciclo de imports.
- **Limitación a propósito**: de momento los efectos son daño/curación/buff
  INSTANTÁNEOS — no hay un motor de estados con turnos (quemadura, veneno
  que hace tic, ralentizado, aturdido de verdad). El texto de cada tier
  sigue describiendo la fantasía completa, pero mecánicamente hoy pega el
  golpe de una vez. Construir ese motor de estados-por-turno es el
  siguiente paso natural si hace falta más adelante.

## Victoria de toda la mazmorra, no de una zona suelta (V0.21)

Antes, limpiar los enemigos de CUALQUIER nivel (p.ej. los 2 esqueletos de
Mausoleo 1) disparaba la pantalla de victoria de toda la partida. Ahora
`rules.js` lleva la cuenta de bajas en `state.hero.totalKills` (viaja entre
niveles igual que la vida/el oro, vía `carry` en `descend()`), y la victoria
de verdad (`gameOver('win')`) solo salta cuando se iguala `totalFoeCount`
(la suma de enemigos de cementerio+cripta+mausoleo1+mausoleo2, calculada una
vez al arrancar en `main.js` y pasada con `setTotalFoeCount`). Limpiar un
tramo suelto solo cierra el combate de esa zona (`checkCombatEnd`), sin más.

## La tienda de habilidades (sistema TEMPORAL de pruebas)

Desde la v0.20 existe una pantalla ("Elige tus habilidades") que se abre justo
después de pulsar "Continuar" en las novedades, antes de entrar en la
partida. Vive entera en `js/skills.js` (datos + estado + render), a
propósito **desacoplada de `rules.js`**: de momento las habilidades no tienen
efecto real en combate, solo sirve para ir probando el catálogo (icono,
nombre, tipo de daño, activa/pasiva, duración, precio) e ir ajustando cada
una antes de que exista el sistema definitivo con sus efectos de verdad.
Cuando llegue ese sistema, esto se puede sustituir sin tocar el motor.

**Cómo está montado:**
- Catálogo en `data/skills.json`: cada habilidad tiene `id`, `icon` (ruta a
  `assets/ui/skills/<id>.png`), `kind` (`active`/`passive`), `damageType`,
  opcionalmente `class` (guerrero/paladín/...), `duration` (turnos del
  efecto) o `durationLabel` (clave i18n directa, para casos como
  "Permanente"/"Instantánea" que no son un número de turnos), y en las
  activas además `range` (casillas; `0`=uno mismo, `1`=cuerpo a cuerpo,
  `null`=no aplica), `area` (radio; `null`/`0`=objetivo único) y `cooldown`
  (en combates; `null`=sin enfriamiento). Un array `tiers` de 3 con el
  precio de cada uno. **`range`/`area`/`cooldown` son solo informativos por
  ahora** (no hay efectos reales en `rules.js` todavía). Los textos van en
  i18n: `skill.<id>.name`, `.desc`, `.tier1`/`.tier2`/`.tier3`.
- **3 tiers por habilidad**: al comprar un tier, la misma tarjeta pasa a
  ofrecer el siguiente (mismo hueco, no aparecen tarjetas nuevas). El precio
  sube por tier; se puede subir de tier cualquier habilidad en cualquier
  momento, sin requisitos entre ellas.
- **Iconos con fallback automático**: si `assets/ui/skills/<id>.png` no
  existe todavía, se ve un círculo con la inicial del nombre; en cuanto el
  archivo real se sube al proyecto, el `<img onerror>` dejar de disparar y
  se ve solo, sin tocar código. Los iconos reales que sube el usuario (arte
  Nano Banana, fondo magenta) se procesan igual que los sprites: quitar
  magenta por color, recortar al contenido real y guardar en
  `assets/ui/skills/<id>.png`.
- **Progreso persistente**: los tiers comprados en `localStorage`
  (`cripta.skills`), con su propio botón de "reiniciar progreso" dentro de
  la tienda (separado del "Reiniciar partida" de siempre; ver sección de
  guardado más arriba). El oro NO vive aquí — es el mismo `state.hero.gold`
  de siempre (ver sección de guardado).
- Al pulsar "Terminar" (con confirmación) se entra al juego, que ya estaba
  cargado en segundo plano desde el arranque (partida nueva o retomada).
- **Barra de acción de 10 huecos** (`#actionbar` en `index.html`), con los
  iconos de las habilidades ACTIVAS compradas, en el orden en que se
  compraron. Es un bloque más de `LAYOUT_IDS` en `main.js` (movible por
  separado con el reposicionador de interfaz de siempre).
- Las habilidades PASIVAS compradas se listan (nombre + tier en estrellas)
  en un grupo nuevo ("Habilidades") en la hoja de estadísticas del
  inventario (`js/inventory.js`), sin inventar un efecto numérico concreto
  todavía.
- El modal de confirmación genérico (`showConfirm`, `#confirmVeil`) se
  reutiliza aquí; por eso su z-index se subió a 25, por encima de la propia
  tienda (z-index 20), para que se vea encima al confirmar desde dentro.

## Emboscada sincronizada (V0.21.2) — los 2 sigilos de Mausoleo 2

Mausoleo 2 no tenía ningún enemigo colocado a mano — su única "amenaza" son
los 2 marcadores de evento del centro de la sala (`event_1`/`event_2`,
ahora renombrados), pensados como una emboscada: activar CUALQUIERA de los
dos hace aparecer 6 Espectros de golpe alrededor de ambos, en casillas
libres al azar.

**Cómo está montado (todo en `rules.js`, sección "Emboscada sincronizada"):**
- Nuevo tipo de trigger: `type: "ambush"`. Los 2 marcadores comparten el
  MISMO `id` (`mausoleo2_ambush`) — por eso basta una sola entrada en
  `events.json` para los dos, y sirve también para encontrar al "gemelo": al
  activar uno, `triggerAmbush()` busca todos los triggers `ambush` con ese
  mismo id y los marca `used` de golpe (el otro deja de poder tocarse y,
  como cualquier trigger no-cofre ya usado, deja de dibujarse).
- `spawnAmbushSpectres(origins, count=6, maxDist=3)` reutiliza
  `freeTilesNear()` (la misma función del Esqueleto Mago para invocar) desde
  CADA uno de los orígenes del grupo, junta las casillas candidatas sin
  repetir, las baraja (Fisher-Yates, dando algo de preferencia a las más
  cercanas por el orden de partida) y coloca ahí a los 6 Espectros
  (`sprite: 'enemy5'`, mismas stats que los de siempre: hp 16, atk 4).
  `freeTilesNear` ya descarta por sí sola la casilla del héroe, muros,
  otros enemigos y cualquier objeto/altar/marcador bloqueante — exactamente
  la condición pedida ("nunca encima de marcadores de evento, objetos,
  altares...").
- Los Espectros nacen ya despiertos (`dormant: false`): en cuanto se
  generan, `scanForNewCombatants()` los mete en la cola de iniciativa de
  inmediato y, si esto entra en combate por primera vez, se llama a
  `endHeroTurn(true)` — el mismo mecanismo de "despertar a mitad de camino"
  que ya existía para enemigos dormidos — así la emboscada de verdad
  interrumpe al héroe en vez de esperar a que acabe su turno.
- Carta de aviso en `events.json`/i18n (`ev.mausoleo2Ambush`): una sola
  opción ("Tocar el sigilo"), sin efecto de stats — el efecto real es la
  invocación, no algo que pase por `resolveChoice`.

## Contenedores de botín (V0.21.2) — primer paso del sistema de items

Los antiguos props tipo `item` ("Objeto" en el editor) pasan a ser
**contenedores de botín** genéricos: objetos repartidos por el mapa que
sueltan oro aleatorio, pensados como la base sobre la que en el futuro se
construirá el sistema de itemización completo (afijos, sufijos, únicos,
sets, palabras rúnicas — estilo Diablo 2). De momento **solo dan oro**, con
el mismo rango que los enemigos (10-200, subido temporalmente para probar
la tienda).

**Diferencia clave con el `chest`:** `chest` es el cofre narrativo especial
(ligado a una carta de `events.json`, y a futuro podrá llevar cerraduras,
trampas o checkeos de stats). `container` es el genérico y repetible, **sin
carta de evento** — se abre directo, como un cadáver. Cada uno tiene su
propio arte y su propio sonido — **no hay que confundirlos**:
- `chest` → arte de baúl de madera (`assets/props/chest/`), se abre con
  bisagra (clip `open`, 4 fotogramas), sonido `chestOpen`
  (`assets/audio/chestopen.mp3`).
- `container` → arte de jarrón de barro (`assets/props/container/`), se
  **rompe** en vez de abrirse (mismo clip `open` a nivel de código, pero
  visualmente es una secuencia de rotura: entero → agrietado → hecho
  pedazos → escombros), sonido `containerBreak`
  (`assets/audio/containerbreak.mp3`).

**Cómo está montado:**
- Tipo de prop nuevo: `container`, con su propio clip de animación en
  `anim.js` (`ANIM_CLIPS.container`: `idle` 1 fotograma, `open` 4
  fotogramas — el nombre de clip `open` es solo la etiqueta de código
  compartida con `chest`; el contenido real es la rotura del jarrón) y sus
  imágenes en `assets/props/container/idle.png` / `open.png` (arte de Nano
  Banana, magenta recortado agrupando por bandas horizontales —los
  fragmentos sueltos del jarrón roto quedan repartidos en varios
  componentes conectados independientes del cuerpo principal, así que se
  agrupan por su posición en la hoja en vez de por componente—, escala
  normalizada por el fotograma más alto del clip).
- El `chest` ya tenía su clip de animación reservado desde antes, pero
  nunca había llegado a conectarse a ningún nivel (los triggers `type:
  "chest"` no llevaban `sprite`, así que se veían con el icono ▪ genérico).
  Ahora los 3 cofres existentes (cementerio, cripta, mausoleo2/level2)
  llevan `"sprite": "chest"` y ya se ven con el baúl de madera real.
- En los niveles (`data/levels/*.json`), los triggers de contenedor ya no
  son `type: "item"` sino `type: "container"` y llevan `"sprite":
  "container"` para que `render.js` los pinte con el jarrón real en vez del
  icono ★ genérico de siempre.
- **Interacción** (`rules.js`, antes de entrar en el bloque genérico de
  objetos con carta): si el contenedor está adyacente, se reproduce la
  animación de saqueo del héroe + la rotura (`anim.openProp(...,
  'container')`) + el sonido `containerBreak` (solo la primera vez), se
  genera su botín una sola vez (`generateLoot()`, la misma función que usan
  los enemigos al morir — el parámetro `foe` no se usa, está reservado) y
  se abre la MISMA ventana de botín que un cadáver (`showLootWindow`). No
  cuesta PA, igual que recoger de un cadáver.
- El sonido `chestOpen` se dispara en `afterInteract` (rules.js), justo
  cuando el cofre narrativo se abre de verdad tras cerrar su carta.
- **Ventana de botín generalizada** (`ui.js`): antes solo la usaban
  cadáveres; ahora `showLootWindow(source)` distingue por
  `source.type === 'container'` para el título ("Contenedor" / i18n
  `loot.container`, en vez del nombre del enemigo) y para cómo desaparece al
  vaciarse: un cadáver pone `deathPlaying = false` (sistema de siempre); un
  contenedor pone `tr.used = true`, que ya hace que `render.js` deje de
  pintarlo (mismo criterio que cualquier otro prop de un solo uso) — así
  desaparece del mapa para siempre en cuanto se coge todo el botín.
- El manifest (`data/manifest.json`) tiene la clave `container` en vez de
  `item`, y ambos (`chest`/`container`) llevan ya su `sprite` de fábrica
  para que el editor de niveles (artifact aparte) lo asigne solo a
  cualquier cofre/contenedor nuevo que se coloque — pero el desplegable
  también debe actualizarse por su cuenta para mostrar "Contenedor" en vez
  de "Objeto"; lee el manifest en vivo, así que en cuanto esta versión esté
  publicada ya debería verlo solo.
- Se eliminó el evento suelto `item_1` de `events.json` (una tumba con 5 de
  oro/nada): ya no aplica, los contenedores no pasan por el sistema de
  cartas.

**Pendiente de verdad (fase 2, más adelante):** todo el sistema real de
itemización — rareza, afijos/sufijos, únicos, sets, palabras rúnicas, tablas
de drop por nivel — se construirá por partes, con preguntas concretas en
cada paso.

## Armadura: valor numérico con rendimientos decrecientes (V0.26)

**Fusionado desde un minifix hecho en paralelo** (`CriptaV0_25_1.zip`,
subido a mitad de esta sesión). Importante: ese zip partía de una base
ligeramente más vieja que el repo real (de antes de que existiera el daño
`arcane`, añadido en la 0.23) — por eso el zip revertía por error
`arcane_chain`/`arcane_overload` a `damageType: "nature"` y quitaba el
color/texto de `arcane`. **Eso NO se fusionó** (se detectó comparando
archivo por archivo con `diff`, tal como pide este documento en "Antes de
empezar a tocar nada"): solo se aplicó el cambio de verdad, el rebalanceo de
armadura, conservando `arcane` tal cual estaba.

**El cambio**: la armadura deja de ser un %-plano (`hero.armor = 0.10` =
10% de reducción fija) y pasa a ser un **valor numérico con rendimientos
decrecientes**, igual que la armadura de WoW:

```
% de daño físico reducido = armadura / (armadura + ARMOR_CONSTANT)
```

Con `ARMOR_CONSTANT = 200` (`config.js`): 25 de armadura → ~11%, 100 → 33%,
200 → 50%, 400 → 66%... nunca llega al 100%, cada punto extra ayuda un poco
menos que el anterior. El daño elemental (fuego/hielo/naturaleza/sombra/
sagrado) no cambia: sigue usando `hero.resist[tipo]` en % directo.

**Dónde vive**:
- `config.js`: `ARMOR_CONSTANT`.
- `rules.js`: `resolveIncomingHit` aplica la fórmula solo para
  `damageType === 'physical'`; `temporaryArmorBonus()` (Forma Salvaje +
  Simbiosis Natural) ahora suma valores planos (`armorBonus`/
  `armorBonusAtFullHp`, sin el sufijo `Pct` de antes).
- `state.js`/`skills.js`: armadura base del héroe pasa de `0.10` a `25`
  (`BASE_STATS.armor` y `hero.armor` inicial).
- `data/skills.json`: Piel de hierro +25/+50/+75 (antes +5%/+10%/+15%);
  Forma Salvaje y Gracia Vigilante actualizadas al mismo esquema.
- `inventory.js`: la hoja de estadísticas mostraba la armadura con
  `pct(h.armor)` (asumía %) — con el valor numérico eso habría enseñado
  disparates tipo "2500%". Se añadió `armorPct(armor)`, que calcula el % de
  mitigación real con la misma fórmula que el combate, y se usa solo para
  ese stat (el resto de `pct()` para crítico/esquiva/resistencias sigue
  igual, esos sí son %).

**Pruebas hechas**: fórmula de mitigación comprobada en varios puntos (25→
~11%, 100→33%, 200→50%, nunca llega a 100% aunque la armadura sea enorme) y
`applySkillBonuses` comprobado con los datos reales de `data/skills.json`
(sin Piel de hierro comprada, armadura = 25 exactos). Se repitió también la
batería de cofres (ver más abajo) para confirmar que este cambio no le
afecta en nada.

## Arreglos varios de UI + bug real de pasivas (V0.26.1)

**1. Barra de acción — número de cooldown y velo de bloqueo sin CSS.** El
`div.actionbar-cd` (número de turnos restantes) y la clase
`.actionbar-locked` (habilidad en cooldown o sin PA) existían en el HTML
generado por `renderActionBar()` (`skills.js`) desde hace tiempo, pero
**nunca tuvieron ninguna regla CSS** — por eso el número salía descolocado
(sin posición) y el velo rojo nunca se veía. Añadido en `css/styles.css`:
`.actionbar-slot{ position:relative }` (para poder posicionar cosas encima),
`.actionbar-cd` centrado con `position:absolute; inset:0; display:flex`, y
`.actionbar-locked::after` como velo rojo semitransparente (`rgba(120,10,10,.55)`)
por encima de todo el icono.

**2. Chroma magenta en el modelo de entrada/salida.**
`assets/props/exit/model.png` (el único modelo compartido por todas las
entradas/salidas del juego, ver `render.js` ~línea 525) tenía el fondo
magenta del chroma de Nano Banana sin quitar — nunca se procesó. Se limpió
con Python/PIL: distancia euclídea al magenta de referencia (~`(204,9,180)`)
con transición suave (no corte duro, para no dejar borde rígido) +
**despill** (se resta el tinte magenta residual de los píxeles semi-
transparentes del borde, si no queda un halo rosa alrededor del dibujo).
**Importante**: se mantiene el lienzo cuadrado 512×512 tal cual (NO se
recorta al contenido) porque `render.js` dibuja este modelo forzándolo a un
cuadrado (`drawImage(..., size, size)`) — si se recorta a un rectángulo no
cuadrado, saldría deformado al escalarlo. Mismo criterio a aplicar si en el
futuro aparecen más modelos con este problema.

**3. Inventario demasiado pequeño en móvil.** El panel de inventario mide
1920×2112 (diseño ancho tipo escritorio) y `applyScale()` (`inventory.js`)
elegía el menor de los dos factores de escala (ancho/alto) para que cupiera
ENTERO sin recortar nada — en un móvil en vertical, el ancho es el cuello de
botella y el resultado quedaba diminuto (bastante espacio vertical sin usar
de sobra). Se agranda un 45% extra solo en táctil (`pointer:coarse`),
asumiendo que ahora puede sobrar por algún lado; para eso `#inventoryVeil`
gana `overflow:auto` en táctil (antes no se podía hacer scroll dentro). El
multiplicador (1.45×) es ajustable a ojo si hace falta más o menos.

**4. Pestañas Estadísticas/Habilidades en la hoja de personaje.**
`renderCharSheet()` (`inventory.js`) antes pintaba los 3 grupos (Ataque,
Defensa, Habilidades) todos seguidos en la misma columna. Ahora hay una
mini pestaña arriba (`stat.tab.stats` / `stat.tab.skills`) que alterna entre
un panel con Ataque+Defensa y otro solo con Habilidades pasivas —
`charSheetTab` (módulo, 'stats'|'skills') recuerda cuál está activa mientras
dure la sesión de juego. Ganamos espacio vertical sin quitar información.

**5. BUG DE VERDAD (no solo visual): las pasivas planas no se aplicaban al
comprarlas, solo al cargar nivel.** `applySkillBonuses(hero)` (recalcula
`hero.critChance/armor/dodgeChance` desde cero sumando los bonus de Piel de
hierro/Reflejos felinos/Golpes de fe-crítico) solo se llamaba en
`loadLevel()`/`bootLevel()` (`main.js`) — es decir, al empezar o retomar un
nivel. El botón de comprar en la tienda (`buy()` en `skills.js`, invocado
desde el listener de `renderCards()`) actualizaba `owned[id]` y lo
persistía, pero **nunca volvía a llamar a `applySkillBonuses`**. Resultado:
si comprabas Reflejos felinos a mitad de un nivel, la esquiva real del héroe
NO subía hasta la próxima vez que se cargaba/guardaba la partida (bajar de
nivel, recargar la página...) — no era un problema de la hoja de
estadísticas, el número real (`hero.dodgeChance`) se quedaba desactualizado.
Arreglado añadiendo `applySkillBonuses(state.hero)` justo después de una
compra con éxito, antes de repintar. Comprobado con datos reales de
`data/skills.json`: `getSkillBonuses()` y `applySkillBonuses()` ya
calculaban bien (tier 1 de Reflejos felinos = +0.05 esquiva → 0.06 total
con la base de 0.01); el fallo estaba solo en cuándo se invocaban.

**6. Palanca con animación de verdad (antes era un simple glifo `/`).**
El usuario subió una hoja de 4 fotogramas (brazo recto → tumbado del todo,
base fija) para la palanca del cementerio (`lever_1`), que hasta ahora no
tenía sprite ninguno — se dibujaba con el sistema de glifo/círculo genérico
(igual que un evento sin arte). Igual que se hizo con el modelo de
entrada/salida: componentes conectadas (scipy) para separar los 4
fotogramas del chroma magenta + despill. A diferencia de la puerta, aquí
SÍ hacía falta reescalar cada fotograma a una celda cuadrada de
`SPRITE_TILE` (128×128) — la convención de TODO el sistema de animación
(personajes y objetos por igual, ver `ANIM_CLIPS` en `anim.js`) — con un
único factor de escala común para los 4 (referencia = el fotograma más
alto, el brazo recto) y anclando siempre el borde izquierdo de la base en
el mismo punto del lienzo, para que la base no "salte" al cambiar de
fotograma y solo se mueva el brazo. Archivos: `assets/props/lever/idle.png`
(1 fotograma) y `open.png` (tira de 4). Dado de alta en `assets.js` (fuente)
y `anim.js` (`ANIM_CLIPS.lever` + `IDLE_NAME.lever = 'idle'`), y se añadió
`"sprite": "lever"` al trigger `lever_1` en `data/levels/cemetery.json`
(antes no lo tenía). También se añadió `'lever'` a `staysVisibleUsed` en
`render.js` para que se quede visible (en su último fotograma, abierta)
tras usarse, igual que cofre/altar — antes habría desaparecido del mapa al
gastarse, como los objetos "mueble" normales.

**Cuándo se dispara la animación — pedido expresamente "al cerrar la
ventana", no al pulsar Sí.** El sistema tiene un enganche automático en
`render.js`: en cuanto `tr.used` pasa a `true`, el siguiente fotograma
dispara sola la animación de apertura (`if (tr.used && !a.opened)
anim.openProp(...)`) — esto es necesario también para que una partida
guardada con la palanca ya usada se muestre bien abierta al cargar. El
problema: antes, `activateLever()` (en `ui.js`) marcaba `trig.used = true`
Y desbloqueaba las salidas **al pulsar "Sí"**, no al cerrar — como el
bucle de dibujo sigue corriendo de fondo aunque haya una carta abierta
encima (`loop()` en `render.js` siempre se reprograma), la animación
habría empezado en cuanto se pulsara "Sí", antes de ver el texto de
resultado. Se retrasó `activateLever` (renombrada su lógica, se sigue
llamando igual) para que se ejecute en el `onclick` de **cerrar** la carta
de resultado (las dos variantes, con imagen y sin imagen), justo antes de
`afterInteract(trig)` — el botón "Sí" ahora solo cambia la carta a su etapa
de resultado (`o.stage='result'; renderCard();`), sin tocar el estado del
juego todavía. Mismo criterio que ya se usó para "aplicar recompensa del
cofre al cerrar, no al decidir" (ver sección "Cofres" más abajo).

**7. Bug real en `render.js`: los objetos animados con más de 1 fotograma
salían ~N veces más anchos de lo debido.** Al añadir la palanca se detectó
que el cálculo de ancho de los props animados (`cofre`/`altar`/ahora
`palanca`) usaba `img.width` de la **tira entera** del clip (todos los
fotogramas juntos, p.ej. 512px para un clip de 4 fotogramas de 128px) en
vez de uno solo — `w = img.width * th/img.height` daba un ancho ~4 veces
mayor de lo que debía para un clip de 4 fotogramas. Los actores (héroe/
enemigos) NO tenían este fallo porque `drawActor()` siempre usa un destino
cuadrado fijo (`size × size`), sin mirar las dimensiones de la imagen.
Arreglado igualando el criterio: como cada fotograma es cuadrado
(`SPRITE_TILE`), el destino también lo es (`w = th`, en vez de calcularlo a
partir de `img.width/img.height`). Esto corrige de paso cualquier
cofre/altar que se hubiera visto estirado al abrirse — antes de este
arreglo no se había notado/reportado, pero el cálculo era claramente
incorrecto para cualquier clip de más de 1 fotograma. **También cubre al
contenedor genérico** (`item_1`/`item_2`... `type: 'container'`, sprite
`container`, `open.png` también es una tira de 4 fotogramas 512×128): pasa
por este MISMO bloque de dibujo compartido (cualquier trigger con `sprite`
apuntando a un objeto con clips en `ANIM_CLIPS`), así que no hizo falta
ningún cambio aparte — un solo arreglo cubre chest/altar/lever/container a
la vez.

**8. Dos stats nuevas en el grupo Ataque de la hoja de personaje**: "Puntos
de acción" (`h.apMax`) y "Capacidad de movimiento" (`apMax / MOVE_COST`,
hoy en día siempre el mismo número ya que mover 1 casilla cuesta 1 PA fijo
— se calcula así, en vez de un número suelto, para que quede bien si algún
día `MOVE_COST` cambia o aparece algún bonus de movimiento).

## Corrección importante: el arquero de verdad es enemy4, no enemy5 (V0.32)

**Se detectó un error de identificación arrastrado desde hace varias
versiones**: en el V0.28 (y en referencias posteriores) se agrandó el
cadáver de `enemy5` pensando que era el "Esqueleto arquero" — pero
`enemy.enemy5` en los textos es en realidad **"Espectro"**. El arquero DE
VERDAD es **`enemy4`** (`"enemy.enemy4": "Esqueleto arquero"`), confirmado
mirando `data/i18n/es.json` directamente en vez de fiarse de la memoria de
sesiones anteriores. Nombres correctos de todos los esqueletos, para no
volver a confundirlos:
- `enemy1` = Esqueleto (básico)
- `enemy4` = Esqueleto arquero
- `enemy5` = Espectro
- `enemy6` = Esqueleto mago (jefe de la cripta)

**Arreglo de verdad de esta versión**: el cadáver de `enemy4` (el arquero
real) nunca se había tocado — seguía diminuto (50×26px dentro del tile de
128×128). Reescalado ×2.3 con el mismo método de siempre (anclado por el
punto centro-abajo del contenido original, para no flotar ni desplazarse
del suelo). Resultado: 116×61px, sin tocar ningún borde del lienzo. El
cadáver de `enemy5` (Espectro) que se agrandó por error en la V0.28 se
deja tal cual — no hace daño tenerlo más grande también, y deshacerlo no
aporta nada.

## Golem de hueso: idle reconstruido de verdad desde la hoja original (V0.32)

Cierre de un hilo largo: el `idle.png` que quedó en pie tras la V0.29 (los
6 "fotogramas buenos" rescatados de la hoja vieja intercambiada con
`death`) seguía dando problemas — primero un bamboleo real (cabeza
descentrada, pies variando hasta 7px), y al arreglar eso el usuario señaló
que la hoja en sí venía **mal recortada de origen** (arrastrando el
problema de sesiones anteriores, ya que se llevaba reprocesando el mismo
recorte una y otra vez sin arte nuevo de por medio).

El usuario SÍ tenía la hoja de referencia original sin recortar (la misma
`43514.png` que ya se había usado en un intento anterior de esta misma
sesión, y que en su momento se descartó porque "el idle ya estaba bien" —
ya no lo estaba). Reconstruido desde cero con la técnica que ya funcionó
bien para `death` (ver esa sección): recorte por celda exacta de la
rejilla (3×2, 418×627 por celda), magenta fuera por tono de color
(`min(R,B)-G`, sin comparar contra ningún color de referencia), escala
única para toda la animación (referencia = el fotograma más alto),
centrado por el 22% superior del contenido (zona de la cabeza, no el
cuerpo entero) y redimensionado con alfa premultiplicado (evita que el
color de los píxeles transparentes se cuele mezclado en los opacos).
Resultado: 0.00% de residuo de magenta, ningún fotograma toca el borde del
lienzo (sin recortes), posiciones de pegado casi idénticas entre
fotogramas (28-29, 8). Confirmado a ojo por el usuario.

`ANIM_CLIPS.golembone.idle` se queda igual (6 fotogramas, 3fps, loop) — no
hizo falta tocar `anim.js`.

## Barra espaciadora: coger todo el botín si la ventana está abierta (V0.31)

Pedido expreso, solo PC (atajo de teclado): la barra espaciadora ya salta
turno (`skipTurn()`, ver el `keydown` de `main.js`). Ahora, si la ventana de
botín está abierta en ese momento, espacio en vez de eso **coge todo y
cierra la ventana** (más rápido que ir al botón) — únicamente mientras esa
ventana esté abierta; en cualquier otro momento sigue saltando turno igual
que siempre.

Nuevo en `ui.js`: `isLootOpen()` (expone si `lootCorpse` — antes privada —
está puesto) y `lootAllNow()` pasa a exportarse (ya existía, solo la
llamaba el botón "Coger todo"). En el `keydown` de `main.js`: si
`isLootOpen()`, llama a `lootAllNow()` y no sigue con `skipTurn()`.

**Pruebas hechas**: `isLootOpen()` cambia de `false` a `true` al abrir la
ventana de botín y vuelve a `false` tras `lootAllNow()`; el oro de las
entradas de tipo `gold` se aplica de verdad al héroe.

## Pathfinding para lootear a distancia (V0.31)

Pedido expreso: al tocar un cadáver con loot pendiente que esté fuera de
alcance directo (no adyacente) pero SÍ dentro del alcance de movimiento de
este turno, el héroe debe acercarse solo y lootear al llegar, en vez de
solo avisar "acércate más" como hacía siempre.

**Refactor necesario primero**: el bucle de movimiento paso a paso (trampas,
eventos al pisar, salidas de nivel, corte si empieza combate a mitad de
camino...) vivía TODO dentro de `onTapTile()`, con `return` directos a la
función entera en cada corte — no se podía reutilizar tal cual. Se extrajo
a `walkPath(path)` (nueva, privada), que devuelve `true`/`false` según si
se completó el camino entero sin cortes, y `walkTo(path)` (envuelve a
`walkPath` + cierra turno solo si ya no quedan PA al terminar, mismo
criterio de siempre). El movimiento normal (tocar una casilla vacía dentro
de alcance) ahora también pasa por `walkTo()` — mismo comportamiento de
antes, solo reorganizado.

**Lo nuevo**: `bestApproachTile(tx, ty)` busca la casilla adyacente a
`(tx,ty)` más barata dentro de `state.reach` (mira las 8 direcciones,
`reachCost()`). En el bloque del cadáver (`onTapTile`): si no está ya
adyacente, se busca esa casilla de aproximación, se calcula el camino con
`pathTo()` de siempre, y si existe se anda con `walkTo()` — si el camino se
completa entero (no se cortó por trampa/combate/carta a mitad), se abre la
ventana de botín al llegar. Si no hay ninguna casilla de aproximación
alcanzable, se mantiene el aviso de siempre ("acércate más").

**Ojo**: si el camino se corta a mitad (p.ej. una trampa revienta o un
enemigo se activa de camino al cadáver), el héroe se queda donde se haya
parado y NO se abre el botín — hay que tocar el cadáver otra vez cuando se
pueda. Mismo criterio de "nunca completar de más" que ya rige el
movimiento normal.

**Pruebas hechas**: cadáver a distancia 2 dentro de alcance → el héroe
camina hasta quedar adyacente (comprobado con `distTo`) y gasta los PA del
camino. Cadáver fuera de alcance del todo (PA insuficientes) → el héroe no
se mueve. Cadáver ya adyacente → se abre directo, sin gastar PA de más ni
intentar moverse.

## Enfriamiento de habilidades: aclarado en la tienda, no es un bug (V0.31)

Reportado por un tester: "Disparo Múltiple" se quedaba con enfriamiento
"2" para siempre aunque saltara turno ~10 veces. Investigado: **no es un
bug** — el enfriamiento de las habilidades activas se mide en COMBATES
ENTEROS que terminan, no en turnos sueltos. `skillCooldowns` solo baja
dentro de `checkCombatEnd()` (`rules.js`), que corta en seco si
`!state.combat.active` — o sea, si no hay ningún combate en marcha (el
tester estaba caminando por el mapa sin pelear), no baja nunca, por mucho
que se salte turno. Confirmado con el usuario: se deja el diseño tal cual
(combates, no turnos) — solo se aclara el texto de la tienda:
`skillshop.cooldown` pasa de "Enfriamiento: {n} combates" a "Enfriamiento:
{n} combates (no turnos)" (es/en) para que quede inequívoco.

(De paso, lo otro que reportó el tester —que "Disparo Múltiple" no
aparecía en su lista de "Habilidades" del inventario— tampoco es un bug:
esa pestaña solo lista PASIVAS (`getPassiveOwnedSkills()`, ver sección de
pestañas de la hoja de personaje), y Disparo Múltiple es una activa
[`"kind": "active"` en `data/skills.json`] — nunca iba a salir ahí, es el
comportamiento esperado.)

## Bug real: la cripta nunca tuvo su fondo pintado conectado (V0.31)

Segundo bug de verdad de esta ronda, detrás de la sensación de "Cripta no
carga bien". `cripta.json` no tenía ningún `"background"` (a diferencia de
`cemetery`/`mausoleum1`/`mausoleum2`, que sí lo tienen) — por eso
`render.js` caía en su rama de "sin fondo pintado": pintar el atlas de
losetas genérico (`assets/tiles/dungeon.png`, el mismo "placeholder" gris
de toda la vida) casilla a casilla, en vez del mapa de referencia
precioso que el usuario ya había subido (`42395.jpg`) para calibrar la
malla del editor — esa imagen **nunca se guardó como asset del juego**,
solo se usó de forma puntual para verificar el encaje de la malla en su
momento (ver sección "Nivel Cripta de verdad").

**Arreglo**:
1. La imagen de referencia (`42395.jpg`, sigue disponible en
   `/mnt/user-data/uploads/`) tenía el fondo magenta de verdad fuera del
   dungeon (34.3% de la imagen) — quitado por tono de color
   (`min(R,B)-G`, la misma técnica que ya funcionó bien con los sprites del
   golem) y guardada como **PNG con transparencia** (no JPG): así el vacío
   fuera del dungeon deja ver el fondo de vacío del propio motor
   (`drawVoidBackground()`, se dibuja ANTES que el fondo pintado) en vez de
   enseñar magenta a lo bruto — mismo patrón que ya usa `cemetery.png`
   (que también es PNG con transparencia, a diferencia de
   `mausoleum1/2.jpg`, que no la necesitan por estar totalmente pintados).
2. Nueva clave `bg_cripta` en `assets.js` → `assets/backgrounds/cripta.png`.
3. `cripta.json` → `"background": {"key": "bg_cripta"}`.
4. **`_editorMap` reescalado al tamaño REAL del archivo guardado**
   (2160×1440), no al que traía el JSON original del editor (1400×933,
   calibrado sobre una versión más pequeña de la misma imagen — ver la
   sección de comprobación de malla, más abajo, donde ya se detectó este
   mismo desajuste de escala). `state.editorMap` (`state.js`) es lo que usa
   `render.js` para recortar exactamente la misma región que el editor
   alineó sobre su rejilla, estirada a la rejilla del motor — con los
   valores viejos (sin reescalar) el recorte habría salido mal otra vez.
   Verificado con el mismo método cuantitativo de sesiones anteriores: 0%
   de casillas de suelo cayendo en zona transparente/vacía.

## Bug real: palancas de la cripta chocaban de ID con la del cementerio (V0.31)

Reportado por un tester vía el usuario. Las dos palancas del jefe de la
cripta (`lever_1`/`lever_4`, ver "Nivel Cripta de verdad + jefe de dos
palancas") usaban los MISMOS IDs que la palanca del cementerio (también
`lever_1`, dada de alta bastante antes). Como `events.json` es un
diccionario único por ID (sin distinguir de qué nivel viene cada trigger),
esto causaba:
- `lever_1` de la cripta: mostraba el texto/comportamiento de la palanca
  DEL CEMENTERIO (sin sentido en ese contexto), aunque de rebote sí llegaba
  a marcarse `used` y disparar la comprobación del jefe.
- `lever_4` de la cripta: **no tenía ninguna entrada en absoluto** →
  `state.events[tr.id]` daba `undefined` → rama `if (!ev) { log(neutro);
  return; }` en `onTapTile` (`rules.js`) → no pasaba nada al tocarla, nunca
  se marcaba `used`. Con esa palanca inútil, el jefe (que exige las DOS)
  nunca podía aparecer.

**Arreglo**: renombrados los triggers a `cripta_lever_1`/`cripta_lever_4`
en `data/levels/cripta.json` (únicos de verdad, ya no coinciden con
ningún otro nivel), actualizado `CRYPT_BOSS_LEVERS` en `rules.js` a juego,
y añadidas sus propias entradas en `events.json` con texto propio (sin
`unlocks`, ya que estas palancas no abren ninguna salida — su único efecto
real es disparar `checkLeverBossSpawn`). Probado con una prueba headless:
el jefe aparece con los IDs nuevos, y una palanca `lever_1` de OTRO nivel ya
no interfiere para nada.

**Lección para el futuro**: al montar niveles nuevos con marcadores
genéricos tipo `lever_N`/`chest_N`, comprobar que el número no choque con
otro nivel ya existente — `events.json` es un espacio de nombres GLOBAL,
no por nivel.

## Telemetría: errores + estadísticas de partida (V0.30)

Segundo backend real de Cripta (mismo proyecto Supabase compartido,
`cripta-habilidades`), esta vez para depurar y sacar estadísticas, no para
nada de cara al jugador. Dos tablas nuevas:

- **`cripta_error_log`**: errores de JS de verdad capturados en clientes
  reales (`window.onerror` + `unhandledrejection`), con mensaje, traza,
  versión, nivel en el que estaba y un `session_id` aleatorio (sin nada
  identificable — se genera de nuevo cada vez que se abre el juego, no se
  guarda en localStorage; sirve para agrupar eventos DENTRO de una misma
  sesión, no para reconocer al mismo jugador entre visitas).
- **`cripta_events`**: eventos sueltos de partida (`level_start`,
  `hero_death`, `hero_win`, `skill_purchased` de momento) con su
  `payload` (jsonb) — para sacar estadísticas agregadas más adelante
  (embudo de progresión, habilidades más compradas, tiempos medios...).

**Diferencia importante con el leaderboard**: estas dos tablas son **solo
de escritura pública** (política RLS de `insert`, sin ninguna de `select`)
— a diferencia de `cripta_boss_leaderboard` (que sí es de lectura pública,
porque ES el contenido que se le enseña al jugador), aquí nadie con la
clave anon puede leer los datos de otros. La consulta se hace desde el
panel de Supabase (SQL editor) o con la service role.

**Cliente**: `js/telemetry.js`, mismo criterio que `leaderboard.js` — habla
directo con la API REST de Supabase vía `fetch()`, sin SDK, y **nunca**
puede romper ni ralentizar el juego (try/catch por todas partes, nunca se
espera la respuesta antes de seguir). `logError()` descarta el mismo
mensaje repetido dentro de una ventana de 10s (por si un error salta en
bucle, p.ej. cada fotograma) — probado con una prueba headless.

**Enganches actuales** (fácil de ampliar con más eventos según haga falta):
- `initErrorCapture()` + `setTelemetryVersion()`: al arrancar (`main.js`,
  `boot()`), justo después de declarar `currentLevelName` (el capturador de
  errores necesita poder leerlo en el momento del fallo, no solo al
  arrancar).
- `logEvent('level_start', {level, fresh, gold})`: en `loadLevel()`
  (`main.js`), tras fijar `currentLevelName`. `fresh` distingue partida
  nueva de bajar de nivel/volver de un mausoleo.
- `logEvent('hero_win'|'hero_death', {gold, timeMs})`: dentro de
  `gameOver()` (`ui.js`), el único punto de entrada de victoria/derrota.
- `logEvent('skill_purchased', {id, tier})`: en el manejador de compra de
  la tienda (`renderCards`, `skills.js`), justo tras `buy()`.

**Nota sobre el numerado de esta versión**: esta sección y la de arreglos
de abajo iban a ser dos entregas separadas (V0.30 y V0.31), pero como el
usuario aún no había aplicado el zip de la V0.30 al repo real (seguía en
V0.29 quando se empezó la telemetría), se fusionó todo en una sola V0.30 —
más simple que mandar dos zips encadenados sin confirmar que el primero ya
estaba puesto.

## Elevación oculta, inventario sin scroll, altar duplicado y bug de casillas de movimiento (V0.30)

**1. Casillas de elevación, ocultas visualmente a propósito.** El tinte por
altura y los bordes de escalón rojo/verde no tenían ningún diseño de nivel
real detrás todavía y solo ensuciaban la pantalla. Nuevo interruptor
`SHOW_ELEVATION_VISUALS` (`render.js`, `false` de momento) que apaga esos
dos bloques de dibujo — la lógica de juego (coste de subir, `elevAt()`,
`MAX_CLIMB`...) sigue intacta, solo deja de pintarse. Un solo `true` lo
recupera todo cuando se decida qué hacer con los desniveles.

**2. Inventario: ya no hace falta scroll en móvil.** En la V0.26.1 se había
agrandado un 45% extra en táctil (con scroll para lo que sobrara) porque se
veía chico. Ahora se pide justo lo contrario: que quepa entero siempre, sin
scroll. Se quitó el multiplicador de `applyScale()` (`inventory.js`) — vuelve
a ser `Math.min(ancho/BASE_W, alto/BASE_H)` sin más, igual en móvil que en
PC. El `overflow:auto` de `#inventoryVeil` (CSS) se deja tal cual, como red
de seguridad inofensiva (no hace nada si no hace falta scroll).

**3. Mausoleo1 tenía DOS altares pegados** (`altar_1` en (5,3), `altar_2`
en (6,3)) — se quita `altar_2` del todo y `altar_1` se queda como el único,
con `"offsetX": 0.5` (nuevo soporte de offsetX/offsetY para CUALQUIER
objeto animado, no solo las salidas — ver el `worldToScreen` compartido en
`render.js`) para que se dibuje centrado visualmente entre las dos casillas
originales, y `"tall": 1.725` (el doble de 0.8625). Su posición LÓGICA
(dónde hay que estar de pie para interactuar) sigue en (5,3), sin cambios.

**4. Bug de verdad: a veces no salían las casillas de movimiento posible
aunque sí se pudiera mover ahí.** La causa: el resaltado ámbar de alcance,
el cursor del ratón y el propio manejador de toques usaban `anim.active()`
— que mira si CUALQUIER actor del mapa (un enemigo lejano moviéndose por su
cuenta, por ejemplo) está en mitad de una transición animada (mover/atacar),
no si el HÉROE lo está. Con cualquier bicho animando algo sin relación con
el turno del jugador, el resaltado desaparecía Y el toque se ignoraba en
silencio (de ahí que a veces "no salga" pero luego sí puedas moverte — el
siguiente toque, ya sin esa animación de por medio, sí se procesaba). Nuevo
`anim.isBusy(name)` (`anim.js`) — como `active()` pero para UN actor
concreto — usado en los 3 sitios de `render.js` que antes miraban a
`active()` para gestos/resaltado del héroe (el resaltado de rango, el
cursor del ratón en PC, y el manejador de toques limpios). Probado con una
prueba headless: con un enemigo moviéndose y el héroe quieto, `active()`
da `true` pero `isBusy('hero')` sigue en `false` (el héroe puede actuar).

## Palanca: modelo un 100% más grande (V0.29)

Se veía demasiado pequeña ("casi no se ve"). Los objetos animados (cofre,
altar, palanca, contenedor) usan `tr.tall` (por defecto `PROP_TALL` =
`TOKEN_TALL/2` = 0.575, la mitad de un personaje) para decidir su tamaño en
pantalla — ver el `w = th` fijo en `render.js` (arreglo de estiramiento de
la V0.26.1). Se añadió `"tall": 1.15` (el doble, `TOKEN_TALL` completo — el
mismo tamaño que un personaje) a las 3 palancas ya colocadas (`lever_1` en
`cemetery.json`; `lever_1`/`lever_4` en `cripta.json`).

## Llamada Sepulcral: rango de toda la sala (V0.29)

`MAGE_CALL_RANGE` (`rules.js`) subido de 20 a 100 — de facto cubre
cualquier nivel del juego de una tacada (el más grande, Cripta, mide
78×52). Pedido expresamente: "si tiene rango, que llame a toda la
habitación". `MAGE_CALL_GATHER` (dónde se agrupan los llamados alrededor
del mago) se queda igual, en 4.

## Golem de hueso: idle/death reconstruidos con arte nuevo (V0.29)

**Contexto**: tras la V0.29, el usuario reportó que las animaciones del
golem seguían mal (el fotograma roto de `idle` que se "arregló" resultó ser
en realidad que `idle.png` y `death.png` estaban con el CONTENIDO
intercambiado desde que se dieron de alta en una sesión anterior —
"desguazada entera de la original, recortaste mal los frames"). El usuario
proporcionó las dos hojas de referencia ORIGINALES (sin recortar, en
rejilla sobre fondo magenta): una de 8 celdas (4×2) para `death`, otra de 6
celdas (3×2) para `idle`.

**Extracción desde cero** (no reutilizar nada de las hojas anteriores,
corruptas): cada celda de la rejilla se recorta por su tamaño exacto
(`ancho_imagen/cols`, `alto_imagen/filas`), se le quita el fondo y se monta
en un tile de 128×128 (convención `SPRITE_TILE` de todo el proyecto) con
una **única escala por animación completa** (no por fotograma — calculada a
partir del fotograma más alto, normalmente el primero) para que el
desmoronamiento de `death` conserve su encogimiento real en vez de
"renormalizarse" en cada fotograma. Todos los fotogramas anclados a la
misma línea de suelo (y=125).

**Centrado por "cabeza" en vez de por el recuadro completo**: centrar cada
fotograma por su bounding box entero hacía que la figura oscilara de lado a
lado (un brazo/hueso que se abre hacia un lado desplaza el centro del
recuadro aunque el cuerpo no se haya movido — mismo principio que ya se
aplicó al héroe: "recentrar por la cabeza, no por el cuerpo entero"). Se
usa el 22% superior del contenido de cada fotograma como proxy de "zona de
la cabeza" y se centra por ahí. Con esto, `idle` queda con los fotogramas
casi clavados en la misma X (1px de margen); `death` varía algo más hacia
el final, esperable porque ya no queda una "cabeza" reconocible entre los
huesos dispersos.

**Quitar el chroma de verdad — la lección de esta ronda**: se probaron
varios enfoques cada vez más agresivos (distancia a un color de referencia
con degradado + "despill", corte binario simple, limpieza de fragmentos
sueltos por tamaño+color) y todos dejaban algo de magenta visible,
sobre todo en los fotogramas donde el golem se rompe en muchos trozos
pequeños (más perímetro de borde = más superficie donde falla un recorte
por distancia de color). **La solución de verdad, mucho más simple**: como
el diseño real del golem es solo tonos marrón/hueso/negro (el
morado/magenta que parecía un "brillo de energía" en las articulaciones
NUNCA fue un elemento de diseño intencionado — era chroma sin quitar del
todo), basta con detectar cualquier píxel donde el canal verde quede por
debajo de rojo Y azul a la vez (`min(R,B) - G > margen`) y volverlo
transparente sin más — sin comparar contra ningún color de referencia ni
degradado. Aplicado a las celdas en crudo (no a versiones ya procesadas,
para no arrastrar pérdida de información de intentos anteriores). Residuo
final medido: **0.00%**. Al redimensionar, alfa premultiplicado (para que
el color de los píxeles ya transparentes no se cuele mezclado en los
opaços vecinos — otra fuente de fleco magenta que no viene del chroma en
sí, sino del propio redimensionado).

**`idle` finalmente NO se tocó** — el usuario confirmó que la versión ya
en el proyecto (6 fotogramas, quedándose con los buenos de la hoja vieja
corrupta) estaba bien tal cual; solo hizo falta reconstruir `death` con la
hoja de referencia nueva.

**Recuento de fotogramas final** (`ANIM_CLIPS.golembone`, `anim.js`):
`idle`: 6. `walk`: 7 (sin tocar en toda esta ronda). `attack`: 8 (con el
reanclado de pies y centrado horizontal de la V0.29, sin tocar aquí).
`death`: 8 (arte nuevo, reemplaza los 10 fotogramas corruptos de la V0.29).

**Para la próxima vez que haga falta extraer una hoja de referencia en
rejilla** (celdas de tamaño fijo, fondo magenta, varios fotogramas por
fila): 1) recortar por tamaño de celda exacto, no por contenido; 2) escanear
magenta por HUE (`min(R,B)-G`), no por distancia a un color de referencia —
mucho más simple y sin dejar residuo; 3) una única escala para toda la
animación (referencia = el fotograma más alto), nunca por fotograma suelto;
4) centrar por la zona superior (cabeza), no por el recuadro completo;
5) alfa premultiplicado al redimensionar.

## Arreglos de reinicio, mausoleos, sprites y atajos de PC (V0.29)

**1. Reinicio de nivel/partida — de verdad, no solo el mapa.** `initGame()`
(`state.js`) solo tocaba `state.*`; un montón de estado de combate vivía en
variables sueltas de MÓDULO en `rules.js` (cooldowns de habilidades, Grito
de Guerra, Forma Salvaje, rachas de Sed de sangre/Cosecha de Almas,
bendiciones/maldiciones de altar, zonas de Círculo de Renacer...) que
sobrevivían a cualquier "reinicio". Nuevo `resetRunState()` (`rules.js`,
exportado) las limpia todas de golpe; se llama desde `loadLevel()`
(`main.js`) en CUALQUIER carga de nivel, junto con `audio.stopEliteMusic()`
(la música de combate de élite tampoco se paraba si se reiniciaba a mitad
de una emboscada — el gain node de Web Audio es un grafo persistente que
`initGame()` nunca tocaba).

**2. Volver de un mausoleo ya no teleporta al inicio del cementerio.**
Antes, `descend()`→`loadLevel()` siempre colocaba al héroe en el
`start.hero` por defecto del nivel de destino, viniera de donde viniera.
Se añadió un mecanismo de "coordenada de llegada": la salida antigua de un
solo tramo (`state.exit`, la que usan `mausoleo1`/`mausoleo2` para volver a
`cemetery`) puede traer `arriveX`/`arriveY` — las coordenadas de la puerta
del NIVEL DE ORIGEN por las que se entró. Al pisar esa salida
(`rules.js`, chequeo de `state.exit`), se pasan a `onDescend(to, arrive)` →
`descend(to, arrive)` → `loadLevel(name, carry, arrive)` (`main.js`), que
coloca al héroe en la casilla caminable más cercana a esa puerta
(`findWalkableNear()`, búsqueda en anillo creciente hasta 3 casillas — la
puerta en sí es "mueble", no pisable). Configurado en `mausoleo1.json`/
`mausoleo2.json` → `exit.arriveX/arriveY` = coordenadas de `exit_3`/`exit_4`
en `cemetery.json` (25,14 y 22,13).

**3. La tienda ya no reaparece al entrar/salir de un mausoleo.** Es un
desvío lateral corto, no avance real de mazmorra — `descend()` salta
`openSkillShop()` si `to` empieza por `mausoleo` (entrando) o si viene
`arrive` (volviendo). El resto de transiciones de nivel (cementerio→cripta)
siguen abriendo la tienda como siempre.

**4. Malla de mausoleo1 desplazada una casilla hacia abajo.** Estaba
descuadrada respecto al fondo pintado. Se insertó una fila de muro arriba
de `tiles`/`elev`/`difficult` (crecen de 12 a 13 filas) y se sumó `y+=1` a
héroe, enemigos, triggers y `exit` — pero NO a `exit.arriveX/arriveY`
(son coordenadas del CEMENTERIO, un nivel distinto, no deben tocarse).
Verificado que todo sigue en casillas caminables tras el desplazamiento.

**5. Ajuste fino de posición por salida (offsetX/offsetY).** Nuevo campo
opcional en cualquier entrada de `exits[]`: desplaza SOLO el dibujo del
modelo de esa salida en concreto (en fracción de casilla, `render.js`), sin
tocar su posición lógica (colisión/interacción) ni afectar a las demás
salidas que comparten el mismo `exitModel`. Usado en `exit_3` de
`cemetery.json` (la puerta a mausoleo1), `offsetX: -0.2`, para que encaje
mejor con el detalle del fondo pintado. Ajustable a ojo si hace falta más
o menos.

**6. Cadáveres demasiado pequeños para lootear (esqueleto arquero y
básico).** Medido con Python: el último fotograma de `death.png` ocupaba
una fracción minúscula del lienzo de 128×128 (68×32 px el básico, 61×30 el
arquero, pegado abajo del todo). Reescalado con Lanczos, anclado por el
punto centro-abajo del contenido original (para no "flotar" ni desplazarse
del suelo): arquero (`enemy5`) ×2, básico (`enemy1`) ×1.5, tal como se pidió.

**7. Esqueleto básico (`enemy1`), idle con trocito de mano/daga
desaparecido en varios fotogramas.** Comparación píxel a píxel de los 6
fotogramas de `idle.png` contra el más completo (frame 0): varios (1,2,3,4,5)
tenían huecos de 28 a 84 píxeles en la zona de la mano/daga (recorte fijo
x50-105,y60-110) que frame 0 sí tenía. Se parchearon SOLO esos píxeles
concretos (no todo el fotograma, para no romper el balanceo natural del
idle) copiándolos del frame de referencia.

**8. Golem de hueso (`golembone`), fotograma roto en `idle` + pies flotando
en `attack`.** El 10º (y último) fotograma de `idle.png` salía notablemente
más pequeño y flotando por encima del suelo respecto a los otros 9 (altura
de contenido 81px vs 114-116px en el resto, medido con bounding box de
alpha). Sustituido por una copia del fotograma 9 (el anterior, bueno) —
recurso rápido y seguro para quitar un fotograma roto de un bucle sutil sin
arte nuevo. Además, en `attack.png` el golem literalmente flotaba 18-20px
por encima del suelo en 2 de sus 8 fotogramas (pies en y=103-104 frente a
y=119-123 en el resto) — confirmado bug de verdad (no un salto
intencionado: idle/walk/death del mismo bicho tienen los pies siempre en la
misma fila). Arreglado desplazando verticalmente el contenido de cada
fotograma para que los pies queden todos en la misma fila de referencia
(y=122), sin reescalar nada, solo corrigiendo la posición.

**8b. Diagnóstico sistemático de las 40 y pico tiras de sprite del juego**
(pedido expreso del usuario: "revisar todas las animaciones"). Se midió,
por cada fotograma de cada clip, dónde empieza la cabeza de verdad (saltando
armas/objetos alargados que falsean la medida — el problema de origen que
señaló el usuario) y dónde caen los pies. Hallazgos:
- **Muertes de todos los bichos + `hero/loot`**: varían mucho de altura a
  propósito (se van desplomando/agachando) — dadas por buenas por el
  usuario, no se tocan salvo que algo concreto se vea mal.
- **Esqueleto arquero (`enemy5`) al atacar**: varía de altura (72-101px)
  pero los PIES están perfectamente clavados en la misma fila (y=122) en
  los 7 fotogramas — la variación es casi seguro el propio arco
  tensándose/soltando, no un fallo de escala. Anotado, sin tocar, a la
  espera de que el usuario vea algo raro de verdad jugando.
- El resto de clips (`idle`/`walk` de todos los bichos, `hero/attack1`,
  `hero/potion`, `hero/activate`...) miden consistentes, sin bandera.

## Leaderboard global del Esqueleto Mago (V0.28)

**9. Animación de ataque del héroe (`attack1`/`attack2`) — medido con la
capucha como referencia, no la espada.** Confirmado el diagnóstico del
usuario: medir la altura total del sprite (incluyendo la espada en alto)
da lecturas muy infladas en los fotogramas de estocada alta (hasta 89px)
frente a los de guardia baja (~55-65px), lo que llevaría a "corregir" una
escala que en realidad nunca estuvo mal. Midiendo desde donde EMPIEZA la
cabeza de verdad (saltando el tramo fino de la hoja de la espada, detectado
por anchura de silueta ≥15px) hasta los pies: `attack1` da 52-57px (muy
consistente), `attack2` da 52-64px (más variación, pero con los pies
siempre clavados en la misma fila — podría ser el propio agachado/estirado
del golpe, no un fallo de escala). **No se ha aplicado ningún reescalado**
a la espera de que el usuario confirme si el "cambio de tamaño" que percibe
va más allá de esto.

**10. Atajos de teclado 1-9 y 0 para la barra de acción (solo PC).** Nuevo
`initActionBarHotkeys()` en `skills.js`, llamado una vez desde
`initSkillShop()`. 1-9 arman los huecos 1-9, 0 arma el 10º (último,
`ACTIONBAR_SLOTS=10`). Se ignora si hay Ctrl/Alt/Meta pulsado, si el foco
está en un `<input>`/`<textarea>` (el nombre del leaderboard, por ejemplo),
o si la habilidad de ese hueco está bloqueada (cooldown o sin PA — mismo
criterio que el velo rojo visual).

**Pruebas hechas**: `resetRunState()` no revienta al llamarla. Datos de
`mausoleo1.json`/`mausoleo2.json` tras el desplazamiento: héroe, enemigos y
salida en casillas caminables, `arriveX/arriveY` correctos; `exit_3` de
`cemetery.json` con su `offsetX`. Verificación de dimensiones de todos los
sprites tocados (múltiplos de 128×128 tras el reescalado/parcheado).

## Leaderboard global del Esqueleto Mago (V0.28)

Primer sistema con backend de verdad en Cripta. Cripta es una web estática
(GitHub Pages, sin servidor propio), así que el leaderboard vive en
**Supabase**, en el proyecto compartido **`cripta-habilidades`** (mismo
proyecto que usan otras apps del usuario — Sprite Forge, y hasta un juego
sin relación ninguna; se decidió reutilizarlo a propósito en vez de crear
uno nuevo). Tabla propia con prefijo `cripta_` para no mezclarse:
**`cripta_boss_leaderboard`** (`player_name`, `time_ms`, `client_version`,
`created_at`).

**Seguridad — limitación conocida y aceptada**: al no haber servidor propio
ni login de jugadores, no hay forma de verificar de verdad que un tiempo
enviado es legítimo — cualquiera podría mandar uno falso a mano desde las
herramientas de desarrollador del navegador. RLS permite lectura Y
escritura públicas sin autenticarse; los únicos límites son los `CHECK` de
la tabla (nombre 2-20 caracteres, tiempo entre 0 y 24h) — una red de
seguridad mínima, no un sistema antitrampas. Sin `UPDATE`/`DELETE` para
nadie salvo la service role (una puntuación, una vez mandada, no se puede
tocar desde el cliente).

**Cliente**: `js/leaderboard.js`, nuevo módulo. Habla directo con la API
REST de Supabase (PostgREST) vía `fetch()` — **no** se añadió el SDK
`supabase-js` a propósito, para no meter una dependencia externa en un
proyecto vanilla JS sin build step. Expone `fetchTop10()` (nunca revienta,
devuelve `[]` si falla la red — el leaderboard es un extra, no debe
bloquear el juego), `submitScore(nombre, ms, versión)`, `formatTime(ms)`
(`mm:ss.d`) y `rankWithinTop10(top10, ms)` (puesto 1-10, o `null` si no
entra).

**Cuándo empieza el cronómetro**: `state.hero.runStartedAt = Date.now()` en
`loadLevel()` (`main.js`), SOLO en partida nueva de verdad (rama `else`,
donde también se resetea `totalKills`) — nunca al retomar una partida
guardada. Al bajar de nivel (`descend()`) se arrastra en el objeto `carry`
junto con vida/oro/`totalKills`, para que el cronómetro no se reinicie al
cambiar de zona. Se guarda solo porque `savegame.saveGame()` ya copia TODO
`state.hero` tal cual (`{ ...state.hero }`) — no hizo falta tocar
`savegame.js` para nada.

**Cuándo termina el nivel de verdad (ojo, cambiado a mitad de sesión)**:
NO al morir el jefe — al **cerrar la ventana de botín de su cadáver**. El
enganche generalizado: nuevo `bindOnCorpseLooted(fn)` en `ui.js`, llamado
desde `closeLootVeil()` (cubre las 3 formas de cerrar el botín: botón
"coger todo", cerrar sin más, o coger el último objeto suelto uno a uno)
con la fuente que se acaba de cerrar. Conectado en `main.js` a
`checkBossLooted(source)` (`rules.js`): si `source.id === 'enemy6_boss'`,
calcula `Date.now() - state.hero.runStartedAt` y llama a
`gameOver('win', { timeMs })`. `checkFullVictory()` pasó de mirar
`foe.alive` a mirar un flag `cryptBossLooted` que solo se pone a `true`
aquí — así la victoria no salta en el instante de la muerte.

**Pantallas nuevas/ampliadas**:
- `#leaderboard` (`index.html`, mismo molde `.splash` que las novedades):
  se ve **siempre** al arrancar (decisión del usuario, no solo en partida
  nueva), justo después de cerrar `#splash` y antes de la tienda de
  habilidades — `showLeaderboard()` en `main.js` pinta el TOP10 (rango,
  nombre escapado con `escapeHtml()`, tiempo formateado).
- Pantalla de victoria (`renderOver`, `ui.js`): si `gameOver('win', {timeMs})`
  trae un tiempo, añade una línea con el tiempo + un formulario mínimo
  (nombre + botón "Enviar al leaderboard"). Al enviar: `submitScore()`, y si
  sale bien, un segundo `fetchTop10()` para calcular en qué puesto quedaría
  (`rankWithinTop10`) y mostrarlo. Si falla el envío (sin conexión...), aviso
  y se puede seguir jugando igual — nunca bloquea el botón "Otra incursión".

**Pruebas hechas**: funciones puras de `leaderboard.js` (`formatTime`,
`rankWithinTop10`, varios casos con el top a medias/lleno). `checkBossLooted`
con un cadáver de verdad del jefe (no revienta, dispara `gameOver`) y con un
contenedor cualquiera (no hace nada). Inserción/lectura reales contra la
tabla de Supabase (y borrado del registro de prueba después).

## Nivel "Cripta" de verdad + jefe de dos palancas (V0.27)

El `cripta.json` que había hasta ahora era un **placeholder de pruebas**
(18×18, solo un cofre y un altar, sin enemigos, salida a `level1`). Se
sustituyó entero por el nivel real diseñado en el editor (78×52, 60
enemigos, 54 objetos, salida a `cemetery`), exportado como JSON desde
**CRIPTA Editor v0.12.2/v0.12.5** y pegado tal cual, conservando todos los
IDs de sus marcadores (protocolo del editor: "el editor define DÓNDE, Claude
implementa QUÉ").

**Conversión hecha al importar** (los `note` de los marcadores, que eran
contexto para implementar la lógica, se quitaron del JSON final — no
aportan nada al motor):
- `lever_1`/`lever_4`: se les añadió `"sprite": "lever"` (el JSON del editor
  no lo traía; sin esto se habrían dibujado con el glifo `/` genérico, como
  antes de la V0.26.1).
- `event_tchamber` (cámara del tesoro, marcador invisible): se marcó
  `"walkTrigger": true` y se le dio una entrada sencilla en `events.json`
  (`event_tchamber`, solo `i18n`, sin `type` → pasa por la rama de mensaje de
  registro de `triggerWalkEvent`, no por una carta a toda pantalla — no había
  imagen para ello). Texto: "Vaya, vaya… parece que hemos encontrado una
  cámara secreta…".
- `event_3_bonegolem`/`event_bonegolem2` (marcadores puestos porque el editor
  aún no tiene el golem de hueso como colocable): **convertidos en enemigos
  reales** en `start.foes` — mismas stats que ya usa `pickWeightedSummon`
  para el golem de hueso (90hp/9atk/`tall:1.725`, dormant, wakeR 3). Se
  conservó el ID original de cada marcador como `id` del enemigo
  (`event_3_bonegolem`/`event_bonegolem2`) para no perder la trazabilidad con
  el editor, aunque el nombre ya no describa bien qué es.
- `event_boss`: marcador invisible, se deja tal cual en `triggers` (sin
  entrada en `events.json` — no es interactivo, solo es la posición donde
  aparece el jefe, ver más abajo). Si se toca sin querer, sale el mensaje
  neutro de siempre ("no parece que haya nada aquí").

**Jefe de las dos palancas** (`checkLeverBossSpawn`, `rules.js`): cuando
`lever_1` Y `lever_4` están ambas activadas (da igual el orden), aparece un
**Esqueleto Mago** (`enemy6`, 80hp/8atk — decisión tomada esta sesión;
enemigos normales del nivel van de 9 a 16hp, el golem de hueso tiene 90/9)
justo en las coordenadas de `event_boss`. Detalles:
- `enemy6` **ya existía en el código con toda su IA** (invoca esqueletos
  cercanos y castea Llamada Sepulcral solo en su primer turno, ver
  `mageTurn`/`castSepulchralCall`) pero nunca se había colocado en ningún
  nivel — no hizo falta tocar su comportamiento, solo darlo de alta aquí.
- Se engancha con el mismo patrón que `resolveAltar`/`resolveChest`
  (`rules.js` no se puede importar desde `ui.js`, import circular): nuevo
  `bindOnLeverPulled(fn)` en `ui.js`, llamado al final de `activateLever()`
  (justo cuando se cierra la carta de la palanca), conectado desde
  `main.js` a `checkLeverBossSpawn`.
- La comprobación de "¿ya apareció?" se hace mirando si `state.foes` ya
  tiene un enemigo con `id: 'enemy6_boss'`, no con una variable aparte — así
  funciona bien también si se recarga una partida guardada después de que
  el jefe ya hubiera aparecido (no se duplica).
- **Matar al jefe basta por sí solo para terminar el mapa — única y
  exclusivamente esa condición** (decisión final del usuario, corrigiendo lo
  que se había dicho antes de que también hacía falta limpiar los 2
  mausoleos). Implementado en `checkFullVictory()` (`rules.js`): si hay un
  enemigo con `id: 'enemy6_boss'` y `!alive`, victoria inmediata
  (`gameOver('win')`), sin mirar el recuento total de la mazmorra para nada.
  Se quitó el ajuste de "+1" en `main.js` que se había añadido para la
  versión anterior de este mismo mecanismo (ya no hace falta: el jefe ya no
  depende de sumar/contar nada). El recuento de "mazmorra entera limpia" de
  siempre se conserva aparte, como camino alternativo para quien prefiera
  explorarlo todo sin usar el jefe como atajo — ambos caminos llevan a la
  misma pantalla de victoria.
- Confirmado con el usuario: "se reinicia el mapa" = la pantalla de victoria
  ya existente (`gameOver('win')` → botón de reiniciar). No hizo falta
  construir nada nuevo para esto, ya se comportaba así.
- **Pendiente para otra sesión** (decisión explícita): "se desbloquea el
  nivel 2 de dificultad" — no existe ningún sistema de dificultad por
  niveles todavía en el juego. Se deja sin implementar a propósito hasta
  diseñarlo con calma.

**Pruebas hechas**: batería headless de `checkLeverBossSpawn` (no aparece
con solo 1 palanca, aparece con las 2 en cualquier orden, con las stats y
coordenadas correctas, no se duplica si se vuelve a comprobar, ignora
palancas de otros niveles). Validación de `cripta.json`: dimensiones
78×52, héroe/enemigos/objetos todos en casillas caminables, sin IDs
duplicados entre triggers y enemigos. Se comprobó también, a petición del
usuario, que la malla del nivel encajaba con la imagen de referencia del
editor: el bloque `_editorMap` del JSON venía calibrado para una imagen de
1400×933, pero la imagen real subida medía 2160×1440 (factor ~1.543×) — con
los números crudos, un 17.3% de las casillas de "suelo" caían sobre el
fondo magenta (vacío) de la imagen; reescalando cellSize/origin al tamaño
real, ese porcentaje bajó a 0.0%. **Esto no afecta al nivel importado**: el
motor solo usa la matriz `tiles` (ya en coordenadas de rejilla), nunca ese
metadato de calibración de píxeles — es puramente para la vista previa del
propio editor.

**Cambio de idea del usuario a mitad de sesión**: la condición de victoria
de la cripta pasó de "matar al jefe Y limpiar los 2 mausoleos" a "matar al
jefe, única y exclusivamente" (ver el punto de `checkFullVictory` más
arriba) — el código se actualizó en el momento, no quedó ninguna referencia
a la versión anterior (ambos mausoleos limpios) en `AGENTS.md` ni en el
código.

## Ajuste de márgenes en las tarjetas "story" (cofre + altar + palanca) — V0.26

`storychoices` es la columna de texto que se superpone a la ilustración en
las tarjetas de imagen (cofre, altar, palanca — todas comparten esta misma
clase CSS en `css/styles.css`). Se estrechó para que el texto no se meta
en la parte dibujada de la ilustración (dejaba muy poco margen: `left:52%`
de escritorio / `50%` en móvil, ahora `58%`/`56%`), y los botones Sí/No/
Cerrar dentro de esa columna pasan a medir un 75% del ancho del texto
(antes ocupaban el 100%, de borde a borde) — `width:75%; align-self:center`
en `.card.story .storychoices .choice`. Afecta a la vez a cofres, altares y
la palanca (misma clase compartida), tal como se pidió.

## Cofres (V0.26)

Mismo patrón que ya se usó con los altares (V0.24): el cofre pasa de ser un
evento de `events.json` con 3 opciones elegidas por el jugador a ser **un
solo marcador genérico** — todos los `chest` del juego son iguales y
comparten el mismo pool de eventos aleatorios, sorteado al abrirlo. Se
quitaron las entradas `cofre`/`chest_1` de `events.json` (y sus textos
huérfanos en i18n): el contenido vive directamente en `CHEST_EVENTS`
(`rules.js`), igual que `ALTAR_EVENTS`. Los 3 cofres ya colocados
(cementerio, cripta, mausoleo2/level2) no necesitaron ningún cambio en sus
niveles — su `id` (`chest_1`/`cofre`) queda ahí pero ya no se usa para
nada, exactamente igual que pasa con el `id` de los altares.

**Flujo de interacción, con pregunta Sí/No (a diferencia de la primera
versión de esta misma feature, que abría directo)** — rama propia en
`rules.js`, justo después del bloque de altar y antes del bloque genérico
de "objeto con carta":
1. Adyacente y sin gastar → cuesta 1 PA, se reproduce `activateAnim` y se
   llama a `openChestCard(tr)` (ui.js), que muestra la pregunta ("Te
   acercas al cofre... ¿lo intentas abrir?") con la ilustración
   `chest_decision` (mismo molde `storywrap`/`storychoices` que el altar).
2. **No** → la carta se cierra sin más (el cofre sigue sin gastar: se puede
   volver a intentar más tarde, aunque el PA de tocarlo ya se haya gastado
   esta vez, igual que con el altar).
3. **Sí** → `resolveChest(trig)` (conectado desde `main.js` a
   `pickChestEvent` en `rules.js` vía `bindResolveChest`) sortea 1 de los 6
   eventos y marca `tr.used = true` — **pero todavía NO aplica el efecto**.
   En ese mismo instante: suena `chestOpen`, se reproduce `anim.loot`
   (héroe) + `anim.openProp(..., 'chest')` (la tapa se abre y se queda
   congelada en su último fotograma para siempre — `openProp` ya hace esto
   solo). La MISMA tarjeta cambia a mostrar el texto de ambientación del
   evento sorteado (`chest.evN.title`/`.result`, todavía sin imagen propia
   — ver más abajo) con botón **"Cerrar"**.
4. Al cerrar: `applyChest(trig, result)` (conectado a `applyChestEvent` en
   rules.js) aplica AHORA de verdad el efecto (oro/vida/invocación) — el
   jugador ve primero el texto, la recompensa se concreta al cerrar, tal
   como se pidió. Después, `afterInteract` (rules.js) ya no hace nada
   específico de cofre (se movió todo al paso 3): solo recalcula alcance y
   cierra turno si toca, igual que para cualquier otro objeto.
5. Ya gastado (toque posterior) → mensaje neutro (`log.chestSpent`).

**Por qué el cofre abierto no bloquea el paso**: `blockingTriggerAt` (en
`state.js`) ya excluye cualquier trigger con `used: true` de golpe — no
hizo falta ningún cambio para esto, es el mismo mecanismo que ya usa el
altar.

**Arte**: la imagen de la pregunta (`chest_decision.jpg`, subida por el
usuario, mismas dimensiones 1672×941 que `altar_decision`) ya está
conectada. Las 6 ilustraciones POR EVENTO (`chest_ev1..6`) siguen
pendientes — de momento el resultado es solo texto (cargar una ruta de
imagen que no existe rompería toda la carga del juego, ver `loadAssets` en
`assets.js`). Cuando lleguen, añadirlas a `sources` y cambiar el stage
`'result'` de `renderChestCard` para usar el mismo `storywrap`/`img` que ya
usa el stage `'ask'`.

**Los 6 eventos** (`CHEST_EVENTS` en `rules.js`; `n` = nº de evento, pensado
para poder engancharse a `chest_evN` cuando haya arte):
- **Buenos** (3): 1. Tesoro abundante (oro alto, 30–70). 2. Bolsa de
  monedas (oro modesto y seguro, 12–30). 3. Suministros del explorador
  (cura ~15% de la vida máxima que falte + oro pequeño, 8–15).
- **Malos** (3): 4. Cofre vacío (nada). 5. Aguijón oculto (quita vida,
  5–15% de la vida actual, nunca deja al héroe a menos de 1 — mismo
  patrón que el golpe del altar). 6. Ruido en la oscuridad (invoca 1
  enemigo adyacente al cofre, reutilizando `pickWeightedSummon` +
  `freeTileAdjacentTo` — el mismo pool ponderado que ya usaba la
  Invocación del altar; si no hay hueco libre, simplemente no aparece
  nada, sin reventar).

**Pensado para crecer**: de momento solo hay oro (no existen objetos
equipables de verdad todavía — ver "Pendiente de verdad" en la sección de
Contenedores de botín, más arriba). En cuanto haya un sistema de items real,
o nuevos minijuegos/riesgos, se amplía este mismo pool con más entradas.

**Pruebas hechas esta versión**: batería headless propia — `pickChestEvent`
invocado miles de veces comprobando que los 6 eventos salen todos, que NO
aplica ningún cambio de estado hasta que se llama a `applyChestEvent` por
separado, que oro/vida nunca quedan negativos tras aplicar, y que la
invocación no revienta aunque no haya hueco libre adyacente. No se tocó
ninguna posición de nivel, así que no hacía falta repetir el test de
conectividad completo.

## Golem de hueso + arreglos varios + entrada/salida con arte real (V0.25)

**Golem de hueso** (nuevo enemigo, `sprite: 'golembone'`): monstruosidad
grande y lenta. Escala 1.5× la de un esqueleto normal — para esto hizo falta
un campo nuevo `tall` por ENEMIGO (antes solo el héroe tenía su propio
`HERO_TALL`; el resto de enemigos usaban siempre `TOKEN_TALL` fijo en
`render.js`). 90 hp / 9 atk / 4 PA.

**No aparece colocado en el mapa**: sale de una emboscada disparada al
activar el "Evento" que llevaba desde siempre sin enganchar en Mausoleo 1
(`event_1`, x:5 y:4 — ahora renombrado `mausoleo1_golem_guard`, tipo
`ambush`, con su propia carta en `events.json`/i18n). Al tocarlo aparecen
DE GOLPE el golem + 4 esqueletos normales (`enemy1`) alrededor, todos ya
despiertos, con la MISMA música de combate de élite que la emboscada de
espectros de Mausoleo 2 (`spawnGolemGuard()` en `rules.js`, generalizando
`triggerAmbush()` para poder elegir la composición según el `id` del
marcador — antes solo sabía invocar espectros). Como el resto de emboscadas
dinámicas (spectros de Mausoleo 2 incluidos), estos 5 enemigos NO cuentan
para el total de la mazmorra (`setTotalFoeCount`, que solo suma
`start.foes` de cada nivel) — es coherente con cómo ya se comportaba la
emboscada de Mausoleo 2, no es un bug nuevo.

Sus 2 habilidades se comprueban al EMPEZAR su turno (`golemTurn` en
`rules.js`), antes de la pelea cuerpo a cuerpo normal con el PA que quede:
1. **Rematar débiles** (prioridad si las dos se cumplen a la vez): si algo
   adyacente —el héroe o uno de sus propios compañeros esqueleto— tiene
   menos del 5% de su vida máxima, lo mata de un golpe (cuesta lo mismo que
   un ataque normal), se cura 25% de su propia vida máxima y su daño sube
   10% **para siempre** (no caduca — un monstruo que crece con cada
   víctima). Si remata a un aliado suyo, NO pasa por `killFoe()` (que
   registraría Sed de Sangre/Cosecha de Almas como si el HÉROE hubiera
   hecho la muerte) — usa `executeAllyFoe()`, una versión más ligera sin
   esos ganchos.
2. **Aturdir**: si tiene 2 o más unidades "del bando del héroe" adyacentes A
   LA VEZ, gasta 2 PA en aturdir a la que menos vida tenga durante 2 turnos
   DE ELLA (no del golem). Con solo 1 héroe y sin mascotas todavía esto casi
   nunca se cumple — se dejó construido a propósito para cuando existan
   mascotas de verdad (decisión tomada con el usuario).

**Aturdido, primer estado real del juego**: `hero.stunnedTurnsLeft`,
comprobado en `startHeroTurn()` — PA a 0, texto flotante "¡Aturdido!",
decrementa y pasa turno solo. El icono (`status_aturdido.png`) y el texto
i18n (`status.aturdido`) ya existían de antes, preparados para cuando
hiciera falta un sistema de estados real (ver limitación conocida en la
sección de habilidades V0.23) — esto es el primer estado que de verdad los
usa. Genérico por diseño (`stunTarget(target, turns)` acepta cualquier
combatiente), aunque hoy solo el héroe puede sufrirlo.

**Arte**: 4 hojas de sprite (idle 10 fotogramas, andar 7, ataque 8, muerte
8) recortadas a rejilla fija (sin huecos entre celdas, a diferencia de las
hojas del altar) y escaladas cada una a SU PROPIA referencia interna (el
fotograma más alto de ESE clip, nunca una escala compartida entre clips —
ver la lección ya anotada más abajo, en "Técnicas de arte y animación").
Nota conocida: 2 fotogramas del idle (7.º y 8.º) salieron con menos
contenido de lo esperado al recortar la rejilla — imperceptible en un bucle
de respiración tan sutil, pero retocable si se nota en el juego.

**Audio del golem**: 3 pistas propias (`golemboneidle/walk/death`), más un
sistema nuevo y genérico de "sonido ambiental de monstruo grande"
(`MONSTER_IDLE_SOUND` en `rules.js`, por sprite): si hay uno despierto a
menos de 4 casillas, suena su idle como mucho 1 vez cada 10s (cada uno con
su propio cronómetro). Ojo si se prueba en Node: el `setInterval` de este
sistema lleva `.unref()` condicional (`if (typeof t.unref === 'function')`)
para no dejar colgado un proceso de pruebas headless — no afecta al
navegador, donde ese método no existe.

**Música de combate de élite** (`ost_combatelite.mp3` → `combatelite.mp3`):
nueva pareja `audio.startEliteMusic()/stopEliteMusic()`, en bucle, baja (no
para del todo) el ambiente de bosque mientras suena. Arranca en la
emboscada sincronizada de espectros de Mausoleo 2 (`triggerAmbush`), para
sola al terminar el combate (`checkCombatEnd`). Reservada para cuando se
invoque al Esqueleto Mago en la Cripta (pendiente, no implementado aún).

**Entrada/salida con arte real**: el glifo ▮/▯ de siempre se sustituye por
una imagen de usuario (`assets/props/exit/model.png`, escaleras hacia la
oscuridad) en el bucle de `state.exits` de `render.js`. Detección
automática de "entrada grande": dos marcadores de salida en casillas
adyacentes (Chebyshev = 1) se dibujan como UN solo modelo centrado entre
las dos, al DOBLE de tamaño normal (decisión tomada con el usuario: doble
tamaño fijo, no ajustado al ancho de las 2 casillas). El aro/resplandor de
color de siempre (abierta/bloqueada, con niebla o sin ella) se queda
detrás del modelo, sin cambios.

**Habilidades bloqueadas en la barra de acciones**: velo rojo + número de
combates de enfriamiento restantes cuando una habilidad no se puede usar
(en CD o sin PA suficientes) — ya no se pueden pulsar. Nuevo getter
`getSkillCooldownLeft(id)` en `rules.js`, conectado a `skills.js` con el
mismo patrón bind-callback que ya usa `useActiveSkill` (`skills.js` no
puede importar `rules.js`: import circular). `renderActionBar()` ahora se
exporta y se refresca sola cada vez que se llama a `syncHUD()` (otro
bind-callback, `bindRefreshActionBar`, para que ui.js tampoco tenga que
importar skills.js).

**Arreglado — Golpe desde las Sombras atacaba/interactuaba "a distancia"**:
el teletransporte actualizaba `hero.x/hero.y` (posición lógica) pero nunca
el sprite en pantalla ni la cámara — el héroe ya estaba ahí de verdad, solo
que su dibujo se quedaba atrás. Nueva función `anim.snapTo(name, gx, gy)`
(reposiciona un actor de golpe, sin animación, incluso si ya existía —
a diferencia de `ensure()`, que no toca nada si el actor ya está creado).

**Reordenado — el contenedor se rompe al CERRAR el loot, no al abrirlo**:
`anim.openProp`/`audio.fx('containerBreak')` se movieron de la interacción
inicial (`rules.js`) a `markLootSourceEmptied()` (`ui.js`), que ya es el
único punto por el que pasa "este contenedor se ha vaciado del todo".

**Tienda de habilidades — ya no aparece al simple retomar una partida**:
antes se abría SIEMPRE al pulsar "Continuar" en la pantalla de novedades,
también al reanudar una partida guardada a medias. Ahora: `isFreshBoot`
(`!savegame.hasSave()` calculado ANTES de que `bootLevel()` decida nada) es
lo único que decide si "Continuar" abre la tienda; además `newGame()` (que
sirve tanto para morir-y-reintentar como para el botón manual de reiniciar)
y `descend()` (bajar de nivel) la abren siempre, sin depender de la
pantalla de novedades.

**Ajustes menores**: escala del altar +50% (`tall` propio, igual mecanismo
que el del golem); número de cantidad de oro en el inventario más grande en
móvil (14px→20px, negrita).

**Revisado y NO era un bug** — "abrir un cofre reinicia la partida": el
flujo completo (tarjeta → efecto → animación) no tiene ninguna ruta que
reinicie por error; si el cofre lleva el efecto negativo (`hp:-6`) y el
héroe ya estaba muy débil, sí puede morir de verdad, y la pantalla de
derrota (con su botón "jugar de nuevo") es justo eso: una muerte real, no
un reinicio accidental. Pendiente de confirmar con el usuario si le sigue
pasando con vida de sobra.

## Altares (V0.24)

Sistema nuevo, reemplaza al viejo evento genérico de 3 opciones que tenía el
altar desde el principio. **Un solo marcador genérico**: todos los altares
del juego son idénticos y comparten el mismo pool de 10 eventos aleatorios
(5 buenos / 5 malos) — no pasan por `events.json` en absoluto, el contenido
vive directamente en `ALTAR_EVENTS` (`rules.js`). Los 5 marcadores ya
colocados en los niveles (cementerio, cripta, level2, mausoleo1 ×2) se
reutilizaron tal cual, solo se les añadió `"sprite": "altar"` para que se
vean con el arte real en vez del rombo ◆ genérico.

**Flujo de interacción** (rama propia en `rules.js`, ANTES del bloque
genérico de "objeto con carta"):
1. Adyacente y sin gastar → `openAltarCard` (ui.js): tarjeta "story" con la
   imagen `altar_decision` y pregunta Sí/No (mismo patrón visual que
   `renderLeverCard`, pero con lógica propia — no es una palanca).
2. **Sí** → `resolveAltar(trig)` (conectado desde `main.js` a `rollAltar` en
   `rules.js`, vía `bindResolveAltar` — rules.js no se puede importar desde
   ui.js, ya que rules.js ya importa de ui.js: import circular). `rollAltar`
   sortea 1 de los 10, marca `tr.used = true`, aplica el efecto de verdad y
   devuelve la entrada elegida.
3. La MISMA tarjeta cambia a la imagen/texto de ESE evento concreto
   (`altar_evN` + `altar.evN.title`/`.result`), con sonido `altarGood`/
   `altarBad` según el tipo, y un botón **"Cerrar" explícito** (a diferencia
   de la palanca/ambientación, que se cierran tocando en cualquier parte —
   aquí se pidió expresamente un botón).
4. Al cerrar: `afterInteract` (rules.js) dispara `anim.pulseProp(...,
   'altar', 'activate'+N)` — enciende (fotogramas 1→4) y se apaga solo
   (4→1) en el propio mapa, y el altar queda para siempre en su idle de
   reposo (nunca se congela como el cofre, ni desaparece como un
   contenedor — por eso `render.js` tiene que exceptuar también a
   `type: 'altar'` de "se oculta en cuanto `tr.used`").
5. **No**, o altar ya gastado (toque posterior) → mensaje neutro
   (`log.altarSpent`), no pasa nada más.

**Arte**: 2 hojas de sprites subidas por el usuario (magenta, rejilla
4 columnas × 5 filas cada una) recortadas a fotogramas de 128×128 (mismo
`SPRITE_TILE` que el resto del juego) con chroma-key + reescalado
"contain" uniforme para las 40 celdas (evita que el altar cambie de
tamaño/posición entre eventos). `assets/props/altar/idle.png` (reposo,
compartido) + `activate1..10.png` (4 fotogramas cada uno). Las 11 imágenes
de ambientación (`altar_decision` + `altar_ev1..10`) son ilustraciones
completas del usuario, mismo molde que `story_lever_arm` (escena a la
izquierda, hueco de pergamino en blanco a la derecha) — convertidas a
`.jpg` (de ~29MB a ~4MB en total, sin transparencia real que perder).

**Los 10 eventos** (`ALTAR_EVENTS` en `rules.js`; `n` = nº de evento = sufijo
del clip `activateN` y de la imagen `altar_evN`):
- **Buenos** (rango 15%–40% donde aplica; buffs duran **3 combates**):
  1. Curación completa (a tope). 2. Lluvia de oro. 3. Bendición de fuerza
  (+15% daño hecho). 4. Piel de piedra (−15% daño recibido). 5. Ojo
  revelador (`revealAllExplored()` en state.js: marca todo el nivel como
  explorado/penumbra de golpe, no toca `visible`/iluminado).
- **Malos** (rango 5%–15%, suavizado a petición; debuffs duran
  **2 combates**): 6. Golpe del altar (quita vida, nunca deja al héroe a
  menos de 1). 7. Maldición de debilidad (−10% daño hecho). 8. Robo (quita
  oro, nunca negativo). 9. Invocación (1 enemigo cerca del altar,
  `freeTileAdjacentTo`, ponderado a la INVERSA de su vida máxima entre los
  3 tipos ya animados de verdad — esqueleto/arquero/espectro — cuanto más
  poderoso, menos probable, pero cualquiera puede salir). 10. Maldición de
  fragilidad (+10% daño recibido).

**Duración en combates, no en turnos**: los 4 buffs/debuffs
(`altarStrengthCombats`/`altarStonehideCombats`/`altarWeaknessCombats`/
`altarFragileCombats`) se decrementan en `checkCombatEnd()`, exactamente
igual que ya hacían los enfriamientos de habilidad (`skillCooldowns`) — NO
en `startHeroTurn()` como Grito de guerra/Forma Salvaje (esos sí son "por
turnos"). Se multiplican dentro de `resolveHeroHit` (daño hecho) y
`applyIncomingHit` (daño recibido, después de esquivar/bloquear, antes del
escudo de Gracia Vigilante).

**Pendiente/limitación conocida**: el pool de invocación solo incluye los
3 tipos de enemigo ya animados de verdad (esqueleto, arquero, espectro) —
el esqueleto mago (`enemy6`) se dejó fuera a propósito porque su lógica de
invocación (`spawnSkeleton`) asume que lo lanza OTRO mago, no tiene sentido
como aparición suelta. Cuando lleguen los otros 2 tipos de esqueleto
animados (ver pendientes generales más abajo), añadirlos aquí también.

**Pruebas hechas esta versión**: batería headless propia (`rollAltar`
invocado miles de veces con `state` simulado) comprobando que los 10
eventos salen con frecuencia pareja, que los rangos de daño/oro/curación
respetan sus límites (incluida vida a 1 / oro a 0), que Invocación coloca
al enemigo adyacente al altar ya despierto, y que llamar `rollAltar` dos
veces sobre el mismo trigger no revienta. Los niveles tocados solo
recibieron el campo `sprite` añadido (ninguna casilla/posición cambió), así
que no hacía falta repetir el test de conectividad completo.

## Efectos reales de las 11 habilidades nuevas (V0.23)

Se añaden 11 habilidades más de 7 clases nuevas (Asesino, Mago, Brujo,
Clérigo, Druida, Nigromante, Cazador), todas con efecto real en combate
desde el minuto uno (mismo criterio que las 10 de la V0.21 — nada de
catálogo-sin-efecto). Aparcadas a propósito (ver "Pendiente" más abajo):
**Levantar Muertos** y **Vínculo con la Fiera** (necesitan aliados/mascota
controlados por IA propia) y **Maldición Persistente** (necesitaría un
motor de estados-por-turno real que hoy no existe).

- **Golpe desde las Sombras** (Asesino, activa): teletransporta al héroe a
  una casilla libre junto al objetivo (`freeTileAdjacentTo`) y golpea con
  más probabilidad de crítico. Tier 3 = crítico garantizado, pero solo
  **una vez por combate** (`shadowStrikeUsedThisCombat`, se resetea en
  `checkCombatEnd`). Nota: el tier 2 no puede "ignorar armadura" porque los
  enemigos no tienen armadura propia en este motor — se convirtió en un
  pequeño bonus de daño en su lugar.
- **Instinto Letal** (Asesino, pasiva): bonus de daño si el objetivo está
  por debajo del % de vida de su tier. Se aplica dentro de `resolveHeroHit`
  a CUALQUIER golpe del héroe (normal o activa), no solo a una habilidad.
- **Cadena Arcana** (Mago, activa): golpea al objetivo y salta al enemigo
  vivo más cercano (dentro de `jumpRange`) sin repetir, perdiendo `falloffPct`
  de daño en cada salto, hasta `jumps` veces.
- **Sobrecarga Arcana** (Mago, pasiva): al usar CUALQUIER activa, tira su
  probabilidad de no gastar el enfriamiento (`finishActiveSkillUse`). Tier 3
  cura un poco si son 2 procs seguidos (`arcaneOverloadStreak`).
- **Pacto de Sangre** (Brujo, activa): descuenta un % de la vida ACTUAL del
  héroe (nunca lo deja a 0, mínimo 1) e inflige daño de sombra alto; tier 3
  roba parte de ese daño como vida si el golpe mata.
- **Círculo de Renacer** (Clérigo, activa, auto-lanzamiento): cura al
  instante y, desde tier 2, deja una zona en el suelo (`holyZones`, radio
  `area`) que sigue curando cada turno del héroe mientras esté dentro y
  dura lo que indique `durationTurns`. Tier 3 añade `preventLethalOnce`: un
  golpe que dejaría al héroe a 0 lo deja en 1 en su lugar, una sola vez por
  zona lanzada (comprobado en `applyIncomingHit` → `tryLethalWard`).
- **Gracia Vigilante** (Clérigo, pasiva): `hero.wardShield` se PONE (no se
  suma) a `shieldPct × maxHp` al empezar cada turno del héroe
  (`refreshWardShield`), y absorbe daño antes que la vida en
  `applyIncomingHit`. Tier 3 cura un poco si el escudo del turno anterior
  seguía en pie al refrescarlo.
- **Forma Salvaje** (Druida, activa, auto-lanzamiento): buff temporal por
  turnos (mismo patrón que Grito de guerra: `wildShapeTurnsLeft`, decrece en
  `startHeroTurn`) con bonus de daño, armadura y curación al golpear. Se
  quitó la "penalización a distancia" del diseño original: el héroe no tiene
  una probabilidad de acierto a distancia que penalizar en este motor, así
  que el texto del tier 1 se simplificó para no prometer algo que no pasa.
- **Simbiosis Natural** (Druida, pasiva): `damageTakenLastTurn` se acumula en
  `applyIncomingHit` (por tanto solo cuenta golpes de combate, no trampas) y
  se revisa en `startHeroTurn` para curar si el turno anterior fue limpio (o
  de poco daño, desde tier 2). Tier 3 añade armadura mientras esté a vida
  completa.
- **Cosecha de Almas** (Nigromante, pasiva): misma mecánica que Sed de
  sangre (racha que se resetea al acabar el combate) pero solo cuenta
  muertes dentro de `nearbyRange` del héroe, y se aplica como multiplicador
  GENERAL de daño (no solo a hechizos de sombra) para que no sea una pasiva
  muerta mientras el héroe no tenga más hechizos de esa escuela. Tier 3: a 5
  stacks, el próximo uso de cualquier activa no gasta enfriamiento (comparte
  el mismo "vale" que Sobrecarga Arcana, `freeNextCastSkip`).
- **Disparo Múltiple** (Cazador, activa): traza una línea recta de 8
  direcciones desde el héroe hacia la casilla tocada (`foesInLine`, se para
  en el primer muro) y golpea a los primeros `maxTargets` enemigos que
  encuentra. Tier 3 añade `slowedTurns`: el enemigo afectado actúa con 1 PA
  menos en su PRÓXIMO turno, sea cual sea su tipo de IA (se resta y se
  restaura en el único punto común de las 4 variantes de turno enemigo,
  `runSingleFoeTurn`, sin tocar cada una por separado).

**Limitación conocida** (igual que ya advertía la V0.21): sigue sin existir
un motor de estados-por-turno de verdad. Todo lo de arriba son
turnos-contados a mano (como ya hacía Grito de guerra), no un sistema
genérico de "efectos con duración" reutilizable — construir ESE sistema es
lo que de verdad haría falta para Maldición Persistente (y para que
Tajo llameante/Nube de veneno quemen o envenenen de verdad turno a turno,
en vez de golpear una sola vez).



**Lección de la 0.20.1**: entre la 0.18 y la 0.19 se colaron dos regresiones
en `cemetery.json` (se perdió `background:{key:bg_cemetery}` y un evento
junto a la entrada perdió su `walkTrigger:true`, además de cambiar de id sin
querer y quedar desconectado de `events.json`). Ninguna se detectó a tiempo
porque la batería de pruebas headless no comprueba fondos pintados ni el
contenido de `events.json` contra los triggers de cada nivel — solo
conectividad/solapes. Si se retoca `cemetery.json` (o cualquier nivel con
fondo pintado) en el futuro, comprobar a mano estos dos puntos antes de dar
la versión por buena: 1) `background` sigue apuntando a una clave real de
`assets.js`; 2) cada trigger con `walkTrigger` en la versión anterior lo
sigue teniendo, y su `id` sigue coincidiendo con la clave real en
`events.json` (no basta con que el juego no reviente — puede fallar en
silencio mostrando el mensaje neutro de "sin evento conectado" en vez del
contenido real).

Ver `CHANGELOG.md` y `data/changelog.json` para el historial completo. A
grandes rasgos, sigue pendiente:
- **Las 4 salidas del cementerio grande ya están conectadas**: 1 y 2 llevan
  a `cripta` (siempre abiertas), 3 a `mausoleo1` y 4 a `mausoleo2`, ambas
  bloqueadas hasta tirar de `lever_1` (adyacente). El motor ahora soporta
  **varias salidas por nivel** (`state.exits`, cada una "mueble": ocupa su
  casilla, se interactúa desde al lado, opcionalmente `blocked`) además del
  formato antiguo de una sola (`state.exit`, sigue igual para Cripta,
  Mausoleo1, Mausoleo2 y level2 — no hacía falta tocarlos). La carta de la
  palanca sigue el patrón "pregunta Sí/No → la misma tarjeta cambia a texto
  de resultado" (`ev.<id>.question` / `.result` en events.json, con
  `unlocks: [ids de salidas]`) — reutilizable para futuras palancas sin
  tocar el motor, solo añadiendo la entrada en `events.json` + i18n.
- Enganchar `cast`/`potion` (héroe y esqueleto) a algún efecto de juego real.
- **Aparcadas a propósito tras la V0.23** (mismo calibre de trabajo, mejor
  todas juntas cuando toque): **Levantar Muertos** (Nigromante, necesita
  aliados invocados con IA propia, distinta del héroe y del enemigo — tocaría
  bastante `rules.js`/`state.js`), **Vínculo con la Fiera** (Cazador, necesita
  un sistema de mascota controlable que hoy no existe), y **Maldición
  Persistente** (Brujo, necesitaría el motor de estados-por-turno real
  mencionado arriba, que hoy tampoco existe).
- Animar a los otros dos tipos de esqueleto (espada+escudo, con armadura)
  cuando lleguen sus sprites — hoy están desactivados en el manifiesto.
- Usar el ensamblador de losetas (`mapgen.js`) para un nivel aleatorio.
- Sacar iconos sueltos del pool de UI estilo Diablo que el usuario subió
  (Claude guarda una copia de referencia fuera del repo; el pool en sí no
  vive en el proyecto para no hincharlo — pedir a Claude si hace falta algo
  de ahí).
