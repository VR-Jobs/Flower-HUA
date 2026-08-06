// 鲜花世界 — a dense, walkable world of Flower-HUA flowers.
//
// Two scales of flower, both built by the real engine (no imitations):
//   · FIELDS  — thousands of small flowers. Per species the engine's petal
//     InstancedMesh is expanded at the INSTANCE level: count goes from
//     "petals of one flower" to "petals × planted copies", and each copy's
//     petal matrices are fieldMatrix · petalMatrix. Zero shader changes, so
//     bloom / wind / palette behave exactly as in the Studio. Stems and core
//     organs are baked into one vertex-coloured geometry per species and
//     instanced alongside. Two draw calls per species.
//   · GIANTS  — the most spectacular anatomy families, deep-cloned at high
//     tessellation and scaled to tree height along a winding stone path.
//
// Plus: petal rain, drifting light motes, butterflies, a gradient sky dome,
// and a world-wide re-bloom that sweeps across every flower (uniform-only).

import * as THREE from "three";
import { createFlowerScene } from "../../Studio/components/flower/flowerScene";
import { PRESET_FLOWERS } from "../../Studio/components/flower/presets";
import type { FlowerConfig } from "../../Studio/components/flower/flowerConfig";

declare const __FLOWERS__: FlowerConfig[];

const byId = new Map(__FLOWERS__.map((f) => [f.id, f]));
// Aurora Rose, Crimson Dahlia and Garland Daisy live in the preset registry,
// not in flowers.json — merge them so the showcase zones can grow them.
for (const preset of PRESET_FLOWERS) if (!byId.has(preset.id)) byId.set(preset.id, preset);

// Field species with per-species petal counts and planting density. A single
// global petal cap was what broke the sunflower: radial-disc needs its ray
// count or the head shows gaps. Fewer copies pay for more petals where needed.
const FIELD_SPECS: { id: string; petals: number; copies: number }[] = [
  { id: "sun-gold-sunflower", petals: 21, copies: 115 },
  { id: "scarlet-rose", petals: 13, copies: 170 },
  { id: "golden-daisy", petals: 21, copies: 115 },
  { id: "lavender-aster", petals: 21, copies: 115 },
  { id: "violet-tulip", petals: 6, copies: 200 },
  { id: "sakura-cloud", petals: 13, copies: 170 },
  { id: "cyan-hydrangea", petals: 24, copies: 95 },
  { id: "ember-chrysanthemum", petals: 16, copies: 140 },
  { id: "violet-allium", petals: 24, copies: 95 },
  { id: "arctic-camellia", petals: 13, copies: 160 },
  { id: "rose-snapdragon", petals: 14, copies: 150 },
  { id: "sunset-hibiscus", petals: 5, copies: 190 },
];
const FIELD_IDS = FIELD_SPECS.map((f) => f.id);
// Showcase species: each gets its own themed zone rather than a drift. Baked at
// higher tessellation (6×14) because visitors walk right up to them.
const SHOWCASE_SPECS: { id: string; petals: number; copies: number }[] = [
  { id: "aurora-rose", petals: 20, copies: 0 },
  { id: "crimson-dahlia", petals: 26, copies: 0 },
  { id: "garland-daisy", petals: 21, copies: 0 },
  { id: "cobalt-ice-bloom", petals: 24, copies: 0 },
];
const ALL_SPECS = FIELD_SPECS.concat(SHOWCASE_SPECS);
// Giants: the anatomies with real organs — beaks, coronas, seed globes.
const GIANT_IDS = [
  "royal-protea",
  "bird-of-paradise",
  "passionflower-corona",
  "velvet-dahlia",
  "moonlit-lotus",
  "black-bat-flower",
  "crimson-torch-ginger",
  "ivory-calla",
  "scarlet-spider-lily",
  "moonlit-cereus",
  "fuchsia-lantern",
  "golden-pincushion",
  "violet-wisteria",
  "dandelion-metamorphosis",
];

// ===== shared snapshot helpers (same technique as the garden page) =====

const petalMats: THREE.ShaderMaterial[] = []; // every cloned petal material

function clonePetalMaterial(src: THREE.ShaderMaterial) {
  const ramp = src.uniforms.uRamps.value as THREE.DataTexture;
  const image = ramp.image as { data: Uint16Array; width: number };
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
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: src.vertexShader,
    fragmentShader: src.fragmentShader,
    side: src.side,
  });
  // Remember the finished-bloom value so the world-wide re-bloom can ease
  // back to exactly the pose the Studio would show.
  mat.userData.bloomTarget = Math.min(1, (uniforms.uBloom.value as number) + 0.14);
  // Livelier meadow than the studio default.
  uniforms.uWindAmp.value = Math.max(uniforms.uWindAmp.value as number, 0.09);
  petalMats.push(mat);
  return mat;
}

const isPetalShader = (m: THREE.Material) =>
  (m as THREE.ShaderMaterial).isShaderMaterial === true &&
  Boolean((m as THREE.ShaderMaterial).uniforms?.uRamps);

function deepClone(source: THREE.Object3D) {
  const copy = source.clone(true);
  const originals: THREE.Object3D[] = [];
  source.traverse((o) => originals.push(o));
  let i = 0;
  copy.traverse((node) => {
    const original = originals[i++] as THREE.Mesh;
    const mesh = node as THREE.Mesh;
    const drawable =
      mesh.isMesh ||
      (mesh as unknown as THREE.Points).isPoints ||
      (mesh as unknown as THREE.LineSegments).isLineSegments;
    if (!drawable || !original) return;
    if (original.geometry) mesh.geometry = original.geometry.clone();
    const mats = Array.isArray(original.material)
      ? original.material
      : [original.material];
    const cloned = mats.map((m) =>
      m ? (isPetalShader(m) ? clonePetalMaterial(m as THREE.ShaderMaterial) : m.clone()) : m,
    );
    mesh.material = Array.isArray(original.material) ? cloned : cloned[0];
  });
  return copy;
}

// ===== field bake =====

type FieldBake = {
  config: FlowerConfig;
  petalGeoBase: THREE.BufferGeometry; // position/uv/index only
  petalAttrs: Record<string, Float32Array>; // 9 per-petal instanced attrs
  petalMatrices: Float32Array; // n × 16, relative to the flower root
  petalCount: number;
  material: THREE.ShaderMaterial;
  staticGeo: THREE.BufferGeometry | null; // stems + cores, vertex-coloured
  minY: number;
  height: number;
};

