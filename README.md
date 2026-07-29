# Cripta — táctico de Puntos de Acción (Descent 2-inspired)

Versión actual: ver `VERSION` (fuente única, junto a `js/config.js`) y
`CHANGELOG.md` para el historial completo. Juego de rol táctico en rejilla
cenital, para móvil y PC, multiidioma (ES/EN). Sin build step: HTML/CSS/JS
vanilla con módulos ES nativos, Canvas 2D y datos en JSON.

> Para arquitectura a fondo, convenciones de código y decisiones de diseño
> ya tomadas, ver `AGENTS.md` — lectura obligatoria al empezar una sesión
> nueva. Este README es la vista general rápida.

## Qué es

El héroe recorre una mazmorra de 4 zonas conectadas (cementerio, cripta y
dos mausoleos) limpiándola de no-muertos, con un sistema de progresión de
habilidades (tienda con oro persistido) y guardado/resume completo. La
victoria depende de limpiar TODA la mazmorra conectada, no solo la zona en
la que se entró primero.

## Combate: Puntos de Acción (PA)

4 PA por turno (`AP_MAX`, `js/config.js`). Moverse 1 casilla = 1 PA
(`MOVE_COST`), más si hay que subir un escalón (`CLIMB_COST`) o el terreno es
difícil (`DIFFICULT_EXTRA`) — un desnivel mayor que `MAX_CLIMB` es un
precipicio infranqueable. Atacar cuesta `ATTACK_COST` (2 PA). Interactuar con
un objeto cuesta lo que diga su `actionCost` en `data/events.json`.

Los objetos "mueble" (cofre, altar, palanca, salida) ocupan su casilla: no se
puede caminar sobre ellos, hay que ponerse al lado y tocarlos. Las trampas
son un peligro de SUELO (si se pisan sin desarmar, se activan solas).

Fuera de combate el movimiento es libre (el PA se refresca solo al llegar a
0, o con el botón de Fin de turno si queda un resto que no alcanza para
nada más). En combate, la iniciativa decide el orden (héroe y enemigos
mezclados); cada tipo de enemigo tiene su propia IA (cuerpo a cuerpo,
arquero que huye y dispara, mago invocador con Llamada Sepulcral, espectro
que roba vida en grupo, golem de hueso con aturdimiento/ejecución).

## Habilidades y progresión

Tienda de habilidades (oro persistido entre partidas, `state.hero.gold` vía
`savegame.js`) con 21 habilidades activas/pasivas repartidas en 3 tiers de
progresión. Las activas se colocan en una barra de acción de 10 huecos
(movible) y tienen enfriamiento medido en COMBATES, no en turnos. Las
pasivas se muestran en verde en la ficha de personaje. "Reiniciar progreso"
borra oro, habilidades y el estado de todas las zonas para empezar de cero.

## Guardado y zonas

Partida guardada completa (posición, vida, enemigos vivos/muertos, niebla
explorada, orden de combate) que sobrevive a cerrar la app. Cada una de las
4 zonas (cementerio, cripta, mausoleo1, mausoleo2) tiene además su propia
"foto" (`savegame.js`: `snapshotZone`/`applyZoneSnapshot`) que se guarda al
salir de ella y se restaura al volver — así entrar y salir de un mausoleo no
reinicia el cementerio.

## Backend (Supabase)

Proyecto compartido `cripta-habilidades` (tablas con prefijo `cripta_`),
consumido con `fetch()` directo a la API REST — sin añadir el SDK
`supabase-js`, para mantener el proyecto vanilla JS sin build step:
- **Leaderboard global** (`cripta_boss_leaderboard`, `js/leaderboard.js`):
  tiempo en matar al Esqueleto Mago de la cripta. Lectura/escritura pública
  sin login.
- **Telemetría** (`cripta_error_log` + `cripta_events`, `js/telemetry.js`):
  errores de JS reales y eventos de partida (inicio de nivel, muerte,
  victoria, compra de habilidad...). Solo escritura pública; se consulta
  desde el panel de Supabase.

## Versión y anticaché

La versión vive en un único sitio: la constante `VERSION` en `js/config.js`.
De ahí sale el parámetro `?v=X.X.X` que se añade a todos los recursos
(imports entre módulos, `fetch()` de JSON, imágenes, `<script>`/`<link>` de
`index.html`), así que subir de versión fuerza la descarga de la versión
nueva sin necesidad de borrar caché a mano.

