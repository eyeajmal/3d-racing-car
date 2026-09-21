import * as THREE from './three.module.js';

const canvas = document.querySelector('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xff9a58);
scene.fog = new THREE.FogExp2(0xd9794b, 0.008);
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 500);
const clock = new THREE.Clock();

const MAPS = {
  city: { name: 'Sunset City', world: true, rx: 115, rz: 115, width: 20, sky: 0x62bfe3, fog: 0x7aa9b5, ground: 0x44705b, road: 0x343946 },
  sunset: { name: 'Sunset oval', rx: 55, rz: 36, width: 20, sky: 0xff9a58, fog: 0xd9794b, ground: 0xd46d35, road: 0x34394a },
  desert: { name: 'Desert giant', rx: 78, rz: 50, width: 24, sky: 0xf0ae62, fog: 0xc98348, ground: 0xb96735, road: 0x3e3b3b },
  coast: { name: 'Coast sprint', rx: 64, rz: 28, width: 19, sky: 0x75b9c8, fog: 0x5f9ba9, ground: 0x477d72, road: 0x303a43 }
};
const CARS = {
  blitz: { name: 'Blaze 77', class: 'Redline starter', price: 0, color: 0xd92832, accel: 23, max: 48, handling: 1.35 },
  comet: { name: 'Comet GT', class: 'Balanced sport', price: 1800, color: 0xf2c451, accel: 25, max: 52, handling: 1.42 },
  solar: { name: 'Solar RS', class: 'High acceleration', price: 4200, color: 0xee5b2b, accel: 29, max: 55, handling: 1.4 },
  phantom: { name: 'Phantom X', class: 'Top speed', price: 7800, color: 0x7a65d8, accel: 30, max: 61, handling: 1.46 },
  dune: { name: 'Dune Buggy', class: 'Grip specialist', price: 3500, color: 0x48a66b, accel: 27, max: 49, handling: 1.68 }
};
let profile;
try { profile = JSON.parse(localStorage.getItem('apex-sunset-profile')); } catch { profile = null; }
if (!profile || !Array.isArray(profile.unlocked)) profile = { credits: 2000, unlocked: ['blitz'], selectedCar: 'blitz', selectedMap: 'city' };
if (!Number.isFinite(profile.credits)) profile.credits = 2000;
profile.unlocked = profile.unlocked.filter(id => CARS[id]);
if (!profile.unlocked.includes('blitz')) profile.unlocked.unshift('blitz');
if (!CARS[profile.selectedCar]) profile.selectedCar = 'blitz';
if (!MAPS[profile.selectedMap]) profile.selectedMap = 'city';
if (!profile.openWorldReady) {
  profile.selectedMap = 'city';
  profile.openWorldReady = true;
  localStorage.setItem('apex-sunset-profile', JSON.stringify(profile));
}
let RX = MAPS[profile.selectedMap].rx;
let RZ = MAPS[profile.selectedMap].rz;
let TRACK_WIDTH = MAPS[profile.selectedMap].width;
scene.background.set(MAPS[profile.selectedMap].sky);
scene.fog.color.set(MAPS[profile.selectedMap].fog);
const LAPS = 3;
const COUNTDOWN_DURATION = 3.55;
const controls = { gas: false, brake: false, left: false, right: false, drift: false };
const game = { state: 'menu', time: 0, countdown: 0, lap: 0, lapStart: 0, best: Infinity, totalAngle: 0, lastAngle: 0, boost: 1, finished: false, collisionCooldown: 0, wallCooldown: 0, cameraShake: 0, pickups: 0 };
const carState = { speed: 0, heading: 0, velocity: new THREE.Vector2(), x: RX, z: -6 };
let audio;
let messageTimer;

function saveProfile() {
  localStorage.setItem('apex-sunset-profile', JSON.stringify(profile));
  updateWallets();
}