const PETAL_ATTR_NAMES = [
  "aU",
  "aSeed",
  "aTilt",
  "aLengthScale",
  "aWidthScale",
  "aCupScale",
  "aWaveScale",
  "aColorBias",
  "aBudTwist",
];

function materialColor(m: THREE.Material): THREE.Color {
  const withColor = m as THREE.MeshBasicMaterial;
  if (withColor.color?.isColor) return withColor.color;
  const shader = m as THREE.ShaderMaterial;
  const u = shader.uniforms?.uColor?.value as THREE.Color | undefined;
  return u?.isColor ? u : new THREE.Color(0x2f7d34);
}

function bakeFieldSpecies(
  engine: ReturnType<typeof createFlowerScene>,
  config: FlowerConfig,
): FieldBake {
  const root = engine.getFlowerGroup();
  root.updateMatrixWorld(true);
  const invRoot = root.matrixWorld.clone().invert();

  let petals: THREE.InstancedMesh | null = null;
  root.traverse((o) => {
    const m = o as THREE.InstancedMesh;
    if (m.isInstancedMesh && isPetalShader(m.material as THREE.Material)) petals = m;
  });
  if (!petals) throw new Error(`No petal mesh for ${config.id}`);
  const p = petals as THREE.InstancedMesh;
  const n = p.count;

  // Petal matrices relative to the flower root (root scale included).
  const rel = new THREE.Matrix4().multiplyMatrices(invRoot, p.matrixWorld);
  const src = p.instanceMatrix.array as Float32Array;
  const matrices = new Float32Array(n * 16);
  const a = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    a.fromArray(src, i * 16).premultiply(rel);
    a.toArray(matrices, i * 16);
  }

  const attrs: Record<string, Float32Array> = {};
  for (const name of PETAL_ATTR_NAMES) {
    attrs[name] = (p.geometry.getAttribute(name).array as Float32Array).slice();
  }
  const base = new THREE.BufferGeometry();
  base.setIndex(p.geometry.getIndex());
  base.setAttribute("position", p.geometry.getAttribute("position").clone());
  base.setAttribute("uv", p.geometry.getAttribute("uv").clone());

  // Head base: the lowest petal root. Everything below it is the engine's stem
  // system; everything at or above it belongs to the flower head.
  const v = new THREE.Vector3();
  let headBase = Infinity;
  for (let i = 0; i < n; i++) headBase = Math.min(headBase, matrices[i * 16 + 13]);
  if (!Number.isFinite(headBase)) headBase = 0;

  // In-head static parts (cores, receptacles, spikes). The engine's own stem
  // and leaves are deliberately dropped: its TubeGeometry stem alone is 960
  // triangles, and any budget that can truncate a stem can strand a flower in
  // mid-air — the arctic-camellia bug. A synthetic stem below replaces them,
  // connected to the ground by construction.
  type Part = { geo: THREE.BufferGeometry; tris: number; size: number };
  const rawParts: Part[] = [];
  const box = new THREE.Box3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh === (p as unknown as THREE.Mesh)) return;
    const geo = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone())
      .applyMatrix4(new THREE.Matrix4().multiplyMatrices(invRoot, mesh.matrixWorld));
    geo.computeBoundingBox();
    // Below the head → part of the engine stem/leaf system → skip.
    if (geo.boundingBox!.max.y < headBase - 0.02) return;
    const count = geo.getAttribute("position").count;
    const color = materialColor(
      Array.isArray(mesh.material) ? mesh.material[0] : mesh.material,
    );
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    for (const name of Object.keys(geo.attributes)) {
      if (name !== "position" && name !== "color") geo.deleteAttribute(name);
    }
    rawParts.push({ geo, tris: count / 3, size: geo.boundingBox!.getSize(new THREE.Vector3()).length() });
  });
  const parts: THREE.BufferGeometry[] = [];
  let organBudget = 520;
  for (const part of rawParts.sort((a, b) => b.size - a.size)) {
    if (part.tris <= organBudget) {
      parts.push(part.geo);
      organBudget -= part.tris;
    }
  }

  // Synthetic plant: stem cylinder + two leaves + receptacle cap. ~50 triangles
  // and it cannot break, because it is generated as one connected piece.
  const STEM_LEN = 1.15;
  const stemCol = new THREE.Color(0x2f7d34);
  const leafCol = new THREE.Color(0x46a049);
  const paint = (geo: THREE.BufferGeometry, color: THREE.Color) => {
    const count = geo.getAttribute("position").count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    for (const name of Object.keys(geo.attributes)) {
      if (name !== "position" && name !== "color") geo.deleteAttribute(name);
    }
    return geo;
  };
  const stem = paint(
    new THREE.CylinderGeometry(0.026, 0.04, STEM_LEN, 5).toNonIndexed(),
    stemCol,
  );
  stem.applyMatrix4(new THREE.Matrix4().makeTranslation(0, headBase - STEM_LEN / 2, 0));
  parts.push(stem);
  const cap = paint(new THREE.ConeGeometry(0.1, 0.12, 6).toNonIndexed(), stemCol);
  cap.applyMatrix4(new THREE.Matrix4().makeTranslation(0, headBase + 0.02, 0));
  parts.push(cap);
  for (const [t, side] of [
    [0.42, 1],
    [0.66, -1],
  ] as const) {
    const leaf = new THREE.PlaneGeometry(0.14, 0.5, 1, 2);
    const lp = leaf.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < lp.count; i++) {
      if (Math.abs(lp.getY(i)) < 0.15) lp.setZ(i, 0.06); // slight fold
    }
    const painted = paint(leaf.toNonIndexed(), leafCol);
    painted.applyMatrix4(
      new THREE.Matrix4()
        .makeRotationZ(side * 0.9)
        .setPosition(side * 0.16, headBase - STEM_LEN * t, 0),
    );
    parts.push(painted);
  }

  // Merge (positions + colours), then flat-shade via non-indexed normals.
  let total = 0;
  for (const g of parts) total += g.getAttribute("position").count;
  const posArr = new Float32Array(total * 3);
  const colArr = new Float32Array(total * 3);
  let off = 0;
  for (const g of parts) {
    posArr.set(g.getAttribute("position").array as Float32Array, off * 3);
    colArr.set(g.getAttribute("color").array as Float32Array, off * 3);
    off += g.getAttribute("position").count;
  }
  const staticGeo = new THREE.BufferGeometry();
  staticGeo.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
  staticGeo.setAttribute("color", new THREE.BufferAttribute(colArr, 3));
  staticGeo.computeVertexNormals();
  staticGeo.computeBoundingBox();
  box.copy(staticGeo.boundingBox!);

  // Bounds: static plus petal reach.
  const petalLen = (config.params.petalLen as number) ?? 0.95;
  for (let i = 0; i < n; i++) {
    v.set(matrices[i * 16 + 12], matrices[i * 16 + 13], matrices[i * 16 + 14]);
    box.expandByPoint(v);
  }
  box.expandByScalar(petalLen * 0.8);

  return {
    config,
    petalGeoBase: base,
    petalAttrs: attrs,
    petalMatrices: matrices,
    petalCount: n,
    material: clonePetalMaterial(p.material as THREE.ShaderMaterial),
    staticGeo,
    minY: box.min.y,
    height: Math.max(box.max.y - box.min.y, 0.001),
  };
}

