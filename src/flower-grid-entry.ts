// A display case: every flower in the library, one per cell, on a slab that
// snaps through 90° views. Space blooms or closes the whole case at once.
//
// The bake pipeline (offscreen engine -> deep clone) is the same one the garden,
// world and editor pages use; only the staging differs.

import * as THREE from "three";
import type { FlowerConfig } from "../../Studio/components/flower/types";
import { createFlowerScene } from "../../Studio/components/flower/flowerScene";
import { PRESET_FLOWERS } from "../../Studio/components/flower/presets";

declare const __FLOWERS__: FlowerConfig[];

const byId = new Map(__FLOWERS__.map((f) => [f.id, f]));
for (const preset of PRESET_FLOWERS) if (!byId.has(preset.id)) byId.set(preset.id, preset);
// A crimson twin of the Aurora Rose, hue-rotated from the blue original. It
// closes the last gap in the 8x5 sheet, so the grid has no empty cell.
const AURORA_CRIMSON = "aurora-rose-crimson";
const auroraSrc = byId.get("aurora-rose");
if (auroraSrc) {
  const hsl = { h: 0, s: 0, l: 0 };
  const palette = (auroraSrc.palette as unknown as [number, number, number][]).map((rgb) => {
    const c = new THREE.Color(rgb[0], rgb[1], rgb[2]);
    c.getHSL(hsl);
    // +0.41 turns the aurora blues into reds while keeping the internal spread
    // between the five ramp stops, so it reads as the same flower in red.
    c.setHSL((hsl.h + 0.41) % 1, Math.min(1, hsl.s * 1.1), hsl.l);
    return [c.r, c.g, c.b] as [number, number, number];
  });
  byId.set(AURORA_CRIMSON, {
    ...auroraSrc,
    id: AURORA_CRIMSON,
    name: "Crimson Aurora · 绯光玫瑰",
    palette: palette as unknown as FlowerConfig["palette"],
  });
}

const SPECIES = [
  ...PRESET_FLOWERS.map((f) => ({ id: f.id, petals: 24 })),
  ...__FLOWERS__.map((f) => ({ id: f.id, petals: 22 })),
  ...(byId.has(AURORA_CRIMSON) ? [{ id: AURORA_CRIMSON, petals: 24 }] : []),
];

// A display case is for looking at things, so the sway is deliberately stronger
// than the editor's 0.14 — you can read the motion across the whole grid.
const WIND_AMP = 0.34;
const WIND_SPEED = 1.15;

// ===== engine snapshot =====

function clonePetalMaterial(src: THREE.ShaderMaterial) {
  const ramp = src.uniforms.uRamps.value as THREE.DataTexture;
  const image = ramp.image as { data: Uint16Array; width: number };
  // The engine re-bakes this same texture for the next flower; take a copy.
  const tex = new THREE.DataTexture(image.data.slice(), image.width, 1, ramp.format, ramp.type);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const uniforms: Record<string, { value: unknown }> = {};
  for (const key of Object.keys(src.uniforms)) {
    const value = src.uniforms[key].value as { clone?: () => unknown };
    uniforms[key] = {
      value: key === "uRamps" ? tex : value && typeof value.clone === "function" ? value.clone() : value,
    };
  }
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: src.vertexShader,
    fragmentShader: src.fragmentShader,
    side: src.side,
  });
  mat.userData.bloomTarget = Math.min(1, (uniforms.uBloom.value as number) + 0.14);
  return mat;
}

const isPetalShader = (m: THREE.Material) =>
  (m as THREE.ShaderMaterial).isShaderMaterial === true &&
  Boolean((m as THREE.ShaderMaterial).uniforms?.uRamps);

function materialColor(m: THREE.Material): THREE.Color {
  const withColor = m as THREE.MeshBasicMaterial;
  if (withColor.color?.isColor) return withColor.color;
  const u = (m as THREE.ShaderMaterial).uniforms?.uColor?.value as THREE.Color | undefined;
  return u?.isColor ? u : new THREE.Color(0x2f7d34);
}

type Bake = {
  config: FlowerConfig;
  petalGeo: THREE.BufferGeometry;
  petalMatrices: Float32Array;
  petalCount: number;
  materialSrc: THREE.ShaderMaterial;
  staticGeo: THREE.BufferGeometry;
  staticMat: THREE.MeshLambertMaterial;
  centre: THREE.Vector3; // of the fully-open flower, so it spins about itself
  radius: number;        // bounding sphere: rotation-invariant cell fit
};

