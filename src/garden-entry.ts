// A walkable low-poly garden planted with the real Flower-HUA flowers.
//
// The flowers are not re-implemented here. createFlowerScene() builds each one
// exactly as the Studio does — including all 26 anatomy families and their core
// organs — into an offscreen scene; we snapshot each finished group (deep clone
// of geometry, per-clone material and ramp texture), then throw the offscreen
// engine away and render the clones in our own scene.

import * as THREE from "three";
import { createFlowerScene } from "../../Studio/components/flower/flowerScene";
import type { FlowerConfig } from "../../Studio/components/flower/flowerConfig";

declare const __FLOWERS__: FlowerConfig[];

// ===== snapshotting the engine's flowers =====

function clonePetalMaterial(src: THREE.ShaderMaterial) {
  const ramp = src.uniforms.uRamps.value as THREE.DataTexture;
  const image = ramp.image as { data: Uint16Array; width: number };
  // A fresh texture from a copy of the baked bytes: the engine re-bakes the
  // shared one for the next flower, and disposes it at the end.
  const tex = new THREE.DataTexture(
    image.data.slice(),
    image.width,
    1,
    ramp.format,
    ramp.type,
  );
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;

  const uniforms: Record<string, { value: unknown }> = {};
  for (const key of Object.keys(src.uniforms)) {
    const value = src.uniforms[key].value as { clone?: () => unknown };
    uniforms[key] = {
      value:
        key === "uRamps"
          ? tex
          : value && typeof value.clone === "function"
            ? value.clone()
            : value,
    };
  }
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: src.vertexShader,
    fragmentShader: src.fragmentShader,
    side: src.side,
  });
}

const isPetalShader = (m: THREE.Material) =>
  (m as THREE.ShaderMaterial).isShaderMaterial === true &&
  Boolean((m as THREE.ShaderMaterial).uniforms?.uRamps);

/** Deep clone: three's own clone() shares geometry and materials by reference. */
function deepClone(source: THREE.Object3D, sink: THREE.ShaderMaterial[]) {
  const copy = source.clone(true);
  const originals: THREE.Object3D[] = [];
  source.traverse((o) => originals.push(o));
  let i = 0;
  copy.traverse((node) => {
    const original = originals[i++] as THREE.Mesh;
    const mesh = node as THREE.Mesh;
    const drawable =
      (mesh as THREE.Mesh).isMesh ||
      (mesh as unknown as THREE.Points).isPoints ||
      (mesh as unknown as THREE.LineSegments).isLineSegments;
    if (!drawable || !original) return;
    if (original.geometry) mesh.geometry = original.geometry.clone();
    const mats = Array.isArray(original.material)
      ? original.material
      : [original.material];
    const cloned = mats.map((m) => {
      if (!m) return m;
      if (isPetalShader(m)) {
        const c = clonePetalMaterial(m as THREE.ShaderMaterial);
        sink.push(c);
        return c;
      }
      return m.clone();
    });
    mesh.material = Array.isArray(original.material) ? cloned : cloned[0];
  });
  return copy;
}

type Species = {
  config: FlowerConfig;
  proto: THREE.Object3D;
  materials: THREE.ShaderMaterial[];
  height: number;
};

/**
 * Studio settings are hero-flower settings. A garden holds dozens of them at a
 * distance, so trim what the viewer cannot see anyway:
 *   · petal count — a 146-petal chrysanthemum reads the same at 30;
 *   · core organ count — filaments and seeds are separate meshes, i.e. draw calls.
 * Petal tessellation is trimmed separately, via the engine's petalSegments option.
 */
const MAX_GARDEN_PETALS = 30;
const MAX_GARDEN_CORE = 16;

function gardenConfig(config: FlowerConfig): FlowerConfig {
  const trimmed: FlowerConfig = {
    ...config,
    params: { ...config.params },
  };
  const petals = trimmed.params.numPetals;
  if (typeof petals === "number" && petals > MAX_GARDEN_PETALS) {
    trimmed.params.numPetals = MAX_GARDEN_PETALS;
  }
  const core = config.anatomy?.core;
  if (config.anatomy && core?.count && core.count > MAX_GARDEN_CORE) {
    trimmed.anatomy = {
      ...config.anatomy,
      core: { ...core, count: MAX_GARDEN_CORE },
    };
  }
  return trimmed;
}

