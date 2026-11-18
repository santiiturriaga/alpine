"""Optional 2016 LiDAR roof survey; downloads only requested COG blocks.

Requires numpy, rasterio, pyproj, scipy, shapely and Pillow. The cached local
bare-earth crop is .cache/lidar.tif (see data/README.md). Roof heights are
inferences from 1 m surfaces, not current building surveys. Tree crowns,
chimneys, construction after 2016 and unmapped roof overhangs are limitations.

Run ``python tools/survey_roof_heights.py`` for the named architecture targets,
or add ``--all`` to survey the cached village footprints and write the compact
runtime table. Survey diagnostics and overheads are kept in .cache/roof-survey.
"""
import argparse
import json
from pathlib import Path
from xml.etree import ElementTree

import numpy as np
from PIL import Image, ImageDraw
from pyproj import Transformer
import rasterio
from rasterio.features import geometry_mask
from rasterio.windows import from_bounds, Window
from scipy.ndimage import median_filter
from shapely.geometry import Polygon, mapping

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.cache' / 'roof-survey'
DSM = 'https://canelevation-dem.s3.ca-central-1.amazonaws.com/hrdem-lidar/BC-Squamish_2016-1m-dsm.tif'
SOURCE = 'https://open.canada.ca/data/en/dataset/957782bf-847c-4644-a757-e383c0057995'
TARGETS = {
    '151613609': "Dusty's Main", '151613608': 'Creekside north photo lodge',
    '151613604': 'First Tracks Lodge', '50903854': 'Fairmont Chateau Whistler',
    '50903873': 'The Aspens', '1174567116': 'Kadenwood lower-station footprint',
}


def footprints():
    records = {}
    project = Transformer.from_crs(4326, 3979, always_xy=True)
    for filename in ['village.osm', 'creekside.osm']:
        root = ElementTree.parse(ROOT / '.cache' / filename).getroot()
        nodes = {n.get('id'): (float(n.get('lon')), float(n.get('lat'))) for n in root.findall('node')}
        for w in root.findall('way'):
            tags = {t.get('k'): t.get('v') for t in w.findall('tag')}
            refs = [n.get('ref') for n in w.findall('nd')]
            if not tags.get('building') or len(refs) < 4 or refs[0] != refs[-1] or any(n not in nodes for n in refs):
                continue
            pts = [project.transform(*nodes[n]) for n in refs]
            poly = Polygon(pts)
            if poly.is_valid and poly.area > 12:
                records[w.get('id')] = {'polygon': poly, 'tags': tags, 'name': TARGETS.get(w.get('id'), tags.get('name', ''))}
    return records


def quantiles(values):
    return [round(float(x), 2) for x in np.quantile(values, [.05, .15, .25, .5, .75, .9, .95, 1])]