const PETAL_ATTR_NAMES = [
  "aU", "aSeed", "aTilt", "aLengthScale", "aWidthScale",
  "aCupScale", "aWaveScale", "aColorBias", "aBudTwist",
];

function paint(g: THREE.BufferGeometry, color: THREE.Color) {
  const count = g.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  for (const name of Object.keys(g.attributes)) {
    if (name !== "position" && name !== "color") g.deleteAttribute(name);
  }
  return g;
}

function bakeSpecies(engine: ReturnType<typeof createFlowerScene>, config: FlowerConfig): Bake {
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

  const rel = new THREE.Matrix4().multiplyMatrices(invRoot, p.matrixWorld);
  const src = p.instanceMatrix.array as Float32Array;
  const matrices = new Float32Array(n * 16);
  const a = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    a.fromArray(src, i * 16).premultiply(rel);
    a.toArray(matrices, i * 16);
  }

  const geo = new THREE.BufferGeometry();
  geo.setIndex(p.geometry.getIndex());
  geo.setAttribute("position", p.geometry.getAttribute("position").clone());
  geo.setAttribute("uv", p.geometry.getAttribute("uv").clone());
  for (const name of PETAL_ATTR_NAMES) {
    geo.setAttribute(
      name,
      new THREE.InstancedBufferAttribute((p.geometry.getAttribute(name).array as Float32Array).slice(), 1),
    );
  }

  let headBase = Infinity;
  for (let i = 0; i < n; i++) headBase = Math.min(headBase, matrices[i * 16 + 13]);
  if (!Number.isFinite(headBase)) headBase = 0;

  // In-head organs under a triangle budget, plus a synthetic stem that cannot
  // snap: the engine's own tube stem is 960 triangles and any budget that
  // truncates it leaves the head floating.
  type Part = { geo: THREE.BufferGeometry; tris: number; size: number };
  const rawParts: Part[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh === (p as unknown as THREE.Mesh)) return;
    const g = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone())
      .applyMatrix4(new THREE.Matrix4().multiplyMatrices(invRoot, mesh.matrixWorld));
    g.computeBoundingBox();
    if (g.boundingBox!.max.y < headBase - 0.02) return;
    const count = g.getAttribute("position").count;
    paint(g, materialColor(Array.isArray(mesh.material) ? mesh.material[0] : mesh.material));
    rawParts.push({ geo: g, tris: count / 3, size: g.boundingBox!.getSize(new THREE.Vector3()).length() });
  });
  const parts: THREE.BufferGeometry[] = [];
  let organBudget = 900;
  for (const part of rawParts.sort((x, y) => y.size - x.size)) {
    if (part.tris <= organBudget) {
      parts.push(part.geo);
      organBudget -= part.tris;
    }
  }
  const STEM_LEN = 1.15;
  const stemCol = new THREE.Color(0x2f7d34);
  const stem = paint(new THREE.CylinderGeometry(0.026, 0.04, STEM_LEN, 6).toNonIndexed(), stemCol);
  stem.applyMatrix4(new THREE.Matrix4().makeTranslation(0, headBase - STEM_LEN / 2, 0));
  parts.push(stem);
  const cap = paint(new THREE.ConeGeometry(0.1, 0.12, 6).toNonIndexed(), stemCol);
  cap.applyMatrix4(new THREE.Matrix4().makeTranslation(0, headBase + 0.02, 0));
  parts.push(cap);
  for (const [t, side] of [[0.42, 1], [0.66, -1]] as const) {
    const leaf = new THREE.PlaneGeometry(0.14, 0.5, 1, 2);
    const lp = leaf.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < lp.count; i++) if (Math.abs(lp.getY(i)) < 0.15) lp.setZ(i, 0.06);
    const painted = paint(leaf.toNonIndexed(), new THREE.Color(0x46a049));
    painted.applyMatrix4(
      new THREE.Matrix4().makeRotationZ(side * 0.9).setPosition(side * 0.16, headBase - STEM_LEN * t, 0),
    );
    parts.push(painted);
  }

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

  // The petals open in the vertex shader, so the CPU cannot read the open pose.
  // A petal only ever swings about its own base though, so base + petalRadius
  // bounds it for every bloom value and every angle — exact, not a guess.
  geo.computeBoundingSphere();
  const petalR = geo.boundingSphere?.radius ?? 0.95;
  const box = staticGeo.boundingBox!.clone();
  const v = new THREE.Vector3();
  const basis = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.set(matrices[i * 16 + 12], matrices[i * 16 + 13], matrices[i * 16 + 14]);
    // Largest scale of the instance, so a scaled-up petal is still covered.
    let scale = 0;
    for (const c of [0, 4, 8]) {
      scale = Math.max(scale, basis.set(matrices[i * 16 + c], matrices[i * 16 + c + 1], matrices[i * 16 + c + 2]).length());
    }
    const reach = petalR * scale;
    box.expandByPoint(v.clone().addScalar(reach));
    box.expandByPoint(v.clone().subScalar(reach));
  }

  return {
    config,
    petalGeo: geo,
    petalMatrices: matrices,
    petalCount: n,
    materialSrc: clonePetalMaterial(p.material as THREE.ShaderMaterial),
    staticGeo,
    staticMat: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    centre: box.getCenter(new THREE.Vector3()),
    radius: Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.001),
  };
}

