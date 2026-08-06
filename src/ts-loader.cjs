const path = require("node:path");

const studioDir = process.env.FLOWER_HUA_STUDIO_DIR;
if (!studioDir) throw new Error("FLOWER_HUA_STUDIO_DIR is required");

const typescript = require(
  require.resolve("typescript", {
    paths: [path.join(studioDir, "node_modules")],
  }),
);

module.exports = function transpileFlowerHuaStudio(source) {
  return typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2020,
      moduleResolution: typescript.ModuleResolutionKind.Bundler,
      jsx: typescript.JsxEmit.ReactJSX,
      esModuleInterop: true,
      sourceMap: false,
    },
    fileName: this.resourcePath,
  }).outputText;
};
