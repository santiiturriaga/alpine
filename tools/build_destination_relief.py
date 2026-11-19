"""Build the selector's compact reliefs from the checked-in terrain and lift data."""

import json
import math
import re
import struct
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
GRID = 45


def json_export(path, name):
    source = path.read_text(encoding='utf8')
    match = re.search(rf'^export const {name} = (.*?);$', source, re.MULTILINE | re.DOTALL)
    return json.loads(re.sub(r',\s*\]$', ']', match[1]))


def simplify(points, tolerance):
    """Keep the route's termini and bends within the given planar error."""
    start, end = np.array(points[0]), np.array(points[-1])
    vector = end - start
    interior = np.array(points[1:-1])
    if len(interior) == 0:
        return [points[0], points[-1]]
    along = np.clip((interior - start) @ vector / (vector @ vector or 1), 0, 1)
    errors = np.linalg.norm(interior - (start + along[:, None] * vector), axis=1)
    furthest = int(errors.argmax())
    if errors[furthest] <= tolerance:
        return [points[0], points[-1]]
    split = furthest + 1
    return simplify(points[:split + 1], tolerance)[:-1] + simplify(points[split:], tolerance)


def relief(heights, bounds, lifts):
    min_x, min_z = bounds['minX'], bounds['minZ']
    width, depth = bounds['maxX'] - min_x, bounds['maxZ'] - min_z
    span = max(width, depth)
    cols = max(2, round((GRID - 1) * width / span) + 1)
    rows = max(2, round((GRID - 1) * depth / span) + 1)
    source_rows, source_cols = heights.shape
    x = np.linspace(0, source_cols - 1, cols)
    z = np.linspace(0, source_rows - 1, rows)
    i = np.minimum(x.astype(int), source_cols - 2)
    j = np.minimum(z.astype(int), source_rows - 2)
    u, v = x - i, (z - j)[:, None]
    nw, ne = heights[j[:, None], i], heights[j[:, None], i + 1]
    sw, se = heights[j[:, None] + 1, i], heights[j[:, None] + 1, i + 1]
    grid = (nw * (1 - u) + ne * u) * (1 - v) + (sw * (1 - u) + se * u) * v
    rise = (grid - grid.min()) * 1.36 / span + .055

    lines = []
    for lift in lifts:
        points = lift['points']
        if len(points) < 2:
            continue
        if math.dist(points[0], points[-1]) < span * .007:
            continue
        coordinates = [
            (round((x - min_x) / width * 65535), round((z - min_z) / depth * 65535))
            for x, z in simplify(points, span * .0015)
        ]
        if all(0 <= n <= 65535 for point in coordinates for n in point):
            lines.append(coordinates)

    yield struct.pack('<BBffH', cols, rows, width / span, depth / span, len(lines))
    yield np.round(rise * 65535).astype('<u2').tobytes()
    for line in lines:
        yield struct.pack('<H', len(line))
        yield np.array(line, dtype='<u2').tobytes()


def main():
    whistler = json_export(DATA / 'geography.js', 'resortBounds')
    packed = np.fromfile(DATA / 'resort.bin', dtype=[('height', '<u2'), ('cover', 'u1')])
    height = packed['height'].reshape(whistler['grid'], whistler['grid']) / 10
    entries = {'whistler-blackcomb': b''.join(relief(
        height, whistler, json_export(DATA / 'osm-whistler.js', 'liftData')
    ))}
    for path in sorted((DATA / 'mountains').glob('*/resort.json')):
        resort = json.loads(path.read_text(encoding='utf8'))
        raster = resort['terrain']
        samples = np.fromfile(path.with_name(raster['file']), dtype='<u2')
        height = samples.reshape(raster['rows'], raster['cols']) * raster['scale'] + raster['offset']
        entries[path.parent.name] = b''.join(relief(height, resort['bounds'], resort['lifts']))

    with (DATA / 'destination-relief.bin').open('wb') as output:
        output.write(b'ADR1' + bytes([len(entries)]))
        for name, record in entries.items():
            key = name.encode('ascii')
            output.write(bytes([len(key)]) + key + struct.pack('<I', len(record)) + record)


if __name__ == '__main__':
    main()
