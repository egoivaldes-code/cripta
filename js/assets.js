// Precarga de imágenes. El juego espera a que estén listas antes de dibujar.
// Añadir un asset nuevo = una línea en `sources`.

import { VERSION } from './config.js?v=0.5';

export const ATLAS_TILE = 128; // px por celda en el tileset fuente (dungeon.png)
export const SPRITE_TILE = 128; // px por fotograma en las hojas de sprites

const sources = {
  tiles: './assets/tiles/dungeon.png',
  hero: './assets/sprites/hero.png',
  enemy: './assets/sprites/enemy.png',
  enemy1: './assets/sprites/enemy1.png',
  enemy2: './assets/sprites/enemy2.png',
  enemy3: './assets/sprites/enemy3.png',
  grave: './assets/props/grave.png',
  // crypt / crypt_in: aparcados (arte isométrico; el cementerio ahora usa un fondo
  // pintado cenital). Los archivos siguen en el proyecto por si se retoman.
  bg_cemetery: './assets/backgrounds/cemetery.jpg',
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
    Object.entries(sources).map(async ([key, src]) => [key, await loadImage(src)])
  );
  for (const [key, img] of entries) images[key] = img;
  return images;
}