Para subir de versión, usar siempre `tools/bump_version.py` (nunca a mano):
actualiza `VERSION`, la constante en `js/config.js` y todos los `?v=...` del
proyecto de una sola vez.

## Estructura

```
index.html          Estructura y capas de UI. Meta-etiquetas anticaché. Carga CSS y main.js.
VERSION              Versión actual (fuente única junto a js/config.js).
CHANGELOG.md         Historial técnico (para Claude/desarrollo).
AGENTS.md            Arquitectura, convenciones y decisiones ya tomadas (lectura obligatoria).
css/styles.css       Estilo: pantalla completa + UI flotante escalable.
assets/
  tiles/, sprites/, props/, backgrounds/, audio/, ui/    Arte y sonido.
data/
  events.json           Objetos/eventos: tipo, coste en PA, efectos (texto en i18n).
  skills.json            Las 21 habilidades: tiers, coste, efecto, enfriamiento.
  changelog.json         Historial in-game, bilingüe (ES/EN).
  manifest.json          Lista de mapas activos.
  i18n/es.json, en.json  Todos los textos del juego.
  levels/
    cemetery.json          El cementerio (nivel 1, mapa fijo pintado).
    cripta.json            La Cripta (jefe: Esqueleto Mago).
    mausoleo1.json          Mausoleo 1 (guardia del Golem de hueso).
    mausoleo2.json          Mausoleo 2 (mecanismo de palancas).
js/
  config.js         Constantes: casilla, zoom, PA, escala de personajes, velocidad, VERSION (fuente única).
  i18n.js           Idiomas: carga y función t().
  assets.js         Precarga de imágenes y hojas de animación.
  state.js          Estado + mapa + altura/terreno difícil + niebla de guerra + alcance (Dijkstra).
  anim.js           Animación: movimiento, ataque, daño, números flotantes.
  render.js         Dibujo en Canvas: cámara, zoom, niebla, iconos, altura.
  rules.js          Turnos por PA, combate, IA enemiga, interacción, trampas, salida de nivel.
  ui.js             HUD (PA/vida/maná), cartas de evento, ajustes, fin de partida.
  skills.js         Tienda de habilidades + barra de acción.
  inventory.js      Inventario y equipo.
  savegame.js       Guardado/resume de partida + foto por zona + oro persistido.
  leaderboard.js    Cliente del leaderboard global (Supabase, fetch directo).
  telemetry.js      Cliente de telemetría/errores (Supabase, fetch directo).
  mapgen.js         Ensamblador de losetas para mapas aleatorios (probado, sin usar en niveles activos).
  main.js           Arranque: idioma, niveles, ajustes, cableado de todos los módulos.
tools/
  bump_version.py       Sube la versión en todo el proyecto de una vez.
  recenter_sprite.py    Recentra sprites por la cabeza (no por el cuerpo entero).
```

## Probar / desplegar

Necesita `http://` (fetch + módulos ES). Local: `python3 -m http.server`.
Producción: GitHub Pages (`index.html` en la raíz del repo
`egoivaldes-code/cripta`), desplegado vía Replit (zip → push) o Jules como
alternativa — ver el protocolo de entrega completo en el chat de Claude
(pregunta antes de empaquetar, parche solo con lo tocado, dos prompts
copiables, etc.).

## Extender

- Textos: edita `data/i18n/*.json`. Añadir idioma = nuevo archivo + botón en Ajustes.
- Nuevo objeto interactivo: entrada en `data/events.json` + un `trigger` en
  el nivel (`x,y,id,type`).
- Nueva habilidad: entrada en `data/skills.json` (tier, coste, efecto) +
  lógica real en `skills.js`/`rules.js` si es activa.
- Nivel: duplica un `data/levels/<nombre>.json`; enlaza zonas con `exits`
  (formato nuevo, varias salidas por nivel) o `exit` (formato antiguo, una
  sola). El editor de niveles (artifact aparte, no vive en el repo) exporta
  el JSON listo para pegar.
- Niebla: radio de visión en `SIGHT`/`SIGHT_DIM` (`js/config.js`).
- Economía de PA: `AP_MAX`, `MOVE_COST`, `ATTACK_COST`, `CLIMB_COST`,
  `DIFFICULT_EXTRA` en `js/config.js`.
- Arte: sprites generados con Pillow (recentrado por cabeza, no por cuerpo)
  y mapas de fondo con Nano Banana — ver `AGENTS.md` para las técnicas de
  extracción/recolor ya validadas.