// World lighting
scene.add(new THREE.HemisphereLight(0xffd6a2, 0x393d4f, 2.1));
const sun = new THREE.DirectionalLight(0xffe0aa, 3.2);
sun.position.set(-70, 85, -45);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -110;
sun.shadow.camera.right = sun.shadow.camera.top = 110;
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(420, 420),
  new THREE.MeshStandardMaterial({ color: MAPS[profile.selectedMap].ground, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

function ellipseRing(inner, outer, segments = 160) {
  const positions = [], uvs = [], indices = [];
  for (let i = 0; i <= segments; i++) {
    const a = i / segments * Math.PI * 2;
    for (const radius of [inner, outer]) {
      positions.push(Math.cos(a) * (RX + radius), .08, Math.sin(a) * (RZ + radius * .68));
      uvs.push(i / segments, radius === inner ? 0 : 1);
    }
    if (i < segments) {
      const j = i * 2;
      indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

let trackGroup = new THREE.Group();
let worldPickups = [];
let worldObstacles = [];
scene.add(trackGroup);

function addTrackLine(offset, color, width, dash = false) {
  const pts = [];
  const seg = 220;
  for (let i = 0; i < seg; i++) {
    if (dash && Math.floor(i / 5) % 2) continue;
    const a = i / seg * Math.PI * 2;
    const next = (i + 1) / seg * Math.PI * 2;
    const x1 = Math.cos(a) * (RX + offset), z1 = Math.sin(a) * (RZ + offset * .68);
    const x2 = Math.cos(next) * (RX + offset), z2 = Math.sin(next) * (RZ + offset * .68);
    const len = Math.hypot(x2 - x1, z2 - z1);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(width, .035, len + .15), new THREE.MeshBasicMaterial({ color }));
    strip.position.set((x1 + x2) / 2, .12, (z1 + z2) / 2);
    strip.rotation.y = Math.atan2(x2 - x1, z2 - z1);
    trackGroup.add(strip);
  }
}

function addGuardWalls() {
  const segments = 128;
  const red = new THREE.MeshStandardMaterial({ color: 0xe94b35, roughness: .72 });
  const cream = new THREE.MeshStandardMaterial({ color: 0xfff5df, roughness: .72 });
  for (const side of [-1, 1]) {
    const offset = side * (TRACK_WIDTH / 2 + .38);
    for (let i = 0; i < segments; i++) {
      const a = i / segments * Math.PI * 2;
      const next = (i + 1) / segments * Math.PI * 2;
      const x1 = Math.cos(a) * (RX + offset), z1 = Math.sin(a) * (RZ + offset * .68);
      const x2 = Math.cos(next) * (RX + offset), z2 = Math.sin(next) * (RZ + offset * .68);
      const length = Math.hypot(x2 - x1, z2 - z1);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(.72, 1.05, length + .18), Math.floor(i / 4) % 2 ? red : cream);
      wall.position.set((x1 + x2) / 2, .62, (z1 + z2) / 2);
      wall.rotation.y = Math.atan2(x2 - x1, z2 - z1);
      wall.receiveShadow = true;
      trackGroup.add(wall);
    }
  }
}

function buildOpenWorld(map) {
  worldPickups = [];
  worldObstacles = [];
  const roadMaterial = new THREE.MeshStandardMaterial({ color: map.road, roughness: .94 });
  const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xffc447 });
  const sidewalkMaterial = new THREE.MeshStandardMaterial({ color: 0xbfc3bb, roughness: 1 });
  const buildingColors = [0xe46a45, 0xf0b84f, 0x4d739b, 0xded2b2, 0x8f6a9c];
  const grid = [-80, -40, 0, 40, 80];

  for (const lane of grid) {
    const vertical = new THREE.Mesh(new THREE.BoxGeometry(TRACK_WIDTH, .12, 240), roadMaterial);
    vertical.position.set(lane, .08, 0); vertical.receiveShadow = true; trackGroup.add(vertical);
    const horizontal = new THREE.Mesh(new THREE.BoxGeometry(240, .12, TRACK_WIDTH), roadMaterial);
    horizontal.position.set(0, .081, lane); horizontal.receiveShadow = true; trackGroup.add(horizontal);
    for (let marker = -108; marker <= 108; marker += 12) {
      if (grid.some(cross => Math.abs(marker - cross) < TRACK_WIDTH * .65)) continue;
      const vDash = new THREE.Mesh(new THREE.BoxGeometry(.18, .04, 5), lineMaterial);
      vDash.position.set(lane, .16, marker); trackGroup.add(vDash);
      const hDash = new THREE.Mesh(new THREE.BoxGeometry(5, .04, .18), lineMaterial);
      hDash.position.set(marker, .161, lane); trackGroup.add(hDash);
    }
  }

  const blockCenters = [-60, -20, 20, 60];
  blockCenters.forEach((bx, xi) => blockCenters.forEach((bz, zi) => {
    const plaza = new THREE.Mesh(new THREE.BoxGeometry(18, .35, 18), sidewalkMaterial);
    plaza.position.set(bx, .17, bz); plaza.receiveShadow = true; trackGroup.add(plaza);
    const height = 7 + ((xi * 11 + zi * 7) % 13);
    const width = 9 + ((xi + zi) % 3) * 2;
    const building = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, width),
      new THREE.MeshStandardMaterial({ color: buildingColors[(xi * 2 + zi) % buildingColors.length], roughness: .78, metalness: .04 })
    );
    building.position.set(bx + (xi % 2 ? 2 : -2), height / 2 + .35, bz + (zi % 2 ? -2 : 2));
    building.castShadow = building.receiveShadow = true; trackGroup.add(building);
    worldObstacles.push({ x: building.position.x, z: building.position.z, half: width / 2 + 1.4 });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(width + .7, .5, width + .7), new THREE.MeshStandardMaterial({ color: 0x293555, roughness: .8 }));
    roof.position.set(building.position.x, height + .6, building.position.z); trackGroup.add(roof);
  }));

  const boundaryMaterial = new THREE.MeshStandardMaterial({ color: 0xd92832, roughness: .75 });
  for (const [x, z, w, d] of [[0, -121, 244, 1.2], [0, 121, 244, 1.2], [-121, 0, 1.2, 244], [121, 0, 1.2, 244]]) {
    const boundary = new THREE.Mesh(new THREE.BoxGeometry(w, 2, d), boundaryMaterial);
    boundary.position.set(x, 1, z); boundary.receiveShadow = true; trackGroup.add(boundary);
  }

  const pickupPositions = [[0,30], [40,15], [80,-25], [55,-80], [0,-55], [-40,-20], [-80,35], [-55,80], [20,80], [80,70], [-80,-75], [20,-40]];
  pickupPositions.forEach(([x, z], index) => {
    const pickup = new THREE.Mesh(
      new THREE.TorusGeometry(.75, .2, 8, 20),
      new THREE.MeshBasicMaterial({ color: 0xffc447 })
    );
    pickup.position.set(x, 1.7, z);
    pickup.userData.pickupIndex = index;
    trackGroup.add(pickup);
    worldPickups.push(pickup);
  });
}

function buildTrack(mapId) {
  const map = MAPS[mapId];
  RX = map.rx; RZ = map.rz; TRACK_WIDTH = map.width;
  scene.remove(trackGroup);
  trackGroup.traverse(object => { if (object.geometry) object.geometry.dispose(); if (object.material) object.material.dispose(); });
  trackGroup = new THREE.Group();
  scene.add(trackGroup);
  scene.background.set(map.sky);
  scene.fog.color.set(map.fog);
  scene.fog.density = mapId === 'desert' ? .006 : .008;
  ground.material.color.set(map.ground);

  if (map.world) {
    scene.fog.density = .0045;
    buildOpenWorld(map);
    return;
  }

  const road = new THREE.Mesh(ellipseRing(-TRACK_WIDTH / 2, TRACK_WIDTH / 2), new THREE.MeshStandardMaterial({ color: map.road, roughness: .93 }));
  road.receiveShadow = true;
  trackGroup.add(road);
  addTrackLine(-TRACK_WIDTH / 2 + .5, 0xfff5df, .28);
  addTrackLine(TRACK_WIDTH / 2 - .5, 0xfff5df, .28);
  addTrackLine(0, 0xf4c764, .13, true);
  addGuardWalls();

  for (let z = -6; z < 6; z += 1.5) {
    for (let x = 0; x < Math.floor(TRACK_WIDTH / .85); x++) {
      const tile = new THREE.Mesh(new THREE.BoxGeometry(.85, .04, 1.5), new THREE.MeshBasicMaterial({ color: (x + Math.floor(z / 1.5)) % 2 ? 0x1c2134 : 0xfff8e9 }));
      tile.position.set(RX - TRACK_WIDTH / 2 + .45 + x * .85, .14, z + .75);
      trackGroup.add(tile);
    }
  }
}
buildTrack(profile.selectedMap);