// ===== world scaffolding =====

const SKY_TOP = new THREE.Color(0x69b7e8);
const SKY_MID = new THREE.Color(0xa5d8f2);
const SKY_HORIZON = new THREE.Color(0xffdbe4);
const FOG_COLOR = new THREE.Color(0xf4dbe6);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(FOG_COLOR.getHex(), 54, 155);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const stage = document.getElementById("stage")!;
stage.appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 400);

scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x5a7a44, 1.35));
const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
sun.position.set(-40, 55, -30);
scene.add(sun);

// Sky dome with a warm horizon, so the fog melts into pink light.
{
  const sky = new THREE.SphereGeometry(190, 24, 12);
  const pos = sky.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / 190, -0.1, 1);
    if (t < 0.18) c.copy(SKY_HORIZON).lerp(SKY_MID, THREE.MathUtils.smoothstep(t, -0.05, 0.18));
    else c.copy(SKY_MID).lerp(SKY_TOP, THREE.MathUtils.smoothstep(t, 0.18, 0.85));
    c.toArray(colors, i * 3);
  }
  sky.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const dome = new THREE.Mesh(
    sky,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }),
  );
  scene.add(dome);

  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(9, 32),
    new THREE.MeshBasicMaterial({ color: 0xfff6d8, fog: false, transparent: true, opacity: 0.95 }),
  );
  sunDisc.position.set(-120, 120, -95);
  sunDisc.lookAt(0, 0, 0);
  scene.add(sunDisc);
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(22, 32),
    new THREE.MeshBasicMaterial({
      color: 0xffe9b8,
      fog: false,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  glow.position.copy(sunDisc.position);
  glow.lookAt(0, 0, 0);
  scene.add(glow);
}

const flat = (color: number) =>
  new THREE.MeshLambertMaterial({ color, flatShading: true });

/** Frost-pale boulder for the Cobalt Frost zone. */
function rockAt(x: number, z: number, s: number) {
  const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), flat(0xc9d6de));
  m.position.set(x, s * 0.4, z);
  m.rotation.set(x, z, x + z);
  m.scale.y = 0.65;
  return m;
}

// The winding path through the valley.
const VALLEY = 58;
const pathX = (z: number) => 13 * Math.sin((z + 44) * 0.075);

// Drift layout first — the ground tints itself around them.
type Drift = {
  id: string;
  name: string;
  center: THREE.Vector3;
  radius: number;
  tint: THREE.Color;
};
const drifts: Drift[] = [];
{
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  FIELD_IDS.forEach((id, k) => {
    const config = byId.get(id)!;
    const angle = (k / FIELD_IDS.length) * Math.PI * 2 + 0.26;
    let r = 27 + (k % 3) * 9 + rand() * 4;
    let cx = Math.cos(angle) * r;
    let cz = Math.sin(angle) * r;
    // Push a drift off the path corridor rather than let it swallow the walk.
    for (let guard = 0; guard < 8 && Math.abs(cx - pathX(cz)) < 10; guard++) {
      r += 4;
      cx = Math.cos(angle) * r;
      cz = Math.sin(angle) * r;
    }
    const mid = config.palette[2];
    drifts.push({
      id,
      name: config.name,
      center: new THREE.Vector3(cx, 0, cz),
      // Area tracks how many copies this species plants, so every drift reads
      // equally dense whether it holds 95 alliums or 200 tulips.
      radius: 6.4 * Math.sqrt(FIELD_SPECS[k].copies / 165) + rand() * 1.2,
      tint: new THREE.Color(mid[0], mid[1], mid[2]),
    });
  });
}

// Ground: flat valley, hills beyond, meadow tinted beneath each drift.
{
  const GROUND = 260;
  const geo = new THREE.PlaneGeometry(GROUND, GROUND, 64, 64);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const p2 = new THREE.Vector2();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const d = Math.hypot(x, z);
    const rise = d < VALLEY + 4 ? 0 : Math.min((d - VALLEY - 4) / 34, 1);
    pos.setY(i, rise * (3.6 + Math.sin(x * 0.13) * 2.0 + Math.cos(z * 0.11) * 2.0));
    c.setHSL(
      0.27 + Math.sin(x * 0.3 + z * 0.21) * 0.018,
      0.42,
      0.37 + Math.sin(x * 0.8 + z * 0.6) * 0.02,
    );
    for (const drift of drifts) {
      p2.set(x - drift.center.x, z - drift.center.z);
      const inside = 1 - THREE.MathUtils.clamp(p2.length() / (drift.radius * 1.5), 0, 1);
      if (inside > 0) c.lerp(drift.tint, inside * 0.24);
    }
    c.toArray(colors, i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  scene.add(
    new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })),
  );
}

