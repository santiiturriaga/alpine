import * as THREE from 'three';
import { makeGondolaShell, addGondolaShell } from './gondola-shell.js';
import { skiDeck, snowboardDeck } from './skier-equipment.js';
import { makeCanvas, canvasTexture } from './util.js';

const interiorMaterials={
  metal:new THREE.MeshStandardMaterial({ color: 0x9aa6a9, roughness: .33, metalness: .58 }),
  dark:new THREE.MeshStandardMaterial({ color: 0x263239, roughness: .75 }),
  liner:new THREE.MeshStandardMaterial({ color: 0xc3cbc8, roughness: .86, side: THREE.DoubleSide }),
};
let noticeMaterial;
for(const material of Object.values(interiorMaterials))material.userData.gondolaShared=true;

// The occupied carrier uses the same cable origin and envelope as the distant
// fleet, but has an actual empty interior and transparent, double-sided panes.
export class GondolaInterior {
  constructor(scene, big = false, creekside = false, name = '', appearance = {}) {
    this.group = new THREE.Group();
    this.group.name = 'Occupied glass gondola';
    this.group.userData.gondolaCarrier=true;
    this.w = big ? 1.55 : .96;
    this.d = big ? 1.94 : 1.01;
    this.floor = big ? -3.32 : -3.12;
    this.eye = this.floor + (big ? 1.47 : 1.36);
    this.walkLimitX=this.w*(big?.60:.91)-.26;
    this.walk = new THREE.Vector3();
    this.yaw = Math.PI * .28;
    this.pitch = -.12;
    this._eye = new THREE.Vector3();
    this._look = new THREE.Vector3();
    const shell = makeGondolaShell(big ? '#b81630' : /Excalibur/.test(name)?'#e2e5de':'#273840', '#ddd9cf', big, creekside);
    this.setDoorOpening = addGondolaShell(this.group, shell, true);
    this.rack = shell.rack;
    if (this.rack) {
      this.rackContents = new THREE.Group();
      this.rackContents.name = 'Occupied gondola equipment rack';
      this.group.add(this.rackContents);
      this.setGear(appearance);
    }
    const {metal,dark,liner}=interiorMaterials;
    const box = (x, y, z, px, py, pz, material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), material);
      mesh.position.set(px, py, pz); this.group.add(mesh); return mesh;
    };
    const beam = (a, b, radius = .022, material = metal) => {
      const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, from.distanceTo(to), 8), material);
      mesh.position.copy(from).add(to).multiplyScalar(.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.sub(from).normalize());
      this.group.add(mesh);
    };
    const lining=[];
    for(let i=0;i<shell.perimeter.length;i++){
      const p=shell.perimeter[i],q=shell.perimeter[(i+1)%shell.perimeter.length];
      const a=[p[0]*this.w*(big?.982:.941),shell.top+.005,p[1]*this.d*(big?.982:.941)],b=[q[0]*this.w*(big?.982:.941),shell.top+.005,q[1]*this.d*(big?.982:.941)];
      const c=[q[0]*this.w*(big?.95:.775),-1.29,q[1]*this.d*(big?.95:.775)],d=[p[0]*this.w*(big?.95:.775),-1.29,p[1]*this.d*(big?.95:.775)];
      if(!shell.doorBays[i])lining.push(...a,...b,...c,...a,...c,...d);
      lining.push(...d,...c,0,-1.29,0);
    }
    const liningGeometry=new THREE.BufferGeometry();
    liningGeometry.setAttribute('position',new THREE.Float32BufferAttribute(lining,3));liningGeometry.computeVertexNormals();
    this.group.add(new THREE.Mesh(liningGeometry,liner));
    // Warm ceiling liner, suspended grab rails, an engraved threshold and a
    // genuinely recessed footwell remain visible with the shared glass shell.
    box(this.w*1.18,.025,this.d*1.15,0,-1.212,0,liner);
    for(const side of [-1,1]) {
      beam([side*this.w*.57,-1.32,-this.d*.55],[side*this.w*.57,-1.32,this.d*.55],.019);
      for(const z of [-this.d*.45,this.d*.45])
        beam([side*this.w*.57,-1.21,z],[side*this.w*.57,-1.32,z],.014);
      box(.024,.015,this.d*1.16,side*this.w*.79,this.floor+.008,0,dark);
      for (const z of [-.57,-.25,.25,.57])
        box(.039,.006,.017,side*this.w*.79,this.floor+.017,z,metal);
    }
    for(let x=-this.w*.67;x<=this.w*.67;x+=.067)
      box(.013,.006,this.d*.86,x,this.floor+.005,0,dark);
    if(!noticeMaterial){
      const sticker = makeCanvas(512,96);
      sticker.ctx.fillStyle='#ede7c6';sticker.ctx.fillRect(0,0,512,96);
      sticker.ctx.fillStyle='#223438';sticker.ctx.font='700 27px "Barlow Condensed",Arial';
      sticker.ctx.textAlign='center';sticker.ctx.fillText('PLEASE REMAIN SEATED',256,37);
      sticker.ctx.font='20px Arial';sticker.ctx.fillText('KEEP DOORS CLOSED DURING TRAVEL',256,70);
      noticeMaterial=new THREE.MeshStandardMaterial({map:canvasTexture(sticker.canvas),roughness:.85,side:THREE.DoubleSide});
      noticeMaterial.userData.gondolaShared=true;
    }
    const notice = new THREE.Mesh(new THREE.PlaneGeometry(.69,.13),noticeMaterial);
    notice.position.set(0,-1.31,this.d*.76);notice.rotation.y=Math.PI;this.group.add(notice);
    scene.add(this.group);
  }

  setGear({ discipline, skiModel, snowboardModel } = {}) {
    if (!this.rack) return;
    const board = discipline === 'snowboard';
    const selection = board ? snowboardModel : skiModel;
    const id = typeof selection === 'string' ? selection : selection?.id;
    const deck = board ? snowboardDeck(id) : skiDeck(id);
    if (this.loadedDeck === deck) return;
    this.loadedDeck = deck;
    this.rackContents.clear();

    const lean = .035;
    const [tailZ, , tailY] = deck.profile[0];
    const seat = this.rack.shelfY - tailZ * Math.cos(lean) + tailY * Math.sin(lean);
    const spacing = Math.max(deck.model.tipMm, deck.model.tailMm) / 2000 + .01;
    for (const offset of board ? [0] : [-spacing, spacing]) {
      const mesh = new THREE.Mesh(deck.geometry, deck.materials);
      mesh.name = deck.model.name;
      mesh.rotation.x = -Math.PI / 2 - lean;
      mesh.position.set(this.rack.x + offset, seat, this.rack.z);
      mesh.castShadow = true;
      this.rackContents.add(mesh);
    }
  }

  update(position, heading, time, doorOpening = 0) {
    this.group.position.copy(position);
    this.setDoorOpening(doorOpening);
    // Whole cabin and camera share this transform; the sway never pushes the
    // rider through a window or leaves the floor moving beneath a fixed camera.
    this.group.rotation.set(Math.sin(time*.71)*.007, heading, Math.sin(time*.93)*.012, 'YXZ');
    this.group.updateMatrixWorld(true);
  }

  move(dt, keys) {
    const frame = Math.min(dt, .06);
    this.yaw -= (Number(!!keys.ArrowRight)-Number(!!keys.ArrowLeft))*frame*1.35;
    this.pitch = THREE.MathUtils.clamp(this.pitch + (Number(!!keys.ArrowUp)-Number(!!keys.ArrowDown))*frame*.8, -.72, .58);
    let forward = Number(!!keys.KeyW)-Number(!!keys.KeyS);
    let strafe = Number(!!keys.KeyD)-Number(!!keys.KeyA);
    const length = Math.hypot(forward, strafe) || 1;
    forward /= length; strafe /= length;
    const pace = frame * .75;
    this.walk.x += (Math.sin(this.yaw)*forward - Math.cos(this.yaw)*strafe)*pace;
    this.walk.z += (Math.cos(this.yaw)*forward + Math.sin(this.yaw)*strafe)*pace;
    // Collision clearance includes the camera's near plane and excludes both
    // benches. The usable floor stays inside the chamfered corners as well.
    this.walk.x = THREE.MathUtils.clamp(this.walk.x, -this.walkLimitX,this.walkLimitX);
    this.walk.z = THREE.MathUtils.clamp(this.walk.z, -this.d*.69+.40, this.d*.69-.40);
  }

  look(dx, dy) {
    this.yaw -= dx * .004;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy*.003, -.72, .58);
  }

  placeCamera(camera) {
    this._eye.set(this.walk.x, this.eye, this.walk.z);
    this._look.copy(this._eye).add(new THREE.Vector3(Math.sin(this.yaw)*Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw)*Math.cos(this.pitch)));
    camera.position.copy(this.group.localToWorld(this._eye));
    camera.up.set(0,1,0).transformDirection(this.group.matrixWorld);
    camera.lookAt(this.group.localToWorld(this._look));
  }

  dispose() {
    this.group.removeFromParent();
    // Deck assets are shared by the player and outfitter preview.
    this.rackContents?.removeFromParent();
    this.rackContents?.clear();
    const materials = new Set();
    this.group.traverse((mesh) => {
      if (!mesh.isMesh) return;
      if(!mesh.geometry.userData.gondolaShared)mesh.geometry.dispose();
      materials.add(mesh.material);
    });
    for (const material of materials) if (!material.userData.gondolaShared) material.dispose();
  }
}
