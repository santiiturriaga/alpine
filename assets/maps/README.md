# Resort trail map

The illustrated winter trail map is the resort-published 2025/26 Whistler
Blackcomb Mountain Atlas, downloaded from [Tourism Whistler's official PDF
mirror](https://cdn.whistler.com/s3/pdf/maps/whistler-blackcomb-trail-map-2025-26.pdf)
on 17 November 2026. The resort's own [trail map page](https://www.whistlerblackcomb.com/the-mountain/about-the-mountain/trail-maps.aspx)
also identifies the winter map as 2025/26 at the time of retrieval.

Artwork and original PDF retain their original copyrights, including Whistler
Blackcomb. This fan game is not affiliated with the resort. These source assets
are not licensed as OpenStreetMap data or as original game artwork.

`whistler-blackcomb-winter-2025-26.pdf` preserves the complete two-page original.
`tools/build_resort_map.py` renders the main panorama, all three alpine insets and
the legend directly from that PDF. The overview images load first; 1024-pixel
tiles rendered at four pixels per PDF point are loaded as the user zooms.
The PDF aspect ratios are preserved. No labels or trail routes are redrawn.

The painterly map is not georeferenced. The optional game-position marker is an
estimate, using manually matched lodge, peak and lift-station landmarks and
piecewise affine interpolation between them. It is most accurate at those
landmarks and can diverge on the illustrated faces, which deliberately compress
or rotate terrain. The marker is not a real-world navigation aid. Conditions and
closures shown in this printed 2025/26 map are not live resort status.

The [official 2024/25 village and base-area PDF](https://www.whistlerblackcomb.com/-/aemasset/sitecore/whistler-blackcomb/maps/winter-2024-2025/20241120_WB_winter-base_map_001.pdf)
adds three zoomable plates covering Whistler Village and Upper Village,
Creekside, and Function Junction. The PDF link in the viewer follows the
selected plate. Width and height use the scale of the original PDF page.
