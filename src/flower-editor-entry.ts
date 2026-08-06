// 鲜花编辑器 — a Warcraft-map-editor-style flower placement tool.
//
// Pick a terrain (lawn / tundra / desert), pick a flower from the left panel,
// and a translucent ghost follows the cursor over the ground; click to plant,
// which plays a sprout-and-bloom animation. Sliders drive size, wind, and a
// hue rotation of the five-stop palette — live on the ghost, on the next
// planting, and on any already-planted flower you select.
//
// Flowers come from the real engine via the proven snapshot pipeline. Each
// plant owns ONE cloned petal material (uBloom / wind / palette are per-plant
// uniforms); geometry is shared per species, so a hundred plants stay cheap.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { createFlowerScene } from "../../Studio/components/flower/flowerScene";
import { PRESET_FLOWERS } from "../../Studio/components/flower/presets";
import type { FlowerConfig } from "../../Studio/components/flower/flowerConfig";

declare const __FLOWERS__: FlowerConfig[];
const STYLE_FRAG_SOURCE = `
precision highp float;
uniform sampler2D tDiffuse, tDepth;
uniform vec2 uResolution; uniform float uTime, uCamNear, uCamFar;
uniform vec3 uOutlineColor, uEdgeBg; uniform float uOutlineStrength, uOutlineWidth;
uniform float uSaturation, uGrain, uBrightness, uContrast, uWarmth, uVignette;
uniform float uHalftone, uHalftoneScale, uDuotone, uPosterize, uComic;
uniform vec3 uDuotoneDark, uDuotoneLight;
uniform float uHueShift, uPixelate, uScanline, uChroma, uBoil, uZoomBlur;
uniform float uEdgeOnly, uDither, uSubpixel, uCross;
uniform float uAnimSpeed, uWave;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float screenDot(vec2 uv, float scale, float angle, float radius){
  float c=cos(angle), s=sin(angle); mat2 rot=mat2(c,-s,s,c);
  vec2 p=rot*(uv*uResolution/max(scale,1.0)); vec2 cell=fract(p)-0.5;
  return 1.0 - smoothstep(radius, radius+0.075, length(cell)); }
float linDepth(vec2 uv){
  float z = texture2D(tDepth, uv).x;
  float nz = z * 2.0 - 1.0;
  return (2.0 * uCamNear * uCamFar) / (uCamFar + uCamNear - nz * (uCamFar - uCamNear)); }
void main(){
  vec2 vUv = gl_FragCoord.xy / uResolution;
  vec2 uv = vUv;
  float t = uTime * uAnimSpeed;   // every time-driven effect runs off this
  if (uBoil > 0.0001){            // hand-drawn boil: whole frame jitters on an 8fps step
    float bt = floor(t * 8.0);
    uv += (vec2(vnoise(uv * 40.0 + bt), vnoise(uv * 40.0 + bt + 7.3)) - 0.5) * uBoil;
  }
  if (uWave > 0.0001){            // rolling wavy distortion
    uv.x += sin(uv.y * 28.0 + t * 1.4) * uWave;
    uv.y += cos(uv.x * 22.0 + t * 1.1) * uWave * 0.6;
  }
  if (uPixelate > 0.5){ vec2 cells = uResolution/uPixelate; uv = (floor(uv*cells)+0.5)/cells; }
  vec3 col = texture2D(tDiffuse, uv).rgb;
  if (uZoomBlur > 0.001){   // radial zoom blur toward center
    vec2 dir = (vec2(0.5) - uv) * uZoomBlur;
    vec3 acc = col;
    for (int i = 1; i < 8; i++) acc += texture2D(tDiffuse, uv + dir * float(i) / 8.0).rgb;
    col = acc / 8.0;
  }
  if (uChroma > 0.01){ vec2 off=(uv-0.5)*uChroma/uResolution*2.0;
    col.r = texture2D(tDiffuse, uv+off).r; col.b = texture2D(tDiffuse, uv-off).b; }
  // depth + luma sobel outline
  vec2 px = uOutlineWidth / uResolution;
  float dC = linDepth(uv);
  float dX = abs(linDepth(uv+vec2(px.x,0.0)) - dC) + abs(linDepth(uv-vec2(px.x,0.0)) - dC);
  float dY = abs(linDepth(uv+vec2(0.0,px.y)) - dC) + abs(linDepth(uv-vec2(0.0,px.y)) - dC);
  float depthEdge = smoothstep(0.35, 1.6, (dX+dY) * 18.0 / max(dC, 3.0));
  float lC = dot(texture2D(tDiffuse, uv).rgb, vec3(0.299,0.587,0.114));
  float lX = dot(texture2D(tDiffuse, uv+vec2(px.x,0.0)).rgb, vec3(0.299,0.587,0.114)) - lC;
  float lY = dot(texture2D(tDiffuse, uv+vec2(0.0,px.y)).rgb, vec3(0.299,0.587,0.114)) - lC;
  float lumaEdge = smoothstep(0.10, 0.34, sqrt(lX*lX + lY*lY) * 2.4);
  float edge = max(depthEdge, lumaEdge) * uOutlineStrength;
  col = mix(col, uOutlineColor, clamp(edge, 0.0, 1.0));
  if (uEdgeOnly > 0.001){   // line-art mode: replace the world with paper + drawn edges
    vec3 wire = mix(uEdgeBg, uOutlineColor * 1.25, clamp(edge * 1.5, 0.0, 1.0));
    col = mix(col, wire, uEdgeOnly);
  }
  float l = dot(col, vec3(0.299,0.587,0.114));
  col = mix(vec3(l), col, uSaturation);
  col = (col - 0.5) * uContrast + 0.5;
  col += vec3(0.09, 0.035, -0.08) * uWarmth;
  if (abs(uHueShift) > 0.001){
    mat3 toYIQ = mat3(vec3(0.299,0.596,0.211), vec3(0.587,-0.274,-0.523), vec3(0.114,-0.322,0.312));
    mat3 toRGB = mat3(vec3(1.0,1.0,1.0), vec3(0.956,-0.272,-1.106), vec3(0.621,-0.647,1.703));
    vec3 yiq = toYIQ * col; float hc=cos(uHueShift), hs=sin(uHueShift);
    col = clamp(toRGB * vec3(yiq.x, yiq.y*hc - yiq.z*hs, yiq.y*hs + yiq.z*hc), 0.0, 1.0);
  }
  float printLuma = clamp(dot(col, vec3(0.299,0.587,0.114)), 0.0, 1.0);
  if (uPosterize > 1.5){
    if (uComic > 0.01){
      col = floor(clamp(col,0.0,1.0)*(uPosterize-1.0)+0.5)/(uPosterize-1.0);
      col = mix(col, smoothstep(vec3(0.04), vec3(0.96), col), 0.35);
    } else {
      printLuma = floor(printLuma*(uPosterize-1.0)+0.5)/(uPosterize-1.0);
    }
  }
  col = mix(col, mix(uDuotoneDark, uDuotoneLight, printLuma), uDuotone);
  float g1 = vnoise(uv*uResolution*0.5), g2 = vnoise(uv*uResolution*0.12);
  float paper = g1*0.55 + g2*0.45;
  col *= 1.0 - uGrain + uGrain*2.0*paper;
  float mm = paper - 0.5; col.r *= 1.0 + mm*0.05; col.b *= 1.0 - mm*0.05;
  // american-comic CMYK plate dots
  float comicShade = clamp(1.0 - dot(col, vec3(0.299,0.587,0.114)), 0.0, 1.0);
  float comicLuma = 1.0 - comicShade;
  float plateMask = smoothstep(0.16,0.42,comicLuma) * (1.0 - smoothstep(0.88,1.0,comicLuma));
  float comicR = mix(0.035, 0.23, comicShade);
  float rp = screenDot(uv+vec2(0.0025,-0.0015), uHalftoneScale*1.25, 0.18, comicR);
  float bp = screenDot(uv+vec2(-0.002,0.002), uHalftoneScale*1.45, -0.35, comicR*0.86);
  float yp = screenDot(uv+vec2(0.001,0.0025), uHalftoneScale*1.08, 0.7, comicR*0.72);
  vec3 plate = vec3(1.0,0.18,0.08)*rp*0.12 + vec3(0.06,0.24,0.95)*bp*0.075 + vec3(1.0,0.76,0.06)*yp*0.07;
  vec3 shadowP = vec3(rp*0.022, (rp+bp)*0.014, bp*0.022);
  col = mix(col, clamp(col + (plate - shadowP)*plateMask, 0.0, 1.0), uComic);
  // monochrome halftone ink dots
  vec2 cell = fract(uv*uResolution/max(uHalftoneScale,1.0)) - 0.5;
  float shade = clamp(1.0 - dot(col, vec3(0.299,0.587,0.114)), 0.0, 1.0);
  float radius = mix(0.05, 0.46, shade);
  float ink = 1.0 - smoothstep(radius, radius+0.08, length(cell));
  col *= 1.0 - ink*uHalftone*0.58;
  // 45° cross-hatch engraving by darkness
  if (uCross > 0.001){
    float lum = dot(col, vec3(0.299,0.587,0.114));
    vec2 pc = uv * uResolution;
    float l1 = step(0.5, fract((pc.x + pc.y) / 7.0));
    float l2 = step(0.5, fract((pc.x - pc.y) / 7.0));
    float hatch = (lum < 0.72 ? l1 : 1.0) * (lum < 0.45 ? l2 : 1.0) * (lum < 0.2 ? step(0.5, fract(pc.x / 6.0)) : 1.0);
    col = mix(col, col * hatch, uCross);
  }
  if (uScanline > 0.01){ float sl = sin(uv.y*uResolution.y*3.14159)*0.5+0.5; col *= 1.0 - uScanline*0.35*sl; }
  if (uSubpixel > 0.001){   // CRT RGB sub-pixel mask
    float px3 = mod(floor(vUv.x * uResolution.x), 3.0);
    vec3 mask = px3 < 1.0 ? vec3(1.0,0.35,0.35) : px3 < 2.0 ? vec3(0.35,1.0,0.35) : vec3(0.35,0.35,1.0);
    col = mix(col, col * mask * 1.55, uSubpixel);
  }
  if (uDither > 0.001){     // Bayer 4x4 ordered dither → 1-bit print
    vec2 bp2 = mod(floor(vUv * uResolution / max(uPixelate, 1.0)), 4.0);
    float idx = bp2.x + bp2.y * 4.0;
    float th = 0.0;
    if (idx < 1.) th=0.; else if (idx<2.) th=8.; else if (idx<3.) th=2.; else if (idx<4.) th=10.;
    else if (idx<5.) th=12.; else if (idx<6.) th=4.; else if (idx<7.) th=14.; else if (idx<8.) th=6.;
    else if (idx<9.) th=3.; else if (idx<10.) th=11.; else if (idx<11.) th=1.; else if (idx<12.) th=9.;
    else if (idx<13.) th=15.; else if (idx<14.) th=7.; else if (idx<15.) th=13.; else th=5.;
    float lum = dot(col, vec3(0.299,0.587,0.114));
    float bit = step((th + 0.5) / 16.0, lum);
    col = mix(col, mix(uDuotoneDark, uDuotoneLight, bit), uDither);
  }
  float vig = smoothstep(0.26, 0.72, length(uv-0.5));
  col *= 1.0 - vig*uVignette;
  col *= uBrightness;
  gl_FragColor = vec4(col, 1.0);
}`;

declare const __MP_SIMD_LOADER__: string;
declare const __MP_SIMD_WASM_B64__: string;
declare const __MP_TASK_B64__: string;
// DefinePlugin substitutes at EVERY occurrence, so each mention of these
// placeholders would inline another full copy of the payload (14 MB for the
// wasm alone). Capture each exactly once.
const MP_LOADER = __MP_SIMD_LOADER__;
const MP_WASM = __MP_SIMD_WASM_B64__;
const MP_TASK = __MP_TASK_B64__;
const HAS_AR = MP_WASM.length > 0;

const byId = new Map(__FLOWERS__.map((f) => [f.id, f]));
for (const preset of PRESET_FLOWERS) if (!byId.has(preset.id)) byId.set(preset.id, preset);

// Every flower is plantable: the three presets first, then the whole library.
const SPECIES: { id: string; petals: number }[] = [
  ...PRESET_FLOWERS.map((f) => ({ id: f.id, petals: 24 })),
  ...__FLOWERS__.map((f) => ({ id: f.id, petals: 22 })),
];

// ===== engine snapshot (the pipeline proven by the garden and world pages) =====

function clonePetalMaterial(src: THREE.ShaderMaterial, ghost = false) {
  const ramp = src.uniforms.uRamps.value as THREE.DataTexture;
  const image = ramp.image as { data: Uint16Array; width: number };
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
    transparent: ghost,
    opacity: 1,
    depthWrite: !ghost,
  });
  mat.userData.bloomTarget = Math.min(1, (uniforms.uBloom.value as number) + 0.14);
  if (ghost) {
    // The petal shader has no opacity uniform; patch its output alpha once.
    mat.fragmentShader = mat.fragmentShader.replace(
      /gl_FragColor\s*=\s*vec4\(([^;]+),\s*1\.0\s*\);/,
      "gl_FragColor = vec4($1, 0.45);",
    );
    mat.needsUpdate = true;
  }
  return mat;
}

const isPetalShader = (m: THREE.Material) =>
  (m as THREE.ShaderMaterial).isShaderMaterial === true &&
  Boolean((m as THREE.ShaderMaterial).uniforms?.uRamps);

function materialColor(m: THREE.Material): THREE.Color {
  const withColor = m as THREE.MeshBasicMaterial;
  if (withColor.color?.isColor) return withColor.color;
  const shader = m as THREE.ShaderMaterial;
  const u = shader.uniforms?.uColor?.value as THREE.Color | undefined;
  return u?.isColor ? u : new THREE.Color(0x2f7d34);
}

type Bake = {
  config: FlowerConfig;
  petalGeo: THREE.BufferGeometry; // shared, with per-petal instanced attrs
  petalMatrices: Float32Array;
  petalCount: number;
  materialSrc: THREE.ShaderMaterial; // template for per-plant clones
  baseCols: THREE.Color[];
  staticGeo: THREE.BufferGeometry;
  staticMat: THREE.MeshLambertMaterial;
  minY: number;
  height: number;
  thumb?: string; // dataURL, rendered at boot
};

