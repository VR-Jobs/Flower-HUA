// Builds one self-contained HTML page that renders flowers from the Flower-HUA
// library. Same machinery as build-flower-hua-html.cjs (Next's vendored webpack
// plus the shared ts-loader), minus React, the Studio interface and the
// MediaPipe AR payload — so the output is a couple of MB, not 43.
//
//   node tools/single-html/build-flower-page.cjs <ids|all> [output.html]
//
//   node tools/single-html/build-flower-page.cjs sun-gold-sunflower "向日葵.html"
//   node tools/single-html/build-flower-page.cjs moonlit-lotus,scarlet-rose two.html
//   node tools/single-html/build-flower-page.cjs all gallery.html
//
// With more than one flower the page grows a picker and honours a #flower-id
// deep link.

const fs = require("node:fs");
const path = require("node:path");

const builderDir = __dirname;
const skillRoot = path.resolve(builderDir, "../..");
const studioDir =
  process.env.FLOWER_HUA_STUDIO_DIR || path.join(skillRoot, "Studio");
const storePath =
  process.env.FLOWER_HUA_STORE_FILE || path.join(skillRoot, "data/flowers.json");

const selector = process.argv[2] || "sun-gold-sunflower";
const outputDir = path.join(builderDir, ".build-flower-page");
// "garden" is a different page entirely: a walkable low-poly garden planted
// with every flower, rather than one flower on a turntable.
const garden = selector === "garden";
// "world" is the dense flower-world variant of the garden page.
const world = selector === "world";
// "grid" is the display case: every flower in its own cell, 90° view snapping.
const grid = selector === "grid";
// "editor" is the map-editor-style flower placement tool. "editor-lite" is the
// same tool without the 26 MB MediaPipe payload — AR is the only thing missing.
const editorLite = selector === "editor-lite";
const editor = selector === "editor" || editorLite;
const withAR = editor && !editorLite;

process.env.FLOWER_HUA_STUDIO_DIR = studioDir;

const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
const all = store.flowers || [];

let flowers;
if (selector === "all" || garden || world || editor || grid) {
  flowers = all;
} else {
  flowers = selector.split(",").map((id) => {
    const found = all.find((entry) => entry.id === id.trim());
    if (!found) {
      throw new Error(
        `No flower with id "${id.trim()}". Available: ${all.map((e) => e.id).join(", ")}`,
      );
    }
    return found;
  });
}
if (flowers.length === 0) throw new Error("No flowers selected");

const outputHtml = path.resolve(
  skillRoot,
  process.argv[3] ||
    (editorLite
      ? "双击打开 鲜花编辑器 轻量版.html"
      : editor
      ? "双击打开 鲜花编辑器.html"
      : grid
      ? "双击打开 花朵陈列柜.html"
      : world
      ? "双击打开 鲜花世界.html"
      : garden
      ? "双击打开 花园漫游.html"
      : flowers.length === 1
        ? `双击打开 ${flowers[0].id}.html`
        : "双击打开 花朵画廊.html"),
);

const webpack = require(
  path.join(studioDir, "node_modules/next/dist/compiled/webpack/webpack.js"),
).webpack;

const config = {
  mode: "production",
  target: ["web", "es2020"],
  entry: path.join(
    builderDir,
    editor
      ? "flower-editor-entry.ts"
      : grid
        ? "flower-grid-entry.ts"
        : world
        ? "flower-world-entry.ts"
        : garden
          ? "garden-entry.ts"
          : "flower-page-entry.ts",
  ),
  output: {
    path: outputDir,
    filename: "flower.bundle.js",
    iife: true,
    clean: true,
  },
  devtool: false,
  resolve: {
    extensions: [".tsx", ".ts", ".jsx", ".js", ".json"],
    modules: [path.join(studioDir, "node_modules"), "node_modules"],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: [{ loader: path.join(builderDir, "ts-loader.cjs") }],
      },
    ],
  },
  plugins: [
    new webpack.DefinePlugin({
      __FLOWERS__: JSON.stringify(flowers),
      // The editor's AR hand-planting embeds MediaPipe (SIMD build only —
      // every 2020+ browser has WASM SIMD; skipping the nosimd twin saves
      // ~14 MB). Other pages get empty strings and never touch them.
      ...(withAR
        ? (() => {
            const mp = path.join(studioDir, "public/mediapipe");
            return {
              __MP_SIMD_LOADER__: JSON.stringify(
                fs.readFileSync(path.join(mp, "wasm/vision_wasm_internal.js"), "utf8"),
              ),
              __MP_SIMD_WASM_B64__: JSON.stringify(
                fs.readFileSync(path.join(mp, "wasm/vision_wasm_internal.wasm")).toString("base64"),
              ),
              __MP_TASK_B64__: JSON.stringify(
                fs.readFileSync(path.join(mp, "gesture_recognizer.task")).toString("base64"),
              ),
            };
          })()
        : {
            __MP_SIMD_LOADER__: JSON.stringify(""),
            __MP_SIMD_WASM_B64__: JSON.stringify(""),
            __MP_TASK_B64__: JSON.stringify(""),
          }),
    }),
    // A file:// page cannot fetch a sibling chunk.
    new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
  ],
  // Next's vendored minimizer reaches for a private Next build-time module.
  optimization: { minimize: false },
  performance: { hints: false },
};

