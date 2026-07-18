#!/usr/bin/env python3
"""
recenter_sprite.py — Arregla hojas de sprites con fotogramas descuadrados.

PROBLEMA QUE RESUELVE
----------------------
Cuando una hoja de animación (tira de N fotogramas del mismo tamaño, uno al
lado del otro) se generó con un arte externo (Nano Banana, Pillow, etc.), a
veces cada fotograma queda recortado con el personaje en un sitio ligeramente
distinto dentro de su celda. El síntoma en el juego es que el personaje
"tiembla" o se desliza de lado a lado mientras hace un bucle de animación
(normalmente el idle, que es el que más se nota al estar en bucle largo).

QUÉ HACE
--------
Para cada fotograma:
  1. Encuentra el bounding box del contenido no transparente (alpha > umbral).
  2. Calcula su centro horizontal (cx).
  3. Desplaza el fotograma entero en horizontal para que ese centro caiga
     siempre en la misma columna (por defecto, el centro de la celda).
Así todos los fotogramas quedan alineados entre sí, igual que ya estaban los
del héroe (que es de donde sale esta técnica).

Por defecto SOLO corrige el eje horizontal (lo que causa el temblor lateral).
Si además hace falta alinear verticalmente (personaje que "bota"), usa
--vertical para alinear por la base del bounding box (los pies).

USO
---
  python3 tools/recenter_sprite.py RUTA_HOJA.png --frames N [opciones]

Ejemplos:
  python3 tools/recenter_sprite.py assets/sprites/enemy1/idle.png --frames 6
  python3 tools/recenter_sprite.py assets/sprites/enemy2/idle.png --frames 6 --dry-run
  python3 tools/recenter_sprite.py assets/sprites/enemy2/walk.png --frames 8 --vertical

Por defecto SOBRESCRIBE el archivo original. Usa --dry-run primero para ver
qué haría sin tocar nada, y --out para guardar en otro archivo de prueba.
"""

import argparse
import sys

import numpy as np
from PIL import Image


def analyze_frame(alpha, threshold):
    ys, xs = np.where(alpha > threshold)
    if len(xs) == 0:
        return None
    return {
        'x0': int(xs.min()), 'x1': int(xs.max()),
        'y0': int(ys.min()), 'y1': int(ys.max()),
        'cx': (int(xs.min()) + int(xs.max())) / 2,
        'cy': (int(ys.min()) + int(ys.max())) / 2,
    }


def shift_frame(frame, dx, dy, size):
    """Desplaza un fotograma (array HxWx4) dx/dy píxeles, rellenando con
    transparente lo que quede fuera. dx/dy pueden ser negativos."""
    out = np.zeros_like(frame)
    h, w = size, size
    src_x0, src_x1 = max(0, -dx), min(w, w - dx)
    dst_x0, dst_x1 = max(0, dx), min(w, w + dx)
    src_y0, src_y1 = max(0, -dy), min(h, h - dy)
    dst_y0, dst_y1 = max(0, dy), min(h, h + dy)
    out[dst_y0:dst_y1, dst_x0:dst_x1] = frame[src_y0:src_y1, src_x0:src_x1]
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('path', help='Ruta a la hoja de sprites (PNG con transparencia)')
    ap.add_argument('--frames', type=int, required=True, help='Número de fotogramas en la hoja')
    ap.add_argument('--size', type=int, default=128, help='Tamaño en píxeles de cada fotograma (por defecto 128, el estándar del proyecto)')
    ap.add_argument('--threshold', type=int, default=10, help='Umbral de alpha para considerar un píxel "contenido" (por defecto 10)')
    ap.add_argument('--target-cx', type=float, default=None, help='Columna X donde centrar (por defecto, el centro de la celda)')
    ap.add_argument('--vertical', action='store_true', help='Además de centrar en X, alinear la base (pies) en Y')
    ap.add_argument('--target-bottom', type=int, default=None, help='Fila Y de la base donde alinear los pies (por defecto, la más baja encontrada entre todos los fotogramas)')
    ap.add_argument('--out', default=None, help='Archivo de salida (por defecto, sobrescribe el original)')
    ap.add_argument('--dry-run', action='store_true', help='Solo muestra el diagnóstico, no guarda nada')
    args = ap.parse_args()

    size = args.size
    target_cx = args.target_cx if args.target_cx is not None else size / 2

    img = Image.open(args.path).convert('RGBA')
    arr = np.array(img)
    expected_w = size * args.frames
    if arr.shape[1] != expected_w:
        print(f'AVISO: la hoja mide {arr.shape[1]}px de ancho, pero {args.frames} fotogramas de {size}px serían {expected_w}px. Revisa --frames/--size.', file=sys.stderr)

    frames = [arr[:, i*size:(i+1)*size, :].copy() for i in range(args.frames)]
    boxes = [analyze_frame(f[:, :, 3], args.threshold) for f in frames]

    target_bottom = args.target_bottom
    if args.vertical and target_bottom is None:
        bottoms = [b['y1'] for b in boxes if b]
        target_bottom = max(bottoms) if bottoms else size - 1

    print(f'Fotogramas: {args.frames} · tamaño celda: {size}px · centrar en cx={target_cx:.1f}' + (f' · base en y={target_bottom}' if args.vertical else ''))
    out_frames = []
    for i, (frame, box) in enumerate(zip(frames, boxes)):
        if box is None:
            print(f'  frame {i}: vacío, se deja igual')
            out_frames.append(frame)
            continue
        dx = round(target_cx - box['cx'])
        dy = round(target_bottom - box['y1']) if args.vertical else 0
        print(f'  frame {i}: cx={box["cx"]:.1f} bottom={box["y1"]}  ->  shift x={dx:+d}' + (f' y={dy:+d}' if args.vertical else ''))
        out_frames.append(shift_frame(frame, dx, dy, size) if (dx or dy) else frame)

    if args.dry_run:
        print('(--dry-run: no se ha guardado nada)')
        return

    out_arr = np.concatenate(out_frames, axis=1)
    out_path = args.out or args.path
    Image.fromarray(out_arr, 'RGBA').save(out_path)
    print(f'Guardado: {out_path}')


if __name__ == '__main__':
    main()