// ===== scene =====

const CELL = 3.1;
const FILL = 0.40; // fitted-sphere radius as a fraction of the cell pitch
const LIFT = 0.08; // pivot raised so the stem clears the name plate

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000); // pure black behind every cell
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.domElement.id = "c3d";
document.getElementById("stage")!.appendChild(renderer.domElement);

// The camera never moves off +Z (except to zoom), which is what lets the key
// bindings be plain world-axis rotations and still read as screen-relative.
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
let gridCols = 8;
let gridRows = 5;
let pitchX = CELL;
let pitchY = CELL;
let baseDist = 30; // set by relayout(); the sheet exactly fills the viewport
let zoom = 1;
let zen = false; // Esc: no panels, sheet spread edge to edge

const camDistance = () => baseDist * zoom;

scene.add(new THREE.HemisphereLight(0xdCE9ff, 0x2a3550, 1.5));
const key = new THREE.DirectionalLight(0xffffff, 1.5);
key.position.set(6, 12, 10);
scene.add(key);
const rim = new THREE.DirectionalLight(0x8fb6ff, 0.7);
rim.position.set(-8, 4, -9);
scene.add(rim);

// Everything the keys rotate lives under this one group.
const caseGroup = new THREE.Group();
scene.add(caseGroup);

const clock = new THREE.Clock();
const bakes: Bake[] = [];
type Cell = {
  mat: THREE.ShaderMaterial;
  pivot: THREE.Group;
  label: THREE.Sprite;
  cell: THREE.Group;
  col: number;
  row: number;
  delay: number;
  radius: number;
  reach: number; // recomputed by relayout()
  id: string;
};

// A very light hairline, the only thing separating one cell from the next.
const lattice = new THREE.LineSegments(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: 0xd6dae2, transparent: true, opacity: 0.28 }),
);
const cells: Cell[] = [];

function labelSprite(name: string, latin: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(10,16,26,0.72)";
  ctx.fillRect(0, 0, 512, 128);
  ctx.textAlign = "center";
  ctx.fillStyle = "#f4f7ff";
  // Shrink to fit rather than clip: several names are long.
  let size = 56;
  do {
    size -= 2;
    ctx.font = `bold ${size}px system-ui, -apple-system, sans-serif`;
  } while (ctx.measureText(name).width > 486 && size > 22);
  ctx.fillText(name, 256, 58);
  ctx.fillStyle = "#8fb6ff";
  ctx.font = "30px system-ui, -apple-system, sans-serif";
  ctx.fillText(latin, 256, 104);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  // A sprite always faces the camera, so the label stays readable through every
  // one of the 90° views without any per-frame billboard maths.
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(1.45, 0.3625, 1);
  return sprite;
}