const PETAL_ATTR_NAMES = [
  "aU", "aSeed", "aTilt", "aLengthScale", "aWidthScale",
  "aCupScale", "aWaveScale", "aColorBias", "aBudTwist",
];

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

  const v = new THREE.Vector3();
  let headBase = Infinity;
  for (let i = 0; i < n; i++) headBase = Math.min(headBase, matrices[i * 16 + 13]);
  if (!Number.isFinite(headBase)) headBase = 0;

  // In-head organs under a budget, plus the guaranteed-connected synthetic stem.
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
    const color = materialColor(Array.isArray(mesh.material) ? mesh.material[0] : mesh.material);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    for (const name of Object.keys(g.attributes)) {
      if (name !== "position" && name !== "color") g.deleteAttribute(name);
    }
    rawParts.push({ geo: g, tris: count / 3, size: g.boundingBox!.getSize(new THREE.Vector3()).length() });
  });
  const parts: THREE.BufferGeometry[] = [];
  let organBudget = 900; // editor plants are few and seen close-up
  for (const part of rawParts.sort((x, y) => y.size - x.size)) {
    if (part.tris <= organBudget) {
      parts.push(part.geo);
      organBudget -= part.tris;
    }
  }
  const paint = (g: THREE.BufferGeometry, color: THREE.Color) => {
    const count = g.getAttribute("position").count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    for (const name of Object.keys(g.attributes)) {
      if (name !== "position" && name !== "color") g.deleteAttribute(name);
    }
    return g;
  };
  const STEM_LEN = 1.15;
  const stemCol = new THREE.Color(0x2f7d34);
  const leafCol = new THREE.Color(0x46a049);
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
    const painted = paint(leaf.toNonIndexed(), leafCol);
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

  const box = staticGeo.boundingBox!.clone();
  const petalLen = (config.params.petalLen as number) ?? 0.95;
  for (let i = 0; i < n; i++) {
    v.set(matrices[i * 16 + 12], matrices[i * 16 + 13], matrices[i * 16 + 14]);
    box.expandByPoint(v);
  }
  box.expandByScalar(petalLen * 0.8);

  const materialSrc = clonePetalMaterial(p.material as THREE.ShaderMaterial);
  const baseCols = [0, 1, 2, 3, 4].map((i) =>
    (materialSrc.uniforms[`uCol${i}`].value as THREE.Vector3).clone(),
  ).map((vec) => new THREE.Color(vec.x, vec.y, vec.z));

  return {
    config,
    petalGeo: geo,
    petalMatrices: matrices,
    petalCount: n,
    materialSrc,
    baseCols,
    staticGeo,
    staticMat: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    minY: box.min.y,
    height: Math.max(box.max.y - box.min.y, 0.001),
  };
}

// ===== scene =====

const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const stage = document.getElementById("stage")!;
renderer.domElement.id = "c3d"; // the AR overlay is also a canvas in #stage
stage.appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 300);
camera.position.set(5.2, 4.4, 6.8);

const controls = new OrbitControls(camera, renderer.domElement);
// Map-editor mouse scheme: LEFT is reserved for planting/selection and never
// moves the camera; RIGHT drags to rotate; MIDDLE drags to pan; wheel zooms.
controls.mouseButtons = {
  LEFT: null as unknown as THREE.MOUSE,
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT: THREE.MOUSE.ROTATE,
};
renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
controls.target.set(0, 0.8, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 2.5;
controls.maxDistance = 60;

const hemi = new THREE.HemisphereLight(0xe8f4ff, 0x5a7a44, 1.3);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1d6, 1.5);
sun.position.set(-30, 45, -22);
scene.add(sun);

// Sky dome, recoloured per environment.
const skyGeo = new THREE.SphereGeometry(140, 24, 12);
skyGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(skyGeo.getAttribute("position").count * 3), 3));
const sky = new THREE.Mesh(
  skyGeo,
  new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }),
);
scene.add(sky);

type Env = {
  key: string;
  label: string;
  groundHue: (x: number, z: number, d: number) => THREE.Color;
  bump: number;
  skyTop: number;
  skyHorizon: number;
  fog: number;
  hemiSky: number;
  hemiGround: number;
  sunColor: number;
};
const ENVS: Env[] = [
  {
    key: "lawn", label: "🌿 草坪",
    groundHue: (x, z) => new THREE.Color().setHSL(0.27 + Math.sin(x * 0.3 + z * 0.21) * 0.018, 0.42, 0.37 + Math.sin(x * 0.8 + z * 0.6) * 0.025),
    bump: 0.35, skyTop: 0x6ab8e8, skyHorizon: 0xffdbe4, fog: 0xf0dce6,
    hemiSky: 0xe8f4ff, hemiGround: 0x5a7a44, sunColor: 0xfff1d6,
  },
  {
    key: "tundra", label: "❄️ 冰原",
    groundHue: (x, z) => new THREE.Color().setHSL(0.56 + Math.sin(x * 0.4 + z * 0.3) * 0.01, 0.16, 0.82 + Math.sin(x * 0.9 + z * 0.7) * 0.05),
    bump: 0.5, skyTop: 0x9fc8e8, skyHorizon: 0xe8f2fa, fog: 0xdcebf5,
    hemiSky: 0xeaf4ff, hemiGround: 0xb8ccd8, sunColor: 0xdceaff,
  },
  {
    key: "desert", label: "🏜 沙漠",
    groundHue: (x, z) => new THREE.Color().setHSL(0.09 + Math.sin(x * 0.25 + z * 0.2) * 0.012, 0.5, 0.6 + Math.sin(x * 0.7 + z * 0.5) * 0.045),
    bump: 0.8, skyTop: 0x8fc4e4, skyHorizon: 0xffe3b8, fog: 0xf3e0c2,
    hemiSky: 0xfff4e0, hemiGround: 0xb08a55, sunColor: 0xffe8c0,
  },
];

const GROUND_SIZE = 90;
const grounds: THREE.Mesh[] = [];
const propGroups: THREE.Group[] = [];
const flat = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true });

for (const env of ENVS) {
  const geo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, 56, 56);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, (Math.sin(x * 0.35) * Math.cos(z * 0.3) + Math.sin(x * 0.13 + z * 0.17) * 0.6) * env.bump * 0.4);
    env.groundHue(x, z, Math.hypot(x, z)).toArray(colors, i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.visible = false;
  scene.add(mesh);
  grounds.push(mesh);

  const props = new THREE.Group();
  props.visible = false;
  let s = 17 + grounds.length;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 26 + rnd() * 16;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (env.key === "lawn") {
      const g = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 2.2, 6), flat(0x6b4a2f));
      trunk.position.y = 1.1;
      g.add(trunk);
      for (let b = 0; b < 3; b++) {
        const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3 - b * 0.25, 0), flat([0x3f8f42, 0x4fa350, 0x357a38][b]));
        blob.position.set(Math.sin(b * 2.3) * 0.4, 2.3 + b * 0.8, Math.cos(b * 2.3) * 0.4);
        g.add(blob);
      }
      g.position.set(x, 0, z);
      props.add(g);
    } else if (env.key === "tundra") {
      const ice = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6 + rnd() * 1.1, 0), flat(0xcfe0ec));
      ice.position.set(x, 0.35, z);
      ice.rotation.set(x, z, x + z);
      ice.scale.y = 1.4 + rnd();
      props.add(ice);
    } else {
      const g = new THREE.Group();
      const column = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 1.8 + rnd() * 1.4, 7), flat(0x4f8a4a));
      column.position.y = column.geometry.parameters.height / 2;
      g.add(column);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.9, 6), flat(0x4f8a4a));
      arm.position.set(0.42, column.geometry.parameters.height * 0.55, 0);
      arm.rotation.z = -0.5;
      g.add(arm);
      g.position.set(x, 0, z);
      g.rotation.y = rnd() * Math.PI * 2;
      props.add(g);
    }
  }
  scene.add(props);
  propGroups.push(props);
}

// Ground cover: one instanced tuft field per environment, so bare noise-coloured
// terrain reads as a real surface. Same trick as the world page's micro-flowers.
const coverGroups: THREE.InstancedMesh[] = [];
for (let envIndex = 0; envIndex < ENVS.length; envIndex++) {
  const env = ENVS[envIndex];
  const blade = new THREE.BufferGeometry();
  const verts: number[] = [];
  const spokes = env.key === "tundra" ? 3 : env.key === "desert" ? 4 : 5;
  for (let k = 0; k < spokes; k++) {
    const a = (k / spokes) * Math.PI * 2;
    const lean = env.key === "lawn" ? 0.55 : 0.3;
    verts.push(0, 0, 0, Math.cos(a) * 0.16, 0.03, Math.sin(a) * 0.16, Math.cos(a) * lean * 0.4, 0.42, Math.sin(a) * lean * 0.4);
  }
  blade.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  blade.computeVertexNormals();
  const tint =
    env.key === "lawn" ? 0x54a04a : env.key === "tundra" ? 0xeef6fb : 0xbf9a5e;
  const inst = new THREE.InstancedMesh(
    blade,
    new THREE.MeshLambertMaterial({ color: tint, side: THREE.DoubleSide, flatShading: true }),
    1800,
  );
  let seed = 991 + envIndex * 37;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 1800; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * (GROUND_SIZE / 2 - 3);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const s = (env.key === "desert" ? 0.5 : 0.75) * (0.6 + rnd() * 0.9);
    // The terrain is displaced by the same formula the ground mesh uses, so the
    // tufts can be placed without a raycast per blade.
    const y = (Math.sin(x * 0.35) * Math.cos(z * 0.3) + Math.sin(x * 0.13 + z * 0.17) * 0.6) * env.bump * 0.4;
    m.compose(
      new THREE.Vector3(x, y, z),
      q.setFromAxisAngle(up, rnd() * Math.PI * 2),
      new THREE.Vector3(s, s * (0.7 + rnd() * 0.7), s),
    );
    inst.setMatrixAt(i, m);
  }
  inst.visible = false;
  inst.frustumCulled = false;
  scene.add(inst);
  coverGroups.push(inst);
}

let currentEnv = 0;
function setEnv(index: number) {
  currentEnv = index;
  const env = ENVS[index];
  grounds.forEach((g, i) => (g.visible = i === index));
  propGroups.forEach((g, i) => (g.visible = i === index));
  coverGroups.forEach((g, i) => (g.visible = i === index));
  scene.fog = new THREE.Fog(env.fog, 40, 120);
  const top = new THREE.Color(env.skyTop);
  const horizon = new THREE.Color(env.skyHorizon);
  const pos = skyGeo.getAttribute("position") as THREE.BufferAttribute;
  const col = skyGeo.getAttribute("color") as THREE.BufferAttribute;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / 140, -0.1, 1);
    c.copy(horizon).lerp(top, THREE.MathUtils.smoothstep(t, 0.02, 0.75));
    c.toArray(col.array as Float32Array, i * 3);
  }
  col.needsUpdate = true;
  hemi.color.set(env.hemiSky);
  hemi.groundColor.set(env.hemiGround);
  sun.color.set(env.sunColor);
  document.querySelectorAll("[data-env]").forEach((el, i) => el.classList.toggle("on", i === index));
  if (typeof daylight !== "undefined") daylight.set(daylight.value());
}

// ===== plants =====

type PlantParams = { scale: number; windSpeed: number; windAmp: number; hue: number };
type Plant = {
  id: number;
  speciesIndex: number;
  group: THREE.Group;
  petals: THREE.InstancedMesh;
  statics: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  params: PlantParams;
  bloomT0: number;
  targetScale: number;
};

// ===== plant sounds — procedural WebAudio, no samples =====
// Each species sings its own notes: the palette's mid-stop hue picks the root
// note on a two-octave pentatonic scale (so nothing can sound sour), the petal
// count sets the arpeggio length, and the hue slider transposes the pitch —
// recolour a flower and it literally plants in a different key.
const audioBus = (() => {
  let ctx: AudioContext | null = null;
  let dry: GainNode | null = null;
  let wet: GainNode | null = null;
  let verb: ConvolverNode | null = null;
  let muted = false;
  const last = { kind: "", freq: 0, notes: 0, count: 0 };
  const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21]; // two pentatonic octaves

  function ensure(): AudioContext | null {
    try {
      if (!ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        dry = ctx.createGain();
        dry.gain.value = 0.42;
        dry.connect(ctx.destination);
        // A small procedural room: exponentially decaying noise as the impulse.
        verb = ctx.createConvolver();
        const len = Math.floor(ctx.sampleRate * 1.3);
        const ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
          const d = ir.getChannelData(ch);
          for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.7);
        }
        verb.buffer = ir;
        wet = ctx.createGain();
        wet.gain.value = 0.5;
        verb.connect(wet);
        wet.connect(ctx.destination);
      }
      if (ctx.state === "suspended") void ctx.resume();
      return ctx;
    } catch {
      return null;
    }
  }

  function tone(freq: number, at: number, dur: number, peak: number, type: OscillatorType) {
    const osc = ctx!.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
    osc.connect(g);
    g.connect(dry!);
    g.connect(verb!);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }

  function thump(at: number, weight: number) {
    const osc = ctx!.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(95 * weight, at);
    osc.frequency.exponentialRampToValueAtTime(38, at + 0.14);
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0.5, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.2);
    osc.connect(g);
    g.connect(dry!);
    osc.start(at);
    osc.stop(at + 0.25);
  }

  function rootFor(speciesIndex: number, hueShift: number): number {
    const hsl = { h: 0, s: 0, l: 0 };
    bakes[speciesIndex].baseCols[2].getHSL(hsl);
    const hue = (hsl.h * 360 + hueShift + 720) % 360;
    const degree = PENTA[Math.floor((hue / 360) * PENTA.length) % PENTA.length];
    return 261.63 * Math.pow(2, degree / 12); // C4-rooted
  }

  return {
    plantOne(speciesIndex: number, hueShift: number, scale: number) {
      if (muted || !ensure()) return;
      const now = ctx!.currentTime;
      const root = rootFor(speciesIndex, hueShift);
      const notes = THREE.MathUtils.clamp(3 + Math.floor(bakes[speciesIndex].petalCount / 9), 3, 5);
      thump(now, THREE.MathUtils.clamp(scale, 0.7, 1.6));
      const steps = [0, 4, 7, 12, 16];
      for (let i = 0; i < notes; i++) {
        const f = root * Math.pow(2, steps[i] / 12);
        tone(f, now + 0.09 + i * 0.085, 0.6, 0.16, "sine");
        tone(f * 1.004, now + 0.09 + i * 0.085, 0.5, 0.06, "triangle"); // shimmer
      }
      Object.assign(last, { kind: "one", freq: root, notes, count: 1 });
    },
    plantBatch(speciesIndex: number, hueShift: number, count: number) {
      if (muted || !ensure()) return;
      const now = ctx!.currentTime;
      const root = rootFor(speciesIndex, hueShift);
      thump(now, 1.25);
      // A rising glissando, longer for bigger plantings — a field waking up.
      const dur = Math.min(0.35 + count * 0.02, 1.5);
      const osc = ctx!.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(root, now + 0.06);
      osc.frequency.exponentialRampToValueAtTime(root * 2, now + 0.06 + dur);
      const g = ctx!.createGain();
      g.gain.setValueAtTime(0, now + 0.06);
      g.gain.linearRampToValueAtTime(0.14, now + 0.14);
      g.gain.exponentialRampToValueAtTime(0.0008, now + 0.06 + dur + 0.25);
      osc.connect(g);
      g.connect(dry!);
      g.connect(verb!);
      osc.start(now + 0.06);
      osc.stop(now + 0.06 + dur + 0.3);
      // Sparkle on top: a few pentatonic bells spread across the sweep.
      const bells = Math.min(6, Math.max(3, Math.floor(count / 8)));
      for (let i = 0; i < bells; i++) {
        tone(root * Math.pow(2, PENTA[(i * 2) % PENTA.length] / 12) * 2, now + 0.15 + (i / bells) * dur, 0.5, 0.09, "sine");
      }
      Object.assign(last, { kind: "batch", freq: root, notes: bells, count });
    },
    /** One soft pentatonic chime — the music garden's voice. */
    chime(hueDeg: number, distance: number) {
      if (muted || !ensure()) return;
      const now = ctx!.currentTime;
      const degree = PENTA[Math.floor((hueDeg / 360) * PENTA.length) % PENTA.length];
      const octave = Math.random() < 0.3 ? 2 : 1;
      const f = 261.63 * Math.pow(2, degree / 12) * octave;
      const level = 0.055 * THREE.MathUtils.clamp(1.4 - distance / 40, 0.3, 1);
      tone(f, now + Math.random() * 0.05, 1.1, level, "sine");
      Object.assign(last, { kind: "chime", freq: f, notes: 1, count: 1 });
    },
    setMuted(on: boolean) {
      muted = on;
    },
    isMuted: () => muted,
    state: () => ({ ...last, ctx: ctx ? ctx.state : "none" }),
  };
})();

