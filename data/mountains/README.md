# Adding a mapped ski resort

Whistler uses its original authored world. The other ski resorts use the shared mapped terrain, ski controller, scenery, lift operations and atlas. Mountain visits use the same terrain and atlas with walkable starting viewpoints.

1. Create a folder under `data/mountains` and use [the Stevens Pass inputs](stevens-pass/sources.json) as a template for `sources.json`. Supply a projected origin, local and regional bounds, elevation and land-cover sources, the OSM ski-area name and any verified local corrections. Choose a default lift and starting run. X increases east, Z increases south, and elevation is in metres.
2. Build the local pack with `python tools/build_mountain_data.py data/mountains/YOUR-ID/sources.json`. See the [Stevens source notes](stevens-pass/README.md) for prerequisites, cache layout, public data attribution and raster encoding. Runtime files sit beside the source configuration.
3. Supply the official reference map URL, any additional terrain views, and the mapped landmarks for this resort. The interactive map uses the same metre coordinates, elevation sampler, runs and lifts as the game. Summer routes carry their own hike or bike designation.
4. Register the display name, region, local data URL and atlas metadata in [resorts.js](../../src/resorts.js). The title and in-game picker then offer the destination, and `?mountain=YOUR-ID` opens it directly. Lodge-specific architecture can be added to the mapped scenery independently of skiing and lift operations.

For a new pack, check a known lift's measured vertical rise, a downhill run, a boarding and unload position, and the agreement between the rendered snow and the ski contact surface. Preserve the source date and distinguish measurements from inferred widths, station hardware and façade details.

## Terrain and trail inventory

| Destination | Playable elevation grid | Run paths | Lift lines |
| --- | --- | ---: | ---: |
| [Les 3 Vallées](les-3-vallees/sources.json) | 20 m, IGN RGE ALTI | 824 | 148 |
| [Zermatt–Cervinia](zermatt-cervinia/sources.json) | 20 m, Copernicus GLO-30 and swissALTI3D around the Matterhorn | 277 | 55 |
| [Chamonix–Mont-Blanc](chamonix-mont-blanc/sources.json) | 20 m, IGN RGE ALTI and cross-border Copernicus GLO-30 | 213 | 68 |
| [Ski Arlberg](ski-arlberg/sources.json) | 20 m, Copernicus GLO-30 | 462 | 85 |
| [Verbier / 4 Vallées](verbier-4-vallees/sources.json) | 20 m, Copernicus GLO-30 | 325 | 66 |
| [Tignes–Val d’Isère](tignes-val-disere/sources.json) | 16 m, IGN RGE ALTI and cross-border Copernicus GLO-30 | 302 | 77 |
| [Vail](vail/sources.json) | 10 m, USGS 3DEP | 296 | 31 |
| [Jackson Hole](jackson-hole/sources.json) | 12 m, USGS 3DEP | 138 | 16 |
| [Niseko United](niseko-united/sources.json) | 12 m, Copernicus GLO-30 | 161 | 27 |

The mapped path counts include individual route segments and unnamed connectors. Piste and lift lines are from the November 15, 2026 OpenStreetMap snapshot distributed by OpenSkiData. Direct OpenStreetMap extracts supply selected village footprints, roads, parking and tagged lift pylons. The Les 3 Vallées piste-map reference covers Courchevel, Méribel, Les Menuires, Saint-Martin-de-Belleville, Val Thorens, Orelle and Brides-les-Bains. The in-game atlas uses geographic coordinates and links to the operator’s ski map. [Les 3 Vallées ski map](https://www.les3vallees.com/en/guide/the-world-s-largest-ski-area/ski-area-map) · [OpenSkiData](https://openskidata.org/#license--attribution)

The seven mountain visits open at [Paradise](mount-rainier/sources.json), [Col du Midi](mont-blanc/sources.json), [Schwarzsee](matterhorn/sources.json), [Kleine Scheidegg](eiger/sources.json), [Kahiltna Base Camp](denali/sources.json), [Everest Base Camp](everest/sources.json) and [Concordia](k2/sources.json). Their grids sample public elevation sources at 15–35 m spacing and include mapped summit and viewpoint coordinates. The regional grids use 100 m spacing. The sample spacing of the game grid can be smaller than the source resolution. Narrow ridges, crevasses and sharp peaks are generalized by the source and the game grid. Building textures, lift hardware and tree positions are procedural.

### Attribution

- © OpenStreetMap contributors. Pistes, lifts, roads, building outlines, parking and map points use OSM data under ODbL 1.0. [OpenStreetMap attribution](https://www.openstreetmap.org/copyright)
- Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved. The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM-30. [Data access](https://registry.opendata.aws/copernicus-dem/) · [Copernicus DEM licence](https://dataspace.copernicus.eu/sites/default/files/media/files/2025-06/copernicus_contributing_mission_data_access_v2_cop_dem_licenses.pdf)
- French local elevations use the French National Institute of Geographic and Forest Information’s RGE ALTI terrain product, accessed in November 2026 under Open Licence 2.0. [IGN RGE ALTI](https://www.data.gouv.fr/datasets/rge-alti-r)
- Matterhorn and Eiger summit areas use elevation data from the Federal Office of Topography swisstopo. Tile years are in the source manifests. [swissALTI3D](https://www.swisstopo.admin.ch/en/height-model-swissalti3d)
- Vail, Jackson Hole and Mount Rainier use public-domain terrain elevations from the U.S. Geological Survey’s 3D Elevation Program. [USGS 3DEP](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services)
- © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium. The forest grid interpolates WorldCover’s tree-cover class. [Zanaga et al.](https://doi.org/10.5281/zenodo.7254221) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
