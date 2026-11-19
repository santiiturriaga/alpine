import { generateSnowData } from './terrain-snow-data.js';

self.onmessage = async ({ data }) => {
  try {
    const result = await generateSnowData(data);
    self.postMessage(result, [result.snowField.buffer, result.shade.buffer, result.grooming.buffer]);
  } catch {
    self.postMessage(null);
  }
  self.close();
};
