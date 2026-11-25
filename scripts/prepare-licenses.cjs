const fs = require('node:fs');
const path = require('node:path');
const { inflateSync } = require('node:zlib');
const { packages } = require('../package-lock.json');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist-licenses', 'Licencias-de-terceros.txt');
// Frontend, bundled API/OCR and the updater installed with the desktop app.
const runtimePackages = [
  'react', 'react-dom', 'lucide-react', 'pdfjs-dist',
  'express', 'cors', 'multer', 'pdf-lib', 'tesseract.js', 'tesseract.js-core',
  'electron-updater',
];
const supplementalNotices = {
  'lazy-val@1.0.5': ['lazy-val-1.0.5.txt'],
  'tr46@0.0.3': ['tr46-0.0.3.txt', 'Unicode-DFS-2015.txt'],
};

function findPackage(name, from = '') {
  for (let directory = from; ; directory = path.posix.dirname(directory)) {
    const location = path.posix.join(directory, 'node_modules', name);
    if (packages[location]) return location;
    if (directory === '.' || directory === '') throw new Error(`No se encontró ${name} desde ${from || 'la raíz'}.`);
  }
}

const locations = new Set();
function collect(location) {
  if (locations.has(location)) return;
  locations.add(location);
  for (const name of Object.keys(packages[location].dependencies ?? {})) {
    collect(findPackage(name, location));
  }
}
runtimePackages.forEach(name => collect(findPackage(name)));

const sections = [];
const missing = [];
for (const location of [...locations].sort()) {
  const directory = path.join(root, location);
  const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const identifier = `${pkg.name}@${pkg.version}`;
  if (pkg.version !== packages[location].version) {
    throw new Error(`La versión instalada de ${pkg.name} no coincide con package-lock.json. Ejecuta npm ci.`);
  }
  const files = fs.readdirSync(directory, { withFileTypes: true })
    .filter(file => file.isFile() && /^(licen[cs]es?|copying|notices?)(?:$|[._-])/i.test(file.name))
    .map(file => file.name)
    .sort();
  const notices = files.map(file => `${file}\n${fs.readFileSync(path.join(directory, file), 'utf8').trimEnd()}`);
  if (identifier === 'cookie-signature@1.0.7') {
    const readme = fs.readFileSync(path.join(directory, 'Readme.md'), 'utf8');
    const license = /^## License\s*\r?\n([\s\S]+)$/m.exec(readme)?.[1];
    if (license) notices.push(`Readme.md\n${license.trim()}`);
  }
  if (identifier === '@pdf-lib/standard-fonts@1.0.0') {
    const readme = fs.readFileSync(path.join(directory, 'README.md'), 'utf8');
    const originalLicense = /^## Original Repo's License\s*\r?\n([\s\S]+)$/m.exec(readme)?.[1];
    if (!originalLicense) throw new Error(`Falta la atribución de afm en ${identifier}.`);
    notices.push(`Readme.md (afm)\n${originalLicense.trim()}`);

    const metrics = path.join(directory, 'lib');
    const fonts = fs.readdirSync(metrics).filter(file => /^[A-Z].*\.compressed\.json$/.test(file)).sort();
    notices.push(['Avisos de los datos de métricas tipográficas', ...fonts.map(file => {
      const encoded = JSON.parse(fs.readFileSync(path.join(metrics, file), 'utf8'));
      const font = JSON.parse(inflateSync(Buffer.from(encoded, 'base64')).toString('utf8'));
      return `${font.FontName}: ${font.Notice}`;
    })].join('\n'));
  }
  for (const file of supplementalNotices[identifier] ?? []) {
    notices.push(`${file}\n${fs.readFileSync(path.join(root, 'docs/licencias-npm', file), 'utf8').trimEnd()}`);
  }
  if (!notices.length) {
    missing.push(identifier);
    continue;
  }
  sections.push([
    `${pkg.name} ${pkg.version} (${pkg.license ?? packages[location].license ?? 'ver abajo'})`,
    ...notices,
  ].join('\n\n'));
}
if (missing.length) throw new Error(`Falta el texto de licencia de ${missing.join(', ')}.`);

for (const [title, directory] of [
  ['PDFCraft 0.4.0', 'bin/licenses'],
  ['Datos de OCR en español e inglés (Tesseract)', 'docs/licencias-ocr'],
]) {
  const absolute = path.join(root, directory);
  const notices = fs.readdirSync(absolute).sort()
    .map(file => `${file}\n${fs.readFileSync(path.join(absolute, file), 'utf8').trimEnd()}`);
  sections.push([title, ...notices].join('\n\n'));
}

const intro = [
  'MagicPDF Pro | Licencias de terceros',
  'Los avisos siguientes corresponden a los componentes que usa la edición de Windows.',
  'Electron y Chromium incluyen sus avisos completos en LICENSE.electron.txt y LICENSES.chromium.html',
  'junto al ejecutable instalado. https://github.com/electron/electron',
  'La licencia MIT del código de MagicPDF se incluye como LICENSE-MagicPDF.txt.',
].join('\n');
const separator = `\n\n${'='.repeat(72)}\n\n`;
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, [intro, ...sections].join(separator) + '\n', 'utf8');
console.log(`Avisos de ${sections.length} componentes escritos en ${path.relative(root, output)}.`);
