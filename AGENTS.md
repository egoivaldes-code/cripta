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
ambas admiten varias unidades — de momento son solo referencia visual para
el usuario, el motor real solo soporta UNA salida por nivel (`level.exit`).

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
  el movimiento desde el `pointerdown` fue menor a un umbral (~10px); si
  se superó, se entiende que el usuario quería mover la cámara, no pintar.
- **Layout en móvil**: mejor un `body` en columna flex a pantalla completa
  (`height:100dvh`) con las barras como `flex:none` y el área de mapa como
  `flex:1`, que calcular alturas fijas a mano — se adapta solo si cambia el
  contenido de las barras.

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

## Pendiente / próximos pasos posibles

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
- Animar a los otros dos tipos de esqueleto (espada+escudo, con armadura)
  cuando lleguen sus sprites — hoy están desactivados en el manifiesto.
- Usar el ensamblador de losetas (`mapgen.js`) para un nivel aleatorio.
- Sacar iconos sueltos del pool de UI estilo Diablo que el usuario subió
  (Claude guarda una copia de referencia fuera del repo; el pool en sí no
  vive en el proyecto para no hincharlo — pedir a Claude si hace falta algo
  de ahí).
