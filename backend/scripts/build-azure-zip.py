"""
Empaquetado para Azure App Service Linux (docs/GUIA_SOCIOS_AUTOS_AZURE_CLOUDAMQP.md, paso 5).

NO usa Compress-Archive (en Windows mete barras invertidas que rompen las rutas en Linux):
zipfile con rutas POSIX "/". Incluye dist/ (con dist/proto/inventory.proto), package.json,
package-lock.json, contracts/ (Swagger v1/v2/v3) y node_modules SOLO de produccion.

Para no destruir el node_modules de desarrollo (tests, nest cli), las dependencias de produccion
se instalan en una carpeta aparte (build-azure/) con `npm ci --omit=dev`, que equivale a
`npm prune --omit=dev` sobre una copia limpia.

Uso (desde backend/):
    npm run build
    python scripts/build-azure-zip.py            -> dist-azure.zip (40-65 MB esperado)
    python scripts/build-azure-zip.py --reuse    -> reutiliza build-azure/node_modules
"""
import os
import shutil
import subprocess
import sys
import zipfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAGING = os.path.join(RAIZ, 'build-azure')
SALIDA = os.path.join(RAIZ, 'dist-azure.zip')
EXCLUIR_EXT = ('.map', '.d.ts', '.tsbuildinfo', '.md', '.markdown')
EXCLUIR_DIRS = {'.bin', 'test', 'tests', '__tests__', 'docs', 'example', 'examples', '.github'}


def npm(*args, cwd):
    cmd = ['npm.cmd' if os.name == 'nt' else 'npm', *args]
    print('>', ' '.join(cmd), f'(en {os.path.relpath(cwd, RAIZ) or "."})')
    subprocess.run(cmd, cwd=cwd, check=True)


def preparar_node_modules(reusar: bool) -> str:
    destino = os.path.join(STAGING, 'node_modules')
    if reusar and os.path.isdir(destino):
        return destino
    shutil.rmtree(STAGING, ignore_errors=True)
    os.makedirs(STAGING)
    for f in ('package.json', 'package-lock.json'):
        shutil.copy2(os.path.join(RAIZ, f), STAGING)
    npm('ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', cwd=STAGING)
    npm('prune', '--omit=dev', '--no-audit', '--no-fund', cwd=STAGING)
    return destino


def agregar_arbol(z: zipfile.ZipFile, origen: str, prefijo: str, filtrar: bool) -> int:
    n = 0
    for base, dirs, archivos in os.walk(origen):
        if filtrar:
            dirs[:] = [d for d in dirs if d not in EXCLUIR_DIRS]
        for a in archivos:
            if filtrar and a.endswith(EXCLUIR_EXT) and not a.lower().startswith('license'):
                continue
            ruta = os.path.join(base, a)
            rel = os.path.relpath(ruta, origen).replace(os.sep, '/')  # barras POSIX
            z.write(ruta, f'{prefijo}/{rel}')
            n += 1
    return n


def main():
    if not os.path.isfile(os.path.join(RAIZ, 'dist', 'main.js')):
        sys.exit('Falta dist/main.js: ejecute "npm run build" primero.')
    if not os.path.isfile(os.path.join(RAIZ, 'dist', 'proto', 'inventory.proto')):
        sys.exit('Falta dist/proto/inventory.proto (assets de nest-cli).')
    nm = preparar_node_modules('--reuse' in sys.argv)
    if os.path.exists(SALIDA):
        os.remove(SALIDA)
    with zipfile.ZipFile(SALIDA, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        total = agregar_arbol(z, os.path.join(RAIZ, 'dist'), 'dist', filtrar=False)
        total += agregar_arbol(z, os.path.join(RAIZ, 'contracts'), 'contracts', filtrar=False)
        total += agregar_arbol(z, nm, 'node_modules', filtrar=True)
        for f in ('package.json', 'package-lock.json'):
            z.write(os.path.join(RAIZ, f), f)
            total += 1
        malas = [i.filename for i in z.infolist() if '\\' in i.filename]
        if malas:
            sys.exit(f'Rutas con barra invertida en el zip: {malas[:3]}')
    mb = os.path.getsize(SALIDA) / 1024 / 1024
    print(f'OK {os.path.relpath(SALIDA, RAIZ)}: {total} archivos, {mb:.1f} MB')
    if not 40 <= mb <= 65:
        print(f'AVISO: el tamano ({mb:.1f} MB) esta fuera del rango 40-65 MB de la guia (no es un error si el despliegue arranca).')


if __name__ == '__main__':
    main()
