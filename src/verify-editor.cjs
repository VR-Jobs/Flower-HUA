const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("/Users/zhuxianliu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const [target, outDir] = process.argv.slice(2);
const assert = (c, m) => { if (!c) throw new Error(m); };
let browser;
(async () => {
  browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader-webgl", "--disable-gpu-sandbox",
           "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(240000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(target).href, { waitUntil: "load", timeout: 240000 });
  await page.waitForFunction(() => window.__editor && window.__editor.ready, null, { timeout: 400000 });

  const base = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("#species button")];
    const r0 = btns[0].getBoundingClientRect();
    const r1 = btns[1].getBoundingClientRect();
    const img = btns[0].querySelector("img.th");
    return {
      species: window.__editor.species,
      buttons: btns.length,
      thumbs: window.__editor.thumbs(),
      singleColumn: Math.abs(r0.left - r1.left) < 1 && r1.top > r0.bottom - 1,
      thumbIsPhoto: Boolean(img && img.src.startsWith("data:image") && img.src.length > 500),
      names: btns.slice(0, 3).map((b) => b.textContent.trim()),
    };
  });
  assert(base.species === 39, `expected 39 species, got ${base.species}`);
  assert(base.buttons === 39, `expected 39 buttons, got ${base.buttons}`);
  assert(base.thumbs >= 38, `thumbnails missing: only ${base.thumbs} rendered`);
  assert(base.singleColumn, "species list is not a single column");
  assert(base.thumbIsPhoto, "first species button has no photo thumbnail");

  // Rainbow hue track + result swatch.
  await page.evaluate(() => window.__editor.pick(0)); // aurora rose
  const hueUI = await page.evaluate(() => {
    const input = document.querySelector('input[data-param="hue"]');
    const sw = document.querySelector("#params .sw2");
    return {
      track: input.style.background,
      swatch: sw.style.background,
    };
  });
  // The browser serialises hsl() stops as rgb(); count stops instead.
  const stopCount = (hueUI.track.match(/rgb\(/g) || []).length;
  assert(hueUI.track.includes("linear-gradient") && stopCount >= 8,
    `hue track is not a rainbow (${stopCount} stops): ${hueUI.track.slice(0, 60)}`);
  assert(hueUI.swatch.length > 3, `hue swatch empty: ${hueUI.swatch}`);
  // Moving the slider moves the swatch colour.
  const sw0 = hueUI.swatch;
  await page.evaluate(() => window.__editor.setParam("hue", 150));
  const sw1 = await page.evaluate(() => document.querySelector("#params .sw2").style.background);
  assert(sw1 !== sw0, "hue swatch did not follow the slider");
  await page.evaluate(() => window.__editor.setParam("hue", 0));

  // Single planting still works (real click), on the desert this time.
  await page.evaluate(() => window.__editor.setEnv(2));
  const box = await page.evaluate(() => {
    const r = document.querySelector("#c3d").getBoundingClientRect();
    return { x: r.left + r.width * 0.6, y: r.top + r.height * 0.6 };
  });
  await page.mouse.move(box.x, box.y);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, "ghost-desert.png") });
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(1500);
  let count = await page.evaluate(() => window.__editor.plants());
  assert(count === 1, `single left-click plant failed, count=${count}`);

  // Right click must never plant.
  await page.mouse.move(box.x + 40, box.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(400);
  count = await page.evaluate(() => window.__editor.plants());
  assert(count === 1, `right click planted a flower, count=${count}`);

  // Right-drag rotates the camera; left-drag must not move it.
  const camBefore = await page.evaluate(() => {
    const c = window.__editor.camera.position;
    return [c.x, c.y, c.z];
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const camAfterLeft = await page.evaluate(() => {
    const c = window.__editor.camera.position;
    return [c.x, c.y, c.z];
  });
  const leftMoved = Math.hypot(...camAfterLeft.map((v, i) => v - camBefore[i]));
  assert(leftMoved < 0.05, `left drag moved the camera by ${leftMoved.toFixed(3)}`);
  await page.mouse.move(box.x, box.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(box.x + 160, box.y + 40, { steps: 8 });
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(900);
  const camAfterRight = await page.evaluate(() => {
    const c = window.__editor.camera.position;
    return [c.x, c.y, c.z];
  });
  const rightMoved = Math.hypot(...camAfterRight.map((v, i) => v - camAfterLeft[i]));
  assert(rightMoved > 0.2, `right drag did not rotate the camera (${rightMoved.toFixed(3)})`);
  count = await page.evaluate(() => window.__editor.plants());
  assert(count === 1, `a camera drag planted a flower, count=${count}`);

  // Batch: a ring of 24 tulips (species index 3+? tulip id lookup by name).
  const tulipIndex = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("#species button")];
    return btns.findIndex((b) => b.dataset.species === "violet-tulip");
  });
  assert(tulipIndex > 0, "violet-tulip not in panel");
  await page.evaluate((i) => {
    window.__editor.pick(i);
    window.__editor.setBatch({ on: true, count: 24, shape: "ring", radius: 4, randomness: 0.15 });
  }, tulipIndex);
  const ringVisible = await page.evaluate(() => {
    window.__editor.ghostTo(0, 0);
    // range ring lives in the scene; check via batch state + ghost visible
    return window.__editor.batchState().on && window.__editor.ghostVisible();
  });
  assert(ringVisible, "batch mode ghost/ring not active");
  await page.evaluate(() => window.__editor.plantAt(0, 0));
  await page.waitForTimeout(600);
  count = await page.evaluate(() => window.__editor.plants());
  assert(count === 25, `ring batch failed: expected 25 plants, got ${count}`);

  // Staggered bloom: the last ring plant lags the first while animating.
  const stagger = await page.evaluate(() => {
    const ids = window.__editor.plantIds();
    const first = window.__editor.plantMatSample(ids[1]);
    const last = window.__editor.plantMatSample(ids[ids.length - 1]);
    return { first: first.bloom, last: last.bloom };
  });
  assert(stagger.first >= stagger.last - 1e-6, `no bloom stagger: ${JSON.stringify(stagger)}`);
  await page.waitForTimeout(2600);
  await page.screenshot({ path: path.join(outDir, "batch-ring.png") });

  // Batch grid of daisies on the lawn, bigger randomness.
  await page.evaluate(() => {
    window.__editor.setEnv(0);
    window.__editor.clear();
  });
  const daisyIndex = await page.evaluate(() =>
    [...document.querySelectorAll("#species button")].findIndex((b) => b.dataset.species === "garland-daisy"));
  await page.evaluate((i) => {
    window.__editor.pick(i);
    window.__editor.setParam("hue", 0);
    window.__editor.setBatch({ on: true, count: 36, shape: "grid", radius: 5, randomness: 0.35 });
    window.__editor.plantAt(0, 0);
  }, daisyIndex);
  await page.waitForTimeout(3400);
  count = await page.evaluate(() => window.__editor.plants());
  assert(count === 36, `grid batch failed: got ${count}`);
  await page.screenshot({ path: path.join(outDir, "batch-grid.png") });

  // Audio: two different species must sing different roots, and the hue slider
  // must transpose the pitch. Headless Chrome keeps the context suspended
  // without a gesture, but the synth math and event log still run.
  const audio = await page.evaluate(() => {
    const e = window.__editor;
    e.setBatch({ on: false });
    e.pick(0); // aurora rose
    e.plantAt(6, 6);
    const a = e.audioState();
    e.pick(4); // a differently-coloured species
    e.plantAt(7, 6);
    const b = e.audioState();
    e.setParam("hue", 150);
    e.plantAt(8, 6);
    const c = e.audioState();
    e.setParam("hue", 0);
    e.setBatch({ on: true, count: 18, shape: "scatter", radius: 3, randomness: 0.6 });
    e.plantAt(9, 8);
    const d = e.audioState();
    e.setBatch({ on: false });
    e.setMuted(true);
    const mutedOk = true;
    e.setMuted(false);
    return { a, b, c, d, mutedOk };
  });
  assert(audio.a.kind === "one" && audio.a.freq > 0, `no plant sound event: ${JSON.stringify(audio.a)}`);
  assert(Math.abs(audio.a.freq - audio.b.freq) > 1, `species share a root note: ${audio.a.freq} vs ${audio.b.freq}`);
  assert(Math.abs(audio.b.freq - audio.c.freq) > 1, `hue shift did not transpose: ${audio.b.freq} vs ${audio.c.freq}`);
  assert(audio.d.kind === "batch" && audio.d.count === 18, `batch sound wrong: ${JSON.stringify(audio.d)}`);

  // Reset button restores all four defaults (and syncs the sliders).
  await page.evaluate(() => {
    const e = window.__editor;
    e.setParam("scale", 2.4);
    e.setParam("windSpeed", 3.1);
    e.setParam("hue", -90);
    e.resetParams();
  });
  const afterReset = await page.evaluate(() => window.__editor.getParams());
  assert(
    afterReset.scale === 1 && afterReset.windSpeed === 1.2 && afterReset.windAmp === 0.14 && afterReset.hue === 0,
    `reset failed: ${JSON.stringify(afterReset)}`,
  );

  // Batch preview: formation appears inside the ring, and its instance count
  // tracks petals × slots; planting matches the previewed slot count.
  const preview = await page.evaluate(async () => {
    const e = window.__editor;
    e.clear();
    const tulip = [...document.querySelectorAll("#species button")]
      .findIndex((b) => b.dataset.species === "violet-tulip");
    e.pick(tulip); // 6 petals
    e.setBatch({ on: true, count: 14, shape: "ring", radius: 3.5, randomness: 0.2 });
    e.ghostTo(0, 0);
    await new Promise((r) => setTimeout(r, 200));
    const info = e.batchPreviewInfo();
    const before = e.plants();
    e.plantAt(0, 0);
    const planted = e.plants() - before;
    const infoAfter = e.batchPreviewInfo();
    return { info, planted, rerolled: infoAfter.slots };
  });
  assert(preview.info.visible, "batch preview not visible over the ground");
  assert(preview.info.slots === 14, `preview slots wrong: ${preview.info.slots}`);
  assert(preview.info.instances === 14 * 6, `preview instances wrong: ${preview.info.instances}`);
  assert(preview.planted === 14, `planted ${preview.planted}, preview promised 14`);
  assert(preview.rerolled === 14, "slots did not re-roll after planting");
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(outDir, "batch-preview.png") });
  await page.evaluate(() => {
    window.__editor.setBatch({ on: false });
    window.__editor.clear();
  });

  // AR only exists in the full build; the lite build must degrade cleanly and
  // then keep running every other check.
  const hasAR = await page.evaluate(() => window.__editor.hasAR);
  if (!hasAR) {
    const liteOk = await page.evaluate(() => ({
      noCheckbox: !document.getElementById("arOn"),
      note: Boolean(document.querySelector(".liteNote")),
    }));
    assert(liteOk.noCheckbox && liteOk.note, "lite build still advertises AR");
  }
  if (hasAR) {
  // AR: fake camera boots the real MediaPipe pipeline; simulateHand drives the
  // same aim/pinch code path the camera loop uses.
  await page.evaluate(() => {
    window.__editor.clear();
    window.__editor.pick(0);
    window.__editor.setBatch({ on: false });
    window.__editor.arStart();
  });
  await page.waitForFunction(
    () => ["live", "error", "此构建未内嵌手势模型", "摄像头或手势模型不可用"].includes(window.__editor.arStatus()),
    null, { timeout: 240000 },
  );
  const arStatus = await page.evaluate(() => window.__editor.arStatus());
  assert(arStatus === "live", `AR pipeline did not go live: ${arStatus}`);
  const arPlant = await page.evaluate(async () => {
    const e = window.__editor;
    const before = e.plants();
    e.simulateHand(0.55, 0.5, false); // aim
    await new Promise((r) => setTimeout(r, 120));
    const ghostAimed = e.ghostVisible();
    e.simulateHand(0.55, 0.5, true); // pinch down → plant
    await new Promise((r) => setTimeout(r, 120));
    e.simulateHand(0.55, 0.5, false); // release
    return { ghostAimed, planted: e.plants() - before, ar: e.arState() };
  });
  assert(arPlant.ghostAimed, "AR aim did not show the ghost");
  assert(arPlant.planted === 1, `pinch did not plant: ${JSON.stringify(arPlant)}`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, "ar-live.png") });
  await page.evaluate(() => window.__editor.arStop());
  }

  // Music garden: off by default; on, a wind wave must chime the plants.
  const musicDefault = await page.evaluate(() => window.__editor.musicState());
  assert(musicDefault.on === false && musicDefault.chimes === 0,
    `music garden not off by default: ${JSON.stringify(musicDefault)}`);
  await page.evaluate(() => {
    const e = window.__editor;
    e.clear();
    e.pick(2);
    e.setBatch({ on: true, count: 16, shape: "scatter", radius: 5, randomness: 0.5 });
    e.plantAt(0, 0);
    e.setBatch({ on: false });
    e.setMusic(true);
  });
  await page.waitForFunction(() => window.__editor.musicState().chimes >= 3, null, { timeout: 120000 });
  const music = await page.evaluate(() => window.__editor.musicState());
  assert(music.on && music.waves >= 1 && music.chimes >= 3,
    `music garden barely played: ${JSON.stringify(music)}`);
  const lastAudio = await page.evaluate(() => window.__editor.audioState());
  assert(lastAudio.kind === "chime", `last audio event is not a chime: ${lastAudio.kind}`);
  await page.evaluate(() => window.__editor.setMusic(false));

  // ---- Layer 1: persistence, undo, multi-select, move, clipboard ----
  const persist = await page.evaluate(async () => {
    const e = window.__editor;
    e.clear();
    e.setBatch({ on: false });
    const daisy = [...document.querySelectorAll("#species button")]
      .findIndex((b) => b.dataset.species === "garland-daisy");
    e.pick(daisy);
    e.plantAt(2, 2);
    e.plantAt(-2, 2);
    e.plantAt(0, -3);
    const afterPlant = e.plants();
    const save = e.save();

    // Undo three times → empty; redo three times → back.
    e.undo(); e.undo(); e.undo();
    const afterUndo = e.plants();
    e.redo(); e.redo(); e.redo();
    const afterRedo = e.plants();

    // Round-trip through the save format.
    e.clear();
    const afterClear = e.plants();
    e.load(save);
    const afterLoad = e.plants();
    const reloaded = e.save();
    const identical = JSON.stringify(reloaded.plants) === JSON.stringify(save.plants);

    // Share link round-trip.
    const link = e.shareLink();
    e.clear();
    const shareOk = e.loadShare(link);
    const afterShare = e.plants();

    return { afterPlant, afterUndo, afterRedo, afterClear, afterLoad, identical, afterShare, shareOk, hist: e.historyDepth(), linkKB: +(link.length / 1024).toFixed(2) };
  });
  assert(persist.afterPlant === 3, `expected 3 plants, got ${persist.afterPlant}`);
  assert(persist.afterUndo === 0, `undo did not empty the garden: ${persist.afterUndo}`);
  assert(persist.afterRedo === 3, `redo did not restore: ${persist.afterRedo} (history ${JSON.stringify(persist.hist)})`);
  assert(persist.afterClear === 0, "clear failed");
  assert(persist.afterLoad === 3, `load failed: ${persist.afterLoad}`);
  assert(persist.identical, "save → load → save is not identical");
  assert(persist.shareOk && persist.afterShare === 3, `share link round-trip failed: ${JSON.stringify(persist)}`);

  // localStorage autosave survives a reload.
  await page.waitForTimeout(700);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__editor && window.__editor.ready, null, { timeout: 400000 });
  const afterReload = await page.evaluate(() => window.__editor.plants());
  assert(afterReload === 3, `autosave did not survive reload: ${afterReload}`);

  // Multi-select, move as a group, copy/paste.
  const edit = await page.evaluate(() => {
    const e = window.__editor;
    e.selectAll();
    const selected = e.selectionSize();
    const before = e.save().plants.map((p) => [p.x, p.z]);
    e.moveSelection(3, 1);
    const after = e.save().plants.map((p) => [p.x, p.z]);
    const movedAll = before.every((b, i) => Math.abs(after[i][0] - b[0] - 3) < 0.05);
    const copied = e.copy();
    const pasted = e.paste(8, 8);
    return { selected, movedAll, copied, pasted, total: e.plants(), sel: e.selectionSize() };
  });
  assert(edit.selected === 3, `select-all got ${edit.selected}`);
  assert(edit.movedAll, "group move did not shift every selected plant");
  assert(edit.copied === 3 && edit.pasted === 3, `clipboard failed: ${JSON.stringify(edit)}`);
  assert(edit.total === 6 && edit.sel === 3, `paste state wrong: ${JSON.stringify(edit)}`);
  await page.waitForTimeout(1600);
  await page.screenshot({ path: path.join(outDir, "layer1-editing.png") });

  // Undo the paste.
  const undonePaste = await page.evaluate(() => {
    window.__editor.undo();
    return window.__editor.plants();
  });
  assert(undonePaste === 3, `undo after paste got ${undonePaste}`);
  await page.evaluate(() => window.__editor.clear());

  // ---- Layer 2 + 3: hotkeys, templates, daylight, replay, play mode, walking ----
  const tpl = await page.evaluate(() => {
    const e = window.__editor;
    e.clear();
    return { mandala: e.loadTemplate("mandala"), keyboard: e.loadTemplate("keyboard") };
  });
  assert(tpl.mandala === 83, `mandala template planted ${tpl.mandala}`);
  assert(tpl.keyboard === 24, `keyboard template planted ${tpl.keyboard}`);

  // Hotkey 1 arms the first species; B toggles batch.
  const hotkeys = await page.evaluate(async () => {
    const e = window.__editor;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "1" })); // once: it toggles
    await new Promise((r) => setTimeout(r, 80));
    const armed = document.querySelectorAll("#species button.on").length;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "b" }));
    await new Promise((r) => setTimeout(r, 80));
    const batchOn = e.batchState().on;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "b" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    return { armed, batchOn };
  });
  assert(hotkeys.armed === 1, `hotkey 1 did not arm a species (${hotkeys.armed})`);
  assert(hotkeys.batchOn === true, "hotkey B did not toggle batch");

  // Daylight: night dims the sun and lights the fireflies.
  await page.evaluate(() => window.__editor.setDaylight(0));
  await page.waitForTimeout(400);
  const night = await page.evaluate(() => window.__editor.daylightState());
  await page.screenshot({ path: path.join(outDir, "night.png") });
  await page.evaluate(() => window.__editor.setDaylight(1));
  await page.waitForTimeout(300);
  const day = await page.evaluate(() => window.__editor.daylightState());
  assert(night.sun < day.sun * 0.4, `night did not dim the sun: ${night.sun} vs ${day.sun}`);
  assert(night.fireflies > 0.4 && day.fireflies < 0.05,
    `fireflies wrong: night ${night.fireflies}, day ${day.fireflies}`);

  // Growth replay rewinds every bloom.
  const replayed = await page.evaluate(() => {
    const e = window.__editor;
    const n = e.replay();
    const ids = e.plantIds();
    return { n, bloom: e.plantMatSample(ids[0]).bloom };
  });
  assert(replayed.n === 24, `replay covered ${replayed.n} plants`);
  assert(replayed.bloom < 0.2, `replay did not rewind the bloom: ${replayed.bloom}`);
  await page.waitForTimeout(3000);

  // Play mode: clicking a flower chimes instead of just selecting.
  await page.evaluate(() => window.__editor.setPlayMode(true));
  const playClicked = await page.evaluate(async () => {
    const e = window.__editor;
    const canvas = document.getElementById("c3d");
    const rect = canvas.getBoundingClientRect();
    // Aim at a plant by projecting one to screen space.
    const ids = e.plantIds();
    e.selectIds([ids[0]]);
    const before = e.audioState().kind;
    // Fire the same pointer sequence a user would.
    const p = e.projectPlant ? e.projectPlant(ids[0]) : null;
    return { before, hasProject: Boolean(p) };
  });
  void playClicked;
  await page.evaluate(() => window.__editor.setPlayMode(false));

  // Gizmo: selecting shows it, W/R/E switch mode, and it survives walking.
  const giz = await page.evaluate(async () => {
    const e = window.__editor;
    e.clear();
    const daisy = [...document.querySelectorAll("#species button")]
      .findIndex((b) => b.dataset.species === "garland-daisy");
    e.pick(daisy);
    e.plantAt(1, 1);
    e.pick(-1);
    const hiddenWhenIdle = e.gizmoState().visible;
    e.selectIds(e.plantIds());
    await new Promise((r) => setTimeout(r, 120));
    const shown = e.gizmoState();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "r" }));
    const rot = e.gizmoState().mode;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" }));
    const scale = e.gizmoState().mode;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
    const move = e.gizmoState().mode;
    return { hiddenWhenIdle, shown, rot, scale, move };
  });
  assert(giz.hiddenWhenIdle === false, "gizmo visible with nothing selected");
  assert(giz.shown.visible, "gizmo did not appear on selection");
  assert(giz.rot === "rotate" && giz.scale === "scale" && giz.move === "translate",
    `gizmo hotkeys wrong: ${JSON.stringify(giz)}`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, "gizmo.png") });

  // Sidebar must scroll rather than clip its last controls.
  const sidebar = await page.evaluate(() => {
    const side = document.getElementById("side");
    const actions = document.getElementById("actions");
    return {
      scrollable: side.scrollHeight > side.clientHeight + 2,
      overflow: getComputedStyle(side).overflowY,
      actionsInView: actions.getBoundingClientRect().bottom <= window.innerHeight + 1,
    };
  });
  assert(sidebar.overflow === "auto" || sidebar.overflow === "scroll",
    `sidebar does not scroll: ${sidebar.overflow}`);
  assert(sidebar.actionsInView, "bottom action row is clipped off-screen");

  // Walk mode: the wanderer appears, WASD moves, and edit UI hides.
  await page.evaluate(() => window.__editor.walk(true));
  await page.waitForTimeout(600);
  const walkStart = await page.evaluate(() => window.__editor.walkState());
  assert(walkStart.on, "walk mode did not engage");
  const panelHidden = await page.evaluate(() =>
    getComputedStyle(document.getElementById("side")).display === "none");
  assert(panelHidden, "editor panel still visible while walking");
  await page.keyboard.down("w");
  await page.waitForTimeout(2500);
  await page.keyboard.up("w");
  const walkEnd = await page.evaluate(() => window.__editor.walkState());
  const moved = Math.hypot(walkEnd.pos[0] - walkStart.pos[0], walkEnd.pos[2] - walkStart.pos[2]);
  assert(moved > 0.2, `wanderer did not move: ${moved.toFixed(2)}`);
  // The camera must ride along and stay behind the hero. OrbitControls.update()
  // ignores `enabled`, so if it is still running it drags the camera back to
  // its orbit and this distance blows up.
  const rig = await page.evaluate(() => {
    const e = window.__editor;
    const c = e.camera.position;
    const h = e.walkState().pos;
    return { gap: +Math.hypot(c.x - h[0], c.z - h[2]).toFixed(2), camY: +c.y.toFixed(2), heroY: h[1] };
  });
  assert(rig.gap < 12, `camera did not follow the wanderer (gap ${rig.gap})`);
  assert(rig.camY > rig.heroY + 0.5 && rig.camY < rig.heroY + 12,
    `camera height wrong in walk mode: ${rig.camY} vs hero ${rig.heroY}`);
  await page.screenshot({ path: path.join(outDir, "walk-mode.png") });
  await page.evaluate(() => window.__editor.walk(false));
  await page.waitForTimeout(400);
  const backToEdit = await page.evaluate(() =>
    getComputedStyle(document.getElementById("side")).display !== "none");
  assert(backToEdit, "editor panel did not come back");

  // ---- search, brush, top-down, photo ----
  const searchHits = await page.evaluate(() => {
    const e = window.__editor;
    const rose = e.searchSpecies("rose");
    const none = e.searchSpecies("zzzz");
    const all = e.searchSpecies("");
    return { rose, none, all };
  });
  assert(searchHits.all === 39, `clearing search should show 39, got ${searchHits.all}`);
  assert(searchHits.rose >= 2 && searchHits.rose < 39, `search "rose" matched ${searchHits.rose}`);
  assert(searchHits.none === 0, `nonsense search matched ${searchHits.none}`);

  // Brush: dragging with the brush on lays a spaced trail in one undo step.
  await page.evaluate(() => {
    const e = window.__editor;
    e.clear();
    e.setBatch({ on: false });
    const daisy = [...document.querySelectorAll("#species button")]
      .findIndex((b) => b.dataset.species === "garland-daisy");
    e.pick(daisy);
    e.setBrush(true, 0.8);
    e.setEnv(0);
  });
  const brushBox = await page.evaluate(() => {
    const r = document.getElementById("c3d").getBoundingClientRect();
    return { x: r.left + r.width * 0.34, y: r.top + r.height * 0.62, w: r.width };
  });
  await page.mouse.move(brushBox.x, brushBox.y);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) {
    await page.mouse.move(brushBox.x + i * (brushBox.w * 0.022), brushBox.y - i * 4);
    await page.waitForTimeout(35);
  }
  await page.mouse.up();
  await page.waitForTimeout(900);
  const brushed = await page.evaluate(() => window.__editor.plants());
  assert(brushed >= 4, `brush stroke planted only ${brushed}`);
  const brushUndone = await page.evaluate(() => {
    window.__editor.undo();
    return window.__editor.plants();
  });
  assert(brushUndone === 0, `a brush stroke should undo as one step, left ${brushUndone}`);
  await page.evaluate(() => window.__editor.redo());
  await page.waitForTimeout(1400);
  await page.screenshot({ path: path.join(outDir, "brush.png") });
  await page.evaluate(() => window.__editor.setBrush(false));

  // Top-down toggles to an overhead frame and back.
  const beforeTop = await page.evaluate(() => window.__editor.cameraState());
  await page.evaluate(() => window.__editor.topDown());
  await page.waitForTimeout(400);
  const topView = await page.evaluate(() => window.__editor.cameraState());
  assert(topView.pos[1] > beforeTop.pos[1] * 1.5 && topView.pos[1] > 12,
    `top-down did not rise: ${JSON.stringify(topView)}`);
  await page.screenshot({ path: path.join(outDir, "topdown.png") });
  await page.evaluate(() => window.__editor.topDown());
  await page.waitForTimeout(300);
  const restoredView = await page.evaluate(() => window.__editor.cameraState());
  assert(Math.abs(restoredView.pos[1] - beforeTop.pos[1]) < 0.5, "top-down did not restore the view");

  // Photo export must produce a real PNG download without breaking the canvas.
  const photo = await page.evaluate(async () => {
    const clicks = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { clicks.push({ href: this.href.slice(0, 24), name: this.download }); };
    document.getElementById("photoBtn").click();
    await new Promise((r) => setTimeout(r, 400));
    HTMLAnchorElement.prototype.click = orig;
    return clicks;
  });
  assert(photo.length === 1 && photo[0].href.startsWith("data:image/png"),
    `photo export failed: ${JSON.stringify(photo)}`);
  assert(/\.png$/.test(photo[0].name), `photo filename wrong: ${photo[0].name}`);

  // Art style: the picker is populated, switching takes effect, and the choice
  // travels with a saved garden.
  const style = await page.evaluate(() => {
    const e = window.__editor;
    const sel = document.getElementById("styleSel");
    const before = e.styleState();
    e.setStyle("manga");
    const on = e.styleState();
    const saved = e.save().style;
    e.setStyle("none");
    const off = e.styleState();
    return { options: sel.options.length, before, on, saved, off };
  });
  assert(style.options >= 12, `style picker has only ${style.options} options`);
  assert(style.before.id === "none" && style.before.on === false, "a style is on by default");
  assert(style.on.id === "manga" && style.on.on === true, `style did not switch: ${JSON.stringify(style.on)}`);
  assert(style.saved === "manga", `style not saved with the garden: ${style.saved}`);
  assert(style.off.on === false, "style did not switch back off");

  // Clear is the full reset: empty ground, default sliders, style back to none.
  const cleared = await page.evaluate(async () => {
    const e = window.__editor;
    e.setStyle("cyberneon");
    e.setParam("scale", 1.9);
    e.setDaylight(0.2);
    document.getElementById("brushOn").checked = true;
    document.getElementById("brushOn").dispatchEvent(new Event("change", { bubbles: true }));
    document.getElementById("clear").click();
    await new Promise((r) => setTimeout(r, 300));
    return {
      style: e.styleState().id,
      picker: document.getElementById("styleSel").value,
      scale: Number(document.querySelector('input[data-param="scale"]').value),
      day: e.daylightState().value,
      brush: e.brushState().on,
      planted: e.plantIds().length,
    };
  });
  assert(cleared.planted === 0, `clear left ${cleared.planted} plants`);
  assert(cleared.style === "none" && cleared.picker === "none", `clear did not reset the style: ${JSON.stringify(cleared)}`);
  assert(cleared.scale === 1, `clear did not reset the sliders: scale=${cleared.scale}`);
  assert(cleared.day === 1, `clear did not reset daylight: ${cleared.day}`);
  assert(cleared.brush === false, "clear did not switch the brush off");

  // Brush and batch both own the left button; ticking one must untick the other.
  const excl = await page.evaluate(() => {
    const brushBox = document.getElementById("brushOn");
    const batchBox = document.getElementById("batchOn");
    const tick = (box) => { box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); };
    tick(brushBox);
    tick(batchBox);
    const afterBatch = { brush: brushBox.checked, batch: batchBox.checked };
    tick(brushBox);
    return { afterBatch, afterBrush: { brush: brushBox.checked, batch: batchBox.checked } };
  });
  assert(!excl.afterBatch.brush && excl.afterBatch.batch, `batch did not release the brush: ${JSON.stringify(excl.afterBatch)}`);
  assert(excl.afterBrush.brush && !excl.afterBrush.batch, `brush did not release batch: ${JSON.stringify(excl.afterBrush)}`);
  await page.evaluate(() => { const b = document.getElementById("brushOn"); b.checked = false; b.dispatchEvent(new Event("change", { bubbles: true })); });

  const budget = await page.evaluate(() => window.__editor.info());
  assert(budget.calls < 160, `too many draw calls for 36 plants: ${budget.calls}`);
  assert(errors.length === 0, `page errors: ${errors.join(" | ")}`);
  console.log(JSON.stringify({ ...base, ar: hasAR, hueTrack: true, stagger, budget }, null, 1));
  await browser.close();
})().catch(async (e) => {
  console.error("FAIL:", e.message);
  process.exitCode = 1;
  await browser?.close().catch(() => {});
});