function buildCase() {
  // Bias toward a wide sheet: a square grid on a 16:9 window wastes the sides
  // and pushes the bottom row under the key legend.
  const cols = Math.ceil(Math.sqrt(bakes.length * 1.6));
  const rows = Math.ceil(bakes.length / cols);

  // The cells are a contact sheet facing the viewer; only the flower inside
  // each one turns. A tilted ground grid would hide most of the flowers behind
  // their own plates, and half the 90° views would be edge-on and empty.
  // There is no per-cell backing: the scene is already black, and one shared
  // lattice draws a single hairline between neighbours instead of two abutting
  // borders with a seam between them.

  bakes.forEach((bake, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cell = new THREE.Group();

    const mat = clonePetalMaterial(bake.materialSrc);
    mat.uniforms.uWindSpeed.value = WIND_SPEED;
    mat.uniforms.uWindAmp.value = WIND_AMP;
    mat.uniforms.uBloom.value = 0; // the case starts closed; Space opens it
    const petals = new THREE.InstancedMesh(bake.petalGeo, mat, bake.petalCount);
    const m = new THREE.Matrix4();
    for (let j = 0; j < bake.petalCount; j++) {
      m.fromArray(bake.petalMatrices, j * 16);
      petals.setMatrixAt(j, m);
    }
    petals.frustumCulled = false; // the engine's bounds ignore the bloom expansion

    // pivot turns, inner centres the flower on that pivot. Scaling by the
    // bounding sphere means no rotation can push it into a neighbouring cell.
    const inner = new THREE.Group();
    inner.add(petals, new THREE.Mesh(bake.staticGeo, bake.staticMat));
    inner.position.copy(bake.centre).negate();
    const pivot = new THREE.Group();
    pivot.add(inner);
    cell.add(pivot);

    const label = labelSprite(bake.config.name, bake.config.id);
    cell.add(label);

    caseGroup.add(cell);
    // A slight stagger makes the shared bloom read as a wave, not a switch.
    cells.push({ mat, pivot, label, col, row, delay: (col + row) * 0.045, radius: bake.radius, cell, reach: 0, id: bake.config.id });
  });

  gridCols = cols;
  gridRows = rows;
  caseGroup.add(lattice);
  relayout();
}

// The cell pitch is derived from the viewport, not fixed, so the sheet always
// matches the window's aspect exactly. That is what lets zen mode cover the
// screen with no band left over on any edge.
function relayout() {
  const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
  // In normal mode the sheet deliberately stops short, and the heading and key
  // legend live in the space left over.
  const marginH = zen ? 1 : 0.8;
  const marginW = zen ? 1 : 0.95;
  const visibleH = (gridRows * CELL) / marginH;
  baseDist = visibleH / 2 / Math.tan(vHalf);
  const visibleW = visibleH * (camera.aspect || 1);
  pitchY = CELL;
  pitchX = (visibleW * marginW) / gridCols;

  const originX = -((gridCols - 1) * pitchX) / 2;
  const originY = ((gridRows - 1) * pitchY) / 2; // first row on top, reading order
  // A flower is scaled by the smaller pitch, so a wide window makes roomy cells
  // rather than stretched flowers.
  const fit = Math.min(pitchX, pitchY);
  for (const c of cells) {
    c.cell.position.set(originX + c.col * pitchX, originY - c.row * pitchY, 0);
    c.pivot.scale.setScalar((fit * FILL) / c.radius);
    c.pivot.position.y = pitchY * LIFT;
    c.label.position.set(0, -pitchY * 0.40, 0.02);
    c.label.scale.set(fit * 0.47, fit * 0.1175, 1);
    c.reach = pitchY * LIFT + c.radius * c.pivot.scale.x;
  }

  // One shared lattice: cols+1 verticals and rows+1 horizontals, so between any
  // two cells there is exactly one line.
  const w = gridCols * pitchX;
  const h = gridRows * pitchY;
  const pts: number[] = [];
  for (let i = 0; i <= gridCols; i++) {
    const x = -w / 2 + i * pitchX;
    pts.push(x, -h / 2, 0, x, h / 2, 0);
  }
  for (let j = 0; j <= gridRows; j++) {
    const y = -h / 2 + j * pitchY;
    pts.push(-w / 2, y, 0, w / 2, y, 0);
  }
  lattice.geometry.dispose();
  lattice.geometry = new THREE.BufferGeometry().setAttribute(
    "position",
    new THREE.Float32BufferAttribute(pts, 3),
  );
}

// ===== 90° view snapping =====