function harvestSpecies(): Species[] {
  // The engine needs a container with a real size, or the camera aspect is NaN.
  const pot = document.createElement("div");
  pot.style.cssText =
    "position:fixed;left:-64px;top:-64px;width:32px;height:32px;opacity:0;pointer-events:none";
  document.body.appendChild(pot);

  const engine = createFlowerScene(pot, null, null, {
    petalSegments: { x: 8, y: 20 },
  });
  const grown: Species[] = [];

  for (const original of __FLOWERS__) {
    const config = gardenConfig(original);
    // Same order as StudioCanvas.applyFlower — setCameraView seeds the stable
    // design-space basis that camera-facing families are laid out against.
    engine.setPalette(config.palette as unknown as [number, number, number][]);
    engine.setAnatomy(config.anatomy);
    // Deliberately NOT config.camera. setCameraView seeds layoutViewPosition,
    // the basis the camera-facing families (radial-disc, bilateral-orchid,
    // bird-fan, passion-corona, pendant-fuchsia) are laid out against. In the
    // Studio you orbit to meet the flower; a garden cannot, so every species
    // gets the same slightly-raised front view and they all face the visitor
    // instead of each lying whichever way its own preset was framed.
    engine.setCameraView([0, 4.6, 3.4]);
    engine.applyPreset(config.params);
    // Snap to the finished pose so the garden is planted in full bloom.
    engine.setEditPose();

    const materials: THREE.ShaderMaterial[] = [];
    const built = deepClone(engine.getFlowerGroup(), materials);
    // The engine turns culling off because the Studio always has its one flower
    // on screen. In a garden that would draw every bed behind your back.
    built.traverse((o) => (o.frustumCulled = true));

    // Wrap rather than edit: the cloned group carries the engine's own scale and
    // offset, and overwriting either (scale.setScalar / position.set) silently
    // undoes them. The wrapper is what the garden scales and places.
    const proto = new THREE.Group();
    proto.add(built);
    const box = new THREE.Box3().setFromObject(proto);
    built.position.y -= box.min.y; // sit the species on y = 0

    grown.push({
      config,
      proto,
      materials,
      height: Math.max(box.max.y - box.min.y, 0.001),
    });
  }

  engine.dispose();
  pot.remove();
  return grown;
}

// ===== scene, sky, ground =====

const SKY = 0x9ed8f2;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 38, 110);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const stage = document.getElementById("stage")!;
stage.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 300);

scene.add(new THREE.HemisphereLight(0xd6ecff, 0x4c7a3c, 1.2));
const sun = new THREE.DirectionalLight(0xfff4dc, 1.45);
sun.position.set(26, 42, 20);
scene.add(sun);

const flat = (color: number) =>
  new THREE.MeshLambertMaterial({ color, flatShading: true });

const LAWN = 34; // radius of the walkable lawn
const GROUND = 190;

const ground = new THREE.PlaneGeometry(GROUND, GROUND, 54, 54);
ground.rotateX(-Math.PI / 2);
{
  const pos = ground.attributes.position as THREE.BufferAttribute;
  const colors: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const d = Math.hypot(x, z);
    // Flat lawn inside, low-poly hills rolling away outside it.
    const rise = d < LAWN + 4 ? 0 : Math.min((d - LAWN - 4) / 30, 1);
    pos.setY(
      i,
      rise * (3.2 + Math.sin(x * 0.15) * 1.8 + Math.cos(z * 0.12) * 1.8),
    );
    c.setHSL(
      0.27 + Math.sin(x * 0.31 + z * 0.19) * 0.02,
      0.4,
      (d < LAWN ? 0.4 : 0.34) + Math.sin(x * 0.7 + z * 0.5) * 0.02,
    );
    colors.push(c.r, c.g, c.b);
  }
  ground.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  ground.computeVertexNormals();
}
scene.add(
  new THREE.Mesh(
    ground,
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  ),
);

/** Soft fake contact shadow — cheaper and tidier than a shadow map here. */
const shadowTex = (() => {
  const s = 64;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const g = cv.getContext("2d")!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, "rgba(0,0,0,0.45)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(cv);
})();
const shadowMat = new THREE.MeshBasicMaterial({
  map: shadowTex,
  transparent: true,
  depthWrite: false,
});
const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
function addShadow(parent: THREE.Object3D, radius: number, y = 0.02) {
  const m = new THREE.Mesh(shadowGeo, shadowMat);
  m.scale.setScalar(radius * 2);
  m.position.y = y;
  parent.add(m);
  return m;
}