const many = flowers.length > 1;
const title = editorLite
  ? "Flower-HUA · 鲜花编辑器 轻量版"
  : editor
  ? "Flower-HUA · 鲜花编辑器"
  : world
  ? "Flower-HUA · 鲜花世界"
  : garden
  ? "Flower-HUA · 花园漫游"
  : many
    ? "Flower-HUA · 花朵画廊"
    : flowers[0].name;


const editorPage = (bundle) => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${title}</title>
<style>
  :root{--panel:#1d232b;--panel2:#242c36;--line:#38424f;--ink:#e8edf3;--dim:#93a0af;--gold:#ffd257;--rose:#ef6f8e}
  html,body{margin:0;height:100%;overflow:hidden;background:#10151b;
    font:500 13.5px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",sans-serif;color:var(--ink);
    -webkit-user-select:none;user-select:none}
  #app{display:grid;grid-template-columns:264px 1fr;height:100%}
  /* The panel grew past one screen; let it scroll instead of clipping. */
  #side{background:var(--panel);border-right:1px solid var(--line);display:flex;flex-direction:column;
    min-height:0;overflow-y:auto;overscroll-behavior:contain}
  #side::-webkit-scrollbar{width:9px}
  #side::-webkit-scrollbar-thumb{background:#3d4753;border-radius:5px}
  #side h1{font-size:15px;letter-spacing:.08em;margin:0;padding:14px 16px 10px;color:var(--gold)}
  #side .sec{padding:10px 14px 4px;font-size:11px;letter-spacing:.14em;color:var(--dim)}
  #envs{display:flex;gap:8px;padding:4px 14px 6px}
  #envs button{flex:1;padding:9px 4px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);
    color:var(--ink);font:inherit;font-size:12.5px;cursor:pointer;transition:all .15s}
  #envs button.on{border-color:var(--gold);color:var(--gold);background:#2c3038}
  #species{flex:0 0 auto;max-height:34vh;overflow-y:auto;display:grid;grid-template-columns:1fr;gap:7px;padding:8px 14px;align-content:start}
  #species button{display:flex;align-items:center;gap:11px;padding:6px 9px;border-radius:12px;border:1px solid var(--line);
    background:var(--panel2);color:var(--ink);font:inherit;font-size:13px;cursor:pointer;text-align:left;transition:all .15s}
  #species button:hover{border-color:#566374}
  #species button.on{border-color:var(--rose);background:#33262c;color:#ffd7e2}
  #species .th{width:44px;height:44px;border-radius:10px;flex:none;background:#171c22;object-fit:cover}
  #species .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #params{border-top:1px solid var(--line);padding:10px 16px 8px}
  #params label{display:block;margin:7px 0}
  #params .row{display:flex;justify-content:space-between;font-size:12px;color:var(--dim);margin-bottom:3px}
  #params .val{color:var(--ink);font-variant-numeric:tabular-nums}
  #params input[type=range]{width:100%;accent-color:var(--rose)}
  .paramsHead{display:flex;align-items:center;justify-content:space-between}
  #resetParams{border:1px solid var(--line);background:var(--panel2);color:var(--dim);font:inherit;
    font-size:11px;padding:3px 10px;border-radius:8px;cursor:pointer;letter-spacing:.04em;transition:all .15s}
  #resetParams:hover{border-color:var(--gold);color:var(--gold)}
  #params input[data-param=hue]{-webkit-appearance:none;appearance:none;height:14px;border-radius:7px;outline:none}
  #params input[data-param=hue]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:19px;height:19px;
    border-radius:50%;background:#fff;border:2.5px solid #20242b;box-shadow:0 1px 5px rgba(0,0,0,.5);cursor:pointer}
  #params .sw2{display:inline-block;width:15px;height:15px;border-radius:5px;vertical-align:-3px;margin-right:6px;
    box-shadow:inset 0 0 0 1px rgba(255,255,255,.3)}
  .chk{display:flex;align-items:center;gap:8px;padding:8px 16px 2px;font-size:13px;cursor:pointer}
  .chk input{accent-color:var(--gold);width:16px;height:16px}
  #batchOpts{padding:2px 16px 8px}
  #batchOpts.off{display:none}
  #batchOpts label{display:block;margin:7px 0}
  #batchOpts .row{display:flex;justify-content:space-between;font-size:12px;color:var(--dim);margin-bottom:3px}
  #batchOpts .val{color:var(--ink);font-variant-numeric:tabular-nums}
  #batchOpts input[type=range]{width:100%;accent-color:var(--gold)}
  #batchOpts select{width:100%;padding:7px 9px;border-radius:9px;border:1px solid var(--line);
    background:var(--panel2);color:var(--ink);font:inherit;font-size:12.5px}
  /* Two rows: the status line never squeezes the buttons into vertical text. */
  #actions{display:grid;grid-template-columns:36px 1fr 1fr;gap:8px;padding:8px 14px 16px;
    border-top:1px solid var(--line);align-items:center;position:sticky;bottom:0;background:var(--panel)}
  #countWrap{grid-column:1 / -1;text-align:center}
  #actions button{padding:9px 6px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);
    color:var(--dim);font:inherit;font-size:12.5px;cursor:pointer;transition:all .15s}
  #actions #mute{color:var(--gold);border-color:var(--gold);padding:9px 0}
  #actions #mute.mutedOn{color:var(--dim);border-color:var(--line)}
  #actions #delete.enabled{border-color:var(--gold);color:var(--gold)}
  #actions #clear:hover{border-color:var(--rose);color:var(--rose)}
  #countWrap{font-size:12px;color:var(--dim);white-space:nowrap}
  #count{color:var(--gold);font-weight:700}
  #stage{position:relative;min-width:0}
  #stage > canvas{display:block;width:100%!important;height:100%!important;touch-action:none}
  #hint{position:absolute;left:0;right:0;top:14px;text-align:center;pointer-events:none;font-size:13px;
    color:#fff;text-shadow:0 1px 8px rgba(0,0,0,.55);letter-spacing:.04em;opacity:.92}
  #arPanel{position:absolute;right:16px;bottom:16px;width:240px;border-radius:14px;overflow:hidden;
    border:2px solid var(--gold);box-shadow:0 6px 24px rgba(0,0,0,.45);background:#000}
  #arPanel.off{display:none}
  #arVideo{display:block;width:100%;transform:scaleX(-1)}
  #arOverlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
  #arStatus{position:absolute;left:0;right:0;bottom:0;padding:5px 8px;font-size:11px;text-align:center;
    color:#ffd257;background:rgba(0,0,0,.55);letter-spacing:.04em}
  #fingerDot{position:absolute;width:18px;height:18px;border-radius:50%;pointer-events:none;display:none;
    background:radial-gradient(circle,#ffd257 0%,rgba(255,210,87,.25) 60%,transparent 75%);
    box-shadow:0 0 12px rgba(255,210,87,.8);transform:translate(-50%,-50%)}
  /* Two columns: five controls in one flex row squeeze into vertical letters. */
  #sceneRow{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:6px 14px 2px}
  #sceneRow select{grid-column:1 / -1}
  #sceneRow button,#sceneRow select{padding:7px 6px;border-radius:9px;border:1px solid var(--line);
    background:var(--panel2);color:var(--ink);font:inherit;font-size:12px;cursor:pointer;transition:all .15s;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #sceneRow button:hover,#sceneRow select:hover{border-color:var(--gold);color:var(--gold)}
  body.walking #side{display:none}
  body.walking #app{grid-template-columns:1fr}
  body.walking #walkFloat{display:block}
  #walkFloat{display:none;position:absolute;left:16px;top:14px;padding:9px 16px;border-radius:10px;
    border:1px solid var(--gold);background:rgba(20,26,33,.85);color:var(--gold);font:inherit;
    font-size:13px;cursor:pointer;z-index:6}
  #styleSel{margin:0 14px 4px;padding:8px 10px;border-radius:9px;border:1px solid var(--line);
    background:var(--panel2);color:var(--ink);font:inherit;font-size:12.5px;cursor:pointer}
  #styleSel:hover{border-color:var(--gold);color:var(--gold)}
  #search{margin:0 14px 2px;padding:7px 11px;border-radius:9px;border:1px solid var(--line);
    background:var(--panel2);color:var(--ink);font:inherit;font-size:12.5px;outline:none}
  #search:focus{border-color:var(--rose)}
  #search::-webkit-search-cancel-button{filter:invert(.6)}
  #species button.hidden{display:none}
  .liteNote{padding:8px 16px 2px;font-size:12px;color:var(--dim)}
  #brushOpts{padding:2px 16px 6px}
  #brushOpts.off{display:none}
  #brushOpts .row{display:flex;justify-content:space-between;font-size:12px;color:var(--dim);margin-bottom:3px}
  #brushOpts .val{color:var(--ink);font-variant-numeric:tabular-nums}
  #brushOpts input[type=range]{width:100%;accent-color:var(--gold)}
  #fileRow{display:flex;gap:6px;padding:8px 14px 0}
  #fileRow button{flex:1;padding:7px 2px;border-radius:9px;border:1px solid var(--line);background:var(--panel2);
    color:var(--dim);font:inherit;font-size:12px;cursor:pointer;transition:all .15s;white-space:nowrap}
  #fileRow button:hover:not(:disabled){border-color:var(--gold);color:var(--gold)}
  #fileRow button:disabled{opacity:.35;cursor:default}
  #fileRow #undo,#fileRow #redo{flex:0 0 34px;font-size:15px}
  #selectBox{position:absolute;display:none;border:1.5px dashed var(--gold);
    background:rgba(255,210,87,.12);pointer-events:none;border-radius:3px}
  #toast{position:absolute;left:50%;top:64px;transform:translateX(-50%);padding:8px 16px;border-radius:10px;
    background:rgba(20,26,33,.9);color:var(--gold);font-size:12.5px;letter-spacing:.04em;
    opacity:0;transition:opacity .25s;pointer-events:none}
  #toast.on{opacity:1}
  #boot{position:fixed;inset:0;display:grid;place-content:center;gap:14px;justify-items:center;
    background:#10151b;color:var(--ink);z-index:9;letter-spacing:.08em}
  #boot .ring{width:34px;height:34px;border:3px solid rgba(232,237,243,.2);border-top-color:var(--rose);
    border-radius:50%;animation:spin .9s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div id="app">
  <aside id="side">
    <h1>🌸 鲜花编辑器</h1>
    <div class="sec">地理环境 TERRAIN</div>
    <div id="envs">
      <button data-env="lawn">🌿 草坪</button>
      <button data-env="tundra">❄️ 冰原</button>
      <button data-env="desert">🏜 沙漠</button>
    </div>
    <div class="sec">花朵图鉴 FLOWERS · 点选后到地面种植</div>
    <input id="search" type="search" placeholder="搜索花名…" autocomplete="off">
    <div id="species"></div>
    <div id="params">
      <div class="sec paramsHead" style="padding:0 0 4px">参数 PARAMETERS <button id="resetParams" type="button">↺ 重置</button></div>
      <label><div class="row"><span>大小 Size</span><span class="val"></span></div>
        <input type="range" data-param="scale" min="0.4" max="3" step="0.05" value="1"></label>
      <label><div class="row"><span>飘动速度 Wind Speed</span><span class="val"></span></div>
        <input type="range" data-param="windSpeed" min="0" max="4" step="0.05" value="1.2"></label>
      <label><div class="row"><span>飘动幅度 Wind Amount</span><span class="val"></span></div>
        <input type="range" data-param="windAmp" min="0" max="0.4" step="0.01" value="0.14"></label>
      <label><div class="row"><span>色相 Hue Shift</span><span><span class="sw2"></span><span class="val"></span></span></div>
        <input type="range" data-param="hue" min="-180" max="180" step="1" value="0"></label>
    </div>
    <label><div class="row" style="padding:8px 16px 0"><span>时间 Time of Day</span><span class="val"></span></div>
      <input type="range" id="daylight" min="0" max="1" step="0.02" value="1" style="width:calc(100% - 32px);margin:4px 16px 2px;accent-color:#ffd257"></label>
    <div class="sec">画风 ART STYLE</div>
    <select id="styleSel"></select>
    <div id="sceneRow">
      <button id="walkBtn">🚶 漫游</button>
      <button id="replayBtn">⏱ 生长回放</button>
      <button id="topBtn" title="俯视规划视角">🗺 俯视</button>
      <button id="photoBtn" title="导出当前画面 PNG">📷 照片</button>
      <select id="templates">
        <option value="">📐 示例花园…</option>
        <option value="mandala">🌸 曼陀罗阵</option>
        <option value="rainbow">🌈 彩虹弧</option>
        <option value="keyboard">🎹 音阶琴键田</option>
      </select>
    </div>
    <label class="chk"><input type="checkbox" id="playModeOn"> 🎹 演奏模式 Play Notes</label>
    <label class="chk"><input type="checkbox" id="musicOn"> 🎵 音乐花园 Music Garden</label>
    ${withAR ? '<label class="chk"><input type="checkbox" id="arOn"> 🖐 AR 手势种花 Hand Planting</label>' : '<div class="liteNote">🖐 AR 手势种花请用完整版</div>'}
    <label class="chk"><input type="checkbox" id="brushOn"> 🖌 画笔连种 Brush Painting</label>
    <div id="brushOpts" class="off">
      <label><div class="row"><span>笔触间距 Spacing</span><span class="val"></span></div>
        <input type="range" id="bSpacing" min="0.4" max="4" step="0.1" value="1.2"></label>
    </div>
    <label class="chk"><input type="checkbox" id="batchOn"> 🌾 批量种植 Batch Planting</label>
    <div id="batchOpts" class="off">
      <label><div class="row"><span>数量 Count</span><span class="val"></span></div>
        <input type="range" id="bCount" min="2" max="80" step="1" value="20"></label>
      <label><div class="row"><span>形状 Shape</span></div>
        <select id="bShape">
          <option value="disc">🌕 圆盘 Disc</option>
          <option value="ring">💍 圆环 Ring</option>
          <option value="grid">🔲 网格 Grid</option>
          <option value="scatter">✨ 自由散布 Scatter</option>
        </select></label>
      <label><div class="row"><span>范围半径 Radius</span><span class="val"></span></div>
        <input type="range" id="bRadius" min="1" max="10" step="0.5" value="4"></label>
      <label><div class="row"><span>随机分布性 Randomness</span><span class="val"></span></div>
        <input type="range" id="bRand" min="0" max="1" step="0.05" value="0.5"></label>
    </div>
    <div id="fileRow">
      <button id="undo" title="撤销 ⌘Z">↶</button>
      <button id="redo" title="重做 ⇧⌘Z">↷</button>
      <button id="exportBtn" title="导出 .json">⬇ 导出</button>
      <button id="importBtn" title="导入 .json">⬆ 导入</button>
      <button id="shareBtn" title="复制分享链接">🔗 分享</button>
      <input type="file" id="importFile" accept="application/json" hidden>
    </div>
    <div id="actions">
      <span id="countWrap">已种 <span id="count">0</span> 株 · <span id="gizmoMode">W 移动</span></span>
      <button id="mute" title="种植音效">🔊</button>
      <button id="delete">删除</button>
      <button id="clear">清空</button>
    </div>
  </aside>
  <div id="stage">
    <div id="hint"></div>
    <div id="arPanel" class="off">
      <video id="arVideo" playsinline muted></video>
      <canvas id="arOverlay"></canvas>
      <div id="arStatus">正在启动摄像头…</div>
    </div>
    <div id="fingerDot"></div>
    <div id="selectBox"></div>
    <button id="walkFloat" type="button">✎ 回到编辑</button>
    <div id="toast"></div>
  </div>
