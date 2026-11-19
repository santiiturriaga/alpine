// Render-only dimensions for the caps and vertical profile, in metres.
// The catalogue supplies the measured planform dimensions and reference stance.
export const deckShapes = {
  'all-mountain': { mount: .088, waistAt: -.026, noseCap: .162, tailCap: .109,
    noseRocker: .17, tailRocker: .12, camber: .009, noseRise: .078, tailRise: .025 },
  'laser-wrt-pro': { mount: .079, waistAt: -.022, noseCap: .115, tailCap: .043,
    noseRocker: .095, tailRocker: .037, camber: .012, noseRise: .058, tailRise: .009, flatTail: .024 },
  carver: { mount: .078, waistAt: -.029, noseCap: .109, tailCap: .044,
    noseRocker: .12, tailRocker: .047, camber: .010, noseRise: .064, tailRise: .012, flatTail: .018 },
  powder: { mount: .080, waistAt: .010, noseCap: .187, tailCap: .171,
    noseRocker: .25, tailRocker: .25, camber: .007, noseRise: .100, tailRise: .072, noseSpoon: .005, tailSpoon: .003 },
  park: { waistAt: .020, noseCap: .160, tailCap: .151,
    noseRocker: .195, tailRocker: .195, camber: .002, noseRise: .059, tailRise: .056 },
  'burton-custom-camber': { waistAt: .015, noseBias: .008, noseCap: .222, tailCap: .194,
    noseRise: .058, tailRise: .054, camber: .009 },
  'jones-flagship': { waistAt: .001, noseCap: .263, tailCap: .152,
    noseRise: .080, tailRise: .045, camber: .010, noseSpoon: .007, tailSpoon: .004 },
};

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function groupStations(from, to, divisions) {
  return Array.from({ length: divisions - 1 }, (_, i) => from + (to - from) * (i + 1) / divisions);
}

export function deckProfile(model, density = 1) {
  const shape = deckShapes[model.id];
  const length = model.lengthCm / 100;
  const setback = model.setbackMm == null ? shape.mount : model.setbackMm / 1000;
  const noseBias = model.noseLengthMm == null ? shape.noseBias ?? 0 : (model.noseLengthMm - model.tailLengthMm) / 2000;
  const tail = setback + noseBias - length / 2;
  const nose = tail + length;
  const tailWide = tail + shape.tailCap;
  const noseWide = nose - shape.noseCap;
  const waistAt = shape.waistAt;
  const radius = model.radiusM;
  const waist = model.waistMm / 2000;
  const tipWidth = model.tipMm / 2000;
  const tailWidth = model.tailMm / 2000;
  const frontContact = model.runningLengthMm == null
    ? nose - length * shape.noseRocker : setback + model.runningLengthMm / 2000;
  const rearContact = model.runningLengthMm == null
    ? tail + length * shape.tailRocker : frontContact - model.runningLengthMm / 1000;

  // Anchor the actual published radius at the waist, then blend outward to
  // the measured widths. Production tip and tail outlines vary by ski mold.
  const arcDepth = distance => radius - Math.sqrt(radius * radius - distance * distance);
  const sidecut = (distance, run, widest) => {
    const arc = arcDepth(run);
    const rise = widest - waist;
    const t = arcDepth(distance) / arc;
    return waist + rise * smoothstep(t) + arc * t * (1 - t) ** 2;
  };
  const cap = (position, widest, flat) => flat + (widest - flat) * Math.sqrt(Math.max(0, 1 - position ** 2.8));
  const crossSection = z => {
    let width;
    if (z < tailWide) width = cap((tailWide - z) / shape.tailCap, tailWidth, shape.flatTail ?? .0008);
    else if (z > noseWide) width = cap((z - noseWide) / shape.noseCap, tipWidth, .0008);
    else if (z < waistAt) width = sidecut(waistAt - z, waistAt - tailWide, tailWidth);
    else width = sidecut(z - waistAt, noseWide - waistAt, tipWidth);

    let y, spoon = 0;
    if (z < rearContact) {
      const rise = ((rearContact - z) / (rearContact - tail)) ** 2.25;
      y = rise * shape.tailRise;
      spoon = rise * (shape.tailSpoon ?? 0);
    } else if (z > frontContact) {
      const rise = ((z - frontContact) / (nose - frontContact)) ** 2.25;
      y = rise * shape.noseRise;
      spoon = rise * (shape.noseSpoon ?? 0);
    } else {
      const phase = (z - rearContact) / (frontContact - rearContact);
      y = Math.sin(phase * Math.PI) ** 2 * shape.camber;
    }
    return [z, width, y + spoon, spoon];
  };

  const stations = [tail, tailWide, rearContact, waistAt, 0, frontContact, noseWide, nose,
    ...groupStations(tail, tailWide, 2 * density), ...groupStations(noseWide, nose, 3 * density),
    ...groupStations(tailWide, waistAt, 4 * density), ...groupStations(waistAt, noseWide, 5 * density)];
  if (model.stanceWidthCm) stations.push(-model.stanceWidthCm / 200, model.stanceWidthCm / 200);
  return [...new Set(stations)].sort((a, b) => a - b).map(crossSection);
}
