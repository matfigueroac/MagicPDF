const fs = require("fs"),
  path = require("path");
const { build } = require("esbuild");
const output = path.resolve("dist-ocr");
fs.mkdirSync(output, { recursive: true });

// The Node adapter in Tesseract.js 6.0.1 receives a boolean and selects
// the full SIMD or scalar core even when recognition runs in LSTM mode.
const core = "tesseract.js-core";
const cores = path.join(output, "cores");
fs.mkdirSync(cores, { recursive: true });
for (const name of ["tesseract-core", "tesseract-core-simd"]) {
  for (const extension of [".js", ".wasm"]) {
    const file = name + extension;
    const packagedFile = extension === ".js" ? name + ".cjs" : file;
    fs.copyFileSync(require.resolve(`${core}/${file}`), path.join(cores, packagedFile));
  }
}
fs.copyFileSync(require.resolve(`${core}/LICENSE`), path.join(cores, "LICENSE"));
build({
  entryPoints: [require.resolve("tesseract.js/src/worker-script/node/index.js")],
  outfile: path.join(output, "worker.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  plugins: [{
    name: "local-ocr-cores",
    setup(builder) {
      builder.onResolve({ filter: /^tesseract\.js-core\// }, ({path: moduleName}) => ({
        path: "./cores/" + path.basename(moduleName) + ".cjs",
        external: true,
      }));
    },
  }],
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});

for (const lang of ["eng", "spa"]) {
  const data = require(`@tesseract.js-data/${lang}`);
  fs.copyFileSync(
    path.join(data.langPath, `${lang}.traineddata.gz`),
    path.join(output, `${lang}.traineddata.gz`),
  );
}