function makeEyeTexture() {
  const eyeCanvas = document.createElement('canvas');
  eyeCanvas.width = 256; eyeCanvas.height = 96;
  const ctx = eyeCanvas.getContext('2d');
  ctx.fillStyle = '#bfe9ef'; ctx.fillRect(0, 0, 256, 96);
  for (const x of [78, 178]) {
    ctx.fillStyle = '#fffaf0'; ctx.beginPath(); ctx.ellipse(x, 48, 38, 29, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#132047'; ctx.beginPath(); ctx.arc(x + (x < 128 ? 8 : -8), 49, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#62bfe3'; ctx.beginPath(); ctx.arc(x + (x < 128 ? 10 : -10), 46, 6, 0, Math.PI * 2); ctx.fill();
  }
  const texture = new THREE.CanvasTexture(eyeCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const eyeTexture = makeEyeTexture();

function createCar(color = 0x1649d8) {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: .32, metalness: .2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x181b25, roughness: .55 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x79a0b1, roughness: .15, metalness: .4 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.25, .58, 4.1), paint);
  body.position.y = .67;
  body.castShadow = true;
  group.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(2.05, .28, 1.1), paint);
  nose.position.set(0, .78, 2.1); nose.castShadow = true; group.add(nose);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.62, .65, 1.85), glass);
  cabin.position.set(0, 1.2, -.2); cabin.rotation.x = -.04; cabin.castShadow = true; group.add(cabin);
  const eyes = new THREE.Mesh(new THREE.PlaneGeometry(1.28, .48), new THREE.MeshBasicMaterial({ map: eyeTexture, transparent: false }));
  eyes.position.set(0, 1.25, .74); eyes.rotation.x = -.04; group.add(eyes);
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(2.42, .12, .5), dark);
  spoiler.position.set(0, 1.12, -1.95); group.add(spoiler);
  const postGeo = new THREE.BoxGeometry(.1, .48, .1);
  for (const x of [-.8, .8]) { const post = new THREE.Mesh(postGeo, dark); post.position.set(x, .9, -1.95); group.add(post); }
  const wheelGeo = new THREE.CylinderGeometry(.48, .48, .34, 16);
  for (const x of [-1.16, 1.16]) for (const z of [-1.27, 1.3]) {
    const wheel = new THREE.Mesh(wheelGeo, dark); wheel.rotation.z = Math.PI / 2; wheel.position.set(x, .5, z); wheel.castShadow = true; group.add(wheel);
  }
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff372e });
  for (const x of [-.68, .68]) { const tail = new THREE.Mesh(new THREE.BoxGeometry(.45, .18, .04), tailMat); tail.position.set(x, .75, -2.07); group.add(tail); }
  group.scale.set(.82, .82, .82);
  group.userData.paint = paint;
  return group;
}

const playerCar = createCar(CARS[profile.selectedCar].color);
scene.add(playerCar);
const opponents = [
  { car: createCar(0xf2c451), phase: -.09, rate: .295, lane: -2.4, progress: 0, hit: 0 },
  { car: createCar(0xf4f0df), phase: -.17, rate: .303, lane: 1.8, progress: 0, hit: 0 },
  { car: createCar(0x48a66b), phase: -.25, rate: .287, lane: 0, progress: 0, hit: 0 }
];
opponents.forEach(o => scene.add(o.car));

const impactParticles = [];
const sparkGeometry = new THREE.BoxGeometry(.09, .09, .32);
const sparkMaterial = new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, blending: THREE.AdditiveBlending });

function spawnImpact(x, z, normal) {
  for (let i = 0; i < 14; i++) {
    const spark = new THREE.Mesh(sparkGeometry, sparkMaterial.clone());
    const spread = (Math.random() - .5) * 2.6;
    spark.position.set(x + normal.x * .25, .7 + Math.random() * .45, z + normal.y * .25);
    spark.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    scene.add(spark);
    impactParticles.push({
      mesh: spark,
      velocity: new THREE.Vector3(normal.x * (3 + Math.random() * 5) + spread, 3 + Math.random() * 5, normal.y * (3 + Math.random() * 5) + spread),
      life: .35 + Math.random() * .35
    });
  }
}

function updateImpactParticles(dt) {
  for (let i = impactParticles.length - 1; i >= 0; i--) {
    const particle = impactParticles[i];
    particle.life -= dt;
    particle.velocity.y -= 15 * dt;
    particle.mesh.position.addScaledVector(particle.velocity, dt);
    particle.mesh.rotation.x += dt * 14;
    particle.mesh.material.opacity = Math.max(0, particle.life * 2.2);
    if (particle.life <= 0) {
      scene.remove(particle.mesh);
      particle.mesh.material.dispose();
      impactParticles.splice(i, 1);
    }
  }
}

// Grandstand, trees, and banners give the circuit scale.
const stand = new THREE.Group();
for (let i = 0; i < 4; i++) {
  const step = new THREE.Mesh(new THREE.BoxGeometry(22, .7, 2.6), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xffd08a : 0xf4eee1, roughness: .8 }));
  step.position.set(0, i * .72, i * 1.9); step.receiveShadow = step.castShadow = true; stand.add(step);
}
const viewerCount = 64;
const viewerBodies = new THREE.InstancedMesh(new THREE.BoxGeometry(.32, .6, .3), new THREE.MeshStandardMaterial({ roughness: .8 }), viewerCount);
const viewerHeads = new THREE.InstancedMesh(new THREE.SphereGeometry(.17, 7, 6), new THREE.MeshStandardMaterial({ color: 0xf2b57b, roughness: 1 }), viewerCount);
const viewerMatrix = new THREE.Matrix4();
const shirtColors = [0x1649d8, 0xee5b2b, 0xffbe66, 0x48a66b, 0xf4f0df];
for (let i = 0; i < viewerCount; i++) {
  const row = Math.floor(i / 16), col = i % 16;
  const x = -9.6 + col * 1.28, z = row * 1.9, y = row * .72 + 1.05;
  viewerMatrix.makeTranslation(x, y, z); viewerBodies.setMatrixAt(i, viewerMatrix);
  viewerMatrix.makeTranslation(x, y + .48, z); viewerHeads.setMatrixAt(i, viewerMatrix);
  viewerBodies.setColorAt(i, new THREE.Color(shirtColors[i % shirtColors.length]));
}
viewerBodies.instanceMatrix.needsUpdate = viewerHeads.instanceMatrix.needsUpdate = true;
viewerBodies.instanceColor.needsUpdate = true;
stand.add(viewerBodies, viewerHeads);
stand.position.set(-14, 0, -58); scene.add(stand);

