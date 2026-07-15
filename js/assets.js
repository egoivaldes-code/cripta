// Precarga de imágenes. El juego espera a que estén listas antes de dibujar.
// Añadir un asset nuevo = una línea en `sources`.

export const ATLAS_TILE = 128; // px por celda en el tileset fuente (dungeon.png)
export const SPRITE_TILE = 128; // px por fotograma en las hojas de sprites

const sources = {
  tiles: './assets/tiles/dungeon.png',
  hero: './assets/sprites/hero.png',
  enemy: './assets/sprites/enemy.png',
};

export const images = {}; // se rellena tras loadAssets()

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No pude cargar ' + src));
    img.src = src;
  });
}

export async function loadAssets() {
  const entries = await Promise.all(
    Object.entries(sources).map(async ([key, src]) => [key, await loadImage(src)])
  );
  for (const [key, img] of entries) images[key] = img;
  return images;
}