// Stone path, instanced.
{
  const slabGeo = new THREE.CylinderGeometry(0.66, 0.66, 0.09, 6);
  const slabs: THREE.Matrix4[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (let z = 44; z >= -44; z -= 1.7) {
    m.compose(
      new THREE.Vector3(pathX(z) + Math.sin(z * 3.1) * 0.35, 0.045, z),
      q.setFromAxisAngle(up, z * 0.7),
      new THREE.Vector3(1, 1, 1),
    );
    slabs.push(m.clone());
  }
  const inst = new THREE.InstancedMesh(slabGeo, flat(0xdccfb6), slabs.length);
  slabs.forEach((mat, i) => inst.setMatrixAt(i, mat));
  scene.add(inst);
}

// Soft fake contact shadow.
const shadowTex = (() => {
  const s = 64;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const g = cv.getContext("2d")!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, "rgba(0,0,0,0.4)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(cv);
})();
const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
function addShadow(parent: THREE.Object3D, radius: number, y = 0.02) {
  const m = new THREE.Mesh(shadowGeo, shadowMat);
  m.scale.setScalar(radius * 2);
  m.position.y = y;
  parent.add(m);
}

// Trees on the far hills.
function tree(x: number, z: number, s: number) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 3, 6), flat(0x6b4a2f));
  trunk.position.y = 1.5;
  g.add(trunk);
  const tones = [0x3f8f42, 0x4fa350, 0x357a38];
  for (let i = 0; i < 3; i++) {
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(1.9 - i * 0.35, 0), flat(tones[i]));
    blob.position.set(Math.sin(i * 2.3) * 0.5, 3.3 + i * 1.15, Math.cos(i * 2.3) * 0.5);
    g.add(blob);
  }
  g.position.set(x, 0, z);
  g.scale.setScalar(s);
  g.rotation.y = x * z;
  return g;
}
for (let i = 0; i < 16; i++) {
  const a = (i / 16) * Math.PI * 2 + 0.4;
  const r = VALLEY + 9 + ((i * 7) % 6);
  scene.add(tree(Math.cos(a) * r, Math.sin(a) * r, 1.1 + ((i * 13) % 5) / 9));
}

// Micro-flowers carpeting the grass: one instanced mesh, three pastel tones.
{
  const star = new THREE.BufferGeometry();
  const verts: number[] = [];
  for (let k = 0; k < 5; k++) {
    const a0 = (k / 5) * Math.PI * 2;
    const a1 = a0 + Math.PI / 5;
    const a2 = a0 - Math.PI / 5;
    verts.push(0, 0.02, 0, Math.cos(a1) * 0.5, 0.05, Math.sin(a1) * 0.5, Math.cos(a0), 0.09, Math.sin(a0));
    verts.push(0, 0.02, 0, Math.cos(a0), 0.09, Math.sin(a0), Math.cos(a2) * 0.5, 0.05, Math.sin(a2) * 0.5);
  }
  star.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  star.computeVertexNormals();
  const COUNT = 3000;
  const inst = new THREE.InstancedMesh(
    star,
    new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }),
    COUNT,
  );
  let seed = 31;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const tones = [new THREE.Color(0xffd9ec), new THREE.Color(0xffdf8f), new THREE.Color(0xd9c8ff)];
  for (let i = 0; i < COUNT; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * (VALLEY - 2);
    const s = 0.07 + rand() * 0.07;
    m.compose(
      new THREE.Vector3(Math.cos(a) * r, 0.01, Math.sin(a) * r),
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2),
      new THREE.Vector3(s, s, s),
    );
    inst.setMatrixAt(i, m);
    inst.setColorAt(i, tones[i % 3]);
  }
  scene.add(inst);
}

// ===== boot: grow every species, then plant the world =====

const bootLabel = document.getElementById("boot-label");
const labels: { position: THREE.Vector3; radius: number; name: string }[] = [];
const giants: THREE.Group[] = [];
let plantedFieldFlowers = 0;
let bouquetGiants = 0;

async function tick(text: string) {
  if (bootLabel) bootLabel.textContent = text;
  await new Promise((r) => setTimeout(r, 0));
}

function fieldTrim(config: FlowerConfig, petals: number): FlowerConfig {
  const c: FlowerConfig = { ...config, params: { ...config.params } };
  if ((c.params.numPetals as number) > petals) c.params.numPetals = petals;
  const core = config.anatomy?.core;
  if (config.anatomy && core?.count && core.count > 10) {
    c.anatomy = { ...config.anatomy, core: { ...core, count: 10 } };
  }
  return c;
}
function giantTrim(config: FlowerConfig): FlowerConfig {
  const c: FlowerConfig = { ...config, params: { ...config.params } };
  if ((c.params.numPetals as number) > 64) c.params.numPetals = 64;
  const core = config.anatomy?.core;
  if (config.anatomy && core?.count && core.count > 40) {
    c.anatomy = { ...config.anatomy, core: { ...core, count: 40 } };
  }
  return c;
}

function applyToEngine(engine: ReturnType<typeof createFlowerScene>, config: FlowerConfig) {
  engine.setPalette(config.palette as unknown as [number, number, number][]);
  engine.setAnatomy(config.anatomy);
  // One shared, slightly raised front view for every species: the camera-facing
  // families bake this basis into their layout, and a world cannot orbit each
  // flower to meet it the way the Studio does.
  engine.setCameraView([0, 4.6, 3.4]);
  engine.applyPreset(config.params);
  engine.setEditPose();
}