const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7d3e2e, roughness: 1 });
const leafMat = new THREE.MeshStandardMaterial({ color: 0x315d48, roughness: 1 });
const circuitTrees = new THREE.Group();
scene.add(circuitTrees);
for (let i = 0; i < 70; i++) {
  const a = (i / 70) * Math.PI * 2 + Math.sin(i * 8) * .08;
  const radius = 73 + (i % 5) * 4;
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.28, .42, 2.8, 7), trunkMat); trunk.position.y = 1.4;
  const leaves = new THREE.Mesh(new THREE.ConeGeometry(1.8 + (i % 3) * .2, 5, 7), leafMat); leaves.position.y = 4.3;
  tree.add(trunk, leaves); tree.position.set(Math.cos(a) * radius * 1.12, 0, Math.sin(a) * radius * .78); tree.rotation.y = i; circuitTrees.add(tree);
}

function addBillboard(text, x, z, rotation = 0) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#1649d8'; ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#fff8e9'; ctx.font = '900 72px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 67);
  const mat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.5), mat); mesh.position.set(x, 2.3, z); mesh.rotation.y = rotation; scene.add(mesh);
}
addBillboard('APEX', 0, 47, Math.PI);
addBillboard('SUNSET', -66, 0, Math.PI / 2);

// Low sunset disc
const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(15, 48), new THREE.MeshBasicMaterial({ color: 0xffd27a, fog: false }));
sunDisc.position.set(-100, 44, -150); sunDisc.lookAt(camera.position); scene.add(sunDisc);

function trackRadialBounds(x, z, clearance = 0) {
  const angle = Math.atan2(z / RZ, x / RX);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const halfWidth = Math.max(1, TRACK_WIDTH / 2 - clearance);
  const radialAt = offset => Math.sqrt(
    Math.pow(cos * (RX + offset) / RX, 2) +
    Math.pow(sin * (RZ + offset * .68) / RZ, 2)
  );
  return { inner: radialAt(-halfWidth), outer: radialAt(halfWidth) };
}

function onTrack(x, z) {
  if (MAPS[profile.selectedMap].world) {
    const withinWorld = Math.abs(x) < 118 && Math.abs(z) < 118;
    const nearestXRoad = Math.round(x / 40) * 40;
    const nearestZRoad = Math.round(z / 40) * 40;
    const onVertical = Math.abs(nearestXRoad) <= 80 && Math.abs(x - nearestXRoad) < TRACK_WIDTH / 2;
    const onHorizontal = Math.abs(nearestZRoad) <= 80 && Math.abs(z - nearestZRoad) < TRACK_WIDTH / 2;
    return withinWorld && (onVertical || onHorizontal);
  }
  const radial = Math.sqrt((x * x) / (RX * RX) + (z * z) / (RZ * RZ));
  const bounds = trackRadialBounds(x, z, .2);
  return radial > bounds.inner && radial < bounds.outer;
}

function checkTrackWalls(dt) {
  game.wallCooldown = Math.max(0, game.wallCooldown - dt);
  if (MAPS[profile.selectedMap].world) {
    const limit = 117.5;
    let hit = false;
    const normal = new THREE.Vector2();
    let hitLabel = 'CITY LIMIT';
    for (const obstacle of worldObstacles) {
      const dx = carState.x - obstacle.x, dz = carState.z - obstacle.z;
      if (Math.abs(dx) >= obstacle.half || Math.abs(dz) >= obstacle.half) continue;
      const overlapX = obstacle.half - Math.abs(dx), overlapZ = obstacle.half - Math.abs(dz);
      if (overlapX < overlapZ) {
        normal.set(Math.sign(dx) || 1, 0);
        carState.x = obstacle.x + normal.x * obstacle.half;
      } else {
        normal.set(0, Math.sign(dz) || 1);
        carState.z = obstacle.z + normal.y * obstacle.half;
      }
      hit = true; hitLabel = 'BUILDING HIT'; break;
    }
    if (!hit) {
      if (carState.x > limit) { carState.x = limit; normal.set(-1, 0); hit = true; }
      else if (carState.x < -limit) { carState.x = -limit; normal.set(1, 0); hit = true; }
      if (carState.z > limit) { carState.z = limit; normal.set(0, -1); hit = true; }
      else if (carState.z < -limit) { carState.z = -limit; normal.set(0, 1); hit = true; }
    }
    if (!hit) return;
    const towardSurface = carState.velocity.dot(normal);
    if (towardSurface < 0) carState.velocity.addScaledVector(normal, -towardSurface * 1.7);
    carState.velocity.multiplyScalar(.58);
    if (game.wallCooldown <= 0) {
      spawnImpact(carState.x, carState.z, normal);
      playImpactSound(7); game.cameraShake = .65; game.wallCooldown = .42; flash(hitLabel);
    }
    return;
  }
  const radial = Math.sqrt((carState.x * carState.x) / (RX * RX) + (carState.z * carState.z) / (RZ * RZ));
  const bounds = trackRadialBounds(carState.x, carState.z, 1.35);
  const hitOuter = radial > bounds.outer;
  const hitInner = radial < bounds.inner;
  if (!hitOuter && !hitInner) return;

  const boundary = hitOuter ? bounds.outer : bounds.inner;
  const scale = boundary / Math.max(radial, .001);
  carState.x *= scale;
  carState.z *= scale;

  const normal = new THREE.Vector2(carState.x / (RX * RX), carState.z / (RZ * RZ)).normalize();
  const normalSpeed = carState.velocity.dot(normal);
  if ((hitOuter && normalSpeed > 0) || (hitInner && normalSpeed < 0)) {
    carState.velocity.addScaledVector(normal, -normalSpeed * 1.75);
  }
  carState.velocity.multiplyScalar(.58);

  if (game.wallCooldown <= 0) {
    const roadDirection = hitOuter ? normal.clone().multiplyScalar(-1) : normal;
    spawnImpact(carState.x, carState.z, roadDirection);
    playImpactSound(6 + Math.min(5, Math.abs(normalSpeed) * .25));
    game.cameraShake = Math.max(game.cameraShake, .62);
    game.wallCooldown = .42;
    flash('WALL HIT');
  }
}

