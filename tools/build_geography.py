"""Build the local Whistler game assets from cached geospatial inputs.

See data/README.md for source files and reproducible download instructions.
The game itself runs without any geospatial libraries or network services.
"""
from collections import Counter
import json
import math
from pathlib import Path
from xml.etree import ElementTree

import numpy as np
from pyproj import Transformer
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject
from scipy.ndimage import distance_transform_edt

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache"
DATA = ROOT / "data"
CRS = "EPSG:32610"
ORIGIN_LON_LAT = (-122.9533203, 50.1128468)
TRANSFORMER = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
EAST, NORTH = TRANSFORMER.transform(*ORIGIN_LON_LAT)
RESORT = {"minX": -4300, "maxX": 6600, "minZ": -2100, "maxZ": 8600, "grid": 641}
REGION = {"minX": -25000, "maxX": 25000, "minZ": -25000, "maxZ": 25000, "grid": 501}
BLACK_TUSK = {"minX": -7100, "maxX": -5700, "minZ": 14500, "maxZ": 16000, "grid": 151}
DEM_TILES = ["copernicus.tif", "N50_00_W124.tif", "N49_00_W123.tif", "N49_00_W124.tif"]
COVER_TILES = ["cover-N48W123.tif", "cover-N48W126.tif"]

# Landmarks used as navigational anchors. Lodge geometry is authored in the game.
LANDMARKS = {
    "whistlerPeak": [-122.95694, 50.05917, 2182],
    "blackcombPeak": [-122.87088, 50.08205, 2440],
    "blackTusk": [-123.04271, 49.97537, 2319],
    "village": [*ORIGIN_LON_LAT, 675],
    "upperVillage": [-122.94749, 50.11542, 685],
    "creekside": [-122.98877, 50.09367, 653],
    "roundhouse": [-122.94669, 50.06934],
    "rendezvous": [-122.90032, 50.09548],
}
DIFFICULTY = {
    "novice": "green", "easy": "green", "intermediate": "blue",
    "advanced": "black", "expert": "double", "freeride": "double",
}


def local_point(coord):
    east, north = TRANSFORMER.transform(*coord[:2])
    return [round(east - EAST, 1), round(NORTH - north, 1)]


def resort_features(name):
    # The GeoJSON distribution writes one feature per line.
    with (CACHE / f"{name}.geojson").open(encoding="utf-8") as source:
        for line in source:
            if '"Whistler Blackcomb"' not in line or not line.startswith('{"type":"Feature"'):
                continue
            feature = json.loads(line.rstrip().rstrip(","))
            properties = feature["properties"]
            if properties["status"] != "operating":
                continue
            if not any(
                area["properties"]["name"] == "Whistler Blackcomb"
                for area in properties["skiAreas"]
            ):
                continue
            if not all(s["type"] == "openstreetmap" for s in properties["sources"]):
                continue
            yield feature["geometry"], properties


def feature_sources(properties):
    return [s["id"] for s in properties["sources"]]


def village_buildings():
    buildings = {}
    # Lift terminals use individually authored meshes in the game.
    terminals = {"50677435", "50677442", "50903876"}
    for filename in ("village.osm", "creekside.osm"):
        root = ElementTree.parse(CACHE / filename).getroot()
        nodes = {
            node.get("id"): [float(node.get("lon")), float(node.get("lat"))]
            for node in root.findall("node")
        }
        for way in root.findall("way"):
            osm_id = way.get("id")
            tags = {tag.get("k"): tag.get("v") for tag in way.findall("tag")}
            kind = tags.get("building")
            if not kind or kind in {"no", "parking", "roof", "construction"} or osm_id in terminals:
                continue
            refs = [node.get("ref") for node in way.findall("nd")]
            if len(refs) < 4 or refs[0] != refs[-1] or any(ref not in nodes for ref in refs):
                continue
            points = [local_point(nodes[ref]) for ref in refs[:-1]]
            if len({tuple(p) for p in points}) < 3:
                continue
            record = {"id": osm_id, "points": points}
            for key in ("height", "building:levels"):
                value = tags.get(key, "").removesuffix(" m")
                if value.replace(".", "", 1).isdigit():
                    record[key] = float(value)
            buildings[osm_id] = record
    return list(buildings.values())