// ===== props =====

function tree(x: number, z: number, scale: number) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.24, 2.4, 6),
    flat(0x6b4a2f),
  );
  trunk.position.y = 1.2;
  g.add(trunk);
  const tones = [0x3f8f42, 0x4fa350, 0x357a38];
  for (let i = 0; i < 3; i++) {
    const blob = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.5 - i * 0.28, 0),
      flat(tones[i]),
    );
    blob.position.set(
      Math.sin(i * 2.3) * 0.45,
      2.6 + i * 0.95,
      Math.cos(i * 2.3) * 0.45,
    );
    g.add(blob);
  }
  addShadow(g, 1.5 * scale);
  g.position.set(x, 0, z);
  g.scale.setScalar(scale);
  g.rotation.y = x * z;
  return g;
}

function rock(x: number, z: number, s: number) {
  const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), flat(0x9aa1a8));
  m.position.set(x, s * 0.45, z);
  m.rotation.set(x, z, x + z);
  m.scale.y = 0.7;
  return m;
}

// Ring of trees just outside the lawn, plus scattered rocks.
for (let i = 0; i < 26; i++) {
  const a = (i / 26) * Math.PI * 2 + 0.2;
  const r = LAWN + 5 + ((i * 7) % 5);
  scene.add(tree(Math.cos(a) * r, Math.sin(a) * r, 0.85 + ((i * 13) % 5) / 10));
}
for (let i = 0; i < 22; i++) {
  const a = i * 2.9;
  const r = LAWN * (0.35 + ((i * 17) % 60) / 100);
  scene.add(rock(Math.cos(a) * r, Math.sin(a) * r, 0.2 + ((i * 11) % 4) / 12));
}

// A circular stone path so the beds read as a garden, not a field.
const pathMat = flat(0xd8cdb4);
for (const radius of [11.5, 22]) {
  const count = Math.round(radius * 3.2);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const slab = new THREE.Mesh(
      new THREE.CylinderGeometry(0.62, 0.62, 0.08, 6),
      pathMat,
    );
    slab.position.set(Math.cos(a) * radius, 0.04, Math.sin(a) * radius);
    slab.rotation.y = a;
    scene.add(slab);
  }
}

// ===== plant the flowers =====

const species = harvestSpecies();
const beds: { position: THREE.Vector3; name: string }[] = [];

const TARGET_H = 1.55; // every species normalised to about this tall
const bedMat = flat(0x6b4b34);

species.forEach((s, index) => {
  // Two concentric rings, staggered, so you walk between them.
  const inner = index % 2 === 0;
  const ringCount = Math.ceil(species.length / 2);
  const slot = Math.floor(index / 2);
  const a = (slot / ringCount) * Math.PI * 2 + (inner ? 0 : Math.PI / ringCount);
  const r = inner ? 16 : 27;
  const x = Math.cos(a) * r;
  const z = Math.sin(a) * r;

  const bed = new THREE.Group();
  bed.position.set(x, 0, z);
  bed.rotation.y = -a + Math.PI / 2;

  const mound = new THREE.Mesh(
    new THREE.CylinderGeometry(1.15, 1.45, 0.24, 9),
    bedMat,
  );
  mound.position.y = 0.12;
  bed.add(mound);
  addShadow(bed, 1.5, 0.03);

  // Two plants per bed: enough to read as planting, half the draw calls of three.
  const spots = [
    { x: -0.24, z: -0.08, k: 1 },
    { x: 0.55, z: 0.5, k: 0.74 },
  ];
  for (const spot of spots) {
    const plant = s.proto.clone(true); // geometry/materials shared per species
    plant.scale.setScalar((TARGET_H / s.height) * spot.k);
    plant.position.set(spot.x, 0.23, spot.z);
    plant.rotation.y = spot.x * 3 + spot.z;
    bed.add(plant);
  }

  scene.add(bed);
  beds.push({
    position: new THREE.Vector3(x, 0, z),
    name: s.config.name,
  });
});

// One shared uniform update per species drives the wind on all of its copies.
const windMaterials = species.flatMap((s) => s.materials);

