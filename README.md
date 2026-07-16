# Cripta — táctico + eventos

Versión: 0.2 (ver `CHANGELOG.md`). Juego para móvil y PC, multiidioma.
Sin build step. Módulos ES nativos + datos en JSON.

## Estructura

```
index.html          Estructura y capas de UI. Carga CSS y main.js.
.nojekyll           GitHub Pages sirve los archivos tal cual.
VERSION             Versión actual.
css/styles.css      Estilo: pantalla completa + UI flotante escalable.
assets/
  tiles/dungeon.png     Tileset (suelo con variantes + muro).
  sprites/hero.png      Héroe: 4 fotogramas (quieto, paso dcha/izq, ataque).
  sprites/enemy.png     Enemigo: mismos 4 fotogramas.
data/
  events.json           Eventos (estructura + efectos; el texto va en i18n).
  i18n/es.json          Todos los textos en español.
  i18n/en.json          Todos los textos en inglés.
  levels/level1.json    Nivel 1 (rejilla, inicio, eventos, escalera de salida).
  levels/level2.json    Nivel 2.
js/
  config.js         Constantes (TILE, radio de visión).
  i18n.js           Idiomas: carga y función t().
  assets.js         Precarga de imágenes.
  state.js          Estado + mapa + niebla de guerra (línea de visión).
  anim.js           Animación: movimiento, ataque, daño, números flotantes.
  render.js         Dibujo en canvas: cámara, niebla, pantalla completa.
  rules.js          Turnos, combate, salida de nivel.
  ui.js             HUD, cartas, ajustes (todo el texto vía t()).
  main.js           Arranque: idioma, niveles, ajustes, cableado.
```

## Probar / desplegar
Necesita http:// (fetch + módulos ES). Local: `python3 -m http.server`.
Producción: GitHub Pages (index.html en la raíz).

## Extender
- Textos: edita `data/i18n/*.json`. Añadir idioma = nuevo archivo + botón en Ajustes.
- Nivel: duplica un `data/levels/levelN.json`; enlaza con el campo `exit.to`.
- Niebla: radio de visión en `SIGHT` (`js/config.js`).
- Arte: sustituye los PNG de `assets/` (mismo orden de fotogramas).
