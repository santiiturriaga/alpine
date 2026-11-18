"""Render the requested official PDF map into local, zoomable image tiles.

Source: Tourism Whistler's 2025/26 mirror of the resort-published winter map.
Requires PyMuPDF and Pillow. No network requests are made by the game.
"""
from pathlib import Path
import json
import io
import argparse
import pymupdf
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'assets' / 'maps'
SOURCE = DEST / 'whistler-blackcomb-winter-2025-26.pdf'
BASE = DEST / 'whistler-village-base-2024-25.pdf'
VIEWS = {
    'panorama': (1, (0, 0, 1728, 840)),
    'whistler-alpine': (0, (288, 820, 864, 1215)),
    'seventh-heaven': (0, (864, 820, 1440, 1215)),
    'blackcomb-glacier': (0, (1440, 820, 1728, 1215)),
    'legend': (1, (0, 569, 288, 920)),
}
BASE_VIEWS = {
    'village-base': (0, (22, 22, 1412, 1005)),
    'creekside-base': (1, (22, 28, 557, 1004)),
    'function-junction': (1, (564, 28, 964, 1004)),
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-only', action='store_true', help='Rebuild only the base-area atlas plates')
    parser.add_argument('--atlas', type=Path, help='Folder with the source PDF and plates.json')
    parser.add_argument('--pins-only', action='store_true', help='Update calibrated lift positions on existing tiles')
    args = parser.parse_args()
    dest = args.atlas or DEST
    views = BASE_VIEWS if args.base_only else VIEWS | BASE_VIEWS
    sources = {key: BASE if key in BASE_VIEWS else SOURCE for key in views}
    if args.atlas:
        spec = json.loads((dest / 'plates.json').read_text(encoding='utf-8'))
        views = spec['views']
        sources = {key: dest / spec['pdf'] for key in views}
    manifest = {'scale': 4, 'tileSize': 1024, 'views': {}}
    if args.base_only or args.pins_only:
        manifest = json.loads((dest / 'manifest.json').read_text())
    for name, (page_index, rectangle) in ({} if args.pins_only else views).items():
        doc = pymupdf.open(sources[name])
        clip = pymupdf.Rect(*rectangle)
        page = doc[page_index]
        preview = page.get_pixmap(matrix=pymupdf.Matrix(1, 1), clip=clip, alpha=False)
        Image.open(io.BytesIO(preview.tobytes('png'))).save(dest / f'{name}-preview.webp', quality=90, method=6)
        directory = dest / name
        directory.mkdir(exist_ok=True)
        cols = int((clip.width * 4 + 1023) // 1024)
        rows = int((clip.height * 4 + 1023) // 1024)
        for row in range(rows):
            for col in range(cols):
                tile = pymupdf.Rect(clip.x0 + col * 256, clip.y0 + row * 256,
                                   min(clip.x1, clip.x0 + (col + 1) * 256),
                                   min(clip.y1, clip.y0 + (row + 1) * 256))
                pixels = page.get_pixmap(matrix=pymupdf.Matrix(4, 4), clip=tile, alpha=False)
                Image.open(io.BytesIO(pixels.tobytes('png'))).save(directory / f'{col}-{row}.webp', quality=92, method=6)
        manifest['views'][name] = {'width': clip.width, 'height': clip.height,
                                   'cols': cols, 'rows': rows, 'page': page_index + 1,
                                   'pdfCrop': list(rectangle)}
        doc.close()
    if args.atlas and spec.get('liftAnchors'):
        from scipy.spatial import Delaunay
        survey = json.loads((dest / spec['survey']).read_text(encoding='utf-8'))
        lifts = {lift['id']: lift for lift in survey['lifts']}
        for name, stations in spec['liftAnchors'].items():
            anchors = []
            for key, end, px, py in stations:
                lift = lifts[key]
                x, z = lift['points'][0 if end == 'base' else -1]
                anchors.append(dict(id=f'{key}-{end}', name=f"{lift['name']} · {end}", x=x, z=z, px=px, py=py))
            manifest['views'][name]['anchors'] = anchors
            manifest['views'][name]['triangles'] = Delaunay([(a['x'], a['z']) for a in anchors]).simplices.tolist()
    (dest / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f"Atlas ready with {len(manifest['views'])} views.")


if __name__ == '__main__':
    main()