async function buildWorld() {
  const pot = document.createElement("div");
  pot.style.cssText =
    "position:fixed;left:-64px;top:-64px;width:32px;height:32px;opacity:0;pointer-events:none";
  document.body.appendChild(pot);

  // --- fields: bake every species first, then compose the plantings ---
  const fieldEngine = createFlowerScene(pot, null, null, { petalSegments: { x: 3, y: 7 } });
  let seed = 101;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const TARGET_H = 1.35;

  const bakes: FieldBake[] = [];
  for (let k = 0; k < FIELD_SPECS.length; k++) {
    const spec = FIELD_SPECS[k];
    const config = byId.get(spec.id)!;
    await tick(`正在培育花种 ${k + 1}/${ALL_SPECS.length} · ${config.name}`);
    applyToEngine(fieldEngine, fieldTrim(config, spec.petals));
    bakes.push(bakeFieldSpecies(fieldEngine, config));
  }
  fieldEngine.dispose();

  const showcaseEngine = createFlowerScene(pot, null, null, { petalSegments: { x: 6, y: 14 } });
  for (let k = 0; k < SHOWCASE_SPECS.length; k++) {
    const spec = SHOWCASE_SPECS[k];
    const config = byId.get(spec.id)!;
    await tick(`正在培育名花 ${FIELD_SPECS.length + k + 1}/${ALL_SPECS.length} · ${config.name}`);
    applyToEngine(showcaseEngine, fieldTrim(config, spec.petals));
    bakes.push(bakeFieldSpecies(showcaseEngine, config));
  }
  showcaseEngine.dispose();

  // Placement lists per species. Ground plantings carry the synthetic stem;
  // garland placements (on the arches) are petal-heads only.
  const up = new THREE.Vector3(0, 1, 0);
  const ground: THREE.Matrix4[][] = ALL_SPECS.map(() => []);
  const garland: THREE.Matrix4[][] = ALL_SPECS.map(() => []);
  const speciesIndex = new Map(ALL_SPECS.map((f, i) => [f.id, i]));

  const plantAt = (
    list: THREE.Matrix4[][],
    si: number,
    x: number,
    z: number,
    scale: number,
    yaw: number,
    tilt = 0,
    y?: number,
    orient?: THREE.Quaternion,
  ) => {
    const bake = bakes[si];
    const k = (TARGET_H / bake.height) * scale;
    const rot =
      orient ??
      new THREE.Quaternion()
        .setFromAxisAngle(up, yaw)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt));
    list[si].push(
      new THREE.Matrix4().compose(
        new THREE.Vector3(x, y ?? -bake.minY * k, z),
        rot,
        new THREE.Vector3(k, k, k),
      ),
    );
  };

  // 1) Colour drifts, each rimmed with a complementary companion species —
  //    monoculture reads as a printed texture; a second species reads as a
  //    planted garden border.
  const COMPANIONS: Record<string, string> = {
    "sun-gold-sunflower": "golden-daisy",
    "scarlet-rose": "sakura-cloud",
    "golden-daisy": "violet-tulip",
    "lavender-aster": "arctic-camellia",
    "violet-tulip": "sakura-cloud",
    "sakura-cloud": "arctic-camellia",
    "cyan-hydrangea": "violet-allium",
    "ember-chrysanthemum": "sun-gold-sunflower",
    "violet-allium": "lavender-aster",
    "arctic-camellia": "scarlet-rose",
    "rose-snapdragon": "violet-tulip",
    "sunset-hibiscus": "golden-daisy",
  };
  for (let k = 0; k < FIELD_SPECS.length; k++) {
    const drift = drifts[k];
    for (let j = 0; j < FIELD_SPECS[k].copies; j++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * drift.radius;
      plantAt(
        ground,
        k,
        drift.center.x + Math.cos(a) * r,
        drift.center.z + Math.sin(a) * r,
        0.8 + rand() * 0.55,
        rand() * Math.PI * 2,
        (rand() - 0.5) * 0.12,
      );
    }
    const mate = speciesIndex.get(COMPANIONS[FIELD_SPECS[k].id])!;
    for (let j = 0; j < 24; j++) {
      const a = rand() * Math.PI * 2;
      const r = drift.radius * (0.72 + rand() * 0.33);
      plantAt(
        ground,
        mate,
        drift.center.x + Math.cos(a) * r,
        drift.center.z + Math.sin(a) * r,
        0.6 + rand() * 0.28,
        rand() * Math.PI * 2,
        (rand() - 0.5) * 0.1,
      );
    }
    labels.push({ position: drift.center.clone(), radius: drift.radius + 2.5, name: bakes[k].config.name });
  }

  // 2) The flower mandala: four concentric rings around one oversized bloom.
  const MANDALA = new THREE.Vector3(9, 0, 6);
  const RINGS: { id: string; radius: number; count: number; scale: number }[] = [
    { id: "violet-tulip", radius: 2.6, count: 18, scale: 0.85 },
    { id: "golden-daisy", radius: 4.0, count: 24, scale: 0.9 },
    { id: "scarlet-rose", radius: 5.4, count: 28, scale: 0.95 },
    { id: "arctic-camellia", radius: 6.8, count: 30, scale: 0.9 },
  ];
  for (const ring of RINGS) {
    const si = speciesIndex.get(ring.id)!;
    for (let i = 0; i < ring.count; i++) {
      const a = (i / ring.count) * Math.PI * 2;
      plantAt(
        ground,
        si,
        MANDALA.x + Math.cos(a) * ring.radius,
        MANDALA.z + Math.sin(a) * ring.radius,
        ring.scale,
        a + Math.PI / 2,
      );
    }
  }
  // Centrepiece: one chrysanthemum grown to 2.6× — a ~3.5 m bloom.
  plantAt(ground, speciesIndex.get("ember-chrysanthemum")!, MANDALA.x, MANDALA.z, 2.6, 0.4);
  labels.push({ position: MANDALA.clone(), radius: 9.5, name: "百花曼陀罗 · Flower Mandala" });

  // 3) Garland arches over the path: flower heads studded on a green half-torus.
  const ARCHES = [
    { z: 24, ids: ["sakura-cloud", "scarlet-rose"] },
    { z: 0, ids: ["violet-tulip", "golden-daisy"] },
    { z: -24, ids: ["lavender-aster", "arctic-camellia"] },
  ];
  const ARCH_R = 3.3;
  let garlandCount = 0;
  for (const arch of ARCHES) {
    const cx = pathX(arch.z);
    const frame = new THREE.Mesh(
      new THREE.TorusGeometry(ARCH_R, 0.07, 6, 28, Math.PI),
      flat(0x2f7d34),
    );
    frame.position.set(cx, 0, arch.z);
    scene.add(frame);
    arch.ids.forEach((id, which) => {
      const si = speciesIndex.get(id)!;
      const per = 13;
      for (let i = 0; i < per; i++) {
        const t = (i + (which ? 0.5 : 0)) / (per - 0.5);
        const a = t * Math.PI;
        const outward = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
        const orient = new THREE.Quaternion()
          .setFromUnitVectors(up, outward)
          .multiply(new THREE.Quaternion().setFromAxisAngle(up, rand() * Math.PI * 2));
        plantAt(
          garland,
          si,
          cx + Math.cos(a) * ARCH_R,
          arch.z,
          0.48 + rand() * 0.12,
          0,
          0,
          Math.sin(a) * ARCH_R,
          orient,
        );
        garlandCount++;
      }
    });
  }

  // 4) Showcase zones — one signature arrangement per famous bloom.
  // 极光螺旋: Aurora Rose on a golden-angle spiral, small rim to a large heart.
  {
    const si = speciesIndex.get("aurora-rose")!;
    const C = { x: -24, z: 10 };
    for (let i = 0; i < 37; i++) {
      const a = i * 2.39996; // the golden angle, honouring its spiral-rosette family
      const r = 8 * Math.sqrt((36 - i) / 36) + 0.8;
      plantAt(
        ground,
        si,
        C.x + Math.cos(a) * r,
        C.z + Math.sin(a) * r,
        0.5 + (i / 36) * 0.6,
        a + Math.PI / 2,
        (rand() - 0.5) * 0.08,
      );
    }
    plantAt(ground, si, C.x, C.z, 2.2, 0.7);
    labels.push({ position: new THREE.Vector3(C.x, 0, C.z), radius: 10, name: "极光螺旋 · Aurora Spiral" });
  }
  // 绯红剧场: Crimson Dahlia in three amphitheatre arcs facing a 2.4× soloist.
  {
    const si = speciesIndex.get("crimson-dahlia")!;
    const C = { x: -10, z: -18 };
    const facing = 0.9; // the theatre opens toward the path, north-east
    [
      { r: 3.2, count: 8, scale: 0.75 },
      { r: 4.8, count: 11, scale: 0.95 },
      { r: 6.4, count: 14, scale: 1.15 },
    ].forEach((row) => {
      for (let i = 0; i < row.count; i++) {
        const a = facing + Math.PI * 0.62 + (i / (row.count - 1)) * Math.PI * 0.76;
        plantAt(
          ground,
          si,
          C.x + Math.cos(a) * row.r,
          C.z + Math.sin(a) * row.r,
          row.scale,
          a + Math.PI, // every seat faces the soloist
          0.06,
        );
      }
    });
    plantAt(ground, si, C.x, C.z, 2.4, facing);
    labels.push({ position: new THREE.Vector3(C.x, 0, C.z), radius: 9, name: "绯红剧场 · Crimson Theatre" });
  }
  // 雏菊花环: Garland Daisy in two counter-rotating rings, heads leaning out.
  {
    const si = speciesIndex.get("garland-daisy")!;
    const C = { x: 18, z: -2 };
    [
      { r: 4.4, count: 16, lean: 0.22 },
      { r: 6.4, count: 22, lean: 0.3 },
    ].forEach((ring, which) => {
      for (let i = 0; i < ring.count; i++) {
        const a = (i / ring.count) * Math.PI * 2 + which * 0.3;
        const outward = new THREE.Quaternion()
          .setFromAxisAngle(up, a + (which ? Math.PI / 2 : -Math.PI / 2))
          .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), ring.lean));
        const bake = bakes[si];
        const k2 = (TARGET_H / bake.height) * 0.85;
        ground[si].push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(C.x + Math.cos(a) * ring.r, -bake.minY * k2, C.z + Math.sin(a) * ring.r),
            outward,
            new THREE.Vector3(k2, k2, k2),
          ),
        );
      }
    });
    labels.push({ position: new THREE.Vector3(C.x, 0, C.z), radius: 8.5, name: "雏菊花环 · Daisy Garland" });
  }
  // 钴蓝冰境: Cobalt Ice Bloom in a six-armed frost star, camellia-rimmed.
  {
    const si = speciesIndex.get("cobalt-ice-bloom")!;
    const cam = speciesIndex.get("arctic-camellia")!;
    const C = { x: 10, z: 40 };
    plantAt(ground, si, C.x, C.z, 1.9, 0.3);
    for (let arm = 0; arm < 6; arm++) {
      const a = (arm / 6) * Math.PI * 2;
      for (let step = 1; step <= 3; step++) {
        plantAt(
          ground,
          si,
          C.x + Math.cos(a) * step * 1.9,
          C.z + Math.sin(a) * step * 1.9,
          1.15 - step * 0.22,
          a,
          0.05,
        );
      }
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.26;
      plantAt(ground, cam, C.x + Math.cos(a) * 7.2, C.z + Math.sin(a) * 7.2, 0.6, a, 0.04);
    }
    for (let i = 0; i < 8; i++) {
      const a = i * 2.4;
      scene.add(rockAt(C.x + Math.cos(a) * (4.5 + (i % 3)), C.z + Math.sin(a) * (4.5 + (i % 3)), 0.28 + (i % 3) * 0.1));
    }
    labels.push({ position: new THREE.Vector3(C.x, 0, C.z), radius: 9.5, name: "钴蓝冰境 · Cobalt Frost" });
  }

  // 5) Plant every species: one petals mesh (ground + garland) and one static
  //    mesh (ground only — garland heads have no stems to show).
  await tick("正在栽种花海与花境…");
  for (let k = 0; k < bakes.length; k++) {
    const bake = bakes[k];
    const groundMats = ground[k];
    const allMats = groundMats.concat(garland[k]);
    plantedFieldFlowers += groundMats.length;
    const n = bake.petalCount;

    const geo = new THREE.BufferGeometry();
    geo.setIndex(bake.petalGeoBase.getIndex());
    geo.setAttribute("position", bake.petalGeoBase.getAttribute("position"));
    geo.setAttribute("uv", bake.petalGeoBase.getAttribute("uv"));
    for (const name of PETAL_ATTR_NAMES) {
      const src = bake.petalAttrs[name];
      const tiled = new Float32Array(src.length * allMats.length);
      for (let j = 0; j < allMats.length; j++) tiled.set(src, j * src.length);
      geo.setAttribute(name, new THREE.InstancedBufferAttribute(tiled, 1));
    }
    const petals = new THREE.InstancedMesh(geo, bake.material, n * allMats.length);
    // Instances span the whole valley; the base geometry's bounds do not.
    petals.frustumCulled = false;
    const tmp = new THREE.Matrix4();
    for (let j = 0; j < allMats.length; j++) {
      for (let i = 0; i < n; i++) {
        tmp.fromArray(bake.petalMatrices, i * 16).premultiply(allMats[j]);
        petals.setMatrixAt(j * n + i, tmp);
      }
    }
    scene.add(petals);

    if (bake.staticGeo && groundMats.length) {
      const staticInst = new THREE.InstancedMesh(
        bake.staticGeo,
        new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
        groundMats.length,
      );
      staticInst.frustumCulled = false;
      groundMats.forEach((m, j) => staticInst.setMatrixAt(j, m));
      scene.add(staticInst);
    }
  }
  (buildWorld as unknown as Record<string, unknown>).garlandCount = garlandCount;

  // --- giants ---
  const giantEngine = createFlowerScene(pot, null, null, { petalSegments: { x: 10, y: 24 } });
  for (let k = 0; k < GIANT_IDS.length; k++) {
    const config = byId.get(GIANT_IDS[k])!;
    await tick(`正在种下巨型花 ${k + 1}/${GIANT_IDS.length} · ${config.name}`);
    applyToEngine(giantEngine, giantTrim(config));

    const built = deepClone(giantEngine.getFlowerGroup());
    built.traverse((o) => (o.frustumCulled = true));
    const wrap = new THREE.Group();
    wrap.add(built);
    const box = new THREE.Box3().setFromObject(wrap);
    built.position.y -= box.min.y;
    const height = Math.max(box.max.y - box.min.y, 0.001);

    const z = 38 - k * 5.9;
    const side = k % 2 === 0 ? 1 : -1;
    const x = pathX(z) + side * (9.5 + (k % 3));
    const target = 4.2 + ((k * 7) % 4) * 0.85; // 4.2 – 6.8 m tall
    wrap.scale.setScalar(target / height);
    wrap.position.set(x, 0, z);
    wrap.rotation.y = Math.atan2(pathX(z) - x, 0.001) + (side > 0 ? 0.35 : -0.35);
    addShadow(wrap, 1.6 / wrap.scale.x, 0.03 / wrap.scale.x);
    scene.add(wrap);
    giants.push(wrap);
    labels.push({ position: new THREE.Vector3(x, 0, z), radius: 8.5, name: config.name });
  }
  giantEngine.dispose();

  // Giant bouquets: clones of three path giants arranged tall-mid-low on a
  // knoll. clone(true) shares the already-cloned materials, so world bloom and
  // wind drive the bouquets for free — no new shader compiles.
  const BOUQUETS = [
    { at: [-18, -6] as const, ids: ["velvet-dahlia", "moonlit-lotus", "passionflower-corona"] },
    { at: [16, 14] as const, ids: ["crimson-torch-ginger", "fuchsia-lantern", "ivory-calla"] },
  ];
  for (const spot of BOUQUETS) {
    spot.ids.forEach((id, i) => {
      const src = giants[GIANT_IDS.indexOf(id)];
      const clone = src.clone(true);
      clone.scale.multiplyScalar([0.62, 0.78, 0.5][i]);
      const a = i * 2.1 + spot.at[0];
      clone.position.set(spot.at[0] + Math.cos(a) * 1.7, 0, spot.at[1] + Math.sin(a) * 1.7);
      clone.rotation.y = a * 1.7;
      scene.add(clone);
      bouquetGiants += 1;
    });
    labels.push({
      position: new THREE.Vector3(spot.at[0], 0, spot.at[1]),
      radius: 6.5,
      name: "巨型花束 · Giant Bouquet",
    });
  }
  pot.remove();
}

