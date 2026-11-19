"""Bake exact snow channels, corduroy directions and mountain shade for the browser's piste mask."""

import gzip
from tempfile import TemporaryDirectory
from pathlib import Path

from browser_bake import ROOT, bake_page


def main():
    with TemporaryDirectory() as tmp, bake_page() as page:
        with page.expect_download(timeout=90000) as download:
            page.evaluate("""async () => {
                const { initWorldData, RUNS, WORLD } = await import('/src/worlddata.js');
                const { loadGrid, buildMask } = await import('/src/terrain.js');
                const { prepareValleyLakes } = await import('/src/valley-scenery.js');
                const { generateSnowData } = await import('/src/terrain-snow-data.js');
                const { snowInputDigest } = await import('/src/whistler-snow-pack.js');
                initWorldData();
                const { heights, cover } = await loadGrid('resort.bin', WORLD);
                prepareValleyLakes(heights, cover, WORLD);
                const inputs = { heights, cover, bounds: WORLD, runs: RUNS, mask: buildMask(1536).mask };
                const [fields, digest] = await Promise.all([generateSnowData(inputs), snowInputDigest(inputs)]);
                const header = new DataView(new ArrayBuffer(8));
                header.setUint32(0, 0x57425333);
                header.setUint16(4, 1536, true);
                header.setUint16(6, 385, true);
                const field = fields.snowField;
                const size = 1536;
                const channels = new Uint8Array(3 * size * size);
                // The red channel rounds the existing mask. Store the other
                // channels separately, using a lossless predictor for powder and trees.
                for (let channel = 1; channel < 4; channel++) {
                    const plane = channels.subarray((channel - 1) * size * size);
                    for (let y = 0; y < size; y++) {
                        for (let x = 0; x < size; x++) {
                            const index = y * size + x;
                            const i = 4 * index + channel;
                            let value = field[i];
                            if (channel !== 2) {
                                if (x) value -= field[i - 4];
                                if (y) value -= field[i - 4 * size];
                                if (x && y) value += field[i - 4 * (size + 1)];
                            }
                            plane[index] = value;
                        }
                    }
                }
                const payload = new Blob([header.buffer, digest, fields.grooming, fields.shade, channels]);
                const a = document.createElement('a');
                a.href = URL.createObjectURL(payload);
                a.download = 'snow.bin';
                a.click();
            }""")
        path = Path(tmp) / "snow.bin"
        download.value.save_as(path)
        output = ROOT / "data" / "whistler-snow.bin.gz"
        output.write_bytes(gzip.compress(path.read_bytes(), compresslevel=6, mtime=0))
        print(f"{output.name}: {output.stat().st_size:,} bytes, {path.stat().st_size:,} decoded")


if __name__ == "__main__":
    main()
