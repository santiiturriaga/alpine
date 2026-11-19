"""Build the selector's compact terrain, land cover and mapped routes."""

import json
import math
import re
import struct
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
GRID = 57
UNIT = 65535
DIFFICULTIES = {'green': 1, 'blue': 2, 'red': 3, 'black': 4, 'double': 5, 'unrated': 6}


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


def sample_grid(source, x, z):
    rows, cols = source.shape
    x, z = x * (cols - 1), z * (rows - 1)
    i = np.minimum(x.astype(int), cols - 2)
    j = np.minimum(z.astype(int), rows - 2)
    u, v = x - i, (z - j)[:, None]
    nw, ne = source[j[:, None], i], source[j[:, None], i + 1]
    sw, se = source[j[:, None] + 1, i], source[j[:, None] + 1, i + 1]
    return (nw * (1 - u) + ne * u) * (1 - v) + (sw * (1 - u) + se * u) * v


def sample_axis(size, peaks):
    # Insert exact summit coordinates so downsampling cannot miss a narrow summit.
    axis = [round(i * UNIT / (size - 1)) for i in range(size)]
    exact = sorted({round(p * UNIT) for p in peaks})
    spacing = UNIT / (size - 1)
    axis = [p for p in axis if p in (0, UNIT) or all(abs(p - q) > spacing * .32 for q in exact)]
    return np.array(sorted(set(axis + exact)), dtype='<u2')


def clipped_paths(points, min_x, min_z, width, depth):
    path = []
    for a, b in zip(points, points[1:]):
        start, stop = 0., 1.
        for n, (low, high) in enumerate(((min_x, min_x + width), (min_z, min_z + depth))):
            change = b[n] - a[n]
            if change == 0:
                if not low <= a[n] <= high:
                    start, stop = 1., 0.
                continue
            t0, t1 = (low - a[n]) / change, (high - a[n]) / change
            start, stop = max(start, min(t0, t1)), min(stop, max(t0, t1))
        if start < stop:
            first = tuple(a[n] + (b[n] - a[n]) * start for n in range(2)) if start else tuple(a)
            last = tuple(a[n] + (b[n] - a[n]) * stop for n in range(2)) if stop < 1 else tuple(b)
            if path and first != path[-1]:
                yield path
                path = []
            if not path:
                path.append(first)
            path.append(last)
        elif path:
            yield path
            path = []
    if path:
        yield path


def relief(heights, forest, bounds, lifts, runs, peaks):
    min_x, min_z = bounds['minX'], bounds['minZ']
    width, depth = bounds['maxX'] - min_x, bounds['maxZ'] - min_z
    span = max(width, depth)
    cols = max(2, round((GRID - 1) * width / span) + 1)
    rows = max(2, round((GRID - 1) * depth / span) + 1)
    local_peaks = [((x - min_x) / width, (z - min_z) / depth, altitude) for x, z, altitude in peaks
                   if min_x < x < min_x + width and min_z < z < min_z + depth]
    x_axis = sample_axis(cols, [x for x, _, _ in local_peaks])
    z_axis = sample_axis(rows, [z for _, z, _ in local_peaks])
    grid = sample_grid(heights, x_axis / UNIT, z_axis / UNIT)
    canopy = sample_grid(forest, x_axis / UNIT, z_axis / UNIT)
    for x, z, altitude in local_peaks:
        i, j = x_axis.searchsorted(round(x * UNIT)), z_axis.searchsorted(round(z * UNIT))
        grid[j, i] = max(grid[j, i], altitude)
    rise = (grid - grid.min()) * 1.88 / span + .024

    lines = []
    for features, default_style in ((runs, DIFFICULTIES['unrated']), (lifts, 0)):
        for feature in features:
            style = DIFFICULTIES.get(feature.get('difficulty'), default_style)
            for path in clipped_paths(feature['points'], min_x, min_z, width, depth):
                if sum(math.dist(a, b) for a, b in zip(path, path[1:])) < span * .005:
                    continue
                coordinates = [
                    (round((x - min_x) / width * UNIT), round((z - min_z) / depth * UNIT))
                    for x, z in simplify(path, span * .00085)
                ]
                if len(set(coordinates)) > 1:
                    lines.append((style, coordinates))

    yield struct.pack('<BBffH', len(x_axis), len(z_axis), width / span, depth / span, len(lines))
    yield x_axis.tobytes()
    yield z_axis.tobytes()
    yield np.round(rise * UNIT).astype('<u2').tobytes()
    yield np.round(canopy).astype('u1').tobytes()
    for style, line in lines:
        yield struct.pack('<BH', style, len(line))
        yield np.array(line, dtype='<u2').tobytes()


def main():
    whistler = json_export(DATA / 'geography.js', 'resortBounds')
    packed = np.fromfile(DATA / 'resort.bin', dtype=[('height', '<u2'), ('cover', 'u1')])
    shape = (whistler['grid'], whistler['grid'])
    height = packed['height'].reshape(shape) / 10
    forest = (packed['cover'].reshape(shape) == 10).astype('u1') * 255
    landmarks = json_export(DATA / 'geography.js', 'landmarks')
    whistler_osm = DATA / 'osm-whistler.js'
    entries = {'whistler-blackcomb': b''.join(relief(
        height, forest, whistler, json_export(whistler_osm, 'liftData'), json_export(whistler_osm, 'runData'),
        [landmarks['whistlerPeak'], landmarks['blackcombPeak']],
    ))}
    for path in sorted((DATA / 'mountains').glob('*/resort.json')):
        resort = json.loads(path.read_text(encoding='utf8'))
        raster = resort['terrain']
        samples = np.fromfile(path.with_name(raster['file']), dtype='<u2')
        height = samples.reshape(raster['rows'], raster['cols']) * raster['scale'] + raster['offset']
        cover = resort['forest']
        forest = np.fromfile(path.with_name(cover['file']), dtype='u1').reshape(cover['rows'], cover['cols'])
        peaks = [(*p['point'], p['elevation']) for p in resort['landmarks'] if p['kind'] == 'peak']
        entries[path.parent.name] = b''.join(relief(height, forest, resort['bounds'], resort['lifts'], resort['runs'], peaks))

    with (DATA / 'destination-relief.bin').open('wb') as output:
        output.write(b'ADR2' + bytes([len(entries)]))
        for name, record in entries.items():
            key = name.encode('ascii')
            output.write(bytes([len(key)]) + key + struct.pack('<I', len(record)) + record)


if __name__ == '__main__':
    main()