def overhead(identifier, record, dsm, dtm, transform):
    """North-up DSM-DTM and absolute-roof views with an OSM outline."""
    valid = np.isfinite(dsm) & np.isfinite(dtm)
    height = np.where(valid, np.clip(dsm - dtm, 0, 55), 0)
    # Blue low surfaces through ochre roofs to pale high crowns.
    stops = np.array([[20, 32, 49], [33, 107, 139], [89, 176, 163], [224, 174, 83], [249, 232, 190]])
    levels = [0, 5, 15, 30, 55]
    rgb = np.stack([np.interp(height, levels, stops[:, c]) for c in range(3)], axis=-1).astype('uint8')
    scale = max(2, min(5, 850 // max(rgb.shape[:2])))
    img = Image.fromarray(rgb).resize((rgb.shape[1] * scale, rgb.shape[0] * scale), Image.Resampling.NEAREST)
    canvas = Image.new('RGB', (img.width, img.height + 68), '#101a27')
    canvas.paste(img, (0, 68)); draw = ImageDraw.Draw(canvas)
    draw.text((9, 7), f"{record['name'] or identifier} | OSM {identifier}", fill='white')
    draw.text((9, 25), 'NRCan 2016 | DSM minus DTM | 1 m/pixel | N up', fill='#d7dfeb')
    draw.text((9, 43), 'Blue 0-5m / teal 15m / ochre 30m / pale 55m | white OSM', fill='#d7dfeb')
    coords = [(int((x - transform.c) / transform.a * scale), int((y - transform.f) / transform.e * scale) + 68) for x, y in record['polygon'].exterior.coords]
    draw.line(coords, fill='white', width=2)
    draw.line([(12, img.height + 49), (12 + 10 * scale, img.height + 49)], fill='white', width=3)
    draw.text((12, img.height + 33), '10 m', fill='white')
    canvas.save(OUT / f'{identifier}-overhead.png')


def survey(identifier, record, surface, terrain, make_image=False):
    poly = record['polygon']
    left, bottom, right, top = poly.bounds
    win = from_bounds(np.floor(left - 10), np.floor(bottom - 10), np.ceil(right + 10), np.ceil(top + 10), surface.transform).round_offsets().round_lengths()
    shape = (int(win.height), int(win.width))
    transform = surface.window_transform(win)
    dsm = surface.read(1, window=win, boundless=True, masked=True).filled(np.nan)
    tw = from_bounds(*rasterio.windows.bounds(win, surface.transform), terrain.transform).round_offsets().round_lengths()
    dtm = terrain.read(1, window=tw, out_shape=shape, boundless=True, masked=True).filled(np.nan)
    mask = geometry_mask([mapping(poly)], shape, transform, invert=True)
    inner_poly = poly.buffer(-2)
    if inner_poly.is_empty:
        inner_poly = poly.buffer(-.5)
    inner = geometry_mask([mapping(inner_poly)], shape, transform, invert=True)
    valid = np.isfinite(dsm) & np.isfinite(dtm)
    ground = dtm[mask & valid]
    if len(ground) < 12 or (inner & valid).sum() < 12:
        return {'id': identifier, 'name': record['name'], 'confidence': 'unavailable', 'reason': 'Insufficient DTM/DSM coverage'}
    height = dsm - dtm
    # Smooth, elevated interior surfaces reduce overhanging crowns and edge cells.
    clean_dsm = np.where(np.isfinite(dsm), dsm, 0)
    residual = np.abs(clean_dsm - median_filter(clean_dsm, size=3))
    gy, gx = np.gradient(clean_dsm)
    smooth = (residual < .65) & (np.hypot(gx, gy) < 1.8)
    roof = inner & valid & smooth & (height > 2.4) & (height < 75)
    samples = int((inner & valid).sum())
    fraction = roof.sum() / max(samples, 1)
    coverage = float((inner & valid).sum() / max(inner.sum(), 1))
    # A connected broad interior with little local height variation is useful;
    # sparse rough coverage is deliberately omitted from runtime estimates.
    confidence = 'high' if roof.sum() >= 45 and fraction >= .72 and coverage > .98 else 'medium' if roof.sum() >= 25 and fraction >= .48 and coverage > .95 else 'low'
    if roof.sum() < 8:
        roof = inner & valid
    g = quantiles(ground)
    r = quantiles(dsm[roof])
    hn = quantiles(height[roof])
    upper = g[5]
    # q15 is a lower-roof proxy, not an independently identified eave.
    eave = max(2.5, r[1] - upper)
    ridge = max(eave, r[5] - upper)
    result = {
        'id': identifier, 'name': record['name'], 'confidence': confidence,
        'samples': samples, 'smoothRoofFraction': round(float(fraction), 3), 'coverage': round(coverage, 3),
        'groundQuantiles': g, 'roofAbsoluteQuantiles': r, 'normalizedRoofQuantiles': hn,
        'eaveProxyAboveUpperGround': round(eave, 2), 'ridgeAboveUpperGround': round(ridge, 2),
        'eaveProxyAboveMaxGround': round(r[1] - g[-1], 2), 'ridgeAboveMaxGround': round(r[5] - g[-1], 2),
        'osmTags': record['tags'],
    }
    if make_image:
        overhead(identifier, record, dsm, dtm, transform)
        profile = surface.profile.copy()
        profile.update(driver='GTiff', height=shape[0], width=shape[1], transform=transform, count=2, nodata=np.nan, tiled=False)
        with rasterio.open(OUT / f'{identifier}-surfaces.tif', 'w', **profile) as dest:
            dest.write(dsm, 1); dest.write(dtm, 2)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--all', action='store_true')
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    records = footprints()
    ids = list(TARGETS) + ([i for i in records if i not in TARGETS] if args.all else [])
    results = []
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif', GDAL_HTTP_MAX_RETRY=3), rasterio.open('/vsicurl/' + DSM) as surface, rasterio.open(ROOT / '.cache' / 'lidar.tif') as terrain:
        if surface.crs != terrain.crs or surface.res != terrain.res:
            raise ValueError('DSM/DTM crop must share the 1 m projected grid')
        for identifier in ids:
            if identifier not in records:
                print('MISSING', identifier, flush=True); continue
            result = survey(identifier, records[identifier], surface, terrain, identifier in TARGETS)
            results.append(result)
            print(identifier, result['name'], result['confidence'], result.get('eaveProxyAboveUpperGround'), result.get('ridgeAboveUpperGround'), flush=True)
    diagnostic = {'source': SOURCE, 'dsm': DSM, 'year': 2016, 'quantiles': [.05, .15, .25, .5, .75, .9, .95, 1], 'buildings': results}
    (OUT / 'survey.json').write_text(json.dumps(diagnostic, indent=2), encoding='utf-8')
    if args.all:
        # Named custom models consume the diagnostic directly; the generic table
        # only carries conservative high/medium-confidence usable measurements.
        # Modern terminals are newer than this acquisition, or use custom
        # authorship. Multi-tier roofs cannot be represented by one generic
        # eave/ridge pair. Omit those rather than imply architectural accuracy.
        excluded = set(TARGETS) - {'50903873'}
        excluded.update({'50677435', '50677442', '50903876', '173950357', '173950343'})
        accepted = [r for r in results if r['confidence'] == 'high'
                    and r['id'] not in excluded
                    and 3 < r['eaveProxyAboveUpperGround'] < 45
                    and r['ridgeAboveUpperGround'] < 50
                    and r['ridgeAboveUpperGround'] - r['eaveProxyAboveUpperGround'] < 10.5
                    and r['groundQuantiles'][-1] - r['groundQuantiles'][5] < 2.5]
        lines = [
            '// Derived 2016 NRCan 1 m LiDAR roof estimates, metres above upper (q90) ground.',
            '// Lower-roof q15 is an eave proxy; ridge is roof q90. Smooth interior samples exclude rough crowns.',
            '// Historical surfaces, not a current architectural survey. See tools/survey_roof_heights.py.',
            f'// Source: {SOURCE}',
            f'// DSM: {DSM}',
            '// Contains information licensed under the Open Government Licence – Canada.',
            'export const roofHeights = {',
        ]
        for r in sorted(accepted, key=lambda x: int(x['id'])):
            lines.append(json.dumps(r['id']) + ':' + json.dumps({'eave': round(r['eaveProxyAboveUpperGround'], 1), 'ridge': round(r['ridgeAboveUpperGround'], 1), 'confidence': r['confidence']}, separators=(',', ':')) + ',')
        lines.append('};\n')
        (ROOT / 'data' / 'roof-heights.js').write_text('\n'.join(lines), encoding='utf-8')
        print(f'{len(accepted)} accepted estimates / {len(results)} surveyed')


if __name__ == '__main__':
    main()
