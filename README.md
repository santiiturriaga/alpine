# Alpine Descent

A fan-made, browser-based skiing sandbox on the shoulders of **Whistler & Blackcomb**. Two mountains, 31 named lines, five hidden glades, a Peak 2 Peak gondola, coin trails, kickers, and a full alpine world built from scratch with Three.js.

> **Status:** actively being built. The page deploys automatically to GitHub Pages from `main` once the game entry point is in place.

## Play

Open the GitHub Pages build (once published):

**https://santiiturriaga.github.io/alpine/**

Or run it locally — no build step, no dependencies:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Controls

| Key | Action |
| --- | --- |
| `A` / `D` | Carve left / right |
| `W` | Tuck for speed |
| `S` | Brake / speed check |
| `Space` | Ollie |
| `Shift` | Grab (in the air) |
| `E` | Ride the Peak 2 Peak |
| `M` | Trail map |
| `R` | Reset to Whistler Peak |
| `Esc` | Pause |

## The mountain

- **Whistler** on the east and **Blackcomb** on the west, joined by the Peak 2 Peak.
- 31 named runs across green, blue, black, and double-black terrain.
- Five hidden glades — Wild Card, Crystal Glade, Bear's Hollow, Bushrat, and Dusty's — each with a crystal.
- Coin trails, booters, cliff drops, lift systems, lodges, village terraces, trail signs, and finish arches.
- Real-time carving physics, airborne tricks, spray, ski tracks, snow, wind, and a stylized trail map.

## Reference

Layout and naming are inspired by the [Whistler Blackcomb 2025/26 trail map](https://www.whistlerblackcomb.com/-/aemasset/sitecore/whistler-blackcomb/maps/winter-2025-2026/20251023_WB_winter-trail_map_001.pdf). This is a fan project and is not affiliated with Vail Resorts or Whistler Blackcomb.

## Tech

- [Three.js r160](https://threejs.org/) (vendored locally, no CDN)
- Plain ES modules, HTML, and CSS
- Procedurally generated terrain, forest, snow textures, lifts, and skier
- Barlow type family, self-hosted

## Automatic updates

Every push to `main` runs `.github/workflows/pages.yml` and republishes the site to GitHub Pages.

## License

Fan project. Code is provided for personal and educational use. Whistler Blackcomb and related names are trademarks of their respective owners.