const bakes: Bake[] = [];
const plants: Plant[] = [];

// Batch planting: one click stamps a whole formation.
type BatchShape = "disc" | "ring" | "grid" | "scatter";
const batch = { on: false, count: 20, shape: "disc" as BatchShape, radius: 4, randomness: 0.5 };

type BatchSlot = { dx: number; dz: number; scaleMul: number; yaw: number };
let batchSlots: BatchSlot[] = [];
// The formation is driven by a SEEDED generator, so nudging a slider reshapes
// the same arrangement instead of re-rolling a brand new one. The seed only
// changes once a batch is actually planted.
let batchSeed = 0x9e3779b9;
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let batchRandom = mulberry32(batchSeed);

function rollBatchSlots(newSeed = false) {
  if (newSeed) batchSeed = (Math.random() * 0xffffffff) >>> 0;
  batchRandom = mulberry32(batchSeed);
  const offsets = batchOffsets();
  const jitterRandom = mulberry32(batchSeed ^ 0x5bf03635);
  batchSlots = offsets.map(([dx, dz]) => ({
    dx,
    dz,
    scaleMul: 1 + (jitterRandom() - 0.5) * batch.randomness * 0.7,
    yaw: jitterRandom() * Math.PI * 2,
  }));
  refreshBatchPreview();
}

function batchOffsets(): [number, number][] {
  const rnd = batchRandom;
  const out: [number, number][] = [];
  const N = batch.count;
  const R = batch.radius;
  const jitter = batch.randomness;
  if (batch.shape === "disc") {
    for (let i = 0; i < N; i++) {
      // Sunflower spiral fill: even, and the jitter dial roughens it.
      const a = i * 2.39996 + jitter * (rnd() - 0.5) * 1.6;
      const r = R * Math.sqrt((i + 0.5) / N) * (1 + jitter * (rnd() - 0.5) * 0.5);
      out.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
  } else if (batch.shape === "ring") {
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + jitter * (rnd() - 0.5) * 0.5;
      const r = R * (1 + jitter * (rnd() - 0.5) * 0.25);
      out.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
  } else if (batch.shape === "grid") {
    const side = Math.ceil(Math.sqrt(N));
    const step = (2 * R) / Math.max(side - 1, 1);
    for (let i = 0; i < N; i++) {
      const gx = (i % side) - (side - 1) / 2;
      const gz = Math.floor(i / side) - (side - 1) / 2;
      out.push([
        gx * step + jitter * (rnd() - 0.5) * step * 0.9,
        gz * step + jitter * (rnd() - 0.5) * step * 0.9,
      ]);
    }
  } else {
    for (let i = 0; i < N; i++) {
      const a = rnd() * Math.PI * 2;
      const r = R * Math.pow(rnd(), 0.5 + jitter);
      out.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
  }
  return out;
}
let plantSeq = 1;
let selection: Plant[] = [];
const selected = () => selection[0] ?? null;

const DEFAULT_PARAMS: PlantParams = { scale: 1, windSpeed: 1.2, windAmp: 0.14, hue: 0 };
const editorParams: PlantParams = { ...DEFAULT_PARAMS };

function applyHue(mat: THREE.ShaderMaterial, baseCols: THREE.Color[], hue: number) {
  const hsl = { h: 0, s: 0, l: 0 };
  for (let i = 0; i < 5; i++) {
    const c = baseCols[i].clone();
    c.getHSL(hsl);
    c.setHSL((hsl.h + hue / 360 + 1) % 1, hsl.s, hsl.l);
    (mat.uniforms[`uCol${i}`].value as THREE.Vector3).set(c.r, c.g, c.b);
  }
}

function buildFlowerMeshes(bake: Bake, ghost = false) {
  const mat = clonePetalMaterial(bake.materialSrc, ghost);
  const petals = new THREE.InstancedMesh(bake.petalGeo, mat, bake.petalCount);
  const m = new THREE.Matrix4();
  for (let i = 0; i < bake.petalCount; i++) {
    m.fromArray(bake.petalMatrices, i * 16);
    petals.setMatrixAt(i, m);
  }
  petals.frustumCulled = false;
  const staticMat = ghost
    ? new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.4, depthWrite: false })
    : bake.staticMat;
  const statics = new THREE.Mesh(bake.staticGeo, staticMat);
  const group = new THREE.Group();
  const inner = new THREE.Group();
  inner.add(petals, statics);
  inner.position.y = -bake.minY; // stand on the ground
  group.add(inner);
  return { group, petals, statics, mat };
}

function baseScale(bake: Bake) {
  return 1.6 / bake.height; // "size 1" ≈ 1.6 m plant
}

function plantAt(
  speciesIndex: number,
  point: THREE.Vector3,
  params: PlantParams,
  delay = 0,
  scaleMul = 1,
  forceId = 0,
): Plant {
  const bake = bakes[speciesIndex];
  const { group, petals, statics, mat } = buildFlowerMeshes(bake);
  applyHue(mat, bake.baseCols, params.hue);
  mat.uniforms.uWindSpeed.value = params.windSpeed;
  mat.uniforms.uWindAmp.value = params.windAmp;
  mat.uniforms.uBloom.value = 0;
  const target = baseScale(bake) * params.scale * scaleMul;
  group.position.copy(point);
  group.rotation.y = Math.random() * Math.PI * 2;
  group.scale.setScalar(target * 0.12);
  scene.add(group);
  const id = forceId || plantSeq;
  plantSeq = Math.max(plantSeq, id + 1);
  const plant: Plant = {
    id,
    speciesIndex,
    group,
    petals,
    statics,
    mat,
    params: { ...params },
    bloomT0: clock.getElapsedTime() + delay,
    targetScale: target,
  };
  group.userData.plantId = plant.id;
  plants.push(plant);
  updateCount();
  return plant;
}

function removePlant(plant: Plant) {
  scene.remove(plant.group);
  plant.mat.dispose();
  const index = plants.indexOf(plant);
  if (index >= 0) plants.splice(index, 1);
  if (selection.includes(plant)) setSelection(selection.filter((p) => p !== plant));
  updateCount();
}

function applyParamsToPlant(plant: Plant, params: PlantParams) {
  plant.params = { ...params };
  const bake = bakes[plant.speciesIndex];
  applyHue(plant.mat, bake.baseCols, params.hue);
  plant.mat.uniforms.uWindSpeed.value = params.windSpeed;
  plant.mat.uniforms.uWindAmp.value = params.windAmp;
  plant.targetScale = baseScale(bake) * params.scale;
  // Size changes ease in the loop rather than snapping.
}

// Batch formation preview: every slot as a translucent flower inside the ring.
const batchPreview = (() => {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  let petals: THREE.InstancedMesh | null = null;
  let statics: THREE.Mesh | null = null;
  let staticMat: THREE.MeshLambertMaterial | null = null;
  let builtFor = -1;
  return {
    group,
    instances: () => (petals ? petals.count : 0),
    rebuild(speciesIndex: number, slots: BatchSlot[], scaleBase: number, ghostMat: THREE.ShaderMaterial) {
      if (petals) {
        group.remove(petals);
        petals.dispose();
        petals = null;
      }
      if (statics) {
        group.remove(statics);
        statics = null;
      }
      builtFor = speciesIndex;
      if (speciesIndex < 0 || slots.length === 0) return;
      const bake = bakes[speciesIndex];
      const n = bake.petalCount;
      petals = new THREE.InstancedMesh(bake.petalGeo, ghostMat, n * slots.length);
      petals.frustumCulled = false;
      if (!staticMat) {
        staticMat = new THREE.MeshLambertMaterial({
          vertexColors: true,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.32,
          depthWrite: false,
        });
      }
      const slotMat = new THREE.Matrix4();
      const petalMat = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const staticsMesh = new THREE.InstancedMesh(bake.staticGeo, staticMat, slots.length);
      staticsMesh.frustumCulled = false;
      slots.forEach((slot, j) => {
        const k = scaleBase * slot.scaleMul;
        slotMat.compose(
          new THREE.Vector3(slot.dx, -bake.minY * k, slot.dz),
          q.setFromAxisAngle(up, slot.yaw),
          new THREE.Vector3(k, k, k),
        );
        staticsMesh.setMatrixAt(j, slotMat);
        for (let i = 0; i < n; i++) {
          petalMat.fromArray(bake.petalMatrices, i * 16).premultiply(slotMat);
          petals!.setMatrixAt(j * n + i, petalMat);
        }
      });
      statics = staticsMesh;
      group.add(petals, staticsMesh);
    },
    builtFor: () => builtFor,
  };
})();

function refreshBatchPreview() {
  if (!batch.on || !ghost) {
    batchPreview.group.visible = false;
    return;
  }
  const bake = bakes[ghost.speciesIndex];
  batchPreview.rebuild(
    ghost.speciesIndex,
    batchSlots,
    baseScale(bake) * editorParams.scale,
    ghost.mat,
  );
  batchPreview.group.visible = ghost.group.visible;
  batchPreview.group.position.copy(ghost.group.position);
}

// Batch range indicator: a gold circle around the ghost.
const rangeRing = (() => {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
  }
  const ring = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0xffd257, transparent: true, opacity: 0.85 }),
  );
  ring.visible = false;
  scene.add(ring);
  return ring;
})();
function refreshRangeRing() {
  rangeRing.scale.setScalar(batch.radius);
  const anchored = Boolean(batch.on && ghost && ghost.group.visible);
  rangeRing.visible = anchored;
  if (ghost) {
    rangeRing.position.copy(ghost.group.position).setY(ghost.group.position.y + 0.05);
    // In batch mode the formation preview replaces the single ghost flower.
    ghost.group.children.forEach((c) => (c.visible = !batch.on));
    batchPreview.group.visible = anchored;
    batchPreview.group.position.copy(ghost.group.position);
  } else {
    batchPreview.group.visible = false;
  }
}

// Selection marker: a pulsing ring.
// ===== transform gizmo — W move · R rotate · E scale =====
// TransformControls drives a proxy at the selection's centre; whatever happens
// to the proxy is replayed onto every selected plant, so one gizmo edits a
// whole group. In three r169+ the controls are not an Object3D any more — the
// visible part comes from getHelper().
const walkIsOn = () => (typeof walk === "undefined" ? false : walk.isOn());
const gizmo = (() => {
  const proxy = new THREE.Object3D();
  scene.add(proxy);
  const tc = new TransformControls(camera, renderer.domElement);
  tc.setSize(0.85);
  tc.setSpace("world");
  scene.add(tc.getHelper());
  tc.getHelper().visible = false;
  let mode: "translate" | "rotate" | "scale" = "translate";
  let dragging = false;
  const last = { pos: new THREE.Vector3(), rotY: 0, scale: 1 };

  tc.addEventListener("dragging-changed", (e) => {
    dragging = Boolean((e as unknown as { value: boolean }).value);
    controls.enabled = !dragging && !walkIsOn();
    if (!dragging) commit(); // one gizmo drag is one undo step
  });
  tc.addEventListener("objectChange", () => {
    const dx = proxy.position.x - last.pos.x;
    const dz = proxy.position.z - last.pos.z;
    const dRot = proxy.rotation.y - last.rotY;
    const scaleRatio = last.scale > 1e-6 ? proxy.scale.x / last.scale : 1;
    for (const plant of selection) {
      if (mode === "translate") {
        const x = plant.group.position.x + dx;
        const z = plant.group.position.z + dz;
        plant.group.position.set(x, groundYAt(x, z), z);
      } else if (mode === "rotate") {
        plant.group.rotation.y += dRot;
      } else {
        const next = THREE.MathUtils.clamp(plant.params.scale * scaleRatio, 0.4, 3);
        applyParamsToPlant(plant, { ...plant.params, scale: next });
        plant.group.scale.setScalar(plant.targetScale);
      }
    }
    last.pos.copy(proxy.position);
    last.rotY = proxy.rotation.y;
    last.scale = proxy.scale.x;
  });

  function sync() {
    const visible = selection.length > 0 && !walkIsOn();
    tc.getHelper().visible = visible;
    if (!visible) {
      tc.detach();
      return;
    }
    const centre = new THREE.Vector3();
    for (const plant of selection) centre.add(plant.group.position);
    centre.divideScalar(selection.length);
    proxy.position.copy(centre);
    proxy.rotation.set(0, 0, 0);
    proxy.scale.setScalar(1);
    last.pos.copy(centre);
    last.rotY = 0;
    last.scale = 1;
    tc.attach(proxy);
  }

  return {
    sync,
    dragging: () => dragging,
    mode: () => mode,
    setMode(next: "translate" | "rotate" | "scale") {
      mode = next;
      tc.setMode(next);
      const label = document.getElementById("gizmoMode");
      if (label) {
        label.textContent =
          next === "translate" ? "W 移动" : next === "rotate" ? "R 旋转" : "E 缩放";
      }
      sync();
    },
    visible: () => tc.getHelper().visible,
  };
})();

const markerGeo = new THREE.TorusGeometry(0.75, 0.035, 8, 40).rotateX(-Math.PI / 2);
const markerMat = new THREE.MeshBasicMaterial({
  color: 0xffd257,
  transparent: true,
  opacity: 0.9,
  depthWrite: false,
});
const markerPool: THREE.Mesh[] = [];
function markerFor(index: number) {
  while (markerPool.length <= index) {
    const m = new THREE.Mesh(markerGeo, markerMat);
    m.visible = false;
    scene.add(m);
    markerPool.push(m);
  }
  return markerPool[index];
}

function setSelection(next: Plant[]) {
  selection = next.slice();
  markerPool.forEach((m, i) => (m.visible = i < selection.length));
  const del = document.getElementById("delete")!;
  del.classList.toggle("enabled", selection.length > 0);
  const first = selection[0];
  if (first) {
    // Load the first selected plant's params into the sliders.
    setSlider("scale", first.params.scale);
    setSlider("windSpeed", first.params.windSpeed);
    setSlider("windAmp", first.params.windAmp);
    setSlider("hue", first.params.hue);
    Object.assign(editorParams, first.params);
    refreshHueUI();
  }
  gizmo.sync();
  updateCount();
  updateHint();
}
const setSelected = (plant: Plant | null) => setSelection(plant ? [plant] : []);

// ===== garden state: serialise, restore, undo, persistence =====
// A plant is 8 numbers plus a species id, so a whole garden is tiny. Undo keeps
// full snapshots and restores them by DIFFING against what is on screen — only
// the plants that actually changed are rebuilt, so undoing a 60-flower batch
// costs 60 removals, not a full teardown.
type PlantData = {
  id: number;
  sp: string;
  x: number;
  z: number;
  yaw: number;
  p: [number, number, number, number]; // scale, windSpeed, windAmp, hue
};
type GardenSave = { v: 1; env: string; style?: string; plants: PlantData[] };

