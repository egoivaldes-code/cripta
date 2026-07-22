// Precarga de imágenes. El juego espera a que estén listas antes de dibujar.
// Dos formas de añadir un asset en `sources`:
//   · una ruta de texto  -> imagen suelta (sistema "legacy" de 4 fotogramas).
//   · un objeto {clip: ruta, ...} -> personaje con animaciones de verdad; se
//     carga cada clip por separado y `images[key]` queda como { idle: <img>, ... }.
// Qué claves tienen animaciones de verdad se define en ANIM_CLIPS (anim.js);
// aquí solo hace falta indicar dónde está cada hoja.

import { VERSION } from './config.js?v=0.20';

export const ATLAS_TILE = 128;  // px por celda en el tileset fuente (dungeon.png)
export const SPRITE_TILE = 128; // px por fotograma en las hojas de sprites

const sources = {
  tiles: './assets/tiles/dungeon.png',
  hero: {
    idlepeace: './assets/sprites/hero/idlepeace.png',
    idlecombat: './assets/sprites/hero/idlecombat.png',
    stancechange: './assets/sprites/hero/stancechange.png',
    walk: './assets/sprites/hero/walk.png',
    attack1: './assets/sprites/hero/attack1.png',
    attack2: './assets/sprites/hero/attack2.png',
    hit: './assets/sprites/hero/hit.png',
    loot: './assets/sprites/hero/loot.png',
    activate: './assets/sprites/hero/activate.png',
    death: './assets/sprites/hero/death.png',
    // 'cast' y 'potion' se guardan pero no se usan todavía (sin efecto de juego asignado).
  },
  enemy: './assets/sprites/enemy.png',
  enemy1: {
    idle: './assets/sprites/enemy1/idle.png',
    walk: './assets/sprites/enemy1/walk.png',
    attack: './assets/sprites/enemy1/attack.png',
    death: './assets/sprites/enemy1/death.png',
    cast: './assets/sprites/enemy1/cast.png',   // guardado; sin efecto de juego asignado todavía
  },
  enemy2: './assets/sprites/enemy2.png',
  enemy3: './assets/sprites/enemy3.png',
  enemy4: {
    idle:   './assets/sprites/enemy4/idle.png',
    walk:   './assets/sprites/enemy4/walk.png',
    attack: './assets/sprites/enemy4/attack.png',
    death:  './assets/sprites/enemy4/death.png',
  },
  enemy5: {
    idle:   './assets/sprites/enemy5/idle.png',
    walk:   './assets/sprites/enemy5/walk.png',
    attack: './assets/sprites/enemy5/attack.png',
    death:  './assets/sprites/enemy5/death.png',
  },
  enemy6: {
    idle:   './assets/sprites/enemy6/idle.png',
    walk:   './assets/sprites/enemy6/walk.png',
    attack: './assets/sprites/enemy6/attack.png',
    death:  './assets/sprites/enemy6/death.png',
  },
  grave: './assets/props/grave.png',
  chest: {
    idle: './assets/props/chest/idle.png',
    open: './assets/props/chest/open.png',
  },
  target: './assets/props/target_marker.png',
  // crypt / crypt_in: aparcados (arte isométrico; el cementerio ahora usa un fondo
  // pintado cenital). Los archivos siguen en el proyecto por si se retoman.
  bg_mausoleum1: './assets/backgrounds/mausoleum1.jpg',
  bg_mausoleum2: './assets/backgrounds/mausoleum2.jpg',
  void_forest: './assets/backgrounds/void_forest.jpg',           // fondo de "vacío" para biomas de exterior/bosque
  void_underground: './assets/backgrounds/void_underground.jpg', // fondo de "vacío" para biomas subterráneos
  story_cemetery_noises: './assets/ui/story_cemetery_noises.jpg',
};

export const images = {}; // se rellena tras loadAssets()

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No pude cargar ' + src));
    img.src = `${src}?v=${VERSION}`;
  });
}

export async function loadAssets() {
  const entries = await Promise.all(
    Object.entries(sources).map(async ([key, src]) => {
      if (typeof src === 'string') return [key, await loadImage(src)];
      // conjunto de clips (personaje animado): cargar cada uno y devolver un objeto
      const clipEntries = await Promise.all(
        Object.entries(src).map(async ([clip, path]) => [clip, await loadImage(path)])
      );
      return [key, Object.fromEntries(clipEntries)];
    })
  );
  for (const [key, img] of entries) images[key] = img;
  return images;
}