// ===== low-poly wanderer =====

const hero = new THREE.Group();
{
  const skin = flat(0xf2c9a0);
  const shirt = flat(0xef6f8e);
  const jeans = flat(0x3f5f96);
  const shoe = flat(0x3a3a44);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.3), shirt);
  torso.position.y = 1.06;
  hero.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.4, 0.4), skin);
  head.position.y = 1.6;
  hero.add(head);
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.16, 0.44), flat(0x2f2a2a));
  hair.position.y = 1.79;
  hero.add(hair);
  for (const sx of [-0.1, 0.1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.03), flat(0x27242b));
    eye.position.set(sx, 1.63, 0.21);
    hero.add(eye);
  }

  const limb = (w: number, h: number, mat: THREE.Material) => {
    const geo = new THREE.BoxGeometry(w, h, w);
    geo.translate(0, -h / 2, 0); // pivot at the top, so rotation swings it
    return new THREE.Mesh(geo, mat);
  };
  const armL = limb(0.15, 0.56, shirt);
  const armR = limb(0.15, 0.56, shirt);
  armL.position.set(-0.33, 1.3, 0);
  armR.position.set(0.33, 1.3, 0);
  const legL = limb(0.18, 0.72, jeans);
  const legR = limb(0.18, 0.72, jeans);
  legL.position.set(-0.13, 0.76, 0);
  legR.position.set(0.13, 0.76, 0);
  for (const l of [legL, legR]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.3), shoe);
    foot.position.set(0, -0.72, 0.06);
    l.add(foot);
  }
  hero.add(armL, armR, legL, legR);
  addShadow(hero, 0.5, 0.03);
  (hero as unknown as Record<string, unknown>).limbs = { armL, armR, legL, legR };
}
// Start south of the garden facing the beds, with the camera behind the back.
hero.position.set(0, 0, 11);
hero.rotation.y = Math.PI;
scene.add(hero);
const limbs = (hero as unknown as { limbs: Record<string, THREE.Mesh> }).limbs;

// ===== controls =====

const keys = new Set<string>();
addEventListener("keydown", (e) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
  keys.add(e.key.toLowerCase());
});
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
addEventListener("blur", () => keys.clear());

let camYaw = 0;
let camPitch = 0.24;
let dragging = false;
let lastX = 0;
let lastY = 0;
renderer.domElement.addEventListener("pointerdown", (e) => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  camYaw -= (e.clientX - lastX) * 0.005;
  camPitch = THREE.MathUtils.clamp(camPitch - (e.clientY - lastY) * 0.004, -0.15, 1.0);
  lastX = e.clientX;
  lastY = e.clientY;
});
const stopDrag = () => (dragging = false);
renderer.domElement.addEventListener("pointerup", stopDrag);
renderer.domElement.addEventListener("pointercancel", stopDrag);

let camDist = 7;
renderer.domElement.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    camDist = THREE.MathUtils.clamp(camDist + e.deltaY * 0.01, 2.6, 18);
  },
  { passive: false },
);

// Touch: a virtual stick for phones, so the page is not keyboard-only.
let stick = { x: 0, y: 0, active: false };
const pad = document.getElementById("pad");
const nub = document.getElementById("nub");
if (pad && nub) {
  const radius = 52;
  const set = (e: PointerEvent) => {
    const r = pad.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy) || 1;
    const clamped = Math.min(len, radius);
    dx = (dx / len) * clamped;
    dy = (dy / len) * clamped;
    nub.style.transform = `translate(${dx}px, ${dy}px)`;
    stick = { x: dx / radius, y: dy / radius, active: true };
  };
  pad.addEventListener("pointerdown", (e) => {
    pad.setPointerCapture(e.pointerId);
    set(e);
  });
  pad.addEventListener("pointermove", (e) => {
    if (stick.active) set(e);
  });
  const release = () => {
    stick = { x: 0, y: 0, active: false };
    nub.style.transform = "translate(0,0)";
  };
  pad.addEventListener("pointerup", release);
  pad.addEventListener("pointercancel", release);
  if (matchMedia("(pointer: coarse)").matches) pad.style.display = "grid";
}

// ===== loop =====

const hud = document.getElementById("hud");
const clock = new THREE.Clock();
let stride = 0;
let nearestName = "";

