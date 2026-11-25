const path = require('node:path');
const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { writeFile } = require('node:fs/promises');
const { Arch, Platform, build } = require('electron-builder');
const { build: packageBuild, version: packageVersion } = require('../package.json');

function xmlValue(value) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
  return value.replace(/[&<>"']/g, character => entities[character]);
}

async function main() {
  if (process.platform !== 'win32') throw new Error('Este comando debe ejecutarse en Windows.');
  const [mode, previewVersion, ...rest] = process.argv.slice(2);
  const preview = mode === '--preview';
  if ((mode && !preview) || rest.length) {
    throw new Error('Usa build-windows-store.cjs o build-windows-store.cjs --preview <versión>.');
  }
  const version = preview ? previewVersion : packageVersion;
  if (!/^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/.test(version || '')
    || version.split('.').some(part => Number(part) > 65535)) {
    throw new Error('MSIX requiere una versión mayor.menor.parche con componentes de 0 a 65535.');
  }

  const identityName = preview ? 'MagicPDF.Preview' : (process.env.MAGICPDF_STORE_IDENTITY ?? 'matfc.MagicPDFPro').trim();
  const publisher = preview ? 'CN=MagicPDF Store QA' : (process.env.MAGICPDF_STORE_PUBLISHER ?? 'CN=573F69E9-5F49-48C9-9E74-D829F756FAFD').trim();
  const displayName = preview ? 'MagicPDF Store QA' : (process.env.MAGICPDF_STORE_PUBLISHER_NAME ?? 'matfc').trim();
  if (!identityName || !publisher || !displayName) {
    throw new Error('Configura MAGICPDF_STORE_IDENTITY, MAGICPDF_STORE_PUBLISHER y MAGICPDF_STORE_PUBLISHER_NAME con Identidad del producto de Partner Center.');
  }

  const projectDir = path.resolve(__dirname, '..');
  const output = preview
    ? path.join(projectDir, 'work', 'firma-windows', `store-preview-${version}`)
    : path.resolve(projectDir, process.env.MAGICPDF_RELEASE_OUTPUT || packageBuild.directories.output, 'store');
  const packageName = `MagicPDF-Store-${version}-x64.msix`;
  await build({
    projectDir,
    targets: Platform.WINDOWS.createTarget(['appx'], Arch.x64),
    publish: 'never',
    config: {
      directories: { output },
      publish: null,
      extraMetadata: { version, windowsUpdateChannel: 'store' },
      win: { signExecutable: false },
      appx: {
        identityName,
        publisher: xmlValue(publisher),
        publisherDisplayName: xmlValue(displayName),
        applicationId: 'MagicPDF',
        languages: ['es-CL'],
        backgroundColor: 'transparent',
        minVersion: '10.0.19045.0',
        maxVersionTested: '10.0.26100.0',
        artifactName: packageName,
      },
    },
  });

  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path.join(output, packageName))) hash.update(chunk);
  await writeFile(path.join(output, 'SHA256SUMS.txt'), `${hash.digest('hex')}  ${packageName}\n`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
