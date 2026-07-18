# AGENTS.md — guía rápida para trabajar en Cripta

Este archivo es para que cualquier IA (o persona) que abra este proyecto por
primera vez entienda rápido cómo está montado, sin tener que releer todo el
código. Si cambias algo estructural (arquitectura, convenciones, herramientas
nuevas), actualiza también este archivo.

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

Ver `CHANGELOG.md` y el resumen de contexto del proyecto para el historial
completo. A grandes rasgos, sigue pendiente: terminar de pintar el terreno
de la "cripta de prueba", enganchar `cast`/`potion` a efectos de juego,
animar a los otros dos tipos de esqueleto, y pulir el editor de niveles.
