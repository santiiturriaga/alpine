# Adding a mapped ski resort

Whistler uses its original authored world. Stevens Pass, Snoqualmie and Crystal Mountain use the shared survey-based loader, ski controller, scenery, lift operations and atlas. Additional resorts can use the same entry point and controls.

1. Create a folder under `data/mountains` and use [the Stevens Pass inputs](stevens-pass/sources.json) as a template for `sources.json`. Supply a projected origin, local and regional bounds, elevation and land-cover sources, the OSM ski-area name and any verified local corrections. Choose a default lift and starting run. X increases east, Z increases south, and elevation is in metres.
2. Build the local pack with `python tools/build_mountain_data.py data/mountains/YOUR-ID/sources.json`. See the [Stevens source notes](stevens-pass/README.md) for prerequisites, cache layout, public data attribution and raster encoding. Runtime files sit beside the source configuration.
3. Supply the official reference map URL, any additional terrain views, and the mapped landmarks for this resort. The interactive map uses the same metre coordinates, elevation sampler, runs and lifts as the game. Summer routes carry their own hike or bike designation.
4. Register the display name, region, local data URL and atlas metadata in [resorts.js](../../src/resorts.js). The title and in-game picker then offer the destination, and `?mountain=YOUR-ID` opens it directly. Lodge-specific architecture can be added to the mapped scenery independently of skiing and lift operations.

For a new pack, check a known lift's measured vertical rise, a downhill run, a boarding and unload position, and the agreement between the rendered snow and the ski contact surface. Preserve the source date and distinguish measurements from inferred widths, station hardware and façade details.
