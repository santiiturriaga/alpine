import * as THREE from 'three';
import { createSkier } from './skier.js';
import { skiDeck, snowboardDeck } from './skier-equipment.js';
import { BACKPACK_MODELS } from './backpack-catalog.js';

const width = 192;
const height = 112;
const aspect = width / height;
const mountedPose = { speed: 0, grounded: true, display: true };
const onFootPose = { ...mountedPose, footMode: true };
const front = [.25, .17, 1];
const rear = [.48, .25, -1];

function thumbnailKey(group, id, look) {
  switch (group) {
    case 'backpack': return [group, id, look.backpack, look.sticker];
    case 'backpackColor': return [group, id, look.backpackModel, look.sticker];
    case 'helmet': return [group, id, look.sticker];
    case 'sticker': return [group, id, look.helmet];
    case 'stance': return [group, id, look.snowboardModel, look.pants];
    default: return [group, id];
  }
}

export function createCustomizerThumbnails(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#40443d');
  scene.add(new THREE.HemisphereLight('#fff7e5', '#a9afa8', 1.35));
  for (const [x, y, z, power] of [[-3, 5, 4, 1.8], [3, 2, -4, 1.45], [4, 3, 3, .8]]) {
    const light = new THREE.DirectionalLight('#fff6e5', power);
    light.position.set(x, y, z);
    scene.add(light);
  }
  const display = new THREE.Group();
  scene.add(display);
  const rig = createSkier();
  // Animate against a neutral root like the game rig, including for snowboard stance.
  new THREE.Group().add(rig.group);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 10);
  const target = new THREE.WebGLRenderTarget(width, height, { colorSpace: THREE.SRGBColorSpace });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const image = context.createImageData(width, height);
  const pixels = new Uint8Array(width * height * 4);
  const cache = new Map();

  function stagePiece(node) {
    node?.traverseVisible(part => {
      if (!part.isMesh) return;
      const copy = part.clone(false);
      copy.matrix.copy(part.matrixWorld);
      copy.matrixAutoUpdate = false;
      display.add(copy);
    });
  }

  function stageGear(group, id, look) {
    const skis = group === 'skis';
    if (skis || group === 'snowboard') {
      const { geometry, materials } = skis ? skiDeck(id) : snowboardDeck(id);
      const decks = new THREE.Group();
      decks.rotation.y = .98;
      for (const side of skis ? [-1, 1] : [0]) {
        const deck = new THREE.Mesh(geometry, materials);
        deck.position.set(side * .085, 0, side * .055);
        decks.add(deck);
      }
      display.add(decks);
      return [0, 2.9, .32];
    }

    const boardStance = group === 'stance';
    const footMode = group === 'footwear';
    rig.setAppearance({ ...look, haircut: 'helmet', discipline: boardStance ? 'snowboard' : 'ski' });
    rig.animate(.25, footMode ? onFootPose : mountedPose, null);
    rig.group.updateMatrixWorld(true);
    const { jacket, helmet, goggles, backpack } = rig.gearAnchors;
    const { arms, legs, board } = rig.shadowPose;

    switch (group) {
      case 'jacket':
        for (const node of jacket.children) {
          if (node !== backpack && node !== helmet.parent && !arms.some(arm => arm.shoulder === node)) stagePiece(node);
        }
        for (const { sleeve } of arms) stagePiece(sleeve.mesh);
        return front;
      case 'backpack':
      case 'backpackColor':
        stagePiece(backpack.getObjectByName(BACKPACK_MODELS[look.backpackModel].name));
        return rear;
      case 'goggles':
        stagePiece(goggles);
        return [.27, .08, 1];
      case 'helmet':
      case 'sticker':
        for (const node of helmet.children) if (node !== goggles) stagePiece(node);
        return group === 'helmet' ? front : [.08, .25, -1];
      case 'pants':
        for (const { trousers } of legs) stagePiece(trousers.mesh);
        for (const node of jacket.parent.children) if (node.isMesh) stagePiece(node);
        return front;
      case 'footwear':
        stagePiece(id === 'traverse' ? legs[0].walkShoe : legs[0].skiBoot);
        return [.94, .66, .86];
      case 'stance':
        stagePiece(board);
        for (const { boardBoot, trousers } of legs) {
          stagePiece(boardBoot);
          stagePiece(trousers.mesh);
        }
        return [1.45, 1.52, 1.38];
      default:
        return front;
    }
  }

  function frame(direction) {
    display.updateMatrixWorld(true);
    const center = new THREE.Box3().setFromObject(display).getCenter(new THREE.Vector3());
    camera.position.copy(center).add(new THREE.Vector3(...direction).normalize().multiplyScalar(3));
    camera.lookAt(center);
    camera.updateMatrixWorld(true);
    const bounds = new THREE.Box3();
    const projected = new THREE.Matrix4();
    const point = new THREE.Vector3();
    display.traverse(mesh => {
      if (!mesh.isMesh) return;
      mesh.geometry.computeBoundingBox();
      const { min, max } = mesh.geometry.boundingBox;
      projected.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
      for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
        bounds.expandByPoint(point.set(x, y, z).applyMatrix4(projected));
      }
    });
    const halfHeight = Math.max(bounds.max.y - bounds.min.y, (bounds.max.x - bounds.min.x) / aspect) * .56;
    const middleX = (bounds.max.x + bounds.min.x) / 2;
    const middleY = (bounds.max.y + bounds.min.y) / 2;
    camera.left = middleX - halfHeight * aspect;
    camera.right = middleX + halfHeight * aspect;
    camera.top = middleY + halfHeight;
    camera.bottom = middleY - halfHeight;
    camera.updateProjectionMatrix();
  }

  function thumbnail(group, id, look) {
    const key = thumbnailKey(group, id, look).join('|');
    if (cache.has(key)) return cache.get(key);
    display.clear();
    frame(stageGear(group, id, look));
    const previous = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    } finally {
      renderer.setRenderTarget(previous);
    }
    for (let y = 0; y < height; y++) {
      const row = (height - 1 - y) * width * 4;
      image.data.set(pixels.subarray(row, row + width * 4), y * width * 4);
    }
    context.putImageData(image, 0, 0);
    const url = canvas.toDataURL();
    if (cache.size >= 64) cache.delete(cache.keys().next().value);
    cache.set(key, url);
    return url;
  }
  thumbnail.cached = (group, id, look) => cache.get(thumbnailKey(group, id, look).join('|'));
  return thumbnail;
}