const HALF_PI = Math.PI / 2;
// Home is the flowers standing upright, facing the viewer.
const HOME_QUAT = new THREE.Quaternion();
const targetQuat = new THREE.Quaternion();
// One shared orientation, copied to every cell: all 39 flowers turn together.
const liveQuat = new THREE.Quaternion();
const stepQuat = new THREE.Quaternion();
const AXIS = {
  yaw: new THREE.Vector3(0, 1, 0),
  pitch: new THREE.Vector3(1, 0, 0),
  roll: new THREE.Vector3(0, 0, 1),
};
let steps = { yaw: 0, pitch: 0, roll: 0 };

let freeform = false; // true once a drag leaves the 90° lattice

function turn(axis: keyof typeof AXIS, dir: 1 | -1) {
  // Pre-multiplying keeps every turn relative to the screen, not to whatever
  // orientation the flowers have accumulated — so a key always turns 90° from
  // what you are looking at, including after a free drag.
  stepQuat.setFromAxisAngle(AXIS[axis], dir * HALF_PI);
  targetQuat.premultiply(stepQuat);
  // Once a drag has left the lattice the step counters are meaningless; stop
  // pretending to track them until R puts the case back home.
  if (!freeform) steps[axis] = (steps[axis] + dir + 4) % 4;
  hud();
}

// Free rotation: drag by any angle about the same two screen axes.
function spin(dx: number, dy: number) {
  stepQuat.setFromAxisAngle(AXIS.yaw, dx * 0.0085);
  targetQuat.premultiply(stepQuat);
  stepQuat.setFromAxisAngle(AXIS.pitch, dy * 0.0085);
  targetQuat.premultiply(stepQuat);
  // 1:1 with the pointer — a slerp here would feel like drag on the mouse.
  liveQuat.copy(targetQuat);
  if (!freeform) {
    freeform = true;
    hud();
  }
}

function setZen(on: boolean) {
  zen = on;
  document.body.classList.toggle("zen", zen);
  if (cells.length) relayout(); // the sheet grows to the screen edges
}

// ===== shared bloom =====

let open = false;
let bloomT0 = -99;

function toggleBloom() {
  open = !open;
  bloomT0 = clock.elapsedTime;
  hud();
}

function hud() {
  const el = document.getElementById("state");
  if (!el) return;
  el.innerHTML =
    `<b>${bakes.length}</b> 种花 · ${open ? "🌸 已盛开" : "🌱 已合拢"}` +
    (freeform
      ? " · 视角 <b>自由</b>"
      : ` · 视角 <b>${steps.yaw * 90}°</b>／<b>${steps.pitch * 90}°</b>／<b>${steps.roll * 90}°</b>`);
}

// ===== input =====

function bindInput() {
  window.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    switch (e.code) {
      case "ArrowLeft": case "KeyA": turn("yaw", -1); break;
      case "ArrowRight": case "KeyD": turn("yaw", 1); break;
      case "ArrowUp": case "KeyW": turn("pitch", -1); break;
      case "ArrowDown": case "KeyS": turn("pitch", 1); break;
      case "KeyQ": turn("roll", -1); break;
      case "KeyE": turn("roll", 1); break;
      case "Space": toggleBloom(); break;
      case "KeyR":
        targetQuat.copy(HOME_QUAT);
        steps = { yaw: 0, pitch: 0, roll: 0 };
        freeform = false;
        zoom = 1;
        hud();
        break;
      case "Escape":
        setZen(!zen);
        break;
      default: return;
    }
    e.preventDefault(); // Space would otherwise scroll the page
  });

  // Drag to rotate by any angle; a press that never moves still snaps 90°, so
  // the old click-to-turn stays available.
  const canvas = renderer.domElement;
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  let drag: { id: number; button: number; x: number; y: number; travel: number } | null = null;
  canvas.addEventListener("pointerdown", (e) => {
    drag = { id: e.pointerId, button: e.button, x: e.clientX, y: e.clientY, travel: 0 };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.travel += Math.abs(dx) + Math.abs(dy);
    if (drag.travel > 3) spin(dx, dy);
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.travel <= 3) turn("yaw", drag.button === 2 ? 1 : -1); // a click, not a drag
    drag = null;
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoom = THREE.MathUtils.clamp(zoom * (1 + Math.sign(e.deltaY) * 0.09), 0.3, 3);
    },
    { passive: false },
  );

  for (const [id, fn] of [
    ["bLeft", () => turn("yaw", -1)],
    ["bRight", () => turn("yaw", 1)],
    ["bUp", () => turn("pitch", -1)],
    ["bDown", () => turn("pitch", 1)],
    ["bRollL", () => turn("roll", -1)],
    ["bRollR", () => turn("roll", 1)],
    ["bBloom", () => toggleBloom()],
  ] as const) {
    document.getElementById(id)?.addEventListener("click", fn as () => void);
  }
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h || 1;
  camera.updateProjectionMatrix();
  if (cells.length) relayout();
}
window.addEventListener("resize", resize);