</div>
<div id="boot"><div class="ring"></div><div id="boot-label">正在准备鲜花编辑器…</div></div>
<script>${bundle}</script>
<script>
  (function(){
    var boot=document.getElementById('boot');
    var t=setInterval(function(){if(window.__editor&&window.__editor.ready){clearInterval(t);boot.remove();}},80);
  })();
</script>
</body>
</html>
`;

const gridPage = (bundle) => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="color-scheme" content="dark">
<title>${title}</title>
<style>
  html,body{margin:0;height:100%;overflow:hidden;background:#0d1420;color:#e8eefc;
    font:500 14px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",sans-serif;
    -webkit-user-select:none;user-select:none}
  #stage{position:fixed;inset:0}
  #stage > canvas{display:block;width:100%!important;height:100%!important;touch-action:none}
  #hud{position:fixed;left:0;right:0;top:0;padding:14px 18px 26px;pointer-events:none;
    background:linear-gradient(rgba(8,12,20,.82),rgba(8,12,20,0))}
  #hud h1{margin:0;font-size:17px;letter-spacing:.06em}
  #state{margin-top:4px;font-size:13px;color:#9fb6dd}
  #state b{color:#ffd257;font-weight:700}
  #keys{position:fixed;left:18px;bottom:18px;font-size:12.5px;color:#9fb6dd;line-height:1.9;
    background:rgba(10,16,26,.72);border:1px solid #24334f;border-radius:12px;padding:10px 14px}
  #keys kbd{display:inline-block;min-width:19px;text-align:center;padding:1px 5px;margin:0 1px;
    border:1px solid #3f5c8f;border-bottom-width:2px;border-radius:5px;color:#e8eefc;
    background:#182741;font:600 11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}
  #pad{position:fixed;right:18px;bottom:18px;display:grid;gap:6px;
    grid-template-columns:repeat(3,44px);grid-template-rows:repeat(3,38px)}
  #pad button{border:1px solid #3f5c8f;background:rgba(24,39,65,.85);color:#e8eefc;border-radius:9px;
    font-size:15px;cursor:pointer;padding:0}
  #pad button:hover{background:#24406e;border-color:#5f86c9}
  #bUp{grid-area:1/2}#bLeft{grid-area:2/1}#bDown{grid-area:2/2}#bRight{grid-area:2/3}
  #bRollL{grid-area:3/1}#bBloom{grid-area:3/2;color:#ffd257}#bRollR{grid-area:3/3}
  #boot{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
    gap:12px;background:#0d1420;z-index:20;transition:opacity .5s}
  #boot.off{opacity:0;pointer-events:none}
  #boot .ring{width:46px;height:46px;border:3px solid #24334f;border-top-color:#ffd257;border-radius:50%;
    animation:spin 1s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  #boot-label{font-size:13px;color:#9fb6dd}
  /* Esc: nothing but the flowers. */
  body.zen #hud,body.zen #keys,body.zen #pad{display:none}
  @media (max-width:640px){#keys{display:none}}
</style>
</head>
<body>
<div id="stage"></div>
<div id="hud">
  <h1>🌸 花朵陈列柜 · Flower Display Case</h1>
  <div id="state"></div>
</div>
<div id="keys">
  <b>按住鼠标拖动</b> 任意角度旋转所有花朵　<kbd>Esc</kbd> 隐藏面板铺满全屏<br>
  <kbd>←</kbd><kbd>→</kbd> / <kbd>A</kbd><kbd>D</kbd> 左右转 90°（单击不拖动同）<br>
  <kbd>↑</kbd><kbd>↓</kbd> / <kbd>W</kbd><kbd>S</kbd> 上下翻 90°　<kbd>Q</kbd><kbd>E</kbd> 前后滚 90°<br>
  <kbd>空格</kbd> 全部盛开／合拢　<kbd>R</kbd> 复位　滚轮缩放
</div>
<div id="pad">
  <button id="bUp" title="上翻 90°">▲</button>
  <button id="bLeft" title="左转 90°">◀</button>
  <button id="bDown" title="下翻 90°">▼</button>
  <button id="bRight" title="右转 90°">▶</button>
  <button id="bRollL" title="前滚 90°">↺</button>
  <button id="bBloom" title="盛开／合拢">🌸</button>
  <button id="bRollR" title="后滚 90°">↻</button>
</div>
<div id="boot"><div class="ring"></div><div id="boot-label">正在培育花朵…</div></div>
<script>${bundle}</script>
</body>
</html>
`;

