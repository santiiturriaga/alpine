import * as THREE from 'three';
import { mulberry32 } from './util.js';

let barkMap;

export function coniferBarkMap() {
  if (barkMap) return barkMap;
  const width = 512, height = 768, columns = 42, rows = 5;
  const data = new Uint8Array(width * height * 4), relief = new Float32Array(width * height);
  const rand = mulberry32(814973);
  const scales = Array.from({ length: columns * rows }, () => [rand(), rand(), rand()]);
  const grain = new Float32Array(128 * 64);
  for (let i = 0; i < grain.length; i++) grain[i] = rand();
  const TAU = Math.PI * 2;
  const wrap = (i, n) => (i % n + n) % n;
  function noise(x, y, periodX, periodY) {
    const i = Math.floor(x), j = Math.floor(y);
    const x0 = wrap(i,periodX), x1 = wrap(i+1,periodX);
    const y0 = wrap(j,periodY)*128, y1 = wrap(j+1,periodY)*128;
    const a = x-i, b = y-j, u = a*a*(3-2*a), v = b*b*(3-2*b);
    const top = grain[y0+x0]*(1-u) + grain[y0+x1]*u;
    const bottom = grain[y1+x0]*(1-u) + grain[y1+x1]*u;
    return top*(1-v) + bottom*v;
  }
  const ramp = (x) => { const t = Math.min(1,Math.max(0,x)); return t*t*(3-2*t); };
  for (let y = 0; y < height; y++) {
    const v = y/height;
    for (let x = 0; x < width; x++) {
      const u = x/width;
      // Lengthwise plates wander and fork with separate coarse and fine grain.
      const px = u*columns + Math.sin(v*3*TAU + u*11*TAU)*.18 + (noise(u*64,v*8,64,8) - .5)*.70;
      const py = v*rows + (noise(u*32,v*8,32,8) - .5)*.38;
      let nearest = Infinity, second = Infinity, tint = 0;
      const col = Math.floor(px), row = Math.floor(py);
      for (let j = row-1; j <= row+1; j++) for (let i = col-1; i <= col+1; i++) {
        const [sx,sy,shade] = scales[wrap(j,rows)*columns+wrap(i,columns)];
        const dx = px - i - .18 - sx*.64, dy = (py - j - .18 - sy*.64)*.59;
        const distance = dx*dx+dy*dy;
        if (distance < nearest) { second = nearest; nearest = distance; tint = shade; }
        else if (distance < second) second = distance;
      }
      const fissure = ramp((Math.sqrt(second)-Math.sqrt(nearest)) * 6.6);
      const fibres = noise(u*128 + Math.sin(v*8*TAU)*.41,v*16,128,16) - .5;
      const flakes = noise(u*128,v*64,128,64) - .5;
      const shelf = .43 + .33*tint + .15*Math.sin(u*64*TAU+v*2*TAU);
      const h = .12 + shelf*fissure + fibres*.13 + flakes*.10 + (rand()-.5)*.022;
      relief[y*width+x] = h;
      data[(y*width+x)*4] = Math.round((.15 + h*.76) * 255);
    }
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (a,b) => relief[wrap(b,height)*width+wrap(a,width)];
    const i = (y*width+x)*4;
    data[i+1] = 128 + Math.max(-120,Math.min(120,(at(x-1,y)-at(x+1,y))*255));
    data[i+2] = 128 + Math.max(-120,Math.min(120,(at(x,y-1)-at(x,y+1))*390));
    data[i+3] = 255;
  }
  barkMap = new THREE.DataTexture(data,width,height,THREE.RGBAFormat);
  barkMap.wrapS = barkMap.wrapT = THREE.RepeatWrapping;
  barkMap.magFilter = THREE.LinearFilter;
  barkMap.minFilter = THREE.LinearMipmapLinearFilter;
  barkMap.generateMipmaps = true;
  barkMap.anisotropy = 8;
  barkMap.needsUpdate = true;
  return barkMap;
}
