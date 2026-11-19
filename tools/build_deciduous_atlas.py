"""Bake the game's procedural tree geometry and its filtered mip levels for distant views."""

import base64
import gzip
import struct

from browser_bake import ROOT, bake_page


def main():
    with bake_page() as page:
        result = page.evaluate("""async () => {
            const { bakeDeciduousCrowns } = await import('/src/deciduous-forest.js');
            const atlases = bakeDeciduousCrowns().map(texture => texture.mipmaps);
            const encode = bytes => {
              let text = '';
              for (let i = 0; i < bytes.length; i += 8192)
                text += String.fromCharCode(...bytes.subarray(i, i + 8192));
              return btoa(text);
            };
            return {width: atlases[0][0].width, height: atlases[0][0].height,
              levels: atlases.flat().map(level => encode(level.data))};
        }""")
    header = struct.pack("<4sHH", b"FOL1", result["width"], result["height"])
    payload = header + b"".join(base64.b64decode(level) for level in result["levels"])
    out = ROOT / "assets" / "forest" / "deciduous-crowns.bin.gz"
    out.write_bytes(gzip.compress(payload, compresslevel=9, mtime=0))
    print(f"{out.name}: {out.stat().st_size:,} bytes, {len(payload):,} bytes decoded")


if __name__ == "__main__":
    main()
