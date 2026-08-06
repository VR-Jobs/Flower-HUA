import {
  createFlowerScene,
  STUDIO_FLOWER_GROUP_Y,
  type FlowerSceneApi,
} from "../../Studio/components/flower/flowerScene";
import type { FlowerConfig } from "../../Studio/components/flower/flowerConfig";

declare const __FLOWERS__: FlowerConfig[];

const flowers = __FLOWERS__;
const stage = document.getElementById("stage");
if (!stage) throw new Error("Stage element is missing");

const scene = createFlowerScene(stage, null, null, {
  flowerGroupY: STUDIO_FLOWER_GROUP_Y,
});

// A full-page canvas is a work surface, not a scroll story, so plain wheel zoom
// is safe here (the engine keeps it off by default for the scroll pages).
scene.setWheelZoomEnabled(true);

/**
 * Same order the Studio uses (StudioCanvas.applyFlower). The palette and anatomy
 * must land before applyPreset(), and setCameraView() must come before it too —
 * it seeds the stable design-space basis that camera-facing layouts such as
 * radial-disc are built against. Reordering these makes the flower face wrong.
 */
function applyFlower(target: FlowerSceneApi, flower: FlowerConfig) {
  target.setPalette(flower.palette as unknown as [number, number, number][]);
  target.setAnatomy(flower.anatomy);
  if (flower.camera) target.setCameraView(flower.camera);
  target.applyPreset(flower.params);
}

const caption = document.getElementById("caption");
const picker = document.getElementById("picker") as HTMLSelectElement | null;

function indexFromHash() {
  const id = decodeURIComponent(location.hash.replace(/^#/, ""));
  const found = flowers.findIndex((flower) => flower.id === id);
  return found >= 0 ? found : 0;
}

let current = -1;

function show(index: number, replayBloom = true) {
  if (index === current) return;
  current = index;
  const flower = flowers[index];
  applyFlower(scene, flower);
  // The Studio snaps to its finished pose for editing. A demo page is nicer as
  // a performance: open from a bud, then settle into the live wind sway.
  if (replayBloom) scene.playBloom();
  document.title = flower.name;
  if (caption) caption.textContent = flower.name;
  if (picker) picker.selectedIndex = index;
  const hash = `#${flower.id}`;
  if (location.hash !== hash) history.replaceState(null, "", hash);
}

if (picker) {
  for (const flower of flowers) {
    const option = document.createElement("option");
    option.textContent = flower.name;
    picker.append(option);
  }
  picker.addEventListener("change", () => show(picker.selectedIndex));
  picker.hidden = false;
}

document.getElementById("replay")?.addEventListener("click", () => {
  scene.playBloom();
});

// Deep links (…/gallery.html#velvet-dahlia) and back/forward both work.
addEventListener("hashchange", () => show(indexFromHash()));

show(indexFromHash());

// Screenshot hook for the headless gallery-capture script. `snap` skips the
// 5-second bloom and jumps straight to the finished pose (the same one the
// Studio shows for editing), so 36 captures take seconds rather than minutes.
(window as unknown as Record<string, unknown>).__showFlower = (
  id: string,
  snap = false,
) => {
  const index = flowers.findIndex((flower) => flower.id === id);
  if (index < 0) throw new Error(`Unknown flower id: ${id}`);
  current = -1;
  show(index, !snap);
  if (snap) scene.setEditPose();
};
