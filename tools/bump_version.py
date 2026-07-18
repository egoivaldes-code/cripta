#!/usr/bin/env python3
"""
bump_version.py — Sube el número de versión de Cripta en todo el proyecto.

POR QUÉ EXISTE
--------------
La versión vive en un único sitio "de verdad" (VERSION en js/config.js), pero
por el sistema anticaché se repite como "?v=X.X.X" en:
  - todos los import de módulos entre archivos js/*.js
  - los fetch() de JSON (events, changelog, niveles, i18n)
  - la carga de imágenes en assets.js
  - el <script> y <link> de index.html
Cambiarlo a mano en cada versión es mecánico y fácil de dejarse uno (ya ha
pasado). Este script lo hace todo de una vez, de forma consistente.

QUÉ HACE
--------
1. Lee la versión ACTUAL desde el archivo VERSION en la raíz del proyecto.
2. Reemplaza cada aparición exacta de "v=VIEJA" por "v=NUEVA" en todos los
   .js y .html del proyecto (con cuidado de no confundir 0.8 con 0.8.1).
3. Actualiza el archivo VERSION.
4. Actualiza export const VERSION = '...' en js/config.js.
5. Enseña un resumen de qué se tocó, para revisar antes de hacer commit.

USO
---
  python3 tools/bump_version.py 0.9
  python3 tools/bump_version.py 0.9.1 --dry-run   (para ver qué haría, sin tocar nada)

Se ejecuta desde la raíz del proyecto (donde está el archivo VERSION).
"""

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def find_targets():
    return [p for p in ROOT.rglob('*') if p.suffix in ('.js', '.html') and 'node_modules' not in p.parts]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('new_version', help='Número de versión nuevo, ej. 0.9 o 0.9.1')
    ap.add_argument('--dry-run', action='store_true', help='Solo muestra qué cambiaría, no toca nada')
    args = ap.parse_args()

    version_file = ROOT / 'VERSION'
    if not version_file.exists():
        print(f'ERROR: no encuentro {version_file}. Ejecuta esto desde la raíz del proyecto Cripta.', file=sys.stderr)
        sys.exit(1)

    old_version = version_file.read_text().strip()
    new_version = args.new_version.strip()
    if old_version == new_version:
        print(f'La versión ya es {old_version}, no hay nada que cambiar.')
        return

    # Escapa los puntos y evita que "0.8" pise dentro de "0.8.1" (o viceversa):
    # exige que justo después no venga otro dígito ni otro punto-dígito.
    pattern = re.compile(r'v=' + re.escape(old_version) + r'(?!\.?\d)')

    changed = []
    for path in find_targets():
        text = path.read_text(encoding='utf-8')
        new_text, n = pattern.subn(f'v={new_version}', text)
        if n:
            changed.append((path.relative_to(ROOT), n))
            if not args.dry_run:
                path.write_text(new_text, encoding='utf-8')

    config_path = ROOT / 'js' / 'config.js'
    config_pattern = re.compile(r"(export const VERSION = ')" + re.escape(old_version) + r"(')")
    config_text = config_path.read_text(encoding='utf-8')
    config_new, n_config = config_pattern.subn(r'\g<1>' + new_version + r'\g<2>', config_text)

    print(f'Versión: {old_version} -> {new_version}\n')
    for rel_path, n in changed:
        print(f'  {rel_path}: {n} reemplazo(s)')
    if n_config:
        print(f'  js/config.js: constante VERSION actualizada')
    else:
        print('  AVISO: no encontré la constante VERSION en js/config.js con el valor esperado; revísalo a mano.')

    if args.dry_run:
        print('\n(--dry-run: no se ha guardado nada)')
        return

    config_path.write_text(config_new, encoding='utf-8')
    version_file.write_text(new_version + '\n')
    print(f'\nListo. VERSION y js/config.js actualizados a {new_version}.')
    print('Recuerda: esto NO toca el CHANGELOG.md ni data/changelog.json (esos los escribimos a mano, con el contenido de la versión).')


if __name__ == '__main__':
    main()