// ===== petal rain, motes, butterflies =====

type Tumbler = { seed: number; speed: number };
const rain: { mesh: THREE.InstancedMesh; state: Tumbler[] } = (() => {
  const geo = new THREE.PlaneGeometry(0.11, 0.2, 1, 2);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getY(i)) < 0.06) pos.setZ(i, 0.09); // deep cup, so no square confetti
  }
  geo.computeVertexNormals();
  const COUNT = 380;
  const mesh = new THREE.InstancedMesh(
    geo,
    new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }),
    COUNT,
  );
  mesh.frustumCulled = false;
  const state: Tumbler[] = [];
  const palettePool: THREE.Color[] = [];
  for (const id of FIELD_IDS) {
    const palette = byId.get(id)!.palette;
    for (const stop of [palette[1], palette[2], palette[3]]) {
      // Saturated stops only — near-white petals read as paper scraps.
      const spread = Math.max(...stop) - Math.min(...stop);
      const luma = stop[0] * 0.4 + stop[1] * 0.4 + stop[2] * 0.2;
      if (spread > 0.25 && luma > 0.34) palettePool.push(new THREE.Color(stop[0], stop[1], stop[2]));
    }
  }
  for (let i = 0; i < COUNT; i++) {
    state.push({ seed: Math.random() * 1000, speed: 0.55 + Math.random() * 0.75 });
    mesh.setColorAt(i, palettePool[i % palettePool.length]);
  }
  scene.add(mesh);
  return { mesh, state };
})();