function resetCar() {
  if (MAPS[profile.selectedMap].world) {
    const nearX = THREE.MathUtils.clamp(Math.round(carState.x / 40) * 40, -80, 80);
    const nearZ = THREE.MathUtils.clamp(Math.round(carState.z / 40) * 40, -80, 80);
    if (Math.abs(carState.x - nearX) < Math.abs(carState.z - nearZ)) carState.x = nearX;
    else carState.z = nearZ;
    carState.speed = 0; carState.velocity.set(0, 0);
    playerCar.position.set(carState.x, .1, carState.z);
    flash('Back on the road');
    return;
  }
  const a = Math.atan2(carState.z / RZ, carState.x / RX);
  carState.x = Math.cos(a) * RX; carState.z = Math.sin(a) * RZ;
  carState.heading = Math.atan2(-Math.sin(a) * RX, Math.cos(a) * RZ);
  carState.speed = 0; carState.velocity.set(0, 0);
  playerCar.position.set(carState.x, .1, carState.z); playerCar.rotation.y = carState.heading;
  flash('Back on track');
}

function placeCar() {
  const isWorld = MAPS[profile.selectedMap].world;
  carState.x = isWorld ? 0 : RX; carState.z = isWorld ? -12 : -4;
  carState.heading = 0; carState.speed = 0; carState.velocity.set(0, 0);
  playerCar.position.set(carState.x, .1, carState.z); playerCar.rotation.y = 0;
  game.lastAngle = Math.atan2(carState.z / RZ, carState.x / RX);
}
placeCar();

function updateWorldPickups(dt) {
  worldPickups.forEach(pickup => {
    if (!pickup.visible) return;
    pickup.rotation.y += dt * 2.8;
    pickup.rotation.x = Math.sin(game.time * 2 + pickup.userData.pickupIndex) * .18;
    if (Math.hypot(carState.x - pickup.position.x, carState.z - pickup.position.z) < 2.5) {
      pickup.visible = false;
      game.pickups += 1;
      profile.credits += 100;
      saveProfile();
      flash(`CR 100 · ${game.pickups}/${worldPickups.length} found`);
      if (game.pickups === worldPickups.length) {
        profile.credits += 1000;
        saveProfile();
        setTimeout(() => flash('CITY CLEARED · BONUS CR 1,000'), 900);
      }
    }
  });
}

function updatePlayer(dt) {
  const carSpec = CARS[profile.selectedCar];
  const track = onTrack(carState.x, carState.z);
  const throttle = controls.gas ? 1 : 0;
  const braking = controls.brake ? 1 : 0;
  const forward = new THREE.Vector2(Math.sin(carState.heading), Math.cos(carState.heading));
  const right = new THREE.Vector2(forward.y, -forward.x);
  const forwardSpeed = carState.velocity.dot(forward);
  if (throttle) carState.velocity.addScaledVector(forward, (track ? carSpec.accel : carSpec.accel * .44) * dt);
  if (braking) carState.velocity.addScaledVector(forward, (forwardSpeed > 1 ? -37 : -10) * dt);
  const steer = (controls.left ? 1 : 0) - (controls.right ? 1 : 0);
  const steerStrength = THREE.MathUtils.clamp(Math.abs(forwardSpeed) / 8, .18, 1);
  carState.heading += steer * steerStrength * (controls.drift ? carSpec.handling * 1.52 : carSpec.handling) * dt * Math.sign(forwardSpeed || 1);
  const lateralSpeed = carState.velocity.dot(right);
  carState.velocity.addScaledVector(right, -lateralSpeed * (controls.drift ? 1.6 : 7.5) * dt);
  carState.velocity.multiplyScalar(Math.pow(track ? .993 : .955, dt * 60));
  const max = track ? (controls.drift ? carSpec.max * .92 : carSpec.max) : Math.min(20, carSpec.max * .38);
  if (carState.velocity.length() > max) carState.velocity.setLength(max);
  carState.x += carState.velocity.x * dt;
  carState.z += carState.velocity.y * dt;
  checkTrackWalls(dt);
  carState.speed = carState.velocity.dot(forward);
  playerCar.position.set(carState.x, .1, carState.z);
  playerCar.rotation.y = carState.heading;
  playerCar.rotation.z = THREE.MathUtils.lerp(playerCar.rotation.z, -steer * Math.min(Math.abs(forwardSpeed) / 40, 1) * .07, .12);

  if (MAPS[profile.selectedMap].world) {
    updateWorldPickups(dt);
    return;
  }

  const angle = Math.atan2(carState.z / RZ, carState.x / RX);
  let delta = angle - game.lastAngle;
  if (delta < -Math.PI) delta += Math.PI * 2;
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (track && Math.abs(delta) < .15) game.totalAngle += delta;
  game.lastAngle = angle;
  const newLap = Math.max(0, Math.floor(game.totalAngle / (Math.PI * 2)));
  if (newLap > game.lap && newLap <= LAPS) {
    const lapTime = game.time - game.lapStart;
    game.best = Math.min(game.best, lapTime); game.lapStart = game.time; game.lap = newLap;
    if (game.lap < LAPS) flash(`Lap ${game.lap + 1} · ${formatTime(lapTime)}`);
    else finishRace();
  }
}