const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);

function startLoop() {
  renderer.setAnimationLoop(() => {
    clock.getDelta(); // getElapsedTime() consumes the delta; take it first
    const t = clock.elapsedTime;
    liveQuat.slerp(targetQuat, 0.16);
    camera.position.set(0, 0, camDistance());
    camera.lookAt(0, 0, 0);
    for (const cell of cells) {
      cell.pivot.quaternion.copy(liveQuat);
      cell.mat.uniforms.uTime.value = t;
      const target = open ? (cell.mat.userData.bloomTarget as number) : 0;
      const from = open ? 0 : (cell.mat.userData.bloomTarget as number);
      const k = THREE.MathUtils.clamp((t - bloomT0 - cell.delay) / 1.5, 0, 1);
      cell.mat.uniforms.uBloom.value = THREE.MathUtils.lerp(from, target, easeOutCubic(k));
    }
    renderer.render(scene, camera);
  });
}

// ===== boot =====

(async () => {
  const bootLabel = document.getElementById("boot-label");
  const pot = document.createElement("div");
  pot.style.cssText = "position:fixed;left:-9999px;top:0;width:360px;height:360px";
  document.body.appendChild(pot);
  const engine = createFlowerScene(pot, null, null, { petalSegments: { x: 8, y: 18 } });

  for (let i = 0; i < SPECIES.length; i++) {
    const spec = SPECIES[i];
    const config = byId.get(spec.id)!;
    if (bootLabel) bootLabel.textContent = `正在培育 ${i + 1}/${SPECIES.length} · ${config.name}`;
    // Yield so the boot text paints; without it the whole bake is one long task.
    await new Promise((r) => setTimeout(r, 0));
    const trimmed: FlowerConfig = { ...config, params: { ...config.params } };
    if ((trimmed.params.numPetals as number) > spec.petals) trimmed.params.numPetals = spec.petals;
    engine.setPalette(trimmed.palette as unknown as [number, number, number][]);
    engine.setAnatomy(trimmed.anatomy);
    engine.setCameraView([0, 4.6, 3.4]); // one view for all: otherwise some lie on their side
    engine.applyPreset(trimmed.params);
    engine.setEditPose();
    bakes.push(bakeSpecies(engine, config));
  }
  engine.dispose();
  pot.remove();

  buildCase();
  bindInput();
  resize();
  hud();
  startLoop();
  document.getElementById("boot")?.classList.add("off");

  (window as unknown as Record<string, unknown>).__grid = {
    ready: true,
    species: bakes.length,
    steps: () => ({ ...steps }),
    turn,
    spin,
    isFreeform: () => freeform,
    zen: () => zen,
    setZen,
    camDistance,
    grid: () => ({ cols: gridCols, rows: gridRows, pitchX, pitchY }),
    ids: () => cells.map((c) => c.id),
    // Fraction of the viewport the sheet spans, per axis. 1 means edge to edge.
    coverage: () => {
      const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
      const visibleH = 2 * Math.tan(vHalf) * camDistance();
      return { w: (gridCols * pitchX) / (visibleH * camera.aspect), h: (gridRows * pitchY) / visibleH };
    },
    isOpen: () => open,
    toggleBloom,
    bloom: () => cells.map((c) => c.mat.uniforms.uBloom.value as number),
    quat: () => liveQuat.toArray(),
    targetQuat: () => targetQuat.toArray(),
    windAmp: () => cells[0].mat.uniforms.uWindAmp.value as number,
    // Worst flower reach as a fraction of the cell half-pitch: > 1 means it can
    // cross into a neighbouring cell at some orientation.
    cellFit: () => {
      let worst = 0;
      let worstId = "";
      for (const c of cells) {
        const ratio = c.reach / (Math.min(pitchX, pitchY) * 0.5);
        if (ratio > worst) {
          worst = ratio;
          worstId = c.id;
        }
      }
      return { worst, worstId };
    },
    info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
  };
})();
