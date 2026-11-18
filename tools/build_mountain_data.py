"""Project OpenSkiData and public rasters into the mapped-mountain game format."""

import argparse
from collections import defaultdict
import json
import math
from pathlib import Path
import re
from urllib.request import Request, urlopen
from xml.etree import ElementTree

import numpy as np
from pyproj import Transformer
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import Window, from_bounds
from shapely.geometry import LineString, Polygon, box
from shapely.ops import linemerge


ROOT = Path(__file__).resolve().parents[1]
DIFFICULTY = {
    "novice": "green", "easy": "green", "intermediate": "blue",
    "advanced": "black", "expert": "double", "freeride": "double", "extreme": "double",
}
LIFT_KIND = {
    "chair_lift": "chair", "magic_carpet": "surface", "rope_tow": "surface",
    "drag_lift": "surface", "t-bar": "surface", "j-bar": "surface",
    "platter": "surface", "gondola": "gondola", "cable_car": "gondola",
}
NO_DATA = -9999.0


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower().replace("'", "").replace("’", "")).strip("-")


def tags(element):
    return {tag.get("k"): tag.get("v") for tag in element.findall("tag")}


def lon_lat(node):
    return float(node.get("lon")), float(node.get("lat"))


def number(value):
    try:
        result = float(str(value).removesuffix(" m"))
    except ValueError:
        return None
    return result if math.isfinite(result) and result >= 0 else None


def coordinate_frame(config):
    converter = Transformer.from_crs(4326, config["crs"], always_xy=True)
    east, north = converter.transform(*config["origin"])

    def project(coord):
        x, y = converter.transform(*coord[:2])
        return round(x - east, 1), round(north - y, 1)

    return (east, north), project


def grid_spec(bounds, step, origin):
    east, north = origin
    cols = (bounds["maxX"] - bounds["minX"]) / step + 1
    rows = (bounds["maxZ"] - bounds["minZ"]) / step + 1
    if not (cols.is_integer() and rows.is_integer()):
        raise ValueError("Grid bounds must be divisible by the sample step")
    transform = from_origin(east + bounds["minX"] - step / 2,
                            north - bounds["minZ"] + step / 2, step, step)
    return (int(rows), int(cols)), transform


def source_path(url, cache):
    local = cache / url.rsplit("/", 1)[-1]
    return local if local.is_file() else url


def raster(urls, cache, bounds, step, origin, crs, tree_cover=False):
    shape, transform = grid_spec(bounds, step, origin)
    extent = rasterio.transform.array_bounds(*shape, transform)
    result = np.full(shape, NO_DATA, dtype=np.float32)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
                      CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", GDAL_HTTP_MAX_RETRY="3"):
        for url in urls:
            with rasterio.open(source_path(url, cache)) as src:
                overview = 1 if tree_cover else max(1, round(step / 10))
                target = transform_bounds(crs, src.crs, *extent)
                window = from_bounds(*target, transform=src.transform)
                # Round outwards and retain neighbor pixels for interpolation near tile edges.
                col = max(0, math.floor(window.col_off) - 2 * overview)
                row = max(0, math.floor(window.row_off) - 2 * overview)
                end_col = min(src.width, math.ceil(window.col_off + window.width) + 2 * overview)
                end_row = min(src.height, math.ceil(window.row_off + window.height) + 2 * overview)
                if end_col <= col or end_row <= row:
                    continue
                window = Window(col, row, end_col - col, end_row - row)
                out_shape = (math.ceil(window.height / overview), math.ceil(window.width / overview))
                sample = src.read([1], window=window, out_shape=(1, *out_shape))[0]
                sample_transform = src.window_transform(window) * rasterio.Affine.scale(
                    window.width / out_shape[1], window.height / out_shape[0],
                )
                nodata = src.nodata
                if tree_cover:
                    sample = np.where(sample == nodata, NO_DATA, np.where(sample == 10, 1, 0)).astype(np.float32)
                    nodata = NO_DATA
                reproject(sample, result, src_transform=sample_transform, src_crs=src.crs,
                          dst_transform=transform, dst_crs=crs, src_nodata=nodata,
                          dst_nodata=NO_DATA, init_dest_nodata=False,
                          resampling=Resampling.average if tree_cover else Resampling.bilinear)
    missing = np.count_nonzero(result == NO_DATA)
    if missing or not np.isfinite(result).all():
        raise ValueError(f"Source rasters left {missing} grid samples missing for {bounds}")
    return result


