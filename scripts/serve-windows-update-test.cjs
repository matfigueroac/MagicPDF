const path = require('node:path');
const { statSync } = require('node:fs');
const express = require('express');

const [base, target, mode, ...rest] = process.argv.slice(2);
const versionFormat = /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/;
if (!versionFormat.test(base) || !versionFormat.test(target)
  || target.localeCompare(base, 'en', { numeric: true }) <= 0
  || (mode && mode !== '--test') || rest.length) {
  console.error('Indica la versión inicial y una superior. Usa --test solo con compilaciones de prueba.');
  process.exit(1);
}

const prefix = mode === '--test' ? 'prueba' : 'produccion-local';
const root = path.resolve(__dirname, '..', 'work', 'firma-windows');
const files = new Map();
for (const version of [base, target]) {
  const folder = path.join(root, `${prefix}-${version}`);
  const setup = `MagicPDF-Pro-Setup-${version}.exe`;
  files.set(setup, path.join(folder, setup));
  files.set(`${setup}.blockmap`, path.join(folder, `${setup}.blockmap`));
}
files.set('latest.yml', path.join(root, `${prefix}-${target}`, 'latest.yml'));
if (mode !== '--test') {
  files.set('verify-windows-update.ps1', path.join(__dirname, 'verify-windows-update.ps1'));
}
for (const file of files.values()) {
  if (!statSync(file, { throwIfNoEntry: false })?.isFile()) {
    console.error(`Falta el archivo requerido: ${file}`);
    process.exit(1);
  }
}

const app = express();
app.get('/:filename', (request, response) => {
  const file = files.get(request.params.filename);
  if (!file) return response.sendStatus(404);
  response.on('finish', () => {
    console.log(`${request.method} ${request.params.filename} ${response.statusCode} ${response.get('Content-Length') ?? 0} bytes`);
  });
  response.sendFile(file);
});
app.listen(3268, '127.0.0.1', () => {
  console.log(`Canal local ${base} → ${target}. En la VM usa http://10.0.2.100:3268/.`);
}).on('error', error => {
  console.error(error.message);
  process.exitCode = 1;
});
