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

## Pendiente / próximos pasos posibles

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
- Ir ampliando `data/skills.json` con habilidades reales (una a una, con
  supervisión del usuario) y, más adelante, sustituir el sistema temporal de
  pruebas por uno con efectos de verdad en combate.
- Animar a los otros dos tipos de esqueleto (espada+escudo, con armadura)
  cuando lleguen sus sprites — hoy están desactivados en el manifiesto.
- Usar el ensamblador de losetas (`mapgen.js`) para un nivel aleatorio.
- Sacar iconos sueltos del pool de UI estilo Diablo que el usuario subió
  (Claude guarda una copia de referencia fuera del repo; el pool en sí no
  vive en el proyecto para no hincharlo — pedir a Claude si hace falta algo
  de ahí).