def encode_elevation(data, file, scale=0.05):
    offset = math.floor(float(data.min()))
    encoded = np.rint((data - offset) / scale)
    if encoded.max() > 65535:
        raise ValueError(f"Elevation grid exceeds the 16-bit range at {scale:g} m quantization")
    encoded.astype("<u2").tofile(file)
    rows, cols = data.shape
    return {"file": file.name, "cols": cols, "rows": rows, "offset": offset, "scale": scale}


def interpolator(data, bounds):
    rows, cols = data.shape

    def height(point):
        x, z = point
        x = min(cols - 1, max(0, (x - bounds["minX"]) / (bounds["maxX"] - bounds["minX"]) * (cols - 1)))
        z = min(rows - 1, max(0, (z - bounds["minZ"]) / (bounds["maxZ"] - bounds["minZ"]) * (rows - 1)))
        i, j = min(cols - 2, int(x)), min(rows - 2, int(z))
        dx, dz = x - i, z - j
        top = data[j, i] * (1 - dx) + data[j, i + 1] * dx
        bottom = data[j + 1, i] * (1 - dx) + data[j + 1, i + 1] * dx
        return float(top * (1 - dz) + bottom * dz)

    return height


def features(path, config):
    # The global download stores one feature per line. Filter before decoding JSON.
    areas = set(config.get("sourceAreas", [config["name"]]))
    needles = tuple(json.dumps(area, ensure_ascii=False) for area in areas)
    region = config.get("sourceRegion")
    with path.open(encoding="utf-8") as file:
        for line in file:
            if not any(needle in line for needle in needles) or not line.lstrip().startswith('{"type":"Feature"'):
                continue
            feature = json.loads(line.rstrip().rstrip(","))
            props = feature["properties"]
            if props["status"] != "operating" or props.get("tunnel"):
                continue
            if region and not any(place["iso3166_2"] == region for place in props["places"]):
                continue
            if not any(ski_area["properties"]["name"] in areas for ski_area in props["skiAreas"]):
                continue
            if props["sources"] and all(source["type"] == "openstreetmap" for source in props["sources"]):
                yield feature["geometry"], props


def local_line(coords, project):
    points = []
    for coord in coords:
        point = project(coord)
        if not points or points[-1] != point:
            points.append(point)
    return LineString(points) if len(points) >= 2 else None