const round2 = (n: number) => Math.round(n * 100) / 100;

function serialiseGarden(): GardenSave {
  return {
    v: 1,
    env: ENVS[currentEnv].key,
    style: artStyle.id(),
    plants: plants.map((pl) => ({
      id: pl.id,
      sp: bakes[pl.speciesIndex].config.id,
      x: round2(pl.group.position.x),
      z: round2(pl.group.position.z),
      yaw: round2(pl.group.rotation.y),
      p: [
        round2(pl.params.scale),
        round2(pl.params.windSpeed),
        round2(pl.params.windAmp),
        Math.round(pl.params.hue),
      ] as [number, number, number, number],
    })),
  };
}

const speciesIndexById = new Map<string, number>();
function indexOfSpecies(id: string) {
  if (speciesIndexById.size === 0) {
    bakes.forEach((b, i) => speciesIndexById.set(b.config.id, i));
  }
  return speciesIndexById.get(id) ?? -1;
}

function materialise(data: PlantData, animate: boolean) {
  const si = indexOfSpecies(data.sp);
  if (si < 0) return null;
  const params: PlantParams = {
    scale: data.p[0],
    windSpeed: data.p[1],
    windAmp: data.p[2],
    hue: data.p[3],
  };
  const plant = plantAt(si, new THREE.Vector3(data.x, groundYAt(data.x, data.z), data.z), params, 0, 1, data.id);
  plant.group.rotation.y = data.yaw;
  if (!animate) {
    // Restored gardens appear fully grown instead of re-sprouting.
    plant.bloomT0 = clock.getElapsedTime() - 4;
    plant.group.scale.setScalar(plant.targetScale);
    plant.mat.uniforms.uBloom.value = plant.mat.userData.bloomTarget;
  }
  return plant;
}

function restoreGarden(save: GardenSave, animate = false) {
  const envIndex = ENVS.findIndex((e) => e.key === save.env);
  if (envIndex >= 0 && envIndex !== currentEnv) setEnv(envIndex);
  if (save.style) artStyle.set(save.style);
  const want = new Map(save.plants.map((d) => [d.id, d]));
  for (const plant of [...plants]) {
    const data = want.get(plant.id);
    if (!data || bakes[plant.speciesIndex].config.id !== data.sp) {
      removePlant(plant);
      continue;
    }
    // Same plant, possibly moved or retuned.
    plant.group.position.set(data.x, groundYAt(data.x, data.z), data.z);
    plant.group.rotation.y = data.yaw;
    applyParamsToPlant(plant, {
      scale: data.p[0],
      windSpeed: data.p[1],
      windAmp: data.p[2],
      hue: data.p[3],
    });
    plant.group.scale.setScalar(plant.targetScale);
    want.delete(plant.id);
  }
  for (const data of want.values()) materialise(data, animate);
  setSelection(selection.filter((pl) => plants.includes(pl)));
  updateCount();
}

// ---- undo / redo ----
const history: string[] = [];
let historyAt = -1;
let restoring = false;

function commit() {
  if (restoring) return;
  const snapshot = JSON.stringify(serialiseGarden());
  if (snapshot === history[historyAt]) return;
  history.splice(historyAt + 1);
  history.push(snapshot);
  if (history.length > 60) history.shift();
  historyAt = history.length - 1;
  saveLocal();
  updateCount();
}

function travel(step: number) {
  const next = historyAt + step;
  if (next < 0 || next >= history.length) return false;
  historyAt = next;
  restoring = true;
  restoreGarden(JSON.parse(history[historyAt]) as GardenSave, false);
  restoring = false;
  saveLocal();
  return true;
}

// ---- persistence ----
const STORAGE_KEY = "flower-hua-editor-garden";
let saveTimer = 0;
function saveLocal() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serialiseGarden()));
    } catch {
      /* private mode or quota — the export button still works */
    }
  }, 400);
}

function loadLocal(): GardenSave | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as GardenSave) : null;
  } catch {
    return null;
  }
}

/** A garden small enough to travel in a link: species are dictionary-encoded. */
function encodeShare(save: GardenSave): string {
  const dict: string[] = [];
  const rows = save.plants.map((d) => {
    let si = dict.indexOf(d.sp);
    if (si < 0) si = dict.push(d.sp) - 1;
    return [si, d.x, d.z, d.yaw, d.p[0], d.p[1], d.p[2], d.p[3]];
  });
  const payload = JSON.stringify({ v: 1, e: save.env, s: dict, r: rows });
  return btoa(unescape(encodeURIComponent(payload)));
}

function decodeShare(text: string): GardenSave | null {
  try {
    const raw = JSON.parse(decodeURIComponent(escape(atob(text)))) as {
      v: number;
      e: string;
      s: string[];
      r: number[][];
    };
    if (raw.v !== 1) return null;
    return {
      v: 1,
      env: raw.e,
      plants: raw.r.map((row, i) => ({
        id: i + 1,
        sp: raw.s[row[0]],
        x: row[1],
        z: row[2],
        yaw: row[3],
        p: [row[4], row[5], row[6], row[7]] as [number, number, number, number],
      })),
    };
  } catch {
    return null;
  }
}

function deleteSelection() {
  if (!selection.length) return;
  for (const plant of [...selection]) removePlant(plant);
  setSelection([]);
  commit();
}

// ---- clipboard ----
let clipboard: PlantData[] = [];
function copySelection() {
  if (!selection.length) return 0;
  const save = serialiseGarden();
  const ids = new Set(selection.map((p) => p.id));
  clipboard = save.plants.filter((d) => ids.has(d.id));
  return clipboard.length;
}
function pasteClipboard(at: THREE.Vector3 | null) {
  if (!clipboard.length) return 0;
  // Paste relative to the copied group's centroid, landing under the cursor.
  const cx = clipboard.reduce((s, d) => s + d.x, 0) / clipboard.length;
  const cz = clipboard.reduce((s, d) => s + d.z, 0) / clipboard.length;
  const target = at ?? new THREE.Vector3(cx + 2, 0, cz + 2);
  const made: Plant[] = [];
  for (const d of clipboard) {
    const plant = materialise(
      { ...d, id: plantSeq, x: target.x + (d.x - cx), z: target.z + (d.z - cz) },
      true,
    );
    if (plant) made.push(plant);
  }
  setSelection(made);
  commit();
  return made.length;
}

// ===== ghost preview =====

let activeSpecies = -1;
let ghost: { group: THREE.Group; mat: THREE.ShaderMaterial; speciesIndex: number } | null = null;

function setActiveSpecies(index: number) {
  activeSpecies = index;
  setSelected(null);
  if (ghost) {
    scene.remove(ghost.group);
    ghost.mat.dispose();
    ghost = null;
  }
  if (index >= 0) {
    const bake = bakes[index];
    const { group, mat } = buildFlowerMeshes(bake, true);
    mat.uniforms.uBloom.value = mat.userData.bloomTarget;
    group.visible = false;
    scene.add(group);
    ghost = { group, mat, speciesIndex: index };
    refreshGhost();
    rollBatchSlots();
  }
  refreshRangeRing();
  document.querySelectorAll("[data-species]").forEach((el, i) => el.classList.toggle("on", i === index));
  // Touch: while planting, one finger aims and two fingers move the camera.
  controls.touches = {
    ONE: (index >= 0 ? null : THREE.TOUCH.ROTATE) as unknown as THREE.TOUCH,
    TWO: THREE.TOUCH.DOLLY_PAN,
  };
  refreshHueUI();
  updateHint();
}

function refreshGhost() {
  if (!ghost) return;
  const bake = bakes[ghost.speciesIndex];
  applyHue(ghost.mat, bake.baseCols, editorParams.hue);
  ghost.mat.uniforms.uWindSpeed.value = editorParams.windSpeed;
  ghost.mat.uniforms.uWindAmp.value = editorParams.windAmp;
  ghost.group.scale.setScalar(baseScale(bake) * editorParams.scale);
  refreshBatchPreview();
}

// ===== picking =====

const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
let pointerOverGround: THREE.Vector3 | null = null;

function groundHit(clientX: number, clientY: number): THREE.Vector3 | null {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNdc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointerNdc, camera);
  const hits = raycaster.intersectObject(grounds[currentEnv], false);
  return hits.length ? hits[0].point.clone() : null;
}

function plantHit(clientX: number, clientY: number): Plant | null {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNdc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointerNdc, camera);
  for (const hit of raycaster.intersectObjects(plants.map((pl) => pl.group), true)) {
    let node: THREE.Object3D | null = hit.object;
    while (node) {
      if (node.userData.plantId) {
        return plants.find((pl) => pl.id === node!.userData.plantId) ?? null;
      }
      node = node.parent;
    }
  }
  return null;
}

function groundYAt(x: number, z: number): number {
  raycaster.set(new THREE.Vector3(x, 60, z), new THREE.Vector3(0, -1, 0));
  const hits = raycaster.intersectObject(grounds[currentEnv], false);
  return hits.length ? hits[0].point.y : 0;
}

/** Plant at a clicked point — one flower, or a whole batch formation. */
function stampAt(point: THREE.Vector3) {
  if (!batch.on) {
    plantAt(activeSpecies, point, editorParams);
    audioBus.plantOne(activeSpecies, editorParams.hue, editorParams.scale);
    return 1;
  }
  if (batchSlots.length !== batch.count) rollBatchSlots();
  const slots = batchSlots;
  audioBus.plantBatch(activeSpecies, editorParams.hue, slots.length);
  slots.forEach((slot, i) => {
    const x = point.x + slot.dx;
    const z = point.z + slot.dz;
    const plant = plantAt(
      activeSpecies,
      new THREE.Vector3(x, groundYAt(x, z), z),
      editorParams,
      i * 0.055,
      slot.scaleMul,
    );
    plant.group.rotation.y = slot.yaw;
  });
  const planted = slots.length;
  rollBatchSlots(true); // fresh dice for the next stamp
  return planted;
}

/** Every mutation route ends here so the undo stack never misses a step. */
function stampAndCommit(point: THREE.Vector3) {
  const n = stampAt(point);
  commit();
  return n;
}

let downX = 0;
let downY = 0;
// Select-mode drags do one of two things: move what is already selected, or
// rubber-band a new selection. Which one is decided on pointerdown.
type DragMode = "none" | "move" | "box";
let dragMode: DragMode = "none";
let dragOrigin: THREE.Vector3 | null = null;
let dragStartPositions: { plant: Plant; x: number; z: number }[] = [];
const boxEl = document.getElementById("selectBox");

function screenPoint(plant: Plant) {
  const rect = renderer.domElement.getBoundingClientRect();
  const v = plant.group.position.clone().setY(plant.group.position.y + 0.6).project(camera);
  return {
    x: rect.left + ((v.x + 1) / 2) * rect.width,
    y: rect.top + ((1 - v.y) / 2) * rect.height,
    behind: v.z > 1,
  };
}

// Brush painting: while a species is armed, holding the left button lays a
// trail of flowers spaced by the brush setting. Batch mode still wins if both
// are on — a stamp per brush step would flood the scene.
const brush = { on: false, spacing: 1.2 };
let brushing = false;
let brushLast: THREE.Vector3 | null = null;
let brushCount = 0;

let touchAiming = false;
renderer.domElement.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || walk.isOn()) return;
  if (gizmo.dragging()) return; // the transform gizmo owns this press
  downX = e.clientX;
  downY = e.clientY;
  dragMode = "none";
  if (brush.on && activeSpecies >= 0 && !batch.on) {
    brushing = true;
    brushCount = 0;
    brushLast = null;
    renderer.domElement.setPointerCapture(e.pointerId);
    const point = groundHit(e.clientX, e.clientY);
    if (point) {
      plantAt(activeSpecies, point, editorParams);
      audioBus.plantOne(activeSpecies, editorParams.hue, editorParams.scale);
      brushLast = point.clone();
      brushCount = 1;
    }
    return;
  }
  if (e.pointerType === "touch" && activeSpecies >= 0) {
    // No hover on a touchscreen: the finger itself is the preview. Aim by
    // dragging, plant on release. Two fingers still drive the camera.
    touchAiming = true;
    const point = groundHit(e.clientX, e.clientY);
    if (ghost && point) {
      ghost.group.visible = true;
      ghost.group.position.copy(point);
      refreshRangeRing();
    }
    return;
  }
  if (activeSpecies >= 0) return; // planting mode: no dragging
  const hit = plantHit(e.clientX, e.clientY);
  if (hit) {
    if (!selection.includes(hit)) setSelection(e.shiftKey ? [...selection, hit] : [hit]);
    dragMode = "move";
    dragOrigin = groundHit(e.clientX, e.clientY);
    dragStartPositions = selection.map((plant) => ({
      plant,
      x: plant.group.position.x,
      z: plant.group.position.z,
    }));
    renderer.domElement.setPointerCapture(e.pointerId);
  } else {
    dragMode = "box";
  }
});

renderer.domElement.addEventListener("pointermove", (e) => {
  if (walk.isOn()) return;
  pointerOverGround = groundHit(e.clientX, e.clientY);
  if (ghost) {
    ghost.group.visible = Boolean(pointerOverGround);
    if (pointerOverGround) ghost.group.position.copy(pointerOverGround);
  }
  refreshRangeRing();

  if (brushing) {
    if (pointerOverGround && (!brushLast || pointerOverGround.distanceTo(brushLast) >= brush.spacing)) {
      plantAt(activeSpecies, pointerOverGround, editorParams);
      brushLast = pointerOverGround.clone();
      brushCount += 1;
      // One sound per few flowers keeps a long stroke from becoming noise.
      if (brushCount % 4 === 1) audioBus.plantOne(activeSpecies, editorParams.hue, editorParams.scale);
    }
    return;
  }
  const travelled = Math.hypot(e.clientX - downX, e.clientY - downY);
  if (dragMode === "move" && dragOrigin && pointerOverGround) {
    const dx = pointerOverGround.x - dragOrigin.x;
    const dz = pointerOverGround.z - dragOrigin.z;
    for (const entry of dragStartPositions) {
      const x = entry.x + dx;
      const z = entry.z + dz;
      entry.plant.group.position.set(x, groundYAt(x, z), z);
    }
  } else if (dragMode === "box" && boxEl && travelled > 5) {
    const rect = renderer.domElement.getBoundingClientRect();
    boxEl.style.display = "block";
    boxEl.style.left = `${Math.min(downX, e.clientX) - rect.left}px`;
    boxEl.style.top = `${Math.min(downY, e.clientY) - rect.top}px`;
    boxEl.style.width = `${Math.abs(e.clientX - downX)}px`;
    boxEl.style.height = `${Math.abs(e.clientY - downY)}px`;
  }
});