const motes = (() => {
  const COUNT = 340;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(COUNT * 3);
  const col = new Float32Array(COUNT * 3);
  const c = new THREE.Color();
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 110;
    pos[i * 3 + 1] = 0.4 + Math.random() * 7;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 110;
    c.setHSL(0.09 + Math.random() * 0.12, 0.9, 0.78).toArray(col, i * 3);
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  // A soft radial sprite — bare PointsMaterial draws square points.
  const dot = (() => {
    const size = 64;
    const cv = document.createElement("canvas");
    cv.width = cv.height = size;
    const g = cv.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.4, "rgba(255,255,255,.6)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(cv);
  })();
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size: 0.2,
      map: dot,
      alphaMap: dot,
      vertexColors: true,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  );
  points.frustumCulled = false;
  scene.add(points);
  return points;
})();

const butterflies: { group: THREE.Group; wingL: THREE.Mesh; wingR: THREE.Mesh; phase: number; orbit: number; speed: number; height: number }[] = [];
{
  const wingGeo = new THREE.PlaneGeometry(0.3, 0.22);
  wingGeo.translate(0.15, 0, 0);
  const tones = [0xffb6d5, 0xffe08a, 0xbfd9ff];
  for (let i = 0; i < 14; i++) {
    const mat = new THREE.MeshLambertMaterial({
      color: tones[i % 3],
      side: THREE.DoubleSide,
    });
    const g = new THREE.Group();
    const wingL = new THREE.Mesh(wingGeo, mat);
    const wingR = new THREE.Mesh(wingGeo, mat);
    wingR.rotation.y = Math.PI;
    g.add(wingL, wingR);
    scene.add(g);
    butterflies.push({
      group: g,
      wingL,
      wingR,
      phase: Math.random() * 100,
      orbit: 8 + Math.random() * 38,
      speed: 0.14 + Math.random() * 0.12,
      height: 1.2 + Math.random() * 2.6,
    });
  }
}

// ===== hero (unchanged from the garden, proven) =====

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
    geo.translate(0, -h / 2, 0);
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
hero.position.set(pathX(30), 0, 30);
hero.rotation.y = Math.PI;
scene.add(hero);
const limbs = (hero as unknown as { limbs: Record<string, THREE.Mesh> }).limbs;

// ===== controls (garden rig: TPS follow + retina-safe resize) =====

const keys = new Set<string>();
addEventListener("keydown", (e) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
  keys.add(e.key.toLowerCase());
});
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
addEventListener("blur", () => keys.clear());

let camYaw = Math.PI; // behind the hero, who faces -z
let camPitch = 0.22;
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
  camPitch = THREE.MathUtils.clamp(camPitch - (e.clientY - lastY) * 0.004, -0.12, 1.0);
  lastX = e.clientX;
  lastY = e.clientY;
});
const stopDrag = () => (dragging = false);
renderer.domElement.addEventListener("pointerup", stopDrag);
renderer.domElement.addEventListener("pointercancel", stopDrag);