def line_parts(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == "LineString":
        return [geometry]
    if hasattr(geometry, "geoms"):
        return [line for part in geometry.geoms for line in line_parts(part)]
    return []


def profile(points, height, ascending):
    start, end = height(points[0]), height(points[-1])
    if (ascending and start > end) or (not ascending and start < end):
        points = list(reversed(points))
        start, end = end, start
    return points, round(start, 1), round(end, 1)


def route_section(config, name, geom, project):
    if name in config.get("runSections", {}):
        return config["runSections"][name]
    if geom["type"] in {"LineString", "Polygon"} and config.get("sectionBands"):
        coords = geom["coordinates"]
        if geom["type"] == "Polygon":
            coords = coords[0]
        zs = [project(point)[1] for point in coords]
        middle = (min(zs) + max(zs)) / 2
        for band in config["sectionBands"]:
            if middle < band["maxZ"]:
                return band["name"]
    return config.get("defaultSection", "")


def downhill_ways(features_path, config, osm_nodes, osm_ways):
    supplements = config.get("runSupplements", [])
    for geom, props in features(features_path, config):
        if "downhill" in props["uses"]:
            yield geom, props
    # Add map-confirmed pistes that the aggregated feed categorizes as backcountry.
    for osm_id in supplements:
        way = osm_ways[osm_id]
        props = tags(way)
        if props.get("piste:type") != "downhill":
            raise ValueError(f"Supplement {osm_id} must be a mapped downhill piste")
        coords = [lon_lat(osm_nodes[node.get("ref")]) for node in way.findall("nd")]
        geom = ({"type": "Polygon", "coordinates": [coords]} if props.get("area") == "yes"
                else {"type": "LineString", "coordinates": coords})
        yield geom, {
            "name": props.get("piste:name", props.get("name")), "difficulty": props.get("piste:difficulty"),
            "gladed": props.get("gladed") == "yes", "grooming": props.get("piste:grooming"),
            "sources": [{"id": f"way/{osm_id}"}],
        }


def run_features(cache, config, project, height, play_area, osm_nodes, osm_ways):
    runs, areas = [], []
    named = defaultdict(list)
    seen = set()
    for geom, props in downhill_ways(cache / "runs.geojson", config, osm_nodes, osm_ways):
        source_ids = [source["id"] for source in props["sources"]]
        ways = [source.split("/", 1)[1] for source in source_ids if source.startswith("way/")]
        if ways and all(way in seen for way in ways):
            continue
        seen.update(ways)
        osm_id = ways[0] if ways else source_ids[0].replace("/", "-")
        name = props["name"] or ""
        override = config.get("runOverrides", {}).get(osm_id, {})
        name = override.get("name", name)
        difficulty = override.get("difficulty", DIFFICULTY.get(props["difficulty"], "unrated"))
        section = override.get("section", route_section(config, name, geom, project))
        record = {"name": name, "difficulty": difficulty, "section": section, "sources": source_ids}
        if props.get("gladed"):
            record["gladed"] = True
        if props.get("grooming"):
            record["grooming"] = props["grooming"]
        if geom["type"] == "Polygon":
            areas.append({**record, "id": slug(name) or f"area-{osm_id}",
                          "points": [project(point) for point in geom["coordinates"][0][:-1]]})
        if geom["type"] != "LineString":
            continue
        line = local_line(geom["coordinates"], project)
        if line is not None:
            points, _, _ = profile(list(line.coords), height, ascending=False)
            key = (name, difficulty, section) if name else (f"connector-{osm_id}", difficulty, section)
            named[key].append((LineString(points), record))

    for (key, _, _), records in named.items():
        lines = [line for line, _ in records]
        joined = linemerge(lines, directed=True) if len(lines) > 1 else lines[0]
        parts = line_parts(joined if play_area.covers(joined) else joined.intersection(play_area))
        for part in sorted(parts, key=lambda line: -line.length):
            if part.length < 1:
                continue
            matching = [record for line, record in records if part.intersection(line).length > 0] or [records[0][1]]
            record = matching[0].copy()
            record["sources"] = sorted({source for element in matching for source in element["sources"]})
            points, top, bottom = profile(list(part.coords), height, ascending=False)
            runs.append({**record, "id": slug(key), "points": points, "length": round(part.length, 1),
                         "drop": round(top - bottom, 1), "topElevation": top, "bottomElevation": bottom,
                         "connector": not bool(record["name"])})

    # A named route can have multiple disconnected, independently mapped segments.
    counts = defaultdict(int)
    for run in sorted(runs, key=lambda record: -record["length"]):
        counts[run["id"]] += 1
        if counts[run["id"]] > 1:
            run["id"] = f"{run['id']}-{counts[run['id']]}"
    return sorted(runs, key=lambda record: record["id"]), sorted(areas, key=lambda record: record["id"])


def lift_features(cache, config, project, height, play_area, osm_nodes, osm_ways):
    lifts = []
    for geom, props in features(cache / "lifts.geojson", config):
        if geom["type"] != "LineString" or props["liftType"] not in LIFT_KIND:
            continue
        osm_id = props["sources"][0]["id"].split("/", 1)[1]
        metadata = config.get("liftOverrides", {}).get(osm_id, {})
        if metadata.get("skip"):
            continue
        name = metadata.get("name", props["name"])
        if not name:
            continue
        line = local_line(geom["coordinates"], project)
        if line is None or not play_area.covers(line):
            continue
        points, bottom, top = profile(list(line.coords), height, ascending=True)
        kind = LIFT_KIND[props["liftType"]]
        capacity = props["occupancy"] or 1
        lifts.append({
            "id": slug(name), "name": name, "kind": kind, "capacity": capacity,
            "points": points, "osmId": osm_id, "length": round(line.length, 1),
            "bottomElevation": bottom, "topElevation": top, "liftType": props["liftType"],
            **metadata,
        })
        lift = lifts[-1]
        if config.get("sourceAreas"):
            section = route_section(config, name, geom, project)
            if section:
                lift.setdefault("section", section)
            for source, key in (("capacity", "ridersPerHour"), ("detachable", "detachable")):
                if props.get(source) is not None:
                    lift.setdefault(key, props[source])
        way = osm_ways.get(osm_id)
        if way is not None:
            towers = [project(lon_lat(osm_nodes[nd.get("ref")])) for nd in way.findall("nd")
                      if nd.get("ref") in osm_nodes and tags(osm_nodes[nd.get("ref")]).get("aerialway") == "pylon"]
            if towers:
                lift["towers"] = sorted(towers, key=lambda point: math.dist(point, points[0]))
            duration_min = number(tags(way).get("aerialway:duration"))
            if duration_min:
                lift["speed"] = round(math.hypot(line.length, top - bottom) / (duration_min * 60), 2)
        if lift.get("ridersPerHour"):
            lift["chairsPerHour"] = round(lift["ridersPerHour"] / capacity, 2)
    return sorted(lifts, key=lambda record: record["id"])


def load_osm(config, cache):
    path = cache / config["osmFile"]
    if not path.is_file():
        request = Request(config["osmUrl"], headers={"User-Agent": "Alpine mapped-mountain builder/1.0"})
        with urlopen(request, timeout=30) as remote:
            xml = remote.read()
        ElementTree.fromstring(xml)
        path.write_bytes(xml)
    root = ElementTree.parse(path).getroot()
    return ({node.get("id"): node for node in root.findall("node")},
            {way.get("id"): way for way in root.findall("way")}, root.findall("relation"))


def map_features(osm_nodes, osm_ways, osm_relations, project, play_area):
    buildings, roads, parking = [], [], []

    def coordinates(way):
        return [project(lon_lat(osm_nodes[ref])) for node in way.findall("nd")
                if (ref := node.get("ref")) in osm_nodes]

    def add_building(osm_id, attribution, shape, props):
        if shape.is_empty or not play_area.covers(shape) or shape.area < 1:
            return
        name = props.get("name", "")
        building = {"id": slug(name) if name else f"building-{osm_id}", "name": name,
                    "points": list(shape.exterior.coords)[:-1], "osmId": osm_id, "osmType": attribution}
        for tag, key in (("height", "height"), ("building:levels", "levels")):
            value = number(props.get(tag))
            if value:
                building[key] = value
        buildings.append(building)

    superseded = set()
    for relation in osm_relations:
        props = tags(relation)
        if props.get("type") != "multipolygon" or not props.get("building"):
            continue
        members = [member.get("ref") for member in relation.findall("member")
                   if member.get("type") == "way" and member.get("role") == "outer"]
        lines = [LineString(points) for ref in members
                 if ref in osm_ways and len(points := coordinates(osm_ways[ref])) >= 2]
        rings = [line for line in line_parts(linemerge(lines)) if line.is_ring]
        if len(rings) == 1:
            add_building(relation.get("id"), "relation", Polygon(rings[0]), props)
            superseded.update(members)

    for osm_id, way in osm_ways.items():
        props = tags(way)
        building = props.get("building") not in (None, "no", "roof", "construction", "parking")
        highway = props.get("highway") in {"motorway", "motorway_link", "trunk", "primary", "secondary",
                                          "residential", "unclassified", "service"}
        highway = highway or (props.get("highway") in {"path", "footway"} and props.get("bridge") == "yes")
        carpark = props.get("amenity") == "parking"
        if not (building or highway or carpark):
            continue
        points = coordinates(way)
        if len(points) >= 4 and points[0] == points[-1]:
            shape = Polygon(points)
            if shape.is_valid and building and osm_id not in superseded:
                add_building(osm_id, "way", shape, props)
            if shape.is_valid and carpark and play_area.covers(shape):
                parking.append({"id": f"parking-{osm_id}", "name": props.get("name", ""),
                                "points": points[:-1], "surface": props.get("surface", ""), "osmId": osm_id})
        if highway and len(points) >= 2:
            for index, part in enumerate(line_parts(LineString(points).intersection(play_area))):
                roads.append({"id": f"road-{osm_id}-{index}", "name": props.get("name", ""),
                              "kind": props["highway"], "points": list(part.coords),
                              "bridge": props.get("bridge") == "yes", "osmId": osm_id})
    return buildings, roads, parking


def summer_routes(config, osm_nodes, osm_ways, project, height, play_area):
    routes = []
    for source in config.get("summerRoutes", []):
        name = source["name"]
        lines = []
        for way in source["ways"]:
            coords = [lon_lat(osm_nodes[node.get("ref")]) for node in osm_ways[way].findall("nd")]
            line = local_line(coords, project)
            if line is not None:
                lines.extend((way, part) for part in line_parts(line.intersection(play_area)))
        merged = linemerge([part for _, part in lines])
        parts = sorted(line_parts(merged), key=lambda line: -line.length)
        for i, part in enumerate(parts):
            points, top, bottom = profile(list(part.coords), height, ascending=False)
            sources = sorted({f"way/{way}" for way, line in lines if line.intersection(part).length > 0})
            route_id = slug(name) if i == 0 else f"{slug(name)}-{i + 1}"
            routes.append({key: value for key, value in source.items() if key != "ways"})
            routes[-1].update(id=route_id, points=points, sources=sources, length=round(part.length, 1),
                              drop=round(top - bottom, 1), topElevation=top, bottomElevation=bottom)
    return routes


def build(config, cache, output):
    origin, project = coordinate_frame(config)
    bounds = config["bounds"]
    wider = config["backdropBounds"]
    step, backdrop_step = config["terrainStep"], config["backdropStep"]
    crs, dem = config["crs"], config["elevationSources"]
    terrain = raster(dem, cache, bounds, step, origin, crs)
    backdrop = raster(dem, cache, wider, backdrop_step, origin, crs)
    forest = raster([config["coverSource"]], cache, bounds, step, origin, crs, tree_cover=True)
    terrain_height, backdrop_height = interpolator(terrain, bounds), interpolator(backdrop, wider)
    play_area = box(bounds["minX"], bounds["minZ"], bounds["maxX"], bounds["maxZ"])
    nodes, ways, relations = load_osm(config, cache)
    runs, areas = run_features(cache, config, project, terrain_height, play_area, nodes, ways)
    lifts = lift_features(cache, config, project, terrain_height, play_area, nodes, ways)
    buildings, roads, parking = map_features(nodes, ways, relations, project, play_area)
    landmarks = []
    for source in config.get("landmarks", []):
        node_id = source.get("node")
        point = project(lon_lat(nodes[node_id]) if node_id else source["lonLat"])
        x, z = point
        local = bounds["minX"] <= x <= bounds["maxX"] and bounds["minZ"] <= z <= bounds["maxZ"]
        height = terrain_height if local else backdrop_height
        landmark = {key: value for key, value in source.items() if key not in {"node", "lonLat"}}
        landmarks.append({**landmark, "point": point, "elevation": round(height(point), 1),
                          **({"osmId": node_id} if node_id else {})})
    for key, records in (("startLift", lifts), ("beginnerLift", lifts), ("startBikeLift", lifts),
                         ("startRun", runs), ("beginnerRun", runs)):
        if key in config and not any(record["id"] == config[key] for record in records):
            raise ValueError(f"Unknown {key}: {config[key]}")
    summer = summer_routes(config, nodes, ways, project, terrain_height, play_area)
    if "startBikeRun" in config and not any(route["id"] == config["startBikeRun"] and route["kind"] == "bike" for route in summer):
        raise ValueError(f"Unknown startBikeRun: {config['startBikeRun']}")

    output.mkdir(parents=True, exist_ok=True)
    terrain_spec = encode_elevation(terrain, output / "terrain.bin")
    backdrop_spec = encode_elevation(backdrop, output / "backdrop.bin", config.get("backdropQuantization", 0.05))
    np.rint(forest * 255).clip(0, 255).astype("u1").tofile(output / "forest.bin")
    rows, cols = forest.shape
    metadata = json.loads((cache / "metadata.json").read_text(encoding="utf-8"))
    result = {key: config[key] for key in ("id", "name", "origin", "bounds", "crs", "startLift",
              "beginnerLift", "startRun", "beginnerRun", "startBikeLift", "startBikeRun", "summerLifts",
              "mountainStats", "viewDistance") if key in config}
    if "summerRoutes" in config:
        result["summerRoutes"] = summer
    result.update(terrain=terrain_spec, backdrop={**backdrop_spec, "bounds": wider},
                  forest={"file": "forest.bin", "cols": cols, "rows": rows},
                  runs=runs, runAreas=areas, lifts=lifts, buildings=buildings,
                  roads=roads, parking=parking, landmarks=landmarks,
                  osmTimestamp=metadata["source"]["openStreetMap"]["dataTimestamp"])
    path = output / "resort.json"
    with path.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(result, file, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        file.write("\n")
    print(f"Built {path} with {len(runs)} run paths, {len(lifts)} lifts, {len(buildings)} buildings, "
          f"{len(roads)} roads and {len(parking)} parking polygons")
    print(f"Terrain {terrain.min():.1f}–{terrain.max():.1f} m, backdrop {backdrop.min():.1f}–{backdrop.max():.1f} m, "
          f"tree cover {forest.mean():.1%}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", nargs="?", type=Path,
                        default=ROOT / "data" / "mountains" / "stevens-pass" / "sources.json")
    parser.add_argument("--cache", type=Path, default=ROOT / ".cache")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    config = json.loads(args.config.read_text(encoding="utf-8"))
    build(config, args.cache, args.output or args.config.parent)


if __name__ == "__main__":
    main()