const gardenPage = (bundle) => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="color-scheme" content="light">
<title>${title}</title>
<style>
  html,body{margin:0;height:100%;overflow:hidden;background:#9ed8f2;
    font:500 14px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",sans-serif;
    -webkit-user-select:none;user-select:none}
  #stage{position:fixed;inset:0}
  /* Belt and braces against a canvas whose CSS size drifts from its buffer. */
  #stage > canvas{display:block;width:100%!important;height:100%!important;touch-action:none}
  #arPanel{position:absolute;right:16px;bottom:16px;width:240px;border-radius:14px;overflow:hidden;
    border:2px solid var(--gold);box-shadow:0 6px 24px rgba(0,0,0,.45);background:#000}
  #arPanel.off{display:none}
  #arVideo{display:block;width:100%;transform:scaleX(-1)}
  #arOverlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
  #arStatus{position:absolute;left:0;right:0;bottom:0;padding:5px 8px;font-size:11px;text-align:center;
    color:#ffd257;background:rgba(0,0,0,.55);letter-spacing:.04em}
  #fingerDot{position:absolute;width:18px;height:18px;border-radius:50%;pointer-events:none;display:none;
    background:radial-gradient(circle,#ffd257 0%,rgba(255,210,87,.25) 60%,transparent 75%);
    box-shadow:0 0 12px rgba(255,210,87,.8);transform:translate(-50%,-50%)}
  /* Two columns: five controls in one flex row squeeze into vertical letters. */
  #sceneRow{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:6px 14px 2px}
  #sceneRow select{grid-column:1 / -1}
  #sceneRow button,#sceneRow select{padding:7px 6px;border-radius:9px;border:1px solid var(--line);
    background:var(--panel2);color:var(--ink);font:inherit;font-size:12px;cursor:pointer;transition:all .15s;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #sceneRow button:hover,#sceneRow select:hover{border-color:var(--gold);color:var(--gold)}
  body.walking #side{display:none}
  body.walking #app{grid-template-columns:1fr}
  body.walking #walkFloat{display:block}
  #walkFloat{display:none;position:absolute;left:16px;top:14px;padding:9px 16px;border-radius:10px;
    border:1px solid var(--gold);background:rgba(20,26,33,.85);color:var(--gold);font:inherit;
    font-size:13px;cursor:pointer;z-index:6}
  #styleSel{margin:0 14px 4px;padding:8px 10px;border-radius:9px;border:1px solid var(--line);
    background:var(--panel2);color:var(--ink);font:inherit;font-size:12.5px;cursor:pointer}
  #styleSel:hover{border-color:var(--gold);color:var(--gold)}
  #search{margin:0 14px 2px;padding:7px 11px;border-radius:9px;border:1px solid var(--line);
    background:var(--panel2);color:var(--ink);font:inherit;font-size:12.5px;outline:none}
  #search:focus{border-color:var(--rose)}
  #search::-webkit-search-cancel-button{filter:invert(.6)}
  #species button.hidden{display:none}
  .liteNote{padding:8px 16px 2px;font-size:12px;color:var(--dim)}
  #brushOpts{padding:2px 16px 6px}
  #brushOpts.off{display:none}
  #brushOpts .row{display:flex;justify-content:space-between;font-size:12px;color:var(--dim);margin-bottom:3px}
  #brushOpts .val{color:var(--ink);font-variant-numeric:tabular-nums}
  #brushOpts input[type=range]{width:100%;accent-color:var(--gold)}
  #fileRow{display:flex;gap:6px;padding:8px 14px 0}
  #fileRow button{flex:1;padding:7px 2px;border-radius:9px;border:1px solid var(--line);background:var(--panel2);
    color:var(--dim);font:inherit;font-size:12px;cursor:pointer;transition:all .15s;white-space:nowrap}
  #fileRow button:hover:not(:disabled){border-color:var(--gold);color:var(--gold)}
  #fileRow button:disabled{opacity:.35;cursor:default}
  #fileRow #undo,#fileRow #redo{flex:0 0 34px;font-size:15px}
  #selectBox{position:absolute;display:none;border:1.5px dashed var(--gold);
    background:rgba(255,210,87,.12);pointer-events:none;border-radius:3px}
  #toast{position:absolute;left:50%;top:64px;transform:translateX(-50%);padding:8px 16px;border-radius:10px;
    background:rgba(20,26,33,.9);color:var(--gold);font-size:12.5px;letter-spacing:.04em;
    opacity:0;transition:opacity .25s;pointer-events:none}
  #toast.on{opacity:1}
  #boot{position:fixed;inset:0;display:grid;place-content:center;gap:14px;
    justify-items:center;background:#0e1512;color:#eae2d2;z-index:9;letter-spacing:.08em}
  #boot .ring{width:34px;height:34px;border:3px solid rgba(234,226,210,.25);
    border-top-color:#ef6f8e;border-radius:50%;animation:spin .9s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  #hud{position:fixed;left:0;right:0;top:24px;text-align:center;font-size:17px;
    font-weight:600;letter-spacing:.06em;color:#fff;pointer-events:none;
    text-shadow:0 2px 10px rgba(0,0,0,.45);opacity:0;transition:opacity .25s}
  #tips{position:fixed;left:16px;bottom:14px;color:#25402f;background:rgba(255,255,255,.62);
    -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);
    padding:9px 14px;border-radius:12px;font-size:12.5px;line-height:1.7;
    pointer-events:none;letter-spacing:.03em}
  #tips b{color:#c94f7c}
  #pad{display:none;position:fixed;right:24px;bottom:28px;width:124px;height:124px;
    border-radius:50%;background:rgba(255,255,255,.34);border:2px solid rgba(255,255,255,.6);
    place-content:center;touch-action:none;z-index:5}
  #nub{width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,.9);
    box-shadow:0 2px 10px rgba(0,0,0,.2)}
  #rebloom{position:fixed;right:22px;top:20px;z-index:6;cursor:pointer;font:600 13.5px/1.2 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;
    color:#fff;background:rgba(201,79,124,.82);border:1px solid rgba(255,255,255,.55);
    padding:10px 18px;border-radius:999px;letter-spacing:.06em;
    box-shadow:0 4px 16px rgba(160,40,90,.35);transition:transform .15s,background .15s}
  #rebloom:hover{background:rgba(220,92,140,.95);transform:scale(1.04)}
  @media (max-width:520px){#tips{font-size:11px;right:160px}}
</style>
</head>
<body>
<div id="stage"></div>
<div id="hud"></div>
<div id="tips"><b>W A S D</b> / 方向键 行走 · <b>Shift</b> 奔跑 · 拖动鼠标转视角 · 滚轮拉近拉远<br>${world ? "走进花海或巨型花下会显示花名" : "走近花坛会显示花名"} · 共 ${flowers.length} 种花</div>
<div id="pad"><div id="nub"></div></div>
${world ? '<button id="rebloom" type="button">🌸 重新绽放</button>' : ""}
<div id="boot"><div class="ring"></div><div id="boot-label">正在栽种 ${flowers.length} 种花…</div></div>
<script>${bundle}</script>
<script>
  // The engine builds all ${flowers.length} flowers synchronously on load; hide the
  // splash only once that work has actually finished.
  (function(){
    var boot=document.getElementById('boot');
    if(window.__garden){boot.remove();return;}
    var t=setInterval(function(){if(window.__garden){clearInterval(t);boot.remove();}},80);
  })();
</script>
</body>
</html>
`;

const page = (bundle) => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${title}</title>
<style>
  html,body{margin:0;height:100%;background:#07060a;overflow:hidden}
  #stage{position:fixed;inset:0}
  #stage canvas{display:block}
  #ui{position:fixed;left:0;right:0;bottom:0;display:flex;justify-content:center;
      align-items:center;gap:14px;flex-wrap:wrap;
      padding:20px 16px calc(20px + env(safe-area-inset-bottom));
      font:500 14px/1.4 -apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",sans-serif;
      color:#f4ead8;pointer-events:none}
  #caption{letter-spacing:.06em;text-shadow:0 1px 12px rgba(0,0,0,.75)}
  #picker,#replay{pointer-events:auto;cursor:pointer;font:inherit;color:inherit;
      letter-spacing:.05em;border:1px solid rgba(244,234,216,.32);
      background:rgba(20,16,10,.5);padding:8px 16px;border-radius:999px;
      -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);
      transition:background .18s,border-color .18s}
  #picker{max-width:min(70vw,320px)}
  #picker option{background:#14100a;color:#f4ead8}
  #picker:hover,#replay:hover{background:rgba(244,234,216,.16);
      border-color:rgba(244,234,216,.6)}
  #hint{position:fixed;top:18px;left:0;right:0;text-align:center;
      font:400 12px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;
      color:rgba(244,234,216,.42);pointer-events:none;letter-spacing:.08em}
  @media (max-width:520px){#caption{display:none}}
</style>
</head>
<body>
<div id="stage"></div>
<div id="hint">拖动旋转 · 滚轮缩放${many ? " · 下拉切换花朵" : ""}</div>
<div id="ui">
  <select id="picker" aria-label="选择花朵"${many ? "" : " hidden"}></select>
  <span id="caption"></span>
  <button id="replay" type="button">重新绽放</button>
</div>
<script>${bundle}</script>
</body>
</html>
`;

webpack(config, (error, stats) => {
  if (error) {
    console.error(error);
    process.exitCode = 1;
    return;
  }
  const info = stats.toJson({ all: false, errors: true, warnings: true });
  if (stats.hasErrors()) {
    console.error(info.errors);
    process.exitCode = 1;
    return;
  }
  if (info.warnings?.length) console.warn(info.warnings);

  const emitted = fs.readdirSync(outputDir).filter((n) => n.endsWith(".js"));
  if (emitted.length !== 1) {
    throw new Error(`Expected one embedded script, found: ${emitted.join(", ")}`);
  }

  const scriptCloseEscape = `<${String.fromCharCode(92)}/script`;
  const bundle = fs
    .readFileSync(path.join(outputDir, "flower.bundle.js"), "utf8")
    .replace(/<\/script/gi, scriptCloseEscape);
  if (/<\/script/i.test(bundle)) {
    throw new Error("Bundled JavaScript still contains an unescaped </script tag");
  }

  fs.writeFileSync(outputHtml, (editor ? editorPage : grid ? gridPage : garden || world ? gardenPage : page)(bundle), "utf8");
  fs.rmSync(outputDir, { recursive: true, force: true });
  console.log(`Created ${outputHtml}`);
  console.log(`Flowers: ${flowers.length}`);
  console.log(`Size: ${(fs.statSync(outputHtml).size / 1024 / 1024).toFixed(2)} MB`);
});
