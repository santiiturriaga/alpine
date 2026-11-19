"""Render matching dry and snow-loaded distant crowns from the in-game trees."""

import base64

from browser_bake import ROOT, bake_page


def main():
    with bake_page(args=["--disable-gpu", "--disable-gpu-compositing",
                         "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]) as page:
        atlases = page.evaluate("""async () => {
          const THREE = await import('three');
          const { coniferGeometry, coniferMaterial } = await import('/src/conifers.js');
          const { climateUniforms } = await import('/src/climate-state.js');
          const width = 192, height = 256, gutter = 16, size = 24, elevation = 1780;
          const tileWidth = width + 2 * gutter, tileHeight = height + 2 * gutter;
          const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
          renderer.setSize(width, height);
          renderer.toneMapping = THREE.NoToneMapping;
          const scene = new THREE.Scene();
          scene.add(new THREE.HemisphereLight(0xe6efff, 0x95a7ba, 1.45));
          const sun = new THREE.DirectionalLight(0xfff4dd, 1.55);
          scene.add(sun);
          const camera = new THREE.OrthographicCamera(
            -.421875*size, .421875*size, .5625*size, -.5625*size, .1, 500);
          const material = coniferMaterial(0);
          const tree = new THREE.Mesh(new THREE.BufferGeometry(), material);
          tree.scale.setScalar(size);
          tree.position.y = elevation;
          scene.add(tree);
          const atlas = document.createElement('canvas');
          atlas.width = 4 * tileWidth;
          atlas.height = 6 * tileHeight;
          const ctx = atlas.getContext('2d');
          const species = ['fir', 'spruce', 'hemlock'];
          climateUniforms.snowline.value = 850;
          return [0, 1].map(snow => {
            climateUniforms.snowpack.value = snow;
            ctx.clearRect(0, 0, atlas.width, atlas.height);
            for (let row = 0; row < 6; row++) {
              tree.geometry = coniferGeometry(species[row % 3], 0, Math.floor(row / 3));
              for (let view = 0; view < 4; view++) {
                const angle = view * Math.PI / 2;
                const x = Math.sin(angle), z = Math.cos(angle);
                camera.position.set(x*110, elevation + size*.5, z*110);
                camera.lookAt(0, elevation + size*.5, 0);
                sun.position.set(x*3-z*3, 6, z*3+x*3);
                renderer.render(scene, camera);
                ctx.drawImage(renderer.domElement, tileWidth * view + gutter, tileHeight * row + gutter);
              }
            }
            return atlas.toDataURL('image/png').split(',')[1];
          });
        }""")
    for name, data in zip(("crowns.png", "crowns-snow.png"), atlases, strict=True):
        output = ROOT / "assets" / "forest" / name
        output.write_bytes(base64.b64decode(data))
        print(f"{output.name}: {output.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
