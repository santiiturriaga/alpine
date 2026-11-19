# Whistler Blackcomb data and attribution

The game uses a metre-based local frame in WGS 84 / UTM zone 10N (EPSG:32610). X increases east, Z increases south, and Y is elevation in metres. The origin is the bottom station of Fitzsimmons Express at 50.1128468° N, 122.9533203° W. The game's terrain and collision use the same triangulated height field.

| File | Source and processing |
| --- | --- |
| [osm-whistler.js](osm-whistler.js) | **© OpenStreetMap contributors**, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Ski routes and lift centerlines were extracted via [OpenSkiData / OpenSkiMap](https://openskidata.org/) using the OSM snapshot identified in the file. Village footprints come directly from the OpenStreetMap map endpoint. Coordinates were projected and rounded to decimetres. The downloadable file contains the distributed derivative database and each feature's OSM ID. [OpenStreetMap copyright and license](https://www.openstreetmap.org/copyright) |
| [resort.bin](resort.bin) | 641 × 641 grid at about 17 m spacing. [Copernicus GLO-30](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM) with a blend of the [NRCan BC-Squamish 2016 HRDEM](https://open.canada.ca/data/en/dataset/957782bf-847c-4644-a757-e383c0057995) bare-earth LiDAR where available in the lower valley. The LiDAR input covers about 10% of the playable grid before blending. Land cover comes from ESA WorldCover. |
| [ranges.bin](ranges.bin) | 501 × 501 samples over 50 × 50 km at 100 m spacing. Copernicus GLO-30 elevation and ESA WorldCover land classes. |
| [black-tusk.bin](black-tusk.bin) | Local 151 × 151 resample of Copernicus GLO-30 around The Black Tusk. The narrow volcanic spire is modeled up to its published summit elevation. [BC Geographical Names Office](https://apps.gov.bc.ca/pub/bcgnws/names/5708.html) |
| [geography.js](geography.js) | Grid bounds, local projection origin and selected landmarks. [BC Geographical Names — Blackcomb Peak](https://apps.gov.bc.ca/pub/bcgnws/names/5163.html) |

Each binary grid stores an unsigned 16-bit little-endian elevation in decimetres and one ESA WorldCover class byte per point, ordered west to east and north to south. LiDAR and satellite elevation data were resampled to the runtime grid. Valley buildings are rendered from mapped footprints, with estimated heights, roofs and façades. The trail network is the mapped downhill extract and has not been reconciled run by run against the [official resort trail map](https://www.whistlerblackcomb.com/the-mountain/about-the-mountain/trail-maps.aspx).

### Roundhouse and alpine landmarks

The arrival area, terminal, Olympic rings, and inukshuk were modeled from the supplied photographs and mapped station locations and building footprints. Building heights, sculpture and banner placement, and fine surface details are estimates. The supplied JPEGs did not contain GPS metadata. [Roundhouse Lodge footprint](https://www.openstreetmap.org/way/50909775), [Whistler PEAK 2 PEAK footprint](https://www.openstreetmap.org/way/173634036), [Whistler Blackcomb arrival and access notes](https://www.whistlerblackcomb.com/explore-the-resort/about-the-resort/accessibility-in-whistler.aspx)

### Source notices

Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved. The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM-30. [GLO-30 licence](https://dataspace.copernicus.eu/sites/default/files/media/files/2025-06/copernicus_contributing_mission_data_access_v2_cop_dem_licenses.pdf)

Contains information licensed under the [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada/).

© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium. Land-cover classes were resampled. [Zanaga et al., ESA WorldCover 10 m 2021 v200](https://doi.org/10.5281/zenodo.7254221), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

The OpenSkiData project also credits Skimap.org, Who's On First and Mapterhorn. The imported game features retain OSM geometry, names and classifications, with elevations supplied by the terrain grid. [OpenSkiData attribution](https://openskidata.org/#license--attribution)

Peak 2 Peak's modeled main-span sag uses its published 436 m maximum cabin clearance and the mapped towers. [Doppelmayr lift specifications](https://www.doppelmayr.com/wp-content/uploads/2023/04/Doppelmayr_Garaventa-cable-cars-at-olympic-venues-EN.pdf)

### Regenerating the data

The checked-in assets are sufficient to play. To regenerate, install Python packages `numpy pyproj rasterio scipy` and save the inputs below in `.cache/`, then run `python tools/build_geography.py`. Current downloads may differ from the checked-in snapshot.

- `runs.geojson`, `lifts.geojson`, and `metadata.json` from [OpenSkiData downloads](https://openskidata.org/#download). The global files are large.
- `village.osm` and `creekside.osm` from the [OSM map endpoint for Whistler Village](https://api.openstreetmap.org/api/0.6/map?bbox=-122.961,50.109,-122.940,50.122) and the [map endpoint for Creekside](https://api.openstreetmap.org/api/0.6/map?bbox=-122.998,50.089,-122.984,50.0985).
- `copernicus.tif` for N50° W123°, and `N50_00_W124.tif`, `N49_00_W123.tif`, and `N49_00_W124.tif` for the adjacent tiles from the [AWS GLO-30 collection](https://copernicus-dem-30m.s3.amazonaws.com/readme.html).
- `cover-N48W123.tif` and `cover-N48W126.tif` from [ESA WorldCover v200](https://esa-worldcover.org/en/data-access).
- `lidar.tif` from the [BC-Squamish terrain COG](https://canelevation-dem.s3.ca-central-1.amazonaws.com/hrdem-lidar/BC-Squamish_2016-1m-dtm.tif). Read a projected window around the WGS84 bounds `-123.005,50.085,-122.928,50.133` or use a cached full copy.

At Olympic Plaza, the ring sculpture and neighbouring buildings use local mapped positions. The tower, the roof over Eagle Lodge’s octagonal north bay, the balcony rails and festive lights were interpreted from the supplied winter photograph. [Olympic rings](https://www.openstreetmap.org/node/1210013028), [BrewHouse](https://www.openstreetmap.org/way/146628098), [Eagle Lodge](https://www.openstreetmap.org/way/146630821), [Tyndall Stone Lodge](https://www.openstreetmap.org/way/146589337).

The skier, trees, lift assets, snow material and buildings are generated in code. The Creekside trail board uses mapped trail and lift geometry. The original [resort maps](../assets/maps/README.md) are available for comparison.

The destination selector uses [`destination-relief.bin`](destination-relief.bin), a downsampled elevation grid and simplified mapped lift lines for each playable destination. It uses the same source data as the corresponding in-game terrain, with source notices for the other destinations in `mountains/<destination>/sources.json`. After updating terrain or lift data, rebuild the selector asset with `python tools/build_destination_relief.py` (requires NumPy).