function updateOpponents(dt = 0) {
  opponents.forEach((o, i) => {
    if (MAPS[profile.selectedMap].world) {
      const size = i === 0 ? 40 : 80;
      const perimeter = size * 8;
      let p = (Math.max(0, game.time - COUNTDOWN_DURATION) * (10 + i * 1.4) + i * 71) % perimeter;
      let x, z, heading;
      if (p < size * 2) { x = -size + p; z = -size; heading = Math.PI / 2; }
      else if (p < size * 4) { p -= size * 2; x = size; z = -size + p; heading = 0; }
      else if (p < size * 6) { p -= size * 4; x = size - p; z = size; heading = -Math.PI / 2; }
      else { p -= size * 6; x = -size; z = size - p; heading = Math.PI; }
      o.car.position.set(x, .1, z); o.car.rotation.y = heading;
      o.hit = Math.max(0, o.hit - dt);
      o.car.rotation.z = o.hit > 0 ? Math.sin(o.hit * 35) * o.hit * .38 : 0;
      o.progress = 0;
      return;
    }
    const t = Math.max(0, game.time - COUNTDOWN_DURATION) * o.rate + o.phase;
    const wobble = Math.sin(t * 3 + i) * .45;
    const lane = o.lane + wobble;
    const x = Math.cos(t) * (RX + lane), z = Math.sin(t) * (RZ + lane * .68);
    const nx = Math.cos(t + .01) * (RX + lane), nz = Math.sin(t + .01) * (RZ + lane * .68);
    o.car.position.set(x, .1, z); o.car.rotation.y = Math.atan2(nx - x, nz - z);
    o.hit = Math.max(0, o.hit - dt);
    o.car.rotation.z = o.hit > 0 ? Math.sin(o.hit * 35) * o.hit * .38 : 0;
    o.progress = Math.max(0, t - o.phase);
  });
}

function playImpactSound(strength) {
  if (!audio) return;
  const now = audio.ctx.currentTime;
  const hitOsc = audio.ctx.createOscillator();
  const hitGain = audio.ctx.createGain();
  const hitFilter = audio.ctx.createBiquadFilter();
  hitOsc.type = 'square';
  hitOsc.frequency.setValueAtTime(115 + strength * 7, now);
  hitOsc.frequency.exponentialRampToValueAtTime(38, now + .16);
  hitFilter.type = 'lowpass';
  hitFilter.frequency.value = 520;
  hitGain.gain.setValueAtTime(Math.min(.14, .055 + strength * .01), now);
  hitGain.gain.exponentialRampToValueAtTime(.001, now + .2);
  hitOsc.connect(hitFilter).connect(hitGain).connect(audio.ctx.destination);
  hitOsc.start(now); hitOsc.stop(now + .21);
}

function checkCarCollisions(dt) {
  game.collisionCooldown = Math.max(0, game.collisionCooldown - dt);
  for (const opponent of opponents) {
    const dx = carState.x - opponent.car.position.x;
    const dz = carState.z - opponent.car.position.z;
    const distance = Math.hypot(dx, dz);
    const collisionRadius = 2.7;
    if (distance >= collisionRadius) continue;

    const normal = new THREE.Vector2(dx, dz);
    if (normal.lengthSq() < .001) normal.set(Math.sin(carState.heading + Math.PI / 2), Math.cos(carState.heading + Math.PI / 2));
    else normal.normalize();

    // Always separate overlapping cars, even during the short impact cooldown.
    const overlap = collisionRadius - Math.max(distance, .01);
    carState.x += normal.x * (overlap + .08);
    carState.z += normal.y * (overlap + .08);
    playerCar.position.set(carState.x, .1, carState.z);

    if (game.collisionCooldown > 0) continue;
    const opponentForward = new THREE.Vector2(Math.sin(opponent.car.rotation.y), Math.cos(opponent.car.rotation.y));
    const relativeVelocity = carState.velocity.clone().addScaledVector(opponentForward, -15);
    const closingSpeed = Math.abs(relativeVelocity.dot(normal));
    const impactStrength = THREE.MathUtils.clamp(2.8 + closingSpeed * .42, 3, 10);
    const normalSpeed = carState.velocity.dot(normal);

    if (normalSpeed < 0) carState.velocity.addScaledVector(normal, -normalSpeed * 1.45);
    carState.velocity.addScaledVector(normal, impactStrength * .65);
    carState.velocity.multiplyScalar(.62);
    carState.heading += Math.sign(normal.x * Math.cos(carState.heading) - normal.y * Math.sin(carState.heading)) * impactStrength * .018;

    opponent.hit = .42;
    game.cameraShake = Math.min(1, .45 + impactStrength * .055);
    game.collisionCooldown = .48;
    spawnImpact((carState.x + opponent.car.position.x) / 2, (carState.z + opponent.car.position.z) / 2, normal);
    playImpactSound(impactStrength);
    flash('IMPACT');
  }
}

function updateCamera(dt) {
  const forward = new THREE.Vector3(Math.sin(carState.heading), 0, Math.cos(carState.heading));
  const desired = playerCar.position.clone().addScaledVector(forward, -10).add(new THREE.Vector3(0, 5.4, 0));
  camera.position.lerp(desired, 1 - Math.pow(.002, dt));
  if (game.cameraShake > .01) {
    const shake = game.cameraShake * game.cameraShake;
    camera.position.x += (Math.random() - .5) * shake * 1.25;
    camera.position.y += (Math.random() - .5) * shake * .75;
    camera.position.z += (Math.random() - .5) * shake * 1.25;
    game.cameraShake = Math.max(0, game.cameraShake - dt * 3.2);
  }
  const look = playerCar.position.clone().addScaledVector(forward, 8).add(new THREE.Vector3(0, 1.15, 0));
  camera.lookAt(look);
  camera.fov = THREE.MathUtils.lerp(camera.fov, 58 + Math.min(carState.velocity.length() / 48, 1) * 9, .06);
  camera.updateProjectionMatrix();
  sunDisc.lookAt(camera.position);
}

function formatTime(seconds) {
  const min = Math.floor(seconds / 60).toString().padStart(2, '0');
  const sec = Math.floor(seconds % 60).toString().padStart(2, '0');
  const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
  return `${min}:${sec}.${ms}`;
}

function updateWallets() {
  const formatted = Math.floor(profile.credits).toLocaleString();
  document.querySelector('#wallet-balance').textContent = formatted;
  document.querySelector('#garage-balance').textContent = formatted;
}

