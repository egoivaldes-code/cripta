# Cripta — prototipo táctico + eventos

Rol táctico cenital (rejilla por turnos) con eventos de decisión en HTML.
Sin build step. Módulos ES nativos + datos en JSON.

## Estructura

```
index.html          Estructura, HUD y capa de la carta de evento. Carga CSS y main.js.
.nojekyll           Le dice a GitHub Pages que sirva los archivos tal cual.
css/
  styles.css        Todo el estilo (paleta piedra/brasa).
assets/
  tiles/
    dungeon.png     Tileset: 3 variantes de suelo + muro (celdas de 128px).
  sprites/
    hero.png        Héroe: 4 fotogramas (quieto, paso dcha, paso izq, ataque).
    enemy.png       Enemigo: mismos 4 fotogramas.
data/
  events.json       Los eventos (tu "base de datos" de decisiones).
  level1.json       El nivel: rejilla, posiciones/stats iniciales y puntos de evento.
js/
  config.js         Constantes de motor (TILE...). Sin dependencias.
  assets.js         Precarga de imágenes (tileset). Añadir arte = una línea.
  anim.js           Animación: posición visual que persigue a la lógica.
  state.js          Estado de la partida + consultas del mapa. No dibuja ni toca el DOM.
  render.js         Dibujo en canvas. ÚNICA capa atada al canvas.
  rules.js          Turnos, movimiento y combate. El cerebro del juego.
  ui.js             Cartas de evento, HUD, registro, fin de partida (DOM).
  main.js           Punto de entrada: carga JSON, conecta módulos y arranca.
```

Flujo de dependencias (sin ciclos):
`config → state → {render, ui} → rules → main`.
El único puente delicado (ui ↔ rules) se rompe por inyección en `main.js`
(`bindAfterChoice`, `bindRestart`).

## Probar en local

`fetch` y los módulos ES necesitan `http://` (con `file://` se bloquean por CORS).
Cualquiera de estas sirve la carpeta:

- Python:  `python3 -m http.server` → abre `http://localhost:8000`
- Node:    `npx serve`
- O súbelo a GitHub Pages (abajo) y pruébalo por la URL, incluso desde el móvil.

## Desplegar en GitHub Pages (desde el móvil)

1. Crea un repositorio nuevo en github.com (público).
2. Sube el contenido de `cripta/` a la raíz del repo
   (Add file → Upload files; o desde `github.dev` pulsando `.` en el repo).
3. Settings → Pages → Source: **Deploy from a branch** → rama `main`, carpeta `/ (root)`.
4. Espera ~1 min. Tu juego queda en `https://TU-USUARIO.github.io/TU-REPO/`.

## Extender

Añadir un evento: mete una entrada en `data/events.json` con su `id`,
y coloca un punto en `data/level1.json` dentro de `triggers`:
`{ "x": 3, "y": 4, "id": "tu-id" }`.

Editar el mapa: cambia la matriz `tiles` en `data/level1.json`
(`0` = suelo, `1` = muro). Las dimensiones de la rejilla se derivan solas.

Nuevo nivel: duplica `level1.json`, cárgalo en `main.js` y llama a `initGame`
con él. (Cuando quieras varios niveles encadenados, lo montamos.)

Cambiar el arte del mapa: sustituye `assets/tiles/dungeon.png`. Es una tira
horizontal de celdas cuadradas; el valor de cada casilla (`0`,`1`,…) elige la
columna. La correspondencia está en `atlasCol()` dentro de `js/render.js`, y el
tamaño de celda fuente en `ATLAS_TILE` (`js/assets.js`). Para añadir un tipo de
casilla nuevo: añade una columna al PNG, un caso en `atlasCol()` y usa ese
número en el mapa.

Cambiar los sprites: sustituye `assets/sprites/hero.png` o `enemy.png`. Cada uno
es una tira de 4 fotogramas cuadrados en este orden fijo: 0 quieto, 1 paso
derecha, 2 paso izquierda, 3 ataque. Mantén ese orden (o ajusta los índices en
`js/anim.js`) y el tamaño de fotograma en `SPRITE_TILE` (`js/assets.js`).
Las animaciones (deslizar al mover, lunge al atacar, respiración en reposo) las
controla `anim.js`; los tiempos son `D_MOVE` y `D_ATTACK`.

## Limitaciones a propósito (siguiente escalón)

- Movimiento a una casilla por toque (sin pathfinding).
- IA enemiga voraz simple (puede trabarse en esquinas de muro).
