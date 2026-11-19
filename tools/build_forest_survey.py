"""Build small, metre-aligned forest samples from the ETH and Copernicus COGs."""

import argparse
import json
import math
from pathlib import Path
import struct

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import Window, from_bounds as window_from_bounds
from scipy.ndimage import distance_transform_edt


MOUNTAINS = Path(__file__).resolve().parents[1] / "data" / "mountains"
CGLS = "https://zenodo.org/records/3939050/files/PROBAV_LC100_global_v3.0.1_2019-nrt_{}_EPSG-4326.tif"
ETH = "https://libdrive.ethz.ch/index.php/s/cO8or7iOe5dT2Rt/download?path=%2F3deg_cogs&files=ETH_GlobalCanopyHeight_10m_2020_{}_Map.tif"


def layout(bounds, origin, spacing):
    east, north = origin
    west, south = east + bounds["minX"], north - bounds["maxZ"]
    right, top = east + bounds["maxX"], north - bounds["minZ"]
    cols, rows = math.ceil((right - west) / spacing), math.ceil((top - south) / spacing)
    return (rows, cols), from_bounds(west, south, right, top, cols, rows), (west, south, right, top)


def window_read(url, area, crs, layer):
    shape, transform, bounds = area
    result = np.full(shape, 255, dtype="uint8")
    extent = transform_bounds(crs, 4326, *bounds)
    with rasterio.open(url) as src:
        w = window_from_bounds(*extent, transform=src.transform)
        # Read original cells so categorical overviews cannot vote twice.
        margin = 5
        left, top = max(0, math.floor(w.col_off) - margin), max(0, math.floor(w.row_off) - margin)
        right = min(src.width, math.ceil(w.col_off + w.width) + margin)
        bottom = min(src.height, math.ceil(w.row_off + w.height) + margin)
        if right <= left or bottom <= top:
            return result
        window = Window(left, top, right - left, bottom - top)
        values = src.read(1, window=window)
        if layer == "leaf":
            known = (values >= 1) & (values <= 5)
            if not known.any():
                return result
            # Fill small holes at stand edges only. Open terrain still uses the finer ESA mask.
            distance, nearest = distance_transform_edt(~known, return_indices=True)
            leaf = np.choose(np.minimum(values[tuple(nearest)], 5), [0, 0, 0, 0, 100, 50])
            values = np.where(distance <= 3, leaf, 255).astype("uint8")
        reproject(values, result, src_transform=src.window_transform(window), src_crs=src.crs,
                  src_nodata=255, dst_transform=transform, dst_crs=crs, dst_nodata=255,
                  resampling=Resampling.average)
    return result


def tile_name(lat, lon):
    return f"{'N' if lat >= 0 else 'S'}{abs(lat):02d}{'E' if lon >= 0 else 'W'}{abs(lon):03d}"


def surface_fractions(area, crs):
    layers = []
    for name in ("Snow-CoverFraction-layer", "Grass-CoverFraction-layer"):
        values = window_read(CGLS.format(name), area, crs, name)
        if (values == 255).all():
            raise ValueError(f"No coverage for {name}")
        values[values == 255] = 0
        layers.append(values)
    return layers


def build(folder):
    config = json.loads((folder / "sources.json").read_text(encoding="utf-8"))
    crs = config["crs"]
    origin = Transformer.from_crs(4326, crs, always_xy=True).transform(*config["origin"])
    local = layout(config["bounds"], origin, 64)
    region = layout(config["backdropBounds"], origin, 240)
    west, south, east, north = transform_bounds(crs, 4326, *local[2])
    height = np.full(local[0], 255, dtype="uint8")
    for lat in range(math.floor(south / 3) * 3, math.ceil(north / 3) * 3, 3):
        for lon in range(math.floor(west / 3) * 3, math.ceil(east / 3) * 3, 3):
            tile = window_read(ETH.format(tile_name(lat, lon)), local, crs, "height")
            np.copyto(height, tile, where=tile != 255)
    leaf_url = CGLS.format("Forest-Type-layer")
    leaf = window_read(leaf_url, local, crs, "leaf")
    cover = window_read(CGLS.format("Tree-CoverFraction-layer"), region, crs, "cover")
    region_leaf = window_read(leaf_url, region, crs, "leaf")
    if (height == 255).all() or (cover == 255).all():
        raise ValueError(f"{folder.name}: source has no coverage")
    # Zero height means unknown/open. Tree placement is decided by the 10 m WorldCover layer.
    for layer in (height, leaf, cover, region_leaf):
        layer[layer == 255] = 0
    header = struct.pack("<4s4H", b"FOR2", local[0][1], local[0][0], region[0][1], region[0][0])
    payload = header + np.dstack((height, leaf, *surface_fractions(local, crs))).tobytes()
    payload += np.dstack((cover, region_leaf, *surface_fractions(region, crs))).tobytes()
    path = folder / "forest-survey.bin"
    temporary = path.with_suffix(".tmp")
    temporary.write_bytes(payload)
    temporary.replace(path)
    # Insert the optional descriptor without reserializing or reformatting the rest of the pack.
    pack = folder / "resort.json"
    original = pack.read_bytes()
    marker = b'"forest":{"file":"forest.bin"'
    if b'"survey":"forest-survey.bin"' not in original:
        if original.count(marker) != 1:
            raise ValueError(f"Missing forest descriptor in {pack}")
        pack.write_bytes(original.replace(marker, marker + b',"survey":"forest-survey.bin"'))
    print(f"{folder.name}: {len(payload):,} bytes, height max {height.max()} m, "
          f"{(leaf >= 50).mean():.1%} of local cells predominantly broadleaf", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destinations", nargs="+", help="folder names under data/mountains")
    args = parser.parse_args()
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_TIMEOUT="30",
                      GDAL_HTTP_MAX_RETRY="2", GDAL_HTTP_MULTIRANGE="SERIAL"):
        for name in args.destinations:
            build(MOUNTAINS / name)