def ski_network():
    lines, areas = [], []
    for geometry, props in resort_features("runs"):
        if "downhill" not in props["uses"] or props.get("tunnel"):
            continue
        coords = geometry["coordinates"]
        feature = {
            "id": props["id"][:12],
            "name": props["name"],
            "difficulty": DIFFICULTY.get(props["difficulty"], "unrated"),
            "sources": feature_sources(props),
        }
        if geometry["type"] == "Polygon":
            feature["rings"] = [[local_point(p) for p in ring] for ring in coords]
            areas.append(feature)
        elif geometry["type"] == "LineString":
            if coords[-1][2] > coords[0][2]:
                coords = coords[::-1]
            feature["gladed"] = bool(props["gladed"])
            feature["points"] = [local_point(p) for p in coords]
            if len({tuple(p) for p in feature["points"]}) >= 2:
                lines.append(feature)

    lifts = []
    for geometry, props in resort_features("lifts"):
        if geometry["type"] != "LineString" or props.get("tunnel"):
            continue
        coords = geometry["coordinates"]
        name = props["name"].split(",")[0] if props["name"] else None
        if not name:
            continue
        peak_to_peak = name == "Peak 2 Peak Gondola"
        if (peak_to_peak and coords[0][0] > coords[-1][0]) or (
            not peak_to_peak and coords[0][2] > coords[-1][2]
        ):
            coords = coords[::-1]
        lifts.append({
            "id": feature_sources(props)[0].replace("/", "-"),
            "name": name,
            "type": "p2p" if peak_to_peak else props["liftType"],
            "seats": props["occupancy"],
            "points": [local_point(p) for p in coords],
            "sources": feature_sources(props),
        })
    timestamp = json.loads((CACHE / "metadata.json").read_text("utf-8"))["source"]["openStreetMap"]["dataTimestamp"]
    buildings = village_buildings()
    with (DATA / "osm-whistler.js").open("w", encoding="utf-8", newline="\n") as output:
        output.write("// OpenStreetMap contributors, ODbL 1.0. Extracted via OpenSkiData. See data/README.md.\n")
        output.write(f"export const osmTimestamp = {json.dumps(timestamp)};\n")
        for name, features in (("runData", lines), ("areaData", areas), ("liftData", lifts), ("buildingData", buildings)):
            output.write(f"export const {name} = [\n")
            for feature in sorted(features, key=lambda item: item["id"]):
                output.write(json.dumps(feature, ensure_ascii=False, separators=(",", ":")) + ",\n")
            output.write("];\n")
    print(f"{len(lines)} centerline segments, {len(areas)} piste areas, {len(lifts)} lift sections")
    print(f"{len(buildings)} village building footprints")
    print(Counter(lift["type"] for lift in lifts))


def raster(bounds, filenames, resampling, nodata):
    n = bounds["grid"]
    dx = (bounds["maxX"] - bounds["minX"]) / (n - 1)
    dz = (bounds["maxZ"] - bounds["minZ"]) / (n - 1)
    transform = from_origin(EAST + bounds["minX"] - dx / 2, NORTH - bounds["minZ"] + dz / 2, dx, dz)
    result = np.full((n, n), nodata, np.float32)
    for filename in filenames:
        with rasterio.open(CACHE / filename) as source:
            reproject(
                rasterio.band(source, 1), result, dst_transform=transform, dst_crs=CRS,
                dst_nodata=nodata, init_dest_nodata=False, resampling=resampling,
            )
    return result


def terrain(name, bounds, use_lidar=False):
    elevation = raster(bounds, DEM_TILES, Resampling.cubic, -9999)
    if (elevation == -9999).any():
        raise ValueError(f"Missing base elevation in {name}")
    if use_lidar:
        lidar = raster(bounds, ["lidar.tif"], Resampling.average, -9999)
        valid = lidar != -9999
        # Blend the transition to the satellite elevation model across a small buffer.
        blend = np.clip(distance_transform_edt(valid) / 6, 0, 1).astype(np.float32)
        elevation += np.where(valid, lidar - elevation, 0) * blend
        print(f"LiDAR input covers {valid.mean():.1%} of the playable grid before blending")
    cover = raster(bounds, COVER_TILES, Resampling.mode, 0)
    n = bounds["grid"]
    packed = np.empty((n, n), dtype=[("decimetres", "<u2"), ("cover", "u1")])
    packed["decimetres"] = np.rint(elevation * 10).clip(0, 65535)
    packed["cover"] = cover
    packed.tofile(DATA / name)
    print(f"{name} {n}×{n} elevations {elevation.min():.1f}–{elevation.max():.1f} m")


def main():
    DATA.mkdir(exist_ok=True)
    ski_network()
    terrain("resort.bin", RESORT, use_lidar=True)
    terrain("ranges.bin", REGION)
    terrain("black-tusk.bin", BLACK_TUSK)
    with (DATA / "geography.js").open("w", encoding="utf-8", newline="\n") as output:
        output.write("// Generated by tools/build_geography.py. World units are metres, east and south.\n")
        for name, value in (
            ("resortBounds", RESORT), ("regionBounds", REGION), ("blackTuskBounds", BLACK_TUSK),
            ("originUtm", [EAST, NORTH]),
            ("landmarks", {name: [*local_point(coords), *coords[2:]] for name, coords in LANDMARKS.items()}),
        ):
            output.write(f"export const {name} = {json.dumps(value)};\n")


if __name__ == "__main__":
    main()