function endDrag(e: PointerEvent) {
  const travelled = Math.hypot(e.clientX - downX, e.clientY - downY);
  if (boxEl) boxEl.style.display = "none";

  if (dragMode === "move") {
    if (travelled > 5) commit(); // a real move is one undo step
    dragMode = "none";
    dragOrigin = null;
    return;
  }
  if (dragMode === "box" && travelled > 5) {
    const x0 = Math.min(downX, e.clientX);
    const x1 = Math.max(downX, e.clientX);
    const y0 = Math.min(downY, e.clientY);
    const y1 = Math.max(downY, e.clientY);
    const inside = plants.filter((plant) => {
      const p = screenPoint(plant);
      return !p.behind && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
    });
    setSelection(e.shiftKey ? [...new Set([...selection, ...inside])] : inside);
    dragMode = "none";
    return;
  }
  dragMode = "none";
  if (travelled > 5) return; // a camera drag, not a click

  if (activeSpecies >= 0) {
    const point = groundHit(e.clientX, e.clientY);
    if (point) stampAndCommit(point);
    return;
  }
  const hit = plantHit(e.clientX, e.clientY);
  if (playMode && hit) {
    const bake = bakes[hit.speciesIndex];
    const hsl = { h: 0, s: 0, l: 0 };
    bake.baseCols[2].getHSL(hsl);
    audioBus.chime((hsl.h * 360 + hit.params.hue + 720) % 360, 0);
    const amp = hit.mat.uniforms.uWindAmp;
    const base = hit.params.windAmp;
    amp.value = Math.min(base + 0.28, 0.5);
    setTimeout(() => (amp.value = base), 700);
    setSelected(hit);
    return;
  }
  if (hit && e.shiftKey) {
    setSelection(
      selection.includes(hit) ? selection.filter((p) => p !== hit) : [...selection, hit],
    );
  } else {
    setSelected(hit);
  }
}
renderer.domElement.addEventListener("pointerup", (e) => {
  if (e.button !== 0 || walk.isOn()) return; // only the left button plants or selects
  if (gizmo.dragging()) return;
  if (brushing) {
    brushing = false;
    brushLast = null;
    if (brushCount) {
      commit(); // the whole stroke is one undo step
      toast(`画笔种下 ${brushCount} 株`);
    }
    return;
  }
  if (touchAiming) {
    touchAiming = false;
    const point = groundHit(e.clientX, e.clientY);
    if (point) stampAndCommit(point);
    return;
  }
  endDrag(e);
});

addEventListener("keydown", (e) => {
  if (walk.isOn()) return; // WASD belongs to the wanderer, not the editor
  const target = e.target as HTMLElement | null;
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return; // typing in the search box
  const meta = e.metaKey || e.ctrlKey;
  if (e.key === "Escape") {
    setActiveSpecies(-1);
    setSelection([]);
    return;
  }
  if (meta && e.key.toLowerCase() === "z") {
    e.preventDefault();
    travel(e.shiftKey ? 1 : -1);
    return;
  }
  if (meta && e.key.toLowerCase() === "y") {
    e.preventDefault();
    travel(1);
    return;
  }
  if (meta && e.key.toLowerCase() === "c") {
    copySelection();
    return;
  }
  if (meta && e.key.toLowerCase() === "v") {
    e.preventDefault();
    pasteClipboard(pointerOverGround);
    return;
  }
  if (meta && e.key.toLowerCase() === "a") {
    e.preventDefault();
    setSelection([...plants]);
    return;
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    deleteSelection();
    return;
  }
  if (/^[1-9]$/.test(e.key) && !meta) {
    const index = Number(e.key) - 1;
    if (index < bakes.length) setActiveSpecies(activeSpecies === index ? -1 : index);
    return;
  }
  if (e.key.toLowerCase() === "b" && !meta) {
    const box = document.getElementById("batchOn") as HTMLInputElement;
    box.checked = !box.checked;
    box.dispatchEvent(new Event("change"));
    return;
  }
  const key = e.key.toLowerCase();
  if (key === "w" || key === "e" || key === "r") {
    gizmo.setMode(key === "w" ? "translate" : key === "e" ? "scale" : "rotate");
    if (!selection.length) toast("先选中花朵，再按 W 移动 · R 旋转 · E 缩放");
  }
});

// ===== AR hand planting — the Studio's MediaPipe pipeline, repointed =====
// Index fingertip aims the ghost; a thumb–index pinch plants. Assets are the
// embedded SIMD wasm + gesture model, materialised as Blob URLs on demand.
const ar = (() => {
  let running = false;
  let video: HTMLVideoElement | null = null;
  let recognizer: import("@mediapipe/tasks-vision").GestureRecognizer | null = null;
  let raf = 0;
  let pinched = false;
  let status = "off";
  const state = { hands: 0, plants: 0, lastPinch: 0 };

  function setStatus(text: string, key = text) {
    status = key;
    const el = document.getElementById("arStatus");
    if (el) el.textContent = text;
  }

  function decode(b64: string) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  /** Screen-space hand input → ghost aim + pinch planting. Shared by the real
   *  camera loop and the headless test hook, so the maths is verifiable. */
  function handleHand(nx: number, ny: number, pinch: boolean) {
    const stageEl = document.getElementById("stage")!;
    const rect = stageEl.getBoundingClientRect();
    const cx = rect.left + nx * rect.width;
    const cy = rect.top + ny * rect.height;
    const dot = document.getElementById("fingerDot")!;
    dot.style.display = "block";
    dot.style.left = `${nx * rect.width}px`;
    dot.style.top = `${ny * rect.height}px`;
    const point = groundHit(cx, cy);
    if (ghost) {
      ghost.group.visible = Boolean(point);
      if (point) ghost.group.position.copy(point);
      refreshRangeRing();
    }
    if (pinch && !pinched && point && activeSpecies >= 0) {
      stampAt(point);
      state.plants += 1;
      state.lastPinch = performance.now();
    }
    pinched = pinch;
  }

  async function start() {
    if (running) return;
    running = true;
    document.getElementById("arPanel")!.classList.remove("off");
    try {
      if (!HAS_AR) throw new Error("no-assets");
      // Safari refuses camera access to file:// pages by hiding mediaDevices
      // entirely, so say what to do instead of "camera unavailable".
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("no-camera-api");
      setStatus("正在启动摄像头…");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
      });
      video = document.getElementById("arVideo") as HTMLVideoElement;
      video.srcObject = stream;
      await video.play();
      setStatus("正在加载手势模型…");
      const { FilesetResolver, GestureRecognizer } = await import("@mediapipe/tasks-vision");
      const loaderUrl = URL.createObjectURL(new Blob([MP_LOADER], { type: "text/javascript" }));
      const wasmUrl = URL.createObjectURL(new Blob([decode(MP_WASM)], { type: "application/wasm" }));
      const makeRecognizer = (delegate: "GPU" | "CPU") =>
        GestureRecognizer.createFromOptions(
          { wasmLoaderPath: loaderUrl, wasmBinaryPath: wasmUrl },
          {
            baseOptions: { modelAssetBuffer: decode(MP_TASK), delegate },
            runningMode: "VIDEO",
            numHands: 1,
          },
        );
      // Software-GL machines reject the GPU delegate; fall back rather than die.
      recognizer = await makeRecognizer("GPU").catch(() => makeRecognizer("CPU"));
      setStatus("伸出手 · 食指瞄准 · 捏合种花", "live");
      const overlay = document.getElementById("arOverlay") as HTMLCanvasElement;
      const octx = overlay.getContext("2d")!;
      const loop = () => {
        if (!running || !recognizer || !video) return;
        raf = requestAnimationFrame(loop);
        if (video.readyState < 2) return;
        const result = recognizer.recognizeForVideo(video, performance.now());
        overlay.width = video.videoWidth;
        overlay.height = video.videoHeight;
        octx.clearRect(0, 0, overlay.width, overlay.height);
        const lm = result.landmarks?.[0];
        state.hands = lm ? 1 : 0;
        if (!lm) {
          document.getElementById("fingerDot")!.style.display = "none";
          return;
        }
        // Mirror x so moving your hand right moves the cursor right.
        const tip = lm[8];
        const thumb = lm[4];
        const palm = Math.max(Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y), 1e-4);
        const pinch = Math.hypot(tip.x - thumb.x, tip.y - thumb.y) / palm < 0.42;
        handleHand(1 - tip.x, tip.y, pinch);
        // Tiny skeleton preview in the PIP (mirrored to match the video).
        octx.save();
        octx.translate(overlay.width, 0);
        octx.scale(-1, 1);
        octx.fillStyle = pinch ? "#ffd257" : "#7fe08f";
        for (const point of lm) {
          octx.beginPath();
          octx.arc(point.x * overlay.width, point.y * overlay.height, 3.2, 0, Math.PI * 2);
          octx.fill();
        }
        octx.restore();
      };
      loop();
    } catch (error) {
      const code = (error as Error).message;
      const message =
        code === "no-assets"
          ? "此构建未内嵌手势模型，请用完整版"
          : code === "no-camera-api"
            ? "此浏览器不允许本地文件用摄像头 · 请改用 Chrome 打开"
            : /denied|Permission/i.test(code)
              ? "摄像头权限被拒绝 · 请在浏览器地址栏允许摄像头"
              : `摄像头启动失败 · ${code.slice(0, 60)}`;
      setStatus(message, "error");
      toast(message);
      running = false;
      setTimeout(() => {
        const on = document.getElementById("arOn") as HTMLInputElement | null;
        if (on) on.checked = false;
        document.getElementById("arPanel")!.classList.add("off");
      }, 2200);
    }
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    if (video?.srcObject) {
      (video.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    }
    recognizer?.close();
    recognizer = null;
    document.getElementById("arPanel")!.classList.add("off");
    document.getElementById("fingerDot")!.style.display = "none";
    setStatus("off");
  }

  return {
    start,
    stop,
    isRunning: () => running,
    status: () => status,
    state: () => ({ ...state }),
    simulateHand: handleHand, // headless test hook — same code path as the camera
  };
})();

// ===== music garden — the field plays itself, strictly opt-in =====
// Every ~7 s a wind front sweeps the ground; each plant it crosses chimes its
// own root note (the same colour→pitch mapping as planting) and sways a little
// harder for a moment. Off by default; the checkbox is also the AudioContext
// unlock gesture.
const musicGarden = (() => {
  let on = false;
  let nextWave = 0;
  let waveStart = 0;
  let waveDir = new THREE.Vector2(1, 0.3).normalize();
  let prevFront = -30;
  let triggered = new Set<number>();
  const state = { waves: 0, chimes: 0 };
  const SPAN = 60; // how far the front travels
  const SPEED = 9; // m/s

  function chime(plant: Plant) {
    const bake = bakes[plant.speciesIndex];
    const hsl = { h: 0, s: 0, l: 0 };
    bake.baseCols[2].getHSL(hsl);
    audioBus.chime(((hsl.h * 360 + plant.params.hue + 720) % 360), plant.group.position.length());
    // Visible answer: this plant sways harder for a moment.
    const amp = plant.mat.uniforms.uWindAmp;
    const base = plant.params.windAmp;
    amp.value = Math.min(base + 0.22, 0.5);
    setTimeout(() => (amp.value = base), 900);
    state.chimes += 1;
  }

  function update(t: number) {
    if (!on || plants.length === 0) return;
    if (t >= nextWave && waveStart === 0) {
      waveStart = t;
      prevFront = -SPAN / 2;
      triggered = new Set();
      const a = Math.random() * Math.PI * 2;
      waveDir = new THREE.Vector2(Math.cos(a), Math.sin(a));
      state.waves += 1;
    }
    if (waveStart === 0) return;
    const front = -SPAN / 2 + (t - waveStart) * SPEED;
    const prev = prevFront;
    prevFront = front;
    if (front > SPAN / 2) {
      waveStart = 0;
      prevFront = -SPAN / 2;
      nextWave = t + 5.5 + Math.random() * 3.5;
      return;
    }
    // Cap how many voices one wave can wake, sampling when crowded.
    const stride = Math.max(1, Math.floor(plants.length / 22));
    for (let i = 0; i < plants.length; i += 1) {
      const plant = plants[i];
      if (triggered.has(plant.id)) continue;
      if (i % stride !== 0) continue;
      const along = plant.group.position.x * waveDir.x + plant.group.position.z * waveDir.y;
      // Crossed-in-this-frame test: robust at any framerate or wind speed.
      if (along > prev && along <= front) {
        triggered.add(plant.id);
        chime(plant);
      }
    }
  }

  return {
    setOn(value: boolean) {
      on = value;
      if (on) nextWave = clock.getElapsedTime() + 1.2;
      else waveStart = 0;
    },
    isOn: () => on,
    update,
    state: () => ({ ...state, on }),
  };
})();

// ===== UI wiring =====

function updateCount() {
  document.getElementById("count")!.textContent = String(plants.length);
  const undoBtn = document.getElementById("undo") as HTMLButtonElement | null;
  const redoBtn = document.getElementById("redo") as HTMLButtonElement | null;
  if (undoBtn) undoBtn.disabled = historyAt <= 0;
  if (redoBtn) redoBtn.disabled = historyAt >= history.length - 1;
}

let toastTimer = 0;
function toast(message: string) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("on"), 1800);
}
function updateHint() {
  const hint = document.getElementById("hint")!;
  if (walk.isOn()) {
    hint.textContent = "W A S D 行走 · Shift 奔跑 · 拖动转视角 · 滚轮远近 · 点「回到编辑」返回";
    return;
  }
  if (playMode) {
    hint.textContent = "🎹 演奏模式 · 点击任意花朵弹响它的音符";
    return;
  }
  hint.textContent =
    activeSpecies >= 0
      ? brush.on && !batch.on
        ? "🖌 画笔模式 · 按住左键拖动连续播种 · ESC 取消"
        : "移动预览 · 左键点击种植 · 右键旋转 · 中键平移 · ESC 取消"
      : brush.on || batch.on
        ? `${brush.on ? "🖌 画笔" : "🌾 批量"}已开 · 请先在左侧花朵图鉴里选一朵花`
        : selection.length
          ? `已选中 ${selection.length} 株 · W 移动 · R 旋转 · E 缩放 · ⌘C/⌘V 复制 · Delete 删除`
          : "左键点花选中 · 拖空地框选 · ⌘Z 撤销 · 右键旋转 · 中键平移";
}

function setSlider(key: string, value: number) {
  const input = document.querySelector<HTMLInputElement>(`input[data-param="${key}"]`)!;
  input.value = String(value);
  input.dispatchEvent(new Event("__sync"));
}

function baseHueOf(speciesIndex: number): number {
  if (speciesIndex < 0) return 0;
  const hsl = { h: 0, s: 0, l: 0 };
  bakes[speciesIndex].baseCols[2].getHSL(hsl);
  return hsl.h * 360;
}

/** The hue track is a rainbow centred on the flower's own colour, and the value
 *  readout is a swatch of the colour the flower will actually become. */
function refreshHueUI() {
  const input = document.querySelector<HTMLInputElement>('input[data-param="hue"]');
  if (!input) return;
  const base = baseHueOf(activeSpecies >= 0 ? activeSpecies : (selected()?.speciesIndex ?? -1));
  const stops: string[] = [];
  for (let i = 0; i <= 12; i++) {
    stops.push(`hsl(${Math.round(base - 180 + i * 30)}, 88%, 55%) ${((i / 12) * 100).toFixed(1)}%`);
  }
  input.style.background = `linear-gradient(90deg, ${stops.join(",")})`;
  const swatch = input.closest("label")!.querySelector<HTMLElement>(".sw2")!;
  swatch.style.background = `hsl(${Math.round(base + editorParams.hue)}, 88%, 55%)`;
}

