# Herramienta de calibración de huecos de UI

`calibrar.html` es una herramienta aparte (no forma parte del juego, no se
carga desde `index.html`) para medir a mano, sobre una imagen de referencia,
las coordenadas exactas de zonas rectangulares de una interfaz — se usó para
colocar los huecos de equipo, la zona de estadísticas y la rejilla del
inventario, y sirve igual para cualquier pantalla futura parecida (un mapa
de habilidades, una tienda, etc.).

## Qué hace
- Se abre como cualquier archivo HTML (doble clic, o subiéndolo a un Repl).
- Trae de fondo la imagen de referencia del inventario ya incrustada. Para
  usarla con OTRA imagen, hay un botón de subir archivo arriba del todo que
  la sustituye.
- Por cada zona de la lista (array `SLOTS` al principio del `<script>`), se
  tocan sus dos esquinas; una lupa con flechas de ajuste fino (1/5/20 px)
  permite afinar el punto exacto antes de confirmarlo — pensado para que
  funcione igual de bien en móvil que en PC.
- Para una rejilla de casillas iguales (como el inventario), hay un modo
  aparte: mueve la rejilla entera con botones (posición X/Y, ancho y alto de
  celda, espacio entre celdas) viendo el resultado en directo en vez de
  fiarse de dos toques sueltos — mucho más preciso para una rejilla grande,
  porque un error pequeño no se amplifica.
- Al final, "Generar código" da el bloque de configuración (coordenadas)
  listo para copiar y pegar donde haga falta.

## Para reutilizarla en una pantalla nueva
1. Abre `calibrar.html`, sube la imagen de referencia nueva con el botón de
   arriba.
2. Edita a mano el array `SLOTS` (dentro del `<script>`) con las zonas que
   haga falta marcar esta vez — cada una es solo `{ id: '...', label: '...' }`.
   Si alguna es una rejilla de celdas iguales, dale el id `'inventoryGrid'`
   (así activa el modo visual de ajuste de rejilla) o pide que se generalice
   ese nombre si hace falta más de una rejilla a la vez.
3. Márcalas todas y genera el código.

No hace falta pedir que se reconstruya desde cero cada vez: este archivo ya
está listo para el siguiente uso.