function renderGarage() {
  const shop = document.querySelector('#car-shop');
  shop.innerHTML = Object.entries(CARS).map(([id, car]) => {
    const owned = profile.unlocked.includes(id);
    const selected = profile.selectedCar === id;
    const action = selected ? 'Selected' : owned ? 'Select car' : `Buy · CR ${car.price.toLocaleString()}`;
    const speed = Math.round(car.max / 62 * 100);
    const accel = Math.round(car.accel / 31 * 100);
    const grip = Math.round(car.handling / 1.7 * 100);
    return `<article class="car-card ${selected ? 'selected' : ''}" style="--car-color:#${car.color.toString(16).padStart(6, '0')}">
      <div class="car-color"></div>
      <h2>${car.name}</h2><p class="car-class">${car.class}</p>
      <div class="stat"><span>Speed</span><i style="--value:${speed}%"></i></div>
      <div class="stat"><span>Launch</span><i style="--value:${accel}%"></i></div>
      <div class="stat"><span>Grip</span><i style="--value:${grip}%"></i></div>
      <p class="car-price">${owned ? 'Owned' : `CR ${car.price.toLocaleString()}`}</p>
      <button data-car="${id}" ${selected ? 'disabled' : ''}>${action}</button>
    </article>`;
  }).join('');

  shop.querySelectorAll('[data-car]').forEach(button => button.addEventListener('click', () => {
    const id = button.dataset.car;
    const car = CARS[id];
    if (!profile.unlocked.includes(id)) {
      if (profile.credits < car.price) { flash(`Need CR ${(car.price - profile.credits).toLocaleString()} more`); return; }
      profile.credits -= car.price;
      profile.unlocked.push(id);
      flash(`${car.name} purchased`);
    }
    profile.selectedCar = id;
    playerCar.userData.paint.color.set(car.color);
    saveProfile();
    renderGarage();
  }));
}

function selectMap(id) {
  if (!MAPS[id] || profile.selectedMap === id) return;
  profile.selectedMap = id;
  saveProfile();
  buildTrack(id);
  stand.position.set(-RX * .25, 0, -(RZ + 22));
  placeCar();
  updateOpponents();
  updateModeUI();
  document.querySelectorAll('[data-map]').forEach(button => button.classList.toggle('selected', button.dataset.map === id));
}

function updateModeUI() {
  const isWorld = MAPS[profile.selectedMap].world;
  document.querySelector('#start-button').textContent = isWorld ? 'Enter open world' : 'Start race';
  stand.visible = !isWorld;
  circuitTrees.visible = !isWorld;
}

function showRaceMenu() {
  game.state = 'menu';
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('visible'));
  document.querySelector('#start-screen').classList.add('visible');
  document.querySelector('#hud').classList.remove('visible');
  document.querySelector('#pause-button').classList.remove('visible');
  document.querySelector('#mobile-controls').classList.remove('visible');
  updateWallets();
}

function getPlace() {
  const playerProgress = game.totalAngle;
  return 1 + opponents.filter(o => o.progress > playerProgress).length;
}

function ordinal(n) { return `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`; }

function updateHUD() {
  const isWorld = MAPS[profile.selectedMap].world;
  document.querySelector('#speed').textContent = Math.round(carState.velocity.length() * 4.5);
  if (isWorld) {
    const directions = ['N', 'E', 'S', 'W'];
    const directionIndex = ((Math.round(carState.heading / (Math.PI / 2)) % 4) + 4) % 4;
    document.querySelector('#position').textContent = directions[directionIndex];
    document.querySelector('#position-total').textContent = 'Heading';
    document.querySelector('#lap-label').textContent = 'Mode';
    document.querySelector('#lap').textContent = 'Free roam';
    document.querySelector('#best-time').textContent = `Pickups ${game.pickups} / ${worldPickups.length}`;
  } else {
    document.querySelector('#lap').textContent = `${Math.min(game.lap + 1, LAPS)} / ${LAPS}`;
    document.querySelector('#lap-label').textContent = 'Lap';
    document.querySelector('#position').textContent = getPlace();
    document.querySelector('#position-total').textContent = '/ 4';
    document.querySelector('#best-time').textContent = game.best < Infinity ? `Best ${formatTime(game.best)}` : 'Best —';
  }
  document.querySelector('#race-time').textContent = formatTime(Math.max(0, game.time - COUNTDOWN_DURATION));
  document.querySelector('#boost-bar').style.transform = `scaleX(${game.boost})`;
  drawMinimap();
}

function drawMinimap() {
  const c = document.querySelector('#minimap'), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.save(); ctx.translate(c.width / 2, c.height / 2); ctx.scale(1.28, 1.28);
  if (MAPS[profile.selectedMap].world) {
    ctx.strokeStyle = 'rgba(255,244,220,.38)'; ctx.lineWidth = 6;
    for (const lane of [-80, -40, 0, 40, 80]) {
      ctx.beginPath(); ctx.moveTo(lane / 2, -58); ctx.lineTo(lane / 2, 58); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-58, lane / 2); ctx.lineTo(58, lane / 2); ctx.stroke();
    }
    const cityDot = (x, z, color, r) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x / 2, z / 2, r, 0, Math.PI * 2); ctx.fill(); };
    worldPickups.filter(p => p.visible).forEach(p => cityDot(p.position.x, p.position.z, '#ffc447', 1.5));
    opponents.forEach(o => cityDot(o.car.position.x, o.car.position.z, '#fff4dc', 2.4));
    cityDot(carState.x, carState.z, '#d92832', 4.2);
    ctx.restore();
    return;
  }
  ctx.strokeStyle = 'rgba(255,248,233,.35)'; ctx.lineWidth = 12; ctx.beginPath(); ctx.ellipse(0, 0, 58, 36, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#fff8e9'; ctx.lineWidth = 2; ctx.stroke();
  const dot = (x, z, color, r) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x / RX * 58, z / RZ * 36, r, 0, Math.PI * 2); ctx.fill(); };
  opponents.forEach(o => dot(o.car.position.x, o.car.position.z, '#ffbe66', 2.7));
  dot(carState.x, carState.z, `#${CARS[profile.selectedCar].color.toString(16).padStart(6, '0')}`, 4.2); ctx.restore();
}

function flash(text) {
  const el = document.querySelector('#message'); el.textContent = text; el.classList.add('show');
  clearTimeout(messageTimer); messageTimer = setTimeout(() => el.classList.remove('show'), 1700);
}

function initAudio() {
  if (audio) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator(), gain = ctx.createGain(), filter = ctx.createBiquadFilter();
  osc.type = 'sawtooth'; filter.type = 'lowpass'; filter.frequency.value = 340;
  gain.gain.value = 0; osc.connect(filter).connect(gain).connect(ctx.destination); osc.start();
  audio = { ctx, osc, gain, filter };
}