function wireUI() {
  const panel = document.getElementById("species")!;
  bakes.forEach((bake, i) => {
    const btn = document.createElement("button");
    btn.dataset.species = bake.config.id;
    const name = bake.config.name.split(" · ").pop();
    btn.innerHTML = `<img class="th" src="${bake.thumb ?? ""}" alt=""><span class="nm">${name}</span>`;
    btn.addEventListener("click", () => setActiveSpecies(activeSpecies === i ? -1 : i));
    panel.appendChild(btn);
  });

  const search = document.getElementById("search") as HTMLInputElement | null;
  if (search) {
    const filter = () => {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      document.querySelectorAll<HTMLButtonElement>("#species button").forEach((btn, i) => {
        const name = bakes[i].config.name.toLowerCase();
        const hit = !q || name.includes(q) || bakes[i].config.id.includes(q);
        btn.classList.toggle("hidden", !hit);
        if (hit) shown++;
      });
      search.dataset.shown = String(shown);
    };
    search.addEventListener("input", filter);
    filter();
  }

  document.querySelectorAll<HTMLButtonElement>("[data-env]").forEach((btn, i) => {
    btn.addEventListener("click", () => setEnv(i));
  });

  document.querySelectorAll<HTMLInputElement>("input[data-param]").forEach((input) => {
    const key = input.dataset.param as keyof PlantParams;
    const label = input.closest("label")!.querySelector(".val")!;
    const sync = () => {
      label.textContent = key === "hue" ? `${input.value}°` : Number(input.value).toFixed(2);
    };
    input.addEventListener("__sync", sync);
    input.addEventListener("input", () => {
      editorParams[key] = Number(input.value);
      sync();
      refreshGhost();
      refreshHueUI();
      for (const plant of selection) applyParamsToPlant(plant, editorParams);
    });
    // Commit once the drag ends, so a slider sweep is a single undo step.
    input.addEventListener("change", () => {
      if (selection.length) commit();
    });
    sync();
  });

  const brushOn = document.getElementById("brushOn") as HTMLInputElement;
  const brushOpts = document.getElementById("brushOpts")!;
  brushOn.addEventListener("change", () => {
    brush.on = brushOn.checked;
    brushOpts.classList.toggle("off", !brush.on);
    // Brush strokes and batch stamps both own the left button — one has to win,
    // and silently losing is what makes the loser look broken.
    if (brush.on && batchOn.checked) {
      batchOn.checked = false;
      batchOn.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (brush.on) toast(activeSpecies >= 0 ? "🖌 画笔已开 · 按住左键拖动画一条花径" : "🖌 画笔已开 · 先在左侧选一朵花");
    updateHint();
  });
  const spacingInput = document.getElementById("bSpacing") as HTMLInputElement;
  const spacingLabel = spacingInput.closest("label")!.querySelector(".val")!;
  const syncSpacing = () => {
    brush.spacing = Number(spacingInput.value);
    spacingLabel.textContent = `${brush.spacing.toFixed(1)} m`;
  };
  spacingInput.addEventListener("input", syncSpacing);
  syncSpacing();

  const batchOn = document.getElementById("batchOn") as HTMLInputElement;
  const batchOpts = document.getElementById("batchOpts")!;
  batchOn.addEventListener("change", () => {
    batch.on = batchOn.checked;
    batchOpts.classList.toggle("off", !batch.on);
    if (batch.on && brushOn.checked) {
      brushOn.checked = false;
      brush.on = false;
      brushOpts.classList.add("off");
    }
    if (batch.on && activeSpecies < 0) toast("🌾 批量已开 · 先在左侧选一朵花");
    rollBatchSlots();
    refreshRangeRing();
    updateHint();
  });
  const wireBatch = (id: string, key: "count" | "radius" | "randomness", fmt: (v: number) => string) => {
    const input = document.getElementById(id) as HTMLInputElement;
    const label = input.closest("label")!.querySelector(".val")!;
    const sync = () => {
      (batch[key] as number) = Number(input.value);
      label.textContent = fmt(Number(input.value));
      rollBatchSlots();
      refreshRangeRing();
    };
    input.addEventListener("input", sync);
    sync();
  };
  wireBatch("bCount", "count", (v) => String(Math.round(v)));
  wireBatch("bRadius", "radius", (v) => `${v.toFixed(1)} m`);
  wireBatch("bRand", "randomness", (v) => v.toFixed(2));
  (document.getElementById("bShape") as HTMLSelectElement).addEventListener("change", (e) => {
    batch.shape = (e.target as HTMLSelectElement).value as BatchShape;
    rollBatchSlots();
    refreshRangeRing();
  });

  (document.getElementById("musicOn") as HTMLInputElement).addEventListener("change", (e) => {
    musicGarden.setOn((e.target as HTMLInputElement).checked);
  });
  // The lite build ships no AR checkbox at all.
  document.getElementById("arOn")?.addEventListener("change", (e) => {
    if ((e.target as HTMLInputElement).checked) void ar.start();
    else ar.stop();
  });

  function resetPlantParams() {
    for (const key of Object.keys(DEFAULT_PARAMS) as (keyof PlantParams)[]) {
      editorParams[key] = DEFAULT_PARAMS[key];
      setSlider(key, DEFAULT_PARAMS[key]);
    }
    refreshGhost();
    refreshHueUI();
  }
  document.getElementById("resetParams")!.addEventListener("click", () => {
    resetPlantParams();
    for (const plant of selection) applyParamsToPlant(plant, editorParams);
    if (selection.length) commit();
  });

  // Photo: render one clean frame with the gizmos hidden, at 2× for print.
  document.getElementById("photoBtn")!.addEventListener("click", () => {
    const wasSelected = selection.slice();
    const ghostWas = ghost?.group.visible ?? false;
    markerPool.forEach((m) => (m.visible = false));
    rangeRing.visible = false;
    batchPreview.group.visible = false;
    if (ghost) ghost.group.visible = false;
    const w = renderer.domElement.width;
    const h = renderer.domElement.height;
    renderer.setSize(w, h, false);
    // The photo must show the styled frame, not the raw scene.
    if (!artStyle.render(clock.elapsedTime)) renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `flower-garden-${plants.length}-${ENVS[currentEnv].key}.png`;
    a.click();
    if (ghost) ghost.group.visible = ghostWas;
    setSelection(wasSelected);
    refreshRangeRing();
    resize();
    toast("照片已保存");
  });

  // Top-down: a planning view straight over the garden's centre of mass.
  let topSaved: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  document.getElementById("topBtn")!.addEventListener("click", () => {
    if (topSaved) {
      camera.position.copy(topSaved.pos);
      controls.target.copy(topSaved.target);
      topSaved = null;
      toast("已回到斜视角");
      return;
    }
    topSaved = { pos: camera.position.clone(), target: controls.target.clone() };
    const cx = plants.length ? plants.reduce((s2, p) => s2 + p.group.position.x, 0) / plants.length : 0;
    const cz = plants.length ? plants.reduce((s2, p) => s2 + p.group.position.z, 0) / plants.length : 0;
    // Frame everything that is planted, with a floor so an empty garden still reads.
    const spread = plants.length
      ? Math.max(
          ...plants.map((p) => Math.hypot(p.group.position.x - cx, p.group.position.z - cz)),
        )
      : 6;
    controls.target.set(cx, 0, cz);
    camera.position.set(cx, Math.max(spread * 2.2, 14), cz + 0.01);
    toast("俯视规划视角");
  });

  // Populate the art-style picker from the preset table.
  const stylePicker = document.getElementById("styleSel") as HTMLSelectElement;
  for (const [id, preset] of Object.entries(STYLE_PRESETS)) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = String(preset.label);
    stylePicker.appendChild(opt);
  }
  stylePicker.value = artStyle.id();
  stylePicker.addEventListener("change", () => {
    artStyle.set(stylePicker.value);
    toast(String(STYLE_PRESETS[stylePicker.value]?.label ?? ""));
  });

  document.getElementById("walkBtn")!.addEventListener("click", () => walk.setOn(!walk.isOn()));
  document.getElementById("walkFloat")!.addEventListener("click", () => walk.setOn(false));
  document.getElementById("replayBtn")!.addEventListener("click", () => {
    const n = replay.start();
    toast(n ? `回放 ${n} 株的生长` : "先种些花再回放");
  });
  const dayInput = document.getElementById("daylight") as HTMLInputElement;
  const dayLabel = dayInput.closest("label")!.querySelector(".val")!;
  const syncDay = () => {
    const v = Number(dayInput.value);
    daylight.set(v);
    dayLabel.textContent = v > 0.75 ? "☀️ 正午" : v > 0.45 ? "⛅ 黄昏" : v > 0.2 ? "🌆 暮色" : "🌙 夜晚";
  };
  dayInput.addEventListener("input", syncDay);
  syncDay();
  (document.getElementById("playModeOn") as HTMLInputElement).addEventListener("change", (e) => {
    playMode = (e.target as HTMLInputElement).checked;
    if (playMode) setActiveSpecies(-1);
    updateHint();
  });
  const tpl = document.getElementById("templates") as HTMLSelectElement;
  tpl.addEventListener("change", () => {
    const make = TEMPLATES[tpl.value];
    if (!make) return;
    for (const plant of [...plants]) removePlant(plant);
    restoreGarden({ v: 1, env: ENVS[currentEnv].key, plants: make() }, true);
    commit();
    toast(`已载入示例 · ${plants.length} 株`);
    tpl.value = "";
  });

  document.getElementById("undo")!.addEventListener("click", () => travel(-1));
  document.getElementById("redo")!.addEventListener("click", () => travel(1));
  document.getElementById("exportBtn")!.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(serialiseGarden(), null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `flower-garden-${plants.length}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`已导出 ${plants.length} 株`);
  });
  const importFile = document.getElementById("importFile") as HTMLInputElement;
  document.getElementById("importBtn")!.addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", async () => {
    const file = importFile.files?.[0];
    if (!file) return;
    try {
      const save = JSON.parse(await file.text()) as GardenSave;
      if (!Array.isArray(save.plants)) throw new Error("bad file");
      for (const plant of [...plants]) removePlant(plant);
      restoreGarden(save, false);
      commit();
      toast(`已载入 ${plants.length} 株`);
    } catch {
      toast("文件无法识别");
    }
    importFile.value = "";
  });
  document.getElementById("shareBtn")!.addEventListener("click", async () => {
    const link = `${location.origin}${location.pathname}#g=${encodeShare(serialiseGarden())}`;
    try {
      await navigator.clipboard.writeText(link);
      toast(`链接已复制 · ${Math.round(link.length / 1024)} KB`);
    } catch {
      location.hash = `g=${encodeShare(serialiseGarden())}`;
      toast("链接已写入地址栏");
    }
  });

  const muteBtn = document.getElementById("mute")!;
  muteBtn.addEventListener("click", () => {
    audioBus.setMuted(!audioBus.isMuted());
    muteBtn.textContent = audioBus.isMuted() ? "🔇" : "🔊";
    muteBtn.classList.toggle("mutedOn", audioBus.isMuted());
  });

  document.getElementById("delete")!.addEventListener("click", () => deleteSelection());
  // "Clear" is the full reset button: an empty ground AND every knob back to
  // where it started. Only the terrain choice survives — that is the canvas you
  // are replanting on, not a parameter.
  document.getElementById("clear")!.addEventListener("click", () => {
    for (const plant of [...plants]) removePlant(plant);
    setSelection([]);
    resetPlantParams();
    artStyle.set("none");
    stylePicker.value = "none";
    dayInput.value = "1";
    syncDay();
    for (const id of ["brushOn", "batchOn", "musicOn", "playModeOn", "arOn"]) {
      const box = document.getElementById(id) as HTMLInputElement | null;
      if (box?.checked) {
        box.checked = false;
        box.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    commit();
  });
}

// ===== art style — a full-screen post pass (ported from waterpro.html) =====
// The scene renders into a colour+depth target, then one quad redraws it with a
// depth/luma sobel outline plus a stylised grade. Everything is a uniform, so
// switching style costs nothing and no scene object is touched.
const STYLE_PRESETS: Record<string, Record<string, unknown>> = {
  none: { label: "🎨 原始画风 None" },
  watercolor: { label: "💧 水彩 Watercolor", outlineColor: "#3a3531", outlineStrength: 0.9, outlineWidth: 1.3, saturation: 0.82, brightness: 1.03, grain: 0.05 },
  anime: { label: "🌸 日系动画 Anime", outlineColor: "#34434b", outlineStrength: 0.74, outlineWidth: 0.9, saturation: 1.16, grain: 0.015, brightness: 1.06, contrast: 1.08, warmth: -0.03 },
  fairytale: { label: "📖 童话绘本 Fairytale", outlineColor: "#7a5a48", outlineStrength: 0.85, outlineWidth: 1.6, boil: 0.003, saturation: 1.35, brightness: 1.15, warmth: 0.12, grain: 0.08 },
  // Brighter than waterpro's water-scene tuning: a sunlit lawn is mid-grey once
  // desaturated, and heavy halftone over mid-grey turns the whole frame to ink.
  manga: { label: "🖤 黑白漫画 Manga", outlineColor: "#171717", outlineStrength: 1, outlineWidth: 1.55, saturation: 0, grain: 0.03, brightness: 1.5, contrast: 1.15, vignette: 0.06, halftone: 0.3, halftoneScale: 5 },
  print: { label: "💥 美式漫画 Comic", outlineColor: "#171412", outlineStrength: 1, outlineWidth: 1.75, saturation: 1.52, grain: 0.004, brightness: 1.08, contrast: 1.26, warmth: 0.04, vignette: 0.055, halftoneScale: 18, posterize: 5, comic: 0.12, duotoneDark: "#171412", duotoneLight: "#fff0bc" },
  pixel: { label: "🎮 像素时代 Pixel", outlineColor: "#1a1a24", outlineStrength: 0.8, outlineWidth: 1, saturation: 1.25, brightness: 1.05, contrast: 1.15, posterize: 6, comic: 0.02, pixelate: 6 },
  cyberneon: { label: "🌃 赛博霓虹 Cyber Neon", outlineColor: "#21f3ff", outlineStrength: 1, outlineWidth: 1.6, saturation: 1.55, grain: 0.02, brightness: 0.92, contrast: 1.35, warmth: -0.12, vignette: 0.3, hueShift: -0.35, chroma: 2, scanline: 0.12 },
  noir: { label: "🎬 黑色电影 Film Noir", outlineColor: "#0c0c0c", outlineStrength: 1.1, outlineWidth: 2, saturation: 0, contrast: 1.45, halftone: 0.2, vignette: 0.5, brightness: 1.42 },
  copperplate: { label: "🪙 铜板雕刻 Copperplate", outlineColor: "#2a1a0e", outlineStrength: 1, outlineWidth: 1.3, saturation: 0.12, contrast: 1.2, brightness: 1.32, cross: 0.75, duotone: 0.6, duotoneDark: "#241206", duotoneLight: "#ecd3a4", grain: 0.05 },
  inkwhite: { label: "🖋 白底线稿 Ink Sketch", outlineColor: "#000000", edgeBg: "#ffffff", outlineStrength: 1.3, outlineWidth: 0.7, edgeOnly: 1, boil: 0.0045, saturation: 0, grain: 0.06 },
  inkblack: { label: "✏️ 黑底粉笔 Chalk Sketch", outlineColor: "#ffffff", edgeBg: "#000000", outlineStrength: 1.3, outlineWidth: 0.7, edgeOnly: 1, boil: 0.0045, saturation: 0, grain: 0.04 },
  goldwire: { label: "✨ 鎏金线稿 Gold Wire", outlineColor: "#ffd27a", outlineStrength: 1.25, outlineWidth: 1.5, edgeOnly: 0.94, grain: 0.08 },
  dreamzoom: { label: "🌙 梦境放射 Dream Zoom", outlineColor: "#4a3a48", outlineStrength: 0.4, outlineWidth: 1, zoomBlur: 0.35, brightness: 1.1, saturation: 1.2 },
};

const STYLE_DEFAULTS = {
  outlineColor: "#2a2f3a",
  edgeBg: "#21273c",
  outlineStrength: 0,
  outlineWidth: 1,
  saturation: 1,
  grain: 0,
  brightness: 1,
  contrast: 1,
  warmth: 0,
  vignette: 0,
  halftone: 0,
  halftoneScale: 6,
  duotone: 0,
  posterize: 0,
  comic: 0,
  duotoneDark: "#171412",
  duotoneLight: "#fff0bc",
  hueShift: 0,
  pixelate: 0,
  scanline: 0,
  chroma: 0,
  boil: 0,
  zoomBlur: 0,
  edgeOnly: 0,
  dither: 0,
  subpixel: 0,
  cross: 0,
  wave: 0,
  animSpeed: 1,
};

const artStyle = (() => {
  let current = "none";
  const target = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    type: THREE.UnsignedByteType,
  });
  // The outline needs real depth, not a luminance guess.
  target.depthTexture = new THREE.DepthTexture(1, 1);
  target.depthTexture.type = THREE.UnsignedShortType;

  const uniforms: Record<string, { value: unknown }> = {
    tDiffuse: { value: target.texture },
    tDepth: { value: target.depthTexture },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uCamNear: { value: camera.near },
    uCamFar: { value: camera.far },
    uOutlineColor: { value: new THREE.Color(STYLE_DEFAULTS.outlineColor) },
    uEdgeBg: { value: new THREE.Color(STYLE_DEFAULTS.edgeBg) },
    uDuotoneDark: { value: new THREE.Color(STYLE_DEFAULTS.duotoneDark) },
    uDuotoneLight: { value: new THREE.Color(STYLE_DEFAULTS.duotoneLight) },
  };
  const NUMERIC = [
    "outlineStrength", "outlineWidth", "saturation", "grain", "brightness", "contrast",
    "warmth", "vignette", "halftone", "halftoneScale", "duotone", "posterize", "comic",
    "hueShift", "pixelate", "scanline", "chroma", "boil", "zoomBlur", "edgeOnly",
    "dither", "subpixel", "cross", "wave", "animSpeed",
  ] as const;
  for (const key of NUMERIC) {
    uniforms[`u${key[0].toUpperCase()}${key.slice(1)}`] = {
      value: (STYLE_DEFAULTS as Record<string, number | string>)[key] as number,
    };
  }

  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: "void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: STYLE_FRAG_SOURCE,
    depthTest: false,
    depthWrite: false,
  });
  quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

  function apply(id: string) {
    current = STYLE_PRESETS[id] ? id : "none";
    const preset = { ...STYLE_DEFAULTS, ...(STYLE_PRESETS[current] ?? {}) } as Record<string, unknown>;
    for (const key of NUMERIC) {
      uniforms[`u${key[0].toUpperCase()}${key.slice(1)}`].value = Number(preset[key] ?? 0);
    }
    (uniforms.uOutlineColor.value as THREE.Color).set(String(preset.outlineColor));
    (uniforms.uEdgeBg.value as THREE.Color).set(String(preset.edgeBg));
    (uniforms.uDuotoneDark.value as THREE.Color).set(String(preset.duotoneDark));
    (uniforms.uDuotoneLight.value as THREE.Color).set(String(preset.duotoneLight));
    const select = document.getElementById("styleSel") as HTMLSelectElement | null;
    if (select && select.value !== current) select.value = current;
  }

  return {
    id: () => current,
    isOn: () => current !== "none",
    set: apply,
    resize(w: number, h: number, dpr: number) {
      const pw = Math.max(1, Math.floor(w * dpr));
      const ph = Math.max(1, Math.floor(h * dpr));
      target.setSize(pw, ph);
      (uniforms.uResolution.value as THREE.Vector2).set(pw, ph);
    },
    /** Draw the scene through the style pass; returns false if style is off. */
    render(t: number) {
      if (current === "none") return false;
      uniforms.uTime.value = t;
      uniforms.uCamNear.value = camera.near;
      uniforms.uCamFar.value = camera.far;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(quadScene, quadCam);
      return true;
    },
  };
})();