let camDist = 7.5;
renderer.domElement.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    camDist = THREE.MathUtils.clamp(camDist + e.deltaY * 0.01, 2.6, 20);
  },
  { passive: false },
);

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

// ===== world-wide bloom =====

let bloomStart = -1; // clock seconds; staggered per material by species order
function startWorldBloom(at: number) {
  bloomStart = at;
  for (const m of petalMats) m.uniforms.uBloom.value = 0;
}
document.getElementById("rebloom")?.addEventListener("click", () => {
  bloomStart = -2; // sentinel: set on next frame from live clock
});

// ===== loop =====

const hud = document.getElementById("hud");
const clock = new THREE.Clock();
let stride = 0;
let nearestName = "";

function resize() {
  const w = stage.clientWidth || window.innerWidth;
  const h = stage.clientHeight || window.innerHeight;
  renderer.setSize(w, h); // never pass false here — retina crops the view
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const desired = new THREE.Vector3();
const camTarget = new THREE.Vector3();
const rainMat = new THREE.Matrix4();
const rainQ = new THREE.Quaternion();
const rainE = new THREE.Euler();

// Started only after buildWorld() finishes — rendering the half-built world on
// every construction yield is free on a GPU and minutes of stall in software GL.
function startLoop() {
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.getElapsedTime();

  for (const m of petalMats) m.uniforms.uTime.value = t;

  // World bloom sweep: each species starts a beat after the previous one.
  if (bloomStart === -2) startWorldBloom(t);
  if (bloomStart >= 0) {
    let done = true;
    petalMats.forEach((m, i) => {
      const offset = (i % 26) * 0.22;
      const p = THREE.MathUtils.clamp((t - bloomStart - offset) / 4.2, 0, 1);
      const ease = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      m.uniforms.uBloom.value = (m.userData.bloomTarget as number) * ease;
      if (p < 1) done = false;
    });
    if (done) bloomStart = -1;
  }

  // Petal rain.
  {
    const inst = rain.mesh;
    for (let i = 0; i < rain.state.length; i++) {
      const s = rain.state[i];
      const cycle = 24 / s.speed;
      const local = (t * s.speed + s.seed) % 24;
      const y = 17 - local * 0.75;
      const x = Math.sin(s.seed * 12.9898) * 52 + Math.sin(t * 0.5 + s.seed) * 1.6;
      const z = Math.cos(s.seed * 78.233) * 52 + Math.cos(t * 0.42 + s.seed * 1.7) * 1.6;
      rainE.set(t * 1.4 + s.seed, t * 0.9 + s.seed * 2.1, t * 1.1 + s.seed * 0.7);
      rainMat.compose(
        new THREE.Vector3(x, Math.max(y, 0.15), z),
        rainQ.setFromEuler(rainE),
        new THREE.Vector3(1, 1, 1),
      );
      inst.setMatrixAt(i, rainMat);
      void cycle;
    }
    inst.instanceMatrix.needsUpdate = true;
  }

  // Butterflies.
  for (const b of butterflies) {
    const a = t * b.speed + b.phase;
    const x = Math.cos(a) * b.orbit;
    const z = Math.sin(a * 0.9 + b.phase) * b.orbit;
    const y = b.height + Math.sin(t * 1.3 + b.phase) * 0.5;
    const prev = b.group.position.clone();
    b.group.position.set(x, y, z);
    if (prev.distanceToSquared(b.group.position) > 1e-6) {
      b.group.lookAt(prev.lerp(b.group.position, 2));
    }
    const flap = Math.sin(t * 11 + b.phase) * 1.05;
    b.wingL.rotation.y = flap;
    b.wingR.rotation.y = Math.PI - flap;
  }

  // Movement.
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
  const walking = input > 0.02;

  if (walking) {
    forward.set(Math.sin(camYaw), 0, Math.cos(camYaw));
    right.set(forward.z, 0, -forward.x);
    desired.set(0, 0, 0).addScaledVector(forward, iz).addScaledVector(right, ix).normalize();
    const speed = (keys.has("shift") ? 9 : 4.4) * input;
    hero.position.addScaledVector(desired, speed * dt);
    const d = Math.hypot(hero.position.x, hero.position.z);
    if (d > VALLEY - 1) {
      hero.position.x *= (VALLEY - 1) / d;
      hero.position.z *= (VALLEY - 1) / d;
    }
    const want = Math.atan2(desired.x, desired.z);
    let diff = want - hero.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    hero.rotation.y += diff * Math.min(1, dt * 12);
    stride += speed * dt * 2.1;
  } else {
    stride += dt * 1.6;
  }

  const swing = walking ? Math.sin(stride) * 0.85 : Math.sin(stride) * 0.06;
  limbs.legL.rotation.x = swing;
  limbs.legR.rotation.x = -swing;
  limbs.armL.rotation.x = -swing * 0.8;
  limbs.armR.rotation.x = swing * 0.8;
  hero.position.y = walking ? Math.abs(Math.sin(stride)) * 0.06 : 0;

  // TPS follow: drift behind the shoulders while walking, hands off on drag.
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

  // Nearest label.
  let best = Infinity;
  let name = "";
  for (const label of labels) {
    const d = label.position.distanceTo(hero.position) - label.radius;
    if (d < best) {
      best = d;
      name = label.name;
    }
  }
  const text = best < 0 ? name : "";
  if (text !== nearestName && hud) {
    nearestName = text;
    hud.textContent = text;
    hud.style.opacity = text ? "1" : "0";
  }

  renderer.render(scene, camera);
});
}

// ===== boot =====

(async () => {
  await buildWorld();
  startLoop();
  startWorldBloom(clock.getElapsedTime() + 0.5);
  const handle = {
    species: FIELD_IDS.length + GIANT_IDS.length,
    fieldFlowers: plantedFieldFlowers,
    giants: giants.length,
    labels: labels.length,
    bouquet: bouquetGiants,
    garland: (buildWorld as unknown as Record<string, unknown>).garlandCount ?? 0,
    drifts: drifts.map((d) => ({ id: d.id, x: +d.center.x.toFixed(1), z: +d.center.z.toFixed(1) })),
    hero,
    camera,
    renderer,
    nearest: () => nearestName,
    teleport: (x: number, z: number) => hero.position.set(x, 0, z),
    rebloom: () => (bloomStart = -2),
    info: () => ({
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    }),
  };
  const w = window as unknown as Record<string, unknown>;
  w.__world = handle;
  w.__garden = handle; // the boot splash in the shared template polls __garden
})();
