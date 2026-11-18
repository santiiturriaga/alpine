# Alpine Descent

Ski Whistler Blackcomb in British Columbia or Stevens Pass in Washington. Both resorts use real elevation and trail centerlines with code-built scenery and shared ski physics.

## Play locally

From the checkout, run:

```sh
python -m http.server 8080 --bind 127.0.0.1
```

Open [Alpine Descent](http://127.0.0.1:8080). The game uses vendored Three.js and local data files. It needs a WebGL browser and no build step.

**Mountain → Resort → Travel** switches resorts from the title or during play. Open [Stevens Pass](http://127.0.0.1:8080/?mountain=stevens-pass) directly to start at Skyline, or choose Daisy for an easier descent. The Front Side, Mill Valley and base-area plates open with **M**. The Stevens pack includes 88 mapped paths, 13 lift lines, and 47 building footprints within 5.2 × 4.3 km of 10 m terrain. Its 44.8 × 57.6 km backdrop includes Mount Stuart. [Stevens data and coverage](data/mountains/stevens-pass/README.md) · [Adding another resort](data/mountains/README.md)

### Start at Roundhouse

Choose **Unload at Roundhouse**. You start stopped on the snow outside the Whistler Village Gondola arrival area, facing Roundhouse Lodge, the Olympic rings and the Whistler PEAK 2 PEAK terminal. Press **W** to push off or **E** to board the gondola to Blackcomb.

For a powder run, open [the forest beside Come a Long](http://127.0.0.1:8080/?start=come-along). Press **W** to push off and **A/D** to carve.

Press **G** to travel, set the season and weather, or start a challenge. The [mountain-wide avalanche escape](http://127.0.0.1:8080/?challenge=avalanche&view=helmet) starts on Whistler Mountain. Take any downhill route to a village base ahead of the descending slide. [Head-to-head](http://127.0.0.1:8080/?challenge=race) puts a second racer alongside you on Springboard. Whiskey Jack slalom adds three seconds for each missed gate. Landing a spin, flip or held grab can give a short speed boost. Link clean landings to extend it.

Green jackets identify beginners, blue jackets intermediates and black jackets experts. Guests ski and snowboard in parties, queue at lifts and stop to rest or chat.

Press **B** to take your skis off and walk with **W/S**, turning with **A/D**. Walk through the open entrances at Roundhouse Lodge, Rendezvous Lodge, the village warming hut and the ski rental shop. Indoors, the camera switches to eye level.

Gondolas board into the cabin. Use **WASD** to walk, drag or use the arrow keys to look around, and look out the side window to see the skis on the rack. **C** changes the scenic camera, **V** returns to the cabin and **E** skips to the unload.

The signed runs around Roundhouse include Ego Bowl and Upper Whiskey Jack. Peak Express climbs separately to Whistler Peak and the summit inukshuk. **Start at Skiers Plaza** puts you near Fitzsimmons Express for a lower-mountain lap via Fitz and Lower Olympic.

| Key | Action |
| --- | --- |
| A / D | Carve, or look around on a lift |
| W | Tuck at speed or alternate ski steps on flat terrain and climbs |
| S | Brake |
| B | Switch between skis and boots. W/S walk forward/backward |
| Space | Ollie |
| Shift | Grab in the air |
| E | Board or skip a lift, enter or leave a vehicle, or observe nearby wildlife |
| Q | Cycle nearby lifts |
| C | Change chase, helmet, lift or vehicle view. Click the game to capture the mouse for free look |
| V | Return to the gondola cabin |
| M | Open the illustrated trail atlas. Drag to pan, scroll or pinch to zoom, or press Home to fit the full map |
| G | Choose conditions, destination or challenge |
| L | Open the outfitter. Coins, owned gear and field notes save in this browser |
| R | Return to Roundhouse |
| Esc | Pause or resume, including on a lift. Close the map when it is open |

## Geography and artwork

Visit Skiers Plaza, the Fairmont, Dusty’s patio, the summit inukshuk, the glacier cave or the cliff overlook from **G**. Scenic views have a local photo-overlay control and an exit to on-foot exploration. The street view was matched to recognizable building corners. The Fairmont, Creekside and village shells use mapped footprints with surveyed roof heights where available. Hidden elevations, cave interiors, wildlife and operating scenes are interpretations.

The Skiers Plaza camera fits Sundial and the Salomon frontage. It sits about 176 m from the panorama coordinates embedded in the supplied Google Maps link. The cliff overlook uses the Cirque/Couloir shoulder on Whistler Peak. The supplied cliff photo did not establish an exact camera location. The illustrated village atlas uses the resort’s original PDF proportions. [Village base map](https://www.whistlerblackcomb.com/-/aemasset/sitecore/whistler-blackcomb/maps/winter-2024-2025/20241120_WB_winter-base_map_001.pdf) · [Sundial](https://www.sundialhotel.com/homepage) · [Garibaldi Lift Co.](https://www.whistlerblackcomb.com/explore-the-resort/the-village/dining/glc.aspx) · [Slope Magazine resort guide](https://www.slopemagazine.com/snow/whistler-blackcomb/) · [Whistler Mountain geology](https://fireandicegeoregion.ca/geosite/whistler-mountain/) · [Blackcomb Mountain geology](https://fireandicegeoregion.ca/geosite/blackcomb-mountain/)

Vehicle entries under **G** take you to a parked vehicle. Press **E** to enter, **W/S** to change speed, **A/D** to steer and **C** to switch views. Use **Space/Shift** for vertical control in the helicopter and pitch control in the wingsuit. Land before leaving the helicopter. Visit the Roundhouse to observe Canada jays or look for marmots near Rendezvous in the warmer seasons.

The game includes 617 mapped downhill centerline segments, 29 piste areas, and 36 mapped lift sections. Twenty-five public aerial sections support boarding. These counts include separately mapped connectors and lift stages. The playable elevation grid spans 10.9 × 10.7 km, within 50 × 50 km of surrounding Coast Mountain terrain.

Trail centerlines, station locations, and village footprints come from mapping data. Trail widths, most cable profiles, snow conditions, building heights and appearances, and the skier and forest are modeled in code. The geographic inputs and their coverage limits are documented in [Data and attribution](data/README.md).

The in-game atlas uses the [official 2025/26 trail map](https://cdn.whistler.com/s3/pdf/maps/whistler-blackcomb-trail-map-2025-26.pdf). The rider marker is an approximate position on a painted panorama.

The repository's existing GitHub Pages workflow packages the game on pushes to `main`. This is a fan project.
