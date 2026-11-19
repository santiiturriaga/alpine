import { generateSnowData } from './terrain-snow-data.js';

let activeWorker = null;
const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));

function workerSnow(inputs) {
  if (typeof Worker === 'undefined' || activeWorker) return Promise.resolve(null);
  return new Promise(resolve => {
    let worker, timer, done = false;
    const finish = result => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker?.terminate();
      if (activeWorker === worker) activeWorker = null;
      resolve(result);
    };
    try {
      worker = new Worker(new URL('./terrain-snow-worker.js', import.meta.url), { type: 'module', name: 'Whistler snow' });
      activeWorker = worker;
      worker.onerror = event => { event.preventDefault(); finish(null); };
      worker.onmessageerror = () => finish(null);
      worker.onmessage = ({ data }) => {
        const length = inputs.mask.length;
        const valid = data?.snowField instanceof Uint8Array && data.snowField.length === length * 4 &&
          data.grooming instanceof Uint16Array && data.grooming.length === length &&
          data.shade instanceof Uint8Array && data.shade.length === 385 * 385;
        finish(valid ? data : null);
      };
      timer = setTimeout(() => finish(null), 30000);
      // Keep the live physics/Canvas inputs on the main thread. Transfer only
      // these bounded boot copies; terminating the worker releases its inputs
      // and the temporary nearest-run grid after the result buffers return.
      const heights = inputs.heights.slice(), cover = inputs.cover.slice(), mask = inputs.mask.slice();
      const bounds = inputs.bounds;
      worker.postMessage({
        heights, cover, mask,
        bounds: { minX: bounds.minX, maxX: bounds.maxX, minZ: bounds.minZ, maxZ: bounds.maxZ,
          sizeX: bounds.sizeX, sizeZ: bounds.sizeZ, grid: bounds.grid },
        runs: inputs.runs.map(({ width, gladed, points }) => ({ width, gladed, points })),
      }, [heights.buffer, cover.buffer, mask.buffer]);
    } catch { finish(null); }
  });
}

export async function startSnowGeneration(inputs, yieldFrame = yieldTask) {
  const result = await workerSnow(inputs);
  if (result) return { ...result, execution: 'worker' };
  return { ...await generateSnowData(inputs, yieldFrame), execution: 'main' };
}