// ===== growth replay — the garden re-plants itself, in planting order =====
const replay = (() => {
  let playing = false;
  return {
    isPlaying: () => playing,
    start(perFlower = 0.16) {
      if (playing || plants.length === 0) return 0;
      playing = true;
      const now = clock.getElapsedTime();
      // Planting order is the plant id, so a replay is pure scheduling: rewind
      // every bloom clock and let the existing sprout animation run again.
      const ordered = [...plants].sort((a, b) => a.id - b.id);
      ordered.forEach((plant, i) => {
        plant.bloomT0 = now + i * perFlower;
        plant.group.scale.setScalar(plant.targetScale * 0.12);
        plant.mat.uniforms.uBloom.value = 0;
      });
      const total = (ordered.length * perFlower + 2.4) * 1000;
      setTimeout(() => (playing = false), total);
      return ordered.length;
    },
  };
})();

// ===== day / night — one slider drives sun, sky, fog and firefly mood =====
const daylight = (() => {
  let value = 1; // 0 = midnight, 1 = noon
  const fireflies = (() => {
    const COUNT = 120;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 26;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = 0.4 + Math.random() * 2.6;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const sprite = (() => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 64;
      const g = cv.getContext("2d")!;
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, "rgba(255,255,220,1)");
      grad.addColorStop(0.4, "rgba(255,230,140,.5)");
      grad.addColorStop(1, "rgba(255,220,120,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(cv);
    })();
    const points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.34,
        map: sprite,
        alphaMap: sprite,
        color: 0xfff0a8,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    points.frustumCulled = false;
    scene.add(points);
    return points;
  })();

  return {
    value: () => value,
    fireflies,
    set(next: number) {
      value = THREE.MathUtils.clamp(next, 0, 1);
      const env = ENVS[currentEnv];
      const night = 1 - value;
      // Sun swings low and reddens; the sky and fog follow it down.
      sun.intensity = 0.25 + value * 1.35;
      sun.color.setHSL(0.09 + value * 0.02, 0.55 - value * 0.35, 0.45 + value * 0.4);
      const angle = (0.12 + value * 0.75) * Math.PI;
      sun.position.set(Math.cos(angle) * -40, Math.sin(angle) * 55 + 4, -22);
      hemi.intensity = 0.35 + value * 1.0;
      hemi.color.set(env.hemiSky).lerp(new THREE.Color(0x2a3a58), night * 0.85);
      hemi.groundColor.set(env.hemiGround).lerp(new THREE.Color(0x121a26), night * 0.8);
      const top = new THREE.Color(env.skyTop).lerp(new THREE.Color(0x0b1330), night * 0.92);
      const horizon = new THREE.Color(env.skyHorizon).lerp(new THREE.Color(0x2a1f42), night * 0.85);
      const pos = skyGeo.getAttribute("position") as THREE.BufferAttribute;
      const col = skyGeo.getAttribute("color") as THREE.BufferAttribute;
      const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const t = THREE.MathUtils.clamp(pos.getY(i) / 140, -0.1, 1);
        c.copy(horizon).lerp(top, THREE.MathUtils.smoothstep(t, 0.02, 0.75));
        c.toArray(col.array as Float32Array, i * 3);
      }
      col.needsUpdate = true;
      const fogColor = new THREE.Color(env.fog).lerp(new THREE.Color(0x1a1730), night * 0.85);
      if (scene.fog) (scene.fog as THREE.Fog).color.copy(fogColor);
      (fireflies.material as THREE.PointsMaterial).opacity = Math.pow(night, 1.6) * 0.9;
      fireflies.visible = night > 0.15;
    },
    update(t: number) {
      if (!fireflies.visible) return;
      fireflies.rotation.y = t * 0.03;
      (fireflies.material as THREE.PointsMaterial).size = 0.3 + Math.sin(t * 2.2) * 0.06;
    },
  };
})();

// ===== playable garden — click a flower to hear its note =====
let playMode = false;

// ===== starter gardens — a first impression that is not an empty field =====
const TEMPLATES: Record<string, () => PlantData[]> = {
  mandala: () => {
    const rings = [
      { sp: "violet-tulip", r: 2.4, n: 12, sc: 0.85 },
      { sp: "garland-daisy", r: 4.2, n: 18, sc: 0.95 },
      { sp: "scarlet-rose", r: 6, n: 24, sc: 1 },
      { sp: "arctic-camellia", r: 7.8, n: 28, sc: 0.9 },
    ];
    const out: PlantData[] = [];
    let id = 1;
    for (const ring of rings) {
      for (let i = 0; i < ring.n; i++) {
        const a = (i / ring.n) * Math.PI * 2;
        out.push({
          id: id++,
          sp: ring.sp,
          x: round2(Math.cos(a) * ring.r),
          z: round2(Math.sin(a) * ring.r),
          yaw: round2(a + Math.PI / 2),
          p: [ring.sc, 1.2, 0.14, 0],
        });
      }
    }
    out.push({ id: id++, sp: "crimson-dahlia", x: 0, z: 0, yaw: 0.4, p: [2.4, 1, 0.1, 0] });
    return out;
  },
  rainbow: () => {
    const out: PlantData[] = [];
    for (let i = 0; i < 48; i++) {
      const t = i / 47;
      const a = Math.PI * (0.15 + t * 0.7);
      out.push({
        id: i + 1,
        sp: "aurora-rose",
        x: round2(Math.cos(a) * 9),
        z: round2(-Math.sin(a) * 9 + 4),
        yaw: round2(a),
        p: [1, 1.2, 0.16, Math.round(-180 + t * 360)],
      });
    }
    return out;
  },
  keyboard: () => {
    // A pentatonic run: eight species left to right, each a step up the scale.
    const row = [
      "violet-tulip", "garland-daisy", "sakura-cloud", "cobalt-ice-bloom",
      "scarlet-rose", "sun-gold-sunflower", "cyan-hydrangea", "crimson-dahlia",
    ];
    const out: PlantData[] = [];
    let id = 1;
    row.forEach((sp, i) => {
      for (let j = 0; j < 3; j++) {
        out.push({
          id: id++,
          sp,
          x: round2(-10.5 + i * 3),
          z: round2(-3 + j * 3),
          yaw: round2(i * 0.4),
          p: [1.1, 1.4, 0.18, 0],
        });
      }
    });
    return out;
  },
};