function resize() {
  const w = stage.clientWidth || window.innerWidth;
  const h = stage.clientHeight || window.innerHeight;
  // setSize(w, h) — never setSize(w, h, false) here. With updateStyle off the
  // canvas keeps its attribute size (w × devicePixelRatio), so on a retina
  // screen it lays out at twice the window and the view is cropped: the
  // character sits centred in a canvas you can only see a corner of.
  renderer.setSize(w, h);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const desired = new THREE.Vector3();
const camTarget = new THREE.Vector3();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.getElapsedTime();

  // Wind: every cloned petal material reads the same clock.
  for (const m of windMaterials) (m.uniforms.uTime.value as number) = t;

  let ix = 0;
  let iz = 0;
  if (keys.has("w") || keys.has("arrowup")) iz -= 1;
  if (keys.has("s") || keys.has("arrowdown")) iz += 1;
  if (keys.has("a") || keys.has("arrowleft")) ix -= 1;
  if (keys.has("d") || keys.has("arrowright")) ix += 1;
  if (stick.active) {
    ix += stick.x;
    iz += stick.y;
  }
  const input = Math.min(Math.hypot(ix, iz), 1);

  if (input > 0.02) {
    forward.set(Math.sin(camYaw), 0, Math.cos(camYaw));
    right.set(forward.z, 0, -forward.x);
    desired
      .set(0, 0, 0)
      .addScaledVector(forward, iz)
      .addScaledVector(right, ix)
      .normalize();
    const speed = (keys.has("shift") ? 8.2 : 4.1) * input;
    hero.position.addScaledVector(desired, speed * dt);
    // Keep the wanderer on the lawn.
    const d = Math.hypot(hero.position.x, hero.position.z);
    if (d > LAWN) {
      hero.position.x *= LAWN / d;
      hero.position.z *= LAWN / d;
    }
    const want = Math.atan2(desired.x, desired.z);
    let diff = want - hero.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    hero.rotation.y += diff * Math.min(1, dt * 12);
    stride += speed * dt * 2.1;
  } else {
    stride += dt * 1.6;
  }

  const walking = input > 0.02;
  const swing = walking ? Math.sin(stride) * 0.85 : Math.sin(stride) * 0.06;
  limbs.legL.rotation.x = swing;
  limbs.legR.rotation.x = -swing;
  limbs.armL.rotation.x = -swing * 0.8;
  limbs.armR.rotation.x = swing * 0.8;
  hero.position.y = walking ? Math.abs(Math.sin(stride)) * 0.06 : 0;

  // Third-person follow: the camera drifts back behind the shoulders while you
  // walk, and stops doing so the moment you take hold of it with the mouse.
  // camYaw = hero.rotation.y + PI is exactly "behind", and walking straight
  // ahead is a fixed point of that relation, so it does not chase its own tail.
  if (walking && !dragging) {
    let d = hero.rotation.y + Math.PI - camYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    camYaw += d * Math.min(1, dt * 2.2);
  }

  camTarget.copy(hero.position).add(new THREE.Vector3(0, 1.35, 0));
  const cy = Math.sin(camPitch) * camDist;
  const cr = Math.cos(camPitch) * camDist;
  camera.position.lerp(
    new THREE.Vector3(
      camTarget.x + Math.sin(camYaw) * cr,
      camTarget.y + cy,
      camTarget.z + Math.cos(camYaw) * cr,
    ),
    Math.min(1, dt * 9),
  );
  camera.lookAt(camTarget);

  // Name the bed you are standing closest to.
  let best = Infinity;
  let name = "";
  for (const bed of beds) {
    const d = bed.position.distanceTo(hero.position);
    if (d < best) {
      best = d;
      name = bed.name;
    }
  }
  const label = best < 6 ? name : "";
  if (label !== nearestName && hud) {
    nearestName = label;
    hud.textContent = label;
    hud.style.opacity = label ? "1" : "0";
  }

  renderer.render(scene, camera);
});

// Expose a little state for the headless check.
(window as unknown as Record<string, unknown>).__garden = {
  species: species.length,
  beds: beds.length,
  heights: species.map((s) => ({ id: s.config.id, h: +s.height.toFixed(2) })),
  hero,
  camera,
  nearest: () => nearestName,
  teleport: (x: number, z: number) => hero.position.set(x, 0, z),
};
