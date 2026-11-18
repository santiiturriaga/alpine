// All resorts keep the same shadow shader when changing detail. Resizing its
// depth target costs one allocation; toggling shadows recompiles visible materials.
export const graphicsProfiles = [
  { name: 'LOW', pixel: 1, samples: .86, maxPixels: 1800000, shadow: 512 },
  { name: 'BALANCED', pixel: 1.6, samples: 1, maxPixels: 3600000, shadow: 1024 },
  { name: 'HIGH', pixel: 2.2, samples: 1.35, maxPixels: 6000000, shadow: 2048 },
  { name: 'MAX', pixel: 2.5, samples: 1.55, maxPixels: 8800000, shadow: 3072 },
];
const preference = 'alpine.graphics';
export function graphicsIndex(query, fallback) {
  let saved;
  try { saved = localStorage.getItem(preference); } catch {}
  const name = (query.get('quality') || saved || fallback).toUpperCase();
  const index = graphicsProfiles.findIndex(profile => profile.name === name);
  return index < 0 ? graphicsProfiles.findIndex(profile => profile.name === fallback) : index;
}
export function bindGraphics(slider, index, apply) {
  const output = document.getElementById('graphics-level');
  function present(i) {
    const name = graphicsProfiles[i].name;
    slider.value = i;
    slider.setAttribute('aria-valuetext', name);
    output.textContent = name.charAt(0) + name.slice(1).toLowerCase();
  }
  present(index);
  // While dragging, repaint only the label. Commit once on release. Keyboard
  // changes also dispatch change through the native range input.
  slider.addEventListener('input', () => present(slider.valueAsNumber));
  slider.addEventListener('change', () => {
    const next = slider.valueAsNumber;
    if (index === next) return;
    index = next;
    present(next);
    try { localStorage.setItem(preference, graphicsProfiles[next].name); } catch {}
    apply(next);
  });
}
export function applyShadowResolution(renderer, sun, resolution) {
  renderer.shadowMap.enabled = sun.castShadow = true;
  if (sun.shadow.mapSize.x !== resolution) {
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    sun.shadow.mapSize.set(resolution, resolution);
  }
  renderer.shadowMap.needsUpdate = true;
}