// ===== walk mode — the edit ⇄ play loop, in the same scene =====
// No export file needed: the garden you just planted becomes walkable in place,
// and a share link can open straight into it (#w=…). Reuses the TPS rig proven
// by the garden and world pages.
const walk = (() => {
  let on = false;
  const hero = new THREE.Group();
  let limbs: Record<string, THREE.Mesh> = {};
  const keys = new Set<string>();
  let camYaw = Math.PI;
  let camPitch = 0.22;
  let camDist = 6.5;
  let stride = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const savedCam = { pos: new THREE.Vector3(), target: new THREE.Vector3() };

  {
    const skin = flat(0xf2c9a0);
    const shirt = flat(0xef6f8e);
    const jeans = flat(0x3f5f96);
    const shoe = flat(0x3a3a44);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.3), shirt);
    torso.position.y = 1.06;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.4, 0.4), skin);
    head.position.y = 1.6;
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.16, 0.44), flat(0x2f2a2a));
    hair.position.y = 1.79;
    hero.add(torso, head, hair);
    for (const sx of [-0.1, 0.1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.03), flat(0x27242b));
      eye.position.set(sx, 1.63, 0.21);
      hero.add(eye);
    }
    const limb = (w: number, h: number, mat: THREE.Material) => {
      const geo = new THREE.BoxGeometry(w, h, w);
      geo.translate(0, -h / 2, 0); // pivot at the shoulder/hip
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
    limbs = { armL, armR, legL, legR };
    hero.visible = false;
    scene.add(hero);
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (!on) return;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
    keys.add(e.key.toLowerCase());
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
  const onDown = (e: PointerEvent) => {
    if (!on) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onMove = (e: PointerEvent) => {
    if (!on || !dragging) return;
    camYaw -= (e.clientX - lastX) * 0.005;
    camPitch = THREE.MathUtils.clamp(camPitch - (e.clientY - lastY) * 0.004, -0.1, 1);
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onUp = () => (dragging = false);
  const onWheel = (e: WheelEvent) => {
    if (!on) return;
    e.preventDefault();
    camDist = THREE.MathUtils.clamp(camDist + e.deltaY * 0.01, 2.4, 18);
  };

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const camTarget = new THREE.Vector3();

  return {
    isOn: () => on,
    hero,
    setOn(value: boolean) {
      if (value === on) return;
      on = value;
      hero.visible = value;
      document.body.classList.toggle("walking", value);
      gizmo.sync();
      const btn = document.getElementById("walkBtn");
      if (btn) btn.textContent = value ? "✎ 回到编辑" : "🚶 漫游";
      if (value) {
        savedCam.pos.copy(camera.position);
        savedCam.target.copy(controls.target);
        controls.enabled = false;
        setActiveSpecies(-1);
        setSelection([]);
        // Drop the wanderer on a clear patch just south of the garden's centre.
        const cx = plants.length
          ? plants.reduce((sum, p) => sum + p.group.position.x, 0) / plants.length
          : 0;
        const cz = plants.length
          ? plants.reduce((sum, p) => sum + p.group.position.z, 0) / plants.length
          : 0;
        hero.position.set(cx, groundYAt(cx, cz + 9), cz + 9);
        hero.rotation.y = Math.PI;
        camYaw = Math.PI;
        addEventListener("keydown", onKeyDown);
        addEventListener("keyup", onKeyUp);
        renderer.domElement.addEventListener("pointerdown", onDown);
        renderer.domElement.addEventListener("pointermove", onMove);
        renderer.domElement.addEventListener("pointerup", onUp);
        renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
      } else {
        keys.clear();
        controls.enabled = true;
        camera.position.copy(savedCam.pos);
        controls.target.copy(savedCam.target);
        removeEventListener("keydown", onKeyDown);
        removeEventListener("keyup", onKeyUp);
        renderer.domElement.removeEventListener("pointerdown", onDown);
        renderer.domElement.removeEventListener("pointermove", onMove);
        renderer.domElement.removeEventListener("pointerup", onUp);
        renderer.domElement.removeEventListener("wheel", onWheel);
      }
      updateHint();
    },
    update(dt: number) {
      if (!on) return;
      let ix = 0;
      let iz = 0;
      if (keys.has("w") || keys.has("arrowup")) iz -= 1;
      if (keys.has("s") || keys.has("arrowdown")) iz += 1;
      if (keys.has("a") || keys.has("arrowleft")) ix -= 1;
      if (keys.has("d") || keys.has("arrowright")) ix += 1;
      const input = Math.min(Math.hypot(ix, iz), 1);
      const walking = input > 0.02;
      if (walking) {
        forward.set(Math.sin(camYaw), 0, Math.cos(camYaw));
        right.set(forward.z, 0, -forward.x);
        desired.set(0, 0, 0).addScaledVector(forward, iz).addScaledVector(right, ix).normalize();
        const speed = (keys.has("shift") ? 8 : 4) * input;
        hero.position.addScaledVector(desired, speed * dt);
        const limit = GROUND_SIZE / 2 - 3;
        hero.position.x = THREE.MathUtils.clamp(hero.position.x, -limit, limit);
        hero.position.z = THREE.MathUtils.clamp(hero.position.z, -limit, limit);
        const want = Math.atan2(desired.x, desired.z);
        let diff = want - hero.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        hero.rotation.y += diff * Math.min(1, dt * 12);
        stride += speed * dt * 2.1;
        // The camera drifts back behind the shoulders unless you grab it.
        if (!dragging) {
          let d = hero.rotation.y + Math.PI - camYaw;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          camYaw += d * Math.min(1, dt * 2.2);
        }
      } else {
        stride += dt * 1.6;
      }
      const swing = walking ? Math.sin(stride) * 0.85 : Math.sin(stride) * 0.06;
      limbs.legL.rotation.x = swing;
      limbs.legR.rotation.x = -swing;
      limbs.armL.rotation.x = -swing * 0.8;
      limbs.armR.rotation.x = swing * 0.8;
      const groundY = groundYAt(hero.position.x, hero.position.z);
      hero.position.y = groundY + (walking ? Math.abs(Math.sin(stride)) * 0.06 : 0);

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
    },
  };
})();

// ===== loop =====

const clock = new THREE.Clock();
function resize() {
  const w = stage.clientWidth || window.innerWidth;
  const h = stage.clientHeight || window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
  artStyle.resize(w, h, renderer.getPixelRatio());
}
addEventListener("resize", resize);

function startLoop() {
  renderer.setAnimationLoop(() => {
    // getDelta() FIRST: three's getElapsedTime() consumes the delta internally,
    // so asking for elapsed time first leaves getDelta() returning ~0 and
    // anything integrating over dt (the wanderer) never moves.
    const dt2 = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    for (const plant of plants) {
      plant.mat.uniforms.uTime.value = t;
      // Sprout: scale eases out-back; bloom follows the engine's own wavefront.
      const age = t - plant.bloomT0;
      const grow = Math.min(age / 1.1, 1);
      const back = 1 + 2.2 * Math.pow(grow - 1, 3) + 1.2 * Math.pow(grow - 1, 2);
      const eased = grow >= 1 ? 1 : back;
      const current = plant.targetScale * (0.12 + 0.88 * Math.max(eased, 0.02));
      plant.group.scale.setScalar(THREE.MathUtils.lerp(plant.group.scale.x, current, 0.35));
      const bloomProgress = THREE.MathUtils.clamp((age - 0.25) / 1.6, 0, 1);
      const easeBloom = 1 - Math.pow(1 - bloomProgress, 3);
      plant.mat.uniforms.uBloom.value = (plant.mat.userData.bloomTarget as number) * easeBloom;
    }
    if (ghost) {
      ghost.mat.uniforms.uTime.value = t;
      const pulse = 0.42 + Math.sin(t * 3.2) * 0.08;
      ghost.mat.uniforms.uFlat.value = ghost.mat.uniforms.uFlat.value; // no-op keep
      void pulse;
    }
    musicGarden.update(t);
    daylight.update(t);
    walk.update(dt2);
    selection.forEach((plant, i) => {
      const m = markerFor(i);
      m.visible = !walk.isOn();
      m.position.copy(plant.group.position).setY(plant.group.position.y + 0.04);
      const ring = 0.8 * plant.group.scale.x * (bakes[plant.speciesIndex].height / 1.6) + 0.35;
      m.scale.setScalar(ring + Math.sin(t * 4) * 0.05);
    });
    // OrbitControls.update() repositions the camera from its own spherical
    // EVERY call — it does not honour `enabled`. Calling it while walking
    // yanks the third-person camera back each frame, which is what made the
    // walk view and WASD feel broken. Only orbit when actually orbiting.
    if (!walk.isOn()) {
      // Keep the view over the garden instead of drifting into empty space.
      const limit = GROUND_SIZE / 2 - 4;
      controls.target.x = THREE.MathUtils.clamp(controls.target.x, -limit, limit);
      controls.target.z = THREE.MathUtils.clamp(controls.target.z, -limit, limit);
      controls.target.y = THREE.MathUtils.clamp(controls.target.y, 0, 6);
      controls.update();
    }
    // Style pass owns the frame when a preset is active.
    if (!artStyle.render(t)) renderer.render(scene, camera);
  });
}

// ===== boot =====

(async () => {
  const pot = document.createElement("div");
  pot.style.cssText = "position:fixed;left:-64px;top:-64px;width:32px;height:32px;opacity:0;pointer-events:none";
  document.body.appendChild(pot);
  const engine = createFlowerScene(pot, null, null, { petalSegments: { x: 8, y: 18 } });
  const bootLabel = document.getElementById("boot-label");

  // Thumbnail rig: a tiny offscreen renderer photographs each baked flower.
  const thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  thumbRenderer.setSize(96, 96);
  const thumbScene = new THREE.Scene();
  thumbScene.add(new THREE.HemisphereLight(0xffffff, 0x6a7a5a, 1.5));
  const thumbSun = new THREE.DirectionalLight(0xfff4dd, 1.4);
  thumbSun.position.set(2, 3, 2.5);
  thumbScene.add(thumbSun);
  const thumbCam = new THREE.PerspectiveCamera(38, 1, 0.05, 30);
  function photograph(bake: Bake) {
    const { group, mat } = buildFlowerMeshes(bake);
    mat.uniforms.uBloom.value = mat.userData.bloomTarget;
    thumbScene.add(group);
    const bb = new THREE.Box3().setFromObject(group);
    const centre = bb.getCenter(new THREE.Vector3());
    // Frame the flower head (upper part), not the whole stem.
    centre.y = THREE.MathUtils.lerp(centre.y, bb.max.y, 0.42);
    const radius = Math.max(bb.getSize(new THREE.Vector3()).x, bb.max.y - centre.y) * 0.72 + 0.2;
    thumbCam.position.set(centre.x + radius * 0.4, centre.y + radius * 0.75, centre.z + radius * 1.35);
    thumbCam.lookAt(centre);
    thumbRenderer.render(thumbScene, thumbCam);
    bake.thumb = thumbRenderer.domElement.toDataURL("image/png");
    thumbScene.remove(group);
    mat.dispose();
  }
  for (let i = 0; i < SPECIES.length; i++) {
    const spec = SPECIES[i];
    const config = byId.get(spec.id)!;
    if (bootLabel) bootLabel.textContent = `正在培育 ${i + 1}/${SPECIES.length} · ${config.name}`;
    await new Promise((r) => setTimeout(r, 0));
    const trimmed: FlowerConfig = { ...config, params: { ...config.params } };
    if ((trimmed.params.numPetals as number) > spec.petals) trimmed.params.numPetals = spec.petals;
    engine.setPalette(trimmed.palette as unknown as [number, number, number][]);
    engine.setAnatomy(trimmed.anatomy);
    engine.setCameraView([0, 4.6, 3.4]);
    engine.applyPreset(trimmed.params);
    engine.setEditPose();
    const bake = bakeSpecies(engine, config);
    photograph(bake);
    bakes.push(bake);
  }
  engine.dispose();
  thumbRenderer.dispose();
  thumbRenderer.domElement.remove();
  pot.remove();

  wireUI();
  setEnv(0);
  // A shared link wins over the local autosave.
  const hash = location.hash.startsWith("#g=") ? decodeShare(location.hash.slice(3)) : null;
  const restored = hash ?? loadLocal();
  if (restored?.plants?.length) {
    restoreGarden(restored, false);
    toast(`已恢复 ${plants.length} 株`);
  }
  commit(); // seed the undo stack with whatever we start from
  if (location.hash.includes("&walk") || location.hash.startsWith("#w=")) walk.setOn(true);
  resize();
  startLoop();
  updateHint();

  const handle = {
    ready: true,
    species: bakes.length,
    plants: () => plants.length,
    setEnv,
    pick: setActiveSpecies,
    ghostVisible: () => Boolean(ghost?.group.visible),
    ghostTo: (x: number, z: number) => {
      if (!ghost) return false;
      const y = (() => {
        raycaster.set(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0));
        const hits = raycaster.intersectObject(grounds[currentEnv], false);
        return hits.length ? hits[0].point.y : 0;
      })();
      ghost.group.position.set(x, y, z);
      ghost.group.visible = true;
      refreshRangeRing(); // keep the batch preview and ring in step, like pointermove does
      return true;
    },
    plantAt: (x: number, z: number) => {
      if (activeSpecies < 0) return null;
      const before = plants.length;
      stampAndCommit(new THREE.Vector3(x, groundYAt(x, z), z));
      return plants.length > before ? plants[plants.length - 1].id : null;
    },
    setBatch: (opts: Partial<typeof batch>) => {
      Object.assign(batch, opts);
      const on = document.getElementById("batchOn") as HTMLInputElement;
      on.checked = batch.on;
      document.getElementById("batchOpts")!.classList.toggle("off", !batch.on);
      rollBatchSlots();
      refreshRangeRing();
    },
    getParams: () => ({ ...editorParams }),
    save: () => serialiseGarden(),
    load: (data: GardenSave) => {
      for (const plant of [...plants]) removePlant(plant);
      restoreGarden(data, false);
      commit();
    },
    undo: () => travel(-1),
    redo: () => travel(1),
    historyDepth: () => ({ at: historyAt, len: history.length }),
    selectAll: () => setSelection([...plants]),
    selectIds: (ids: number[]) => setSelection(plants.filter((p) => ids.includes(p.id))),
    moveSelection: (dx: number, dz: number) => {
      for (const plant of selection) {
        const x = plant.group.position.x + dx;
        const z = plant.group.position.z + dz;
        plant.group.position.set(x, groundYAt(x, z), z);
      }
      commit();
    },
    copy: () => copySelection(),
    paste: (x: number, z: number) => pasteClipboard(new THREE.Vector3(x, groundYAt(x, z), z)),
    shareLink: () => encodeShare(serialiseGarden()),
    walk: (on: boolean) => walk.setOn(on),
    walkState: () => ({ on: walk.isOn(), pos: walk.hero.position.toArray().map((n) => +n.toFixed(2)) }),
    replay: () => replay.start(0.05),
    setDaylight: (v: number) => {
      const input = document.getElementById("daylight") as HTMLInputElement;
      input.value = String(v);
      input.dispatchEvent(new Event("input"));
    },
    daylightState: () => ({
      value: daylight.value(),
      sun: +sun.intensity.toFixed(3),
      fireflies: (daylight.fireflies.material as THREE.PointsMaterial).opacity,
    }),
    setPlayMode: (on: boolean) => {
      const box = document.getElementById("playModeOn") as HTMLInputElement;
      box.checked = on;
      box.dispatchEvent(new Event("change"));
    },
    setBrush: (on: boolean, spacing?: number) => {
      const box = document.getElementById("brushOn") as HTMLInputElement;
      box.checked = on;
      box.dispatchEvent(new Event("change"));
      if (spacing !== undefined) {
        const input = document.getElementById("bSpacing") as HTMLInputElement;
        input.value = String(spacing);
        input.dispatchEvent(new Event("input"));
      }
    },
    brushState: () => ({ ...brush }),
    gizmoState: () => ({ mode: gizmo.mode(), visible: gizmo.visible() }),
    setGizmoMode: (m: "translate" | "rotate" | "scale") => gizmo.setMode(m),
    searchSpecies: (q: string) => {
      const input = document.getElementById("search") as HTMLInputElement;
      input.value = q;
      input.dispatchEvent(new Event("input"));
      return Number(input.dataset.shown ?? 0);
    },
    topDown: () => (document.getElementById("topBtn") as HTMLButtonElement).click(),
    setStyle: (id: string) => {
      const sel = document.getElementById("styleSel") as HTMLSelectElement;
      sel.value = id;
      sel.dispatchEvent(new Event("change"));
    },
    styleState: () => ({ id: artStyle.id(), on: artStyle.isOn(), count: Object.keys(STYLE_PRESETS).length }),
    cameraState: () => ({
      pos: camera.position.toArray().map((n) => +n.toFixed(2)),
      target: controls.target.toArray().map((n) => +n.toFixed(2)),
    }),
    hasAR: HAS_AR,
    loadTemplate: (name: string) => {
      const sel = document.getElementById("templates") as HTMLSelectElement;
      sel.value = name;
      sel.dispatchEvent(new Event("change"));
      return plants.length;
    },
    loadShare: (text: string) => {
      const save = decodeShare(text);
      if (!save) return false;
      for (const plant of [...plants]) removePlant(plant);
      restoreGarden(save, false);
      commit();
      return true;
    },
    resetParams: () => (document.getElementById("resetParams") as HTMLButtonElement).click(),
    batchPreviewInfo: () => ({
      slots: batchSlots.length,
      instances: batchPreview.instances(),
      visible: batchPreview.group.visible,
    }),
    batchState: () => ({ ...batch }),
    audioState: () => audioBus.state(),
    arStart: () => ar.start(),
    arStop: () => ar.stop(),
    arStatus: () => ar.status(),
    arState: () => ar.state(),
    simulateHand: (nx: number, ny: number, pinch: boolean) => ar.simulateHand(nx, ny, pinch),
    setMusic: (on: boolean) => {
      (document.getElementById("musicOn") as HTMLInputElement).checked = on;
      musicGarden.setOn(on);
    },
    musicState: () => musicGarden.state(),
    setMuted: (on: boolean) => audioBus.setMuted(on),
    plantIds: () => plants.map((pl) => pl.id),
    thumbs: () => bakes.filter((b) => b.thumb && b.thumb.length > 200).length,
    setParam: (key: keyof PlantParams, value: number) => {
      setSlider(key, value);
      editorParams[key] = value;
      refreshGhost();
      refreshHueUI();
      for (const plant of selection) applyParamsToPlant(plant, editorParams);
    },
    selectId: (id: number) => {
      const plant = plants.find((pl) => pl.id === id) ?? null;
      setActiveSpecies(-1);
      setSelected(plant);
      return Boolean(plant);
    },
    selectedParams: () => (selected() ? { ...selected()!.params } : null),
    selectionSize: () => selection.length,
    plantMatSample: (id: number) => {
      const plant = plants.find((pl) => pl.id === id);
      if (!plant) return null;
      const c = plant.mat.uniforms.uCol2.value as THREE.Vector3;
      return { bloom: plant.mat.uniforms.uBloom.value as number, col2: [c.x, c.y, c.z], scale: plant.group.scale.x, wind: plant.mat.uniforms.uWindSpeed.value as number };
    },
    deleteSelected: () => deleteSelection(),
    clear: () => {
      for (const plant of [...plants]) removePlant(plant);
      setSelection([]);
      commit();
    },
    camera,
    info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
  };
  (window as unknown as Record<string, unknown>).__editor = handle;
})();
