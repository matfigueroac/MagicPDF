const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const io = fs.promises;
const { setTimeout: delay } = require('node:timers/promises');

async function replaceFile(source, destination) {
  // Windows PDF readers can briefly hold the destination without delete sharing.
  for (let attempt = 0; ; attempt++) {
    try { return await io.rename(source, destination); }
    catch (error) {
      if (process.platform !== 'win32' || !['EBUSY','EPERM','EACCES'].includes(error.code) || attempt === 5) throw error;
      await delay(25 * 2 ** attempt);
    }
  }
}

function identity(stat) {
  return [stat.dev, stat.ino, stat.birthtimeNs].join(':');
}

// Receipts let a later process clean up only the exact sibling it created.
async function cleanSaveStages(uploads) {
  const ledger = path.join(path.dirname(uploads), 'save-stages');
  const files = await io.readdir(ledger, {withFileTypes:true}).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const item of files) {
    const match = /^(\d+)-([0-9a-f-]{36})\.json$/.exec(item.name);
    if (!item.isFile() || !match) continue;
    try { process.kill(Number(match[1]), 0); continue; }
    catch (error) { if (error.code !== 'ESRCH') continue; }
    const receipt = path.join(ledger, item.name);
    try {
      const record = JSON.parse(await io.readFile(receipt, 'utf8'));
      if (!path.isAbsolute(record.directory) || record.directory !== await io.realpath(record.directory)) continue;
      const sibling = path.join(record.directory, '.magicpdf-' + match[2] + '.tmp');
      const stat = await io.lstat(sibling, {bigint:true}).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
      if (stat && (!stat.isFile() || identity(stat) !== record.identity)) continue;
      if (stat) await io.unlink(sibling);
      await io.rm(receipt, {force:true});
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Temporal de guardado pendiente:', error.message);
    }
  }
}

// Commit on the destination volume. Never truncate or unlink the previous PDF.
async function savePdf(working, target, uploads) {
  const root = await fs.promises.realpath(uploads);
  const source = await fs.promises.realpath(working);
  if (path.relative(root, path.dirname(source)) !== '' || !/\.pdf$/i.test(source))
    throw new Error('Ruta de documento no válida');
  if (!path.isAbsolute(target) || !/\.pdf$/i.test(target))
    throw new Error('Elige un archivo PDF de destino.');
  const directory = await fs.promises.realpath(path.dirname(target));
  const relative = path.relative(root, directory);
  if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)))
    throw new Error('Elige un destino fuera de las copias de trabajo.');
  const destination = path.join(directory, path.basename(target));
  const previous = await fs.promises.lstat(destination).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (previous && !previous.isFile()) throw new Error('El destino debe ser un archivo normal.');
  const before = await fs.promises.stat(source, { bigint: true });
  if (!before.isFile()) throw new Error('La copia de trabajo no es un archivo normal.');
  const id = randomUUID();
  const ledger = path.join(path.dirname(root), 'save-stages');
  await io.mkdir(ledger, {recursive:true});
  const receipt = path.join(ledger, process.pid + '-' + id + '.json');
  const temporary = path.join(directory, '.magicpdf-' + id + '.tmp');
  const handle = await fs.promises.open(temporary, 'wx', 0o600);
  try {
    // Keep the exclusive sibling private until all its bytes are durable.
    const staged = await handle.stat({bigint:true});
    await io.writeFile(receipt, JSON.stringify({directory, identity:identity(staged)}), {flag:'wx', flush:true});
    for await (const bytes of fs.createReadStream(source)) await handle.writeFile(bytes);
    const after = await fs.promises.stat(source, { bigint: true });
    if (before.ino !== after.ino || before.ctimeNs !== after.ctimeNs || before.size !== (await handle.stat({bigint:true})).size)
      throw new Error('El documento cambió durante el guardado. Vuelve a guardar.');
    if (previous) await handle.chmod(previous.mode & 0o777);
    await handle.sync();
    await handle.close();
    await replaceFile(temporary, destination);
    if (process.platform !== 'win32') {
      const parent = await fs.promises.open(directory, 'r');
      try { await parent.sync(); } finally { await parent.close(); }
    }
  } finally {
    await handle.close();
    await fs.promises.rm(temporary, {force:true});
    await io.rm(receipt, {force:true});
  }
}

module.exports = { savePdf, cleanSaveStages, replaceFile };
