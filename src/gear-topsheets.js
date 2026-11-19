export const deckFinishes = {
  'all-mountain': { tip: '#ef764c', base: '#211c35', ink: '#fff1e2', seed: 1841, coat: .28 },
  'laser-wrt-pro': { tip: '#343b42', base: '#111419', ink: '#f4f0e8', seed: 299, coat: .44 },
  carver: { tip: '#ee3d31', base: '#25313c', ink: '#fff0e4', seed: 248, coat: .37 },
  powder: { tip: '#c2b7d4', base: '#344270', ink: '#f4eefa', seed: 425, coat: .51 },
  park: { tip: '#b5d274', base: '#263b32', ink: '#eef6d3', seed: 789, coat: .21 },
  'burton-custom-camber': { tip: '#364b3a', base: '#1c242a', ink: '#d6fb79', seed: 874, coat: .3 },
  'jones-flagship': { tip: '#d1b888', base: '#b8925c', ink: '#25332e', seed: 946, coat: .14 },
};

function polygon(ctx, color, points) {
  ctx.beginPath();
  for (const [i, [x, y]] of points.entries()) {
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

// Original artwork rendered in a common UV space across all seven products.
const artwork = {
  'all-mountain'(ctx) {
    polygon(ctx, '#ea6539', [[0,0],[128,0],[128,362],[0,516]]);
    polygon(ctx, '#b4a0dc', [[0,361],[128,255],[128,299],[0,432]]);
    polygon(ctx, '#252035', [[0,505],[128,380],[128,822],[0,903]]);
    polygon(ctx, '#a994db', [[0,873],[128,784],[128,884],[0,988]]);
    polygon(ctx, '#fa8651', [[54,1024],[128,931],[128,1024]]);
    ctx.fillStyle = '#30243a';
    for (let i = 0; i < 7; i++) ctx.fillRect(18, 407 + i * 8, 26 - i * 2, 2);
  },
  'laser-wrt-pro'(ctx) {
    for (let x = 0; x < 128; x += 3) {
      ctx.fillStyle = x % 2 ? '#ffffff0b' : '#00000015';
      ctx.fillRect(x, 0, 1, 1024);
    }
    polygon(ctx, '#0d1015', [[16,0],[112,0],[108,538],[19,883]]);
    polygon(ctx, '#515b64', [[21,488],[113,241],[113,256],[21,529]]);
    polygon(ctx, '#9ba5a6', [[21,497],[113,249],[113,253],[21,505]]);
    polygon(ctx, '#cf383d', [[0,484],[15,442],[15,810],[0,850]]);
    polygon(ctx, '#a9262b', [[128,747],[64,1024],[128,1024]]);
    ctx.fillStyle = '#d94242';
    ctx.fillRect(52, 175, 24, 24);
    ctx.fillStyle = '#fcf5ea';
    ctx.fillRect(61, 180, 6, 14);
    ctx.fillRect(57, 184, 14, 6);
  },
  carver(ctx) {
    polygon(ctx, '#d9322b', [[0,0],[128,0],[128,468],[0,553]]);
    polygon(ctx, '#f1664e', [[0,332],[128,269],[128,286],[0,369]]);
    polygon(ctx, '#fcdbc3', [[0,423],[128,356],[128,384],[0,458]]);
    polygon(ctx, '#1d2836', [[0,466],[128,432],[128,791],[0,868]]);
    polygon(ctx, '#d33631', [[0,906],[128,811],[128,1024],[0,1024]]);
    ctx.fillStyle = '#ffe4c8';
    for (let i = 0; i < 5; i++) ctx.fillRect(28 + i * 13, 850 - i * 10, 9, 19);
  },
  powder(ctx, random) {
    const evening = ctx.createLinearGradient(0, 0, 0, 454);
    evening.addColorStop(0, '#dfb9c2');
    evening.addColorStop(.58, '#a69cc8');
    evening.addColorStop(1, '#67759e');
    ctx.fillStyle = evening;
    ctx.fillRect(0, 0, 128, 454);
    ctx.fillStyle = '#f8dfce';
    ctx.beginPath();
    ctx.ellipse(70, 138, 21, 36, 0, 0, 2 * Math.PI);
    ctx.fill();
    for (let i = 0; i < 36; i++) ctx.fillRect(12 + 104 * random(), 60 + 129 * random(), 1.7, 3);
    polygon(ctx, '#585e8b', [[0,235],[27,174],[58,278],[96,229],[128,268],[128,454],[0,454]]);
    polygon(ctx, '#e2dbe7', [[16,210],[27,174],[47,240],[32,222],[26,227]]);
    polygon(ctx, '#384d78', [[0,295],[28,277],[61,365],[93,315],[128,330],[128,510],[0,551]]);
    polygon(ctx, '#90adc9', [[0,507],[37,468],[81,498],[128,464],[128,559],[0,608]]);
    polygon(ctx, '#bba5cd', [[0,897],[46,864],[78,885],[128,828],[128,1024],[0,1024]]);
  },
  park(ctx) {
    polygon(ctx, '#283b31', [[0,0],[128,0],[128,386],[0,650]]);
    for (let y = 76; y < 904; y += 136) {
      polygon(ctx, '#a9c95f', [[0,y+111],[55,y],[51,y+72],[128,y+18],[64,y+132],[68,y+68],[0,y+141]]);
      polygon(ctx, '#cfe27d', [[0,y+119],[52,y+29],[0,y+129]]);
    }
    polygon(ctx, '#1a2c24', [[0,185],[128,135],[128,294],[0,344]]);
    polygon(ctx, '#1a2c24', [[0,724],[128,647],[128,798],[0,866]]);
  },
  'burton-custom-camber'(ctx) {
    for (let i = 0; i < 20; i++) {
      ctx.strokeStyle = i % 4 ? '#97cf6927' : '#c5f1699b';
      ctx.lineWidth = i % 4 ? .6 : .95;
      ctx.beginPath();
      ctx.moveTo(-8, 59 + i * 24);
      ctx.bezierCurveTo(131, -40 + i * 23, 6, 320 + i * 23, 140, 220 + i * 25);
      ctx.stroke();
    }
    polygon(ctx, '#283d2e', [[0,157],[128,102],[128,274],[0,320]]);
    polygon(ctx, '#afdc57', [[0,926],[128,851],[128,1024],[0,1024]]);
    polygon(ctx, '#182028', [[0,878],[128,838],[128,883],[0,941]]);
    for (const y of [334, 689]) {
      ctx.fillStyle = '#87906d';
      ctx.fillRect(61.5, y - 49, 5, 98);
      ctx.fillStyle = '#131b1e';
      ctx.fillRect(62.5, y - 48, 3, 96);
    }
  },
  'jones-flagship'(ctx, random) {
    for (let i = 0; i < 275; i++) {
      const x = random() * 128, y = random() * 1024;
      const width = .18 + random() * .7, reach = 40 + random() * 590;
      ctx.strokeStyle = i % 4 === 0 ? '#f7ddad3a' : '#64472838';
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + 5, y + reach * .3, x - 5, y + reach * .75, x + 1, y + reach);
      ctx.stroke();
    }
    polygon(ctx, '#354640', [[0,774],[128,857],[128,1024],[0,1024]]);
    polygon(ctx, '#667966', [[0,760],[128,841],[128,860],[0,779]]);
    for (const y of [391, 747]) for (const x of [57.2, 70.8]) {
      ctx.fillStyle = '#4e463f';
      for (let i = 0; i < 3; i++) ctx.fillRect(x, y + i * 9, 2, 3);
    }
  },
};

export function paintDeckArtwork(ctx, model, width, random) {
  const { ink } = deckFinishes[model.id];
  ctx.save();
  ctx.scale(width / 128, 1);
  artwork[model.id](ctx, random);
  ctx.restore();

  const brand = model.brand.toUpperCase();
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (model.kind === 'snowboard') {
    ctx.font = '700 44px "Barlow Condensed", Arial, sans-serif';
    ctx.fillText(brand, width / 2, 211, width * .75);
    ctx.font = '700 24px "Barlow Condensed", Arial, sans-serif';
    ctx.fillText(model.model.toUpperCase(), width / 2, 252, width * .77);
  } else {
    ctx.save();
    ctx.translate(width * .51, model.id === 'powder' ? 356 : 258);
    ctx.rotate(Math.PI / 2);
    ctx.font = '700 35px "Barlow Condensed", Arial, sans-serif';
    ctx.fillText(brand, 0, 0, model.id === 'park' ? 109 : 175);
    ctx.restore();
  }
  ctx.save();
  ctx.translate(width * .51, model.id === 'jones-flagship' ? 723 : 789);
  ctx.rotate(Math.PI / 2);
  ctx.font = '700 19px "Barlow Condensed", Arial, sans-serif';
  ctx.fillText(`${model.model.toUpperCase()}  /  ${model.lengthCm}`, 0, 0, 174);
  ctx.restore();
}