function updateAudio() {
  if (!audio) return;
  const speed = carState.velocity.length();
  audio.osc.frequency.setTargetAtTime(48 + speed * 5.8, audio.ctx.currentTime, .05);
  audio.filter.frequency.setTargetAtTime(230 + speed * 32, audio.ctx.currentTime, .08);
  audio.gain.gain.setTargetAtTime(game.state === 'racing' ? .018 + speed * .0009 : 0, audio.ctx.currentTime, .1);
}

function startRace() {
  initAudio();
  Object.assign(game, { state: 'countdown', time: 0, countdown: 0, lap: 0, lapStart: 0, best: Infinity, totalAngle: 0, finished: false, collisionCooldown: 0, wallCooldown: 0, cameraShake: 0, pickups: 0 });
  if (MAPS[profile.selectedMap].world) worldPickups.forEach(pickup => { pickup.visible = true; });
  placeCar();
  opponents.forEach((o, i) => { o.phase = -.09 - i * .08; o.progress = 0; o.hit = 0; });
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('visible'));
  document.querySelector('#hud').classList.add('visible');
  document.querySelector('#pause-button').classList.add('visible');
  document.querySelector('#mobile-controls').classList.add('visible');
  document.querySelector('#countdown').textContent = '1';
}

function finishRace() {
  game.state = 'finished'; game.finished = true;
  const place = getPlace();
  const baseRewards = [1200, 700, 400, 200];
  const mapBonus = profile.selectedMap === 'desert' ? 250 : profile.selectedMap === 'coast' ? 100 : 0;
  const reward = baseRewards[place - 1] + mapBonus;
  profile.credits += reward;
  saveProfile();
  setTimeout(() => {
    document.querySelector('#finish-place').textContent = `${ordinal(place)} place`;
    document.querySelector('#final-time').textContent = formatTime(Math.max(0, game.time - COUNTDOWN_DURATION));
    document.querySelector('#final-best').textContent = formatTime(game.best);
    document.querySelector('#final-reward').textContent = `+ CR ${reward.toLocaleString()}`;
    document.querySelector('#finish-screen').classList.add('visible');
    document.querySelector('#pause-button').classList.remove('visible');
    document.querySelector('#mobile-controls').classList.remove('visible');
  }, 850);
}

function pause() {
  if (game.state !== 'racing') return;
  game.state = 'paused'; document.querySelector('#pause-screen').classList.add('visible');
  document.querySelector('#mobile-controls').classList.remove('visible');
}
function resume() { if (game.state === 'paused') { game.state = 'racing'; document.querySelector('#pause-screen').classList.remove('visible'); document.querySelector('#mobile-controls').classList.add('visible'); clock.getDelta(); } }

const introScreen = document.querySelector('#intro-screen');
let introTimer;
function dismissIntro() {
  if (!introScreen.classList.contains('visible') || introScreen.classList.contains('closing')) return;
  clearTimeout(introTimer);
  introScreen.classList.add('closing');
  setTimeout(() => introScreen.classList.remove('visible', 'closing'), 560);
}
introTimer = setTimeout(dismissIntro, matchMedia('(prefers-reduced-motion: reduce)').matches ? 1250 : 5750);
document.querySelector('#skip-intro').addEventListener('click', dismissIntro);

document.querySelector('#start-button').addEventListener('click', startRace);
document.querySelector('#restart-button').addEventListener('click', startRace);
document.querySelector('#quit-button').addEventListener('click', startRace);
document.querySelector('#pause-button').addEventListener('click', pause);
document.querySelector('#resume-button').addEventListener('click', resume);
document.querySelector('#finish-menu-button').addEventListener('click', showRaceMenu);
document.querySelector('#garage-button').addEventListener('click', () => {
  renderGarage();
  document.querySelector('#start-screen').classList.remove('visible');
  document.querySelector('#garage-screen').classList.add('visible');
});
document.querySelector('#garage-back').addEventListener('click', showRaceMenu);
document.querySelectorAll('[data-map]').forEach(button => button.addEventListener('click', () => selectMap(button.dataset.map)));

const keyMap = { ArrowUp: 'gas', KeyW: 'gas', ArrowDown: 'brake', KeyS: 'brake', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'drift' };
addEventListener('keydown', e => {
  if (keyMap[e.code]) { controls[keyMap[e.code]] = true; e.preventDefault(); }
  if (e.code === 'KeyR' && game.state === 'racing') resetCar();
  if (e.code === 'Escape') game.state === 'paused' ? resume() : pause();
});
addEventListener('keyup', e => { if (keyMap[e.code]) { controls[keyMap[e.code]] = false; e.preventDefault(); } });

document.querySelectorAll('[data-control]').forEach(button => {
  const name = button.dataset.control;
  const controlName = name === 'gas' ? 'gas' : name === 'brake' ? 'brake' : name;
  const down = e => { e.preventDefault(); controls[controlName] = true; };
  const up = e => { e.preventDefault(); controls[controlName] = false; };
  button.addEventListener('pointerdown', down); button.addEventListener('pointerup', up); button.addEventListener('pointercancel', up); button.addEventListener('pointerleave', up);
});

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});
addEventListener('blur', () => { if (game.state === 'racing') pause(); });

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), .04);
  if (game.state === 'countdown') {
    game.time += dt; game.countdown += dt;
    const countdownText = game.countdown < 1 ? '1' : game.countdown < 2 ? '2' : game.countdown < 3 ? '3' : 'START!';
    document.querySelector('#countdown').textContent = countdownText;
    if (game.countdown >= COUNTDOWN_DURATION) { game.state = 'racing'; document.querySelector('#countdown').textContent = ''; game.lapStart = game.time; }
  } else if (game.state === 'racing') {
    game.time += dt; updatePlayer(dt); updateOpponents(dt); checkCarCollisions(dt); updateImpactParticles(dt); updateHUD();
  }
  updateCamera(dt); updateAudio(); renderer.render(scene, camera);
}
updateWallets();
renderGarage();
document.querySelectorAll('[data-map]').forEach(button => button.classList.toggle('selected', button.dataset.map === profile.selectedMap));
stand.position.set(-RX * .25, 0, -(RZ + 22));
updateModeUI();
updateOpponents(); updateCamera(.016); animate();
