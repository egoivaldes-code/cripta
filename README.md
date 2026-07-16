# Cripta — táctico de Puntos de Acción + eventos

Versión: 0.3 (ver `CHANGELOG.md`). Juego para móvil y PC, multiidioma.
Sin build step. Módulos ES nativos + datos en JSON.

## Combate: Puntos de Acción (PA)

4 PA por turno (`AP_MAX` en `js/config.js`). Moverse 1 casilla = 1 PA
(`MOVE_COST`). Atacar = 2 PA (`ATTACK_COST`), así que con 4 PA caben dos
ataques seguidos si no haces nada más. Interactuar con un objeto cuesta lo que
diga su `actionCost` en `data/events.json` (entre 1 y 3 según el objeto).

Los objetos "mueble" (cofre, altar, palanca, orbe, mesa) ocupan su casilla:
no se puede caminar sobre ellos, hay que ponerse al lado y tocarlos para
interactuar. Si están a la vista pero lejos, tocarlos da una pista ambigua
gratis (sin gastar PA) para decidir si merece la pena acercarse.

Las trampas son distintas: son un peligro de SUELO (sí se camina encima). Se
ven y dan pista igual que el resto; adyacente se pueden desarmar (gasta PA);
si se pisan sin desarmar —incluso de paso hacia otro destino— se activan solas.

El turno del héroe acaba solo (al llegar a 0 PA) o pulsando "Fin de turno".
El enemigo usa el mismo sistema pero como presupuesto interno: no se ve su
barra, simplemente se acerca y ataca según le rinda.

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
  events.json           Objetos/eventos: tipo, coste en PA, efectos (texto en i18n).
  i18n/es.json          Todos los textos en español.
  i18n/en.json          Todos los textos en inglés.
  levels/level1.json    Nivel 1 (rejilla, inicio, objetos, escalera de salida).
  levels/level2.json    Nivel 2.
js/
  config.js         Constantes: tamaño de casilla, visión, PA/turno, costes.
  i18n.js           Idiomas: carga y función t().
  assets.js         Precarga de imágenes.
  state.js          Estado + mapa + niebla de guerra + alcance por PA.
  anim.js           Animación: movimiento, ataque, daño, números flotantes.
  render.js         Dibujo en canvas: cámara, niebla, iconos de objeto.
  rules.js          Turnos por PA, interacción/pistas, trampas, salida de nivel.
  ui.js             HUD (con PA), cartas, ajustes (todo el texto vía t()).
  main.js           Arranque: idioma, niveles, ajustes, cableado.
```

## Probar / desplegar
Necesita http:// (fetch + módulos ES). Local: `python3 -m http.server`.
Producción: GitHub Pages (index.html en la raíz).

## Extender
- Textos: edita `data/i18n/*.json`. Añadir idioma = nuevo archivo + botón en Ajustes.
- Nuevo objeto interactivo: entrada en `data/events.json` (con `type`, `actionCost`,
  `choices`) + un `trigger` en el nivel (`x,y,id,type`). Tipos de icono disponibles
  en `glyphFor()` (`js/render.js`): chest, altar, lever, orb, table, trap.
- Nueva trampa: igual, pero con `"type":"trap"` y `"trapDmg"` en vez de `choices`.
- Nivel: duplica un `data/levels/levelN.json`; enlaza con el campo `exit.to`.
- Niebla: radio de visión en `SIGHT` (`js/config.js`).
- Economía de PA: `AP_MAX`, `MOVE_COST`, `ATTACK_COST` en `js/config.js`.
- Arte: sustituye los PNG de `assets/` (mismo orden de fotogramas).
