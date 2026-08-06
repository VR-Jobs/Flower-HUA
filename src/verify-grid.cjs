// Verifies the flower display case: 90° view snapping on all three axes, the
// shared bloom toggle, and the deliberately large default wind.
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("/Users/zhuxianliu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const [target, outDir] = process.argv.slice(2);
const assert = (c, m) => { if (!c) throw new Error(m); };

(async () => {
  const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
  // Retina: a canvas whose CSS size drifts from its buffer only shows up at 2x.
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(pathToFileURL(path.resolve(target)).href);
  await page.waitForFunction(() => window.__grid?.ready, null, { timeout: 240000 });
  await page.waitForTimeout(1200);

  const species = await page.evaluate(() => window.__grid.species);
  assert(species >= 36, `only ${species} species in the case`);
  // The sheet must have no empty cell: cols*rows exactly equals the flowers.
  const grid = await page.evaluate(() => window.__grid.grid());
  assert(grid.cols * grid.rows === species, `sheet has ${grid.cols * grid.rows - species} empty cell(s)`);
  const ids = await page.evaluate(() => window.__grid.ids());
  assert(ids.includes("aurora-rose-crimson"), "the crimson Aurora Rose is missing");

  // Zen mode must cover the viewport with no band on any edge: the sheet's
  // aspect has to match the window's, not merely fit inside it.
  await page.evaluate(() => window.__grid.setZen(true));
  await page.waitForTimeout(150);
  const cover = await page.evaluate(() => window.__grid.coverage());
  assert(Math.abs(cover.w - 1) < 0.02 && Math.abs(cover.h - 1) < 0.02,
    `zen leaves a gap: sheet covers ${(cover.w * 100).toFixed(1)}% x ${(cover.h * 100).toFixed(1)}% of the screen`);
  await page.evaluate(() => window.__grid.setZen(false));
  await page.waitForTimeout(150);

  // The canvas must fill the window at its CSS size, not just its buffer size.
  const fit = await page.evaluate(() => {
    const c = document.getElementById("c3d");
    return { cw: c.clientWidth, ch: c.clientHeight, iw: window.innerWidth, ih: window.innerHeight };
  });
  assert(fit.cw === fit.iw && fit.ch === fit.ih, `canvas does not fill the window: ${JSON.stringify(fit)}`);

  // Every flower starts closed.
  const closed = await page.evaluate(() => window.__grid.bloom());
  assert(closed.every((v) => v === 0), "the case did not start closed");
  assert(!(await page.evaluate(() => window.__grid.isOpen())), "isOpen() true before Space");

  // Wind is intentionally stronger than the editor's 0.14.
  const wind = await page.evaluate(() => window.__grid.windAmp());
  assert(wind >= 0.25, `wind amplitude ${wind} is not the larger display default`);

  // Space opens the whole case; the stagger means a wave, not a switch.
  await page.keyboard.press("Space");
  await page.waitForTimeout(260);
  const mid = await page.evaluate(() => window.__grid.bloom());
  assert(mid.some((v) => v > 0), "Space did not start the bloom");
  assert(Math.max(...mid) - Math.min(...mid) > 0.02, "the bloom is not staggered across the grid");
  await page.waitForTimeout(3200);
  const opened = await page.evaluate(() => window.__grid.bloom());
  assert(opened.every((v) => v > 0.6), `some flowers did not open: min ${Math.min(...opened).toFixed(2)}`);
  if (outDir) await page.screenshot({ path: path.join(outDir, "case-open.png") });

  // Space again closes it.
  await page.keyboard.press("Space");
  await page.waitForTimeout(2400);
  const reclosed = await page.evaluate(() => window.__grid.bloom());
  assert(reclosed.every((v) => v < 0.05), `some flowers did not close: max ${Math.max(...reclosed).toFixed(2)}`);
  await page.keyboard.press("Space");
  await page.waitForTimeout(2600);

  // 90° snapping. Four presses of the same key must return to the start.
  const quatOf = () => page.evaluate(() => window.__grid.targetQuat());
  const home = await quatOf();
  const near = (a, b) => a.every((v, i) => Math.abs(Math.abs(v) - Math.abs(b[i])) < 1e-6);
  for (const [k, axis] of [["ArrowRight", "yaw"], ["ArrowDown", "pitch"], ["KeyE", "roll"]]) {
    for (let i = 1; i <= 4; i++) {
      await page.keyboard.press(k);
      await page.waitForTimeout(60);
      const steps = await page.evaluate(() => window.__grid.steps());
      assert(steps[axis] === i % 4, `${k} step ${i}: ${axis}=${steps[axis]}`);
    }
    assert(near(await quatOf(), home), `four ${k} presses did not return home`);
  }

  // Each key pair is a genuine 90° turn about a distinct axis: rotate a probe
  // vector by the target and check it lands where that axis would put it.
  const raw = await page.evaluate(() => {
    const g = window.__grid;
    const out = {};
    for (const [key, axis] of [["ArrowLeft", "yaw"], ["ArrowUp", "pitch"], ["KeyQ", "roll"]]) {
      const before = g.targetQuat();
      g.turn(axis, -1);
      out[key] = { before, after: g.targetQuat() };
      g.turn(axis, 1);
    }
    return out;
  });
  // The case rests tipped toward the viewer, so home is not identity: the turn
  // under test is the delta after ⊗ before⁻¹, not the absolute orientation.
  const mul = (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
  const conj = (q) => [-q[0], -q[1], -q[2], q[3]];
  const probes = Object.fromEntries(
    Object.entries(raw).map(([k, { before, after }]) => [k, mul(after, conj(before))]),
  );
  const rot = (q, v) => {
    const [x, y, z, w] = q;
    const t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
    return [
      v[0] + w * t[0] + (y * t[2] - z * t[1]),
      v[1] + w * t[1] + (z * t[0] - x * t[2]),
      v[2] + w * t[2] + (x * t[1] - y * t[0]),
    ];
  };
  const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-5);
  // Yaw about +Y by -90° sends +X to +Z (the right face swings to the front).
  assert(close(rot(probes.ArrowLeft, [1, 0, 0]), [0, 0, 1]), "left turn is not a yaw");
  // Pitch about +X by -90° sends +Y to -Z (the top tips away from the viewer).
  assert(close(rot(probes.ArrowUp, [0, 1, 0]), [0, 0, -1]), "up turn is not a pitch");
  // Roll about +Z by -90° sends +X to -Y (the case rolls clockwise on screen).
  assert(close(rot(probes.KeyQ, [1, 0, 0]), [0, -1, 0]), "Q is not a roll");

  // The rendered orientation actually follows the target (the slerp runs).
  // q and -q are the same orientation, so compare by |dot|, and wait for
  // convergence rather than a fixed delay: swiftshader runs at a few fps, so a
  // wall-clock wait measures the test machine, not the code.
  await page.evaluate(() => window.__grid.turn("yaw", 1));
  await page.waitForFunction(() => {
    const [a, b] = [window.__grid.quat(), window.__grid.targetQuat()];
    return Math.abs(a.reduce((s, v, i) => s + v * b[i], 0)) > 0.999;
  }, null, { timeout: 60000 }).catch(async () => {
    const [live, want] = await page.evaluate(() => [window.__grid.quat(), window.__grid.targetQuat()]);
    throw new Error(`case did not settle on the target view: ${JSON.stringify({ live, want })}`);
  });
  if (outDir) await page.screenshot({ path: path.join(outDir, "case-turned.png") });

  // Dragging rotates by an arbitrary angle, not a 90° snap.
  const spun = await page.evaluate(async () => {
    const g = window.__grid;
    const start = g.targetQuat();
    const c = document.getElementById("c3d");
    const r = c.getBoundingClientRect();
    const at = (x, y, type, button = 0) =>
      c.dispatchEvent(new PointerEvent(type, {
        pointerId: 1, bubbles: true, button, clientX: r.left + x, clientY: r.top + y,
      }));
    at(400, 400, "pointerdown");
    for (let i = 1; i <= 6; i++) at(400 + i * 9, 400 + i * 3, "pointermove");
    at(454, 418, "pointerup");
    await new Promise((res) => setTimeout(res, 120));
    return { start, after: g.targetQuat(), freeform: g.isFreeform(), steps: g.steps() };
  });
  const dot = Math.abs(spun.start.reduce((s, v, i) => s + v * spun.after[i], 0));
  assert(dot < 0.9999, "dragging did not rotate the flowers");
  // 2*acos(|dot|) is the angle between the two orientations: a real drag of this
  // size lands well short of a 90° step.
  const angle = (2 * Math.acos(Math.min(dot, 1)) * 180) / Math.PI;
  assert(angle > 1 && angle < 80, `drag angle ${angle.toFixed(1)}° is not a free rotation`);
  assert(spun.freeform === true, "a drag did not mark the view as freeform");

  // Esc hides every panel and spreads the sheet: the fit margin drops, so the
  // camera comes closer.
  // One press only: Escape toggles, and an event dispatched on document also
  // bubbles to the window listener, so a belt-and-braces double dispatch would
  // turn zen mode straight back off.
  const far = await page.evaluate(() => window.__grid.camDistance());
  await page.keyboard.press("Escape");
  await page.waitForTimeout(120);
  const zenState = await page.evaluate((farDist) => {
    const g = window.__grid;
    const vis = (id) => {
      const el = document.getElementById(id);
      return el ? getComputedStyle(el).display !== "none" : false;
    };
    return { far: farDist, near: g.camDistance(), zen: g.zen(), hud: vis("hud"), keys: vis("keys"), pad: vis("pad") };
  }, far);
  assert(zenState.zen === true, "Esc did not enter zen mode");
  assert(!zenState.hud && !zenState.keys && !zenState.pad, `Esc left panels visible: ${JSON.stringify(zenState)}`);
  assert(zenState.near < zenState.far, `zen did not spread the sheet: ${zenState.far} -> ${zenState.near}`);
  if (outDir) await page.screenshot({ path: path.join(outDir, "case-zen.png") });
  await page.evaluate(() => window.__grid.setZen(false));

  // R clears the freeform drag and returns home.
  await page.keyboard.press("KeyR");
  await page.waitForTimeout(80);
  assert(!(await page.evaluate(() => window.__grid.isFreeform())), "R did not clear freeform");

  // A click that never moves still snaps 90°, and the on-screen pad works.
  const before = (await page.evaluate(() => window.__grid.steps())).yaw;
  await page.mouse.click(720, 500, { button: "right" });
  await page.waitForTimeout(80);
  const afterMouse = (await page.evaluate(() => window.__grid.steps())).yaw;
  assert(afterMouse === (before + 1) % 4, `right click did not turn: ${before} -> ${afterMouse}`);
  await page.click("#bUp");
  await page.waitForTimeout(80);
  assert((await page.evaluate(() => window.__grid.steps())).pitch !== 0, "the pad did not turn the case");

  // R returns to the home view.
  await page.keyboard.press("KeyR");
  await page.waitForTimeout(80);
  const reset = await page.evaluate(() => window.__grid.steps());
  assert(reset.yaw === 0 && reset.pitch === 0 && reset.roll === 0, `R did not reset: ${JSON.stringify(reset)}`);

  // Nothing may spill out of its cell: the fitted sphere is what guarantees it,
  // so check the fit itself rather than eyeballing a screenshot.
  const spill = await page.evaluate(() => window.__grid.cellFit());
  assert(spill.worst <= 1.0, `flowers overflow their cells, worst ${spill.worst.toFixed(3)} (${spill.worstId})`);

  const budget = await page.evaluate(() => window.__grid.info());
  assert(errors.length === 0, `console errors: ${errors.slice(0, 3).join(" | ")}`);
  console.log(JSON.stringify({ species, wind, budget }, null, 1));
  await browser.close();
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
