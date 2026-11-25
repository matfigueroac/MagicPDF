const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { savePdf } = require('./atomic-save.cjs');

async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function confirmDocuments(window, documents, dialog, uploads, versions = {}) {
  const root = await fs.promises.realpath(uploads);
  for (const doc of documents) {
    const working = await fs.promises.realpath(doc.path);
    if (path.dirname(working).toLowerCase() !== root.toLowerCase() || !working.toLowerCase().endsWith('.pdf'))
      throw new Error('Ruta de documento no válida');
    const version = await digest(working);
    if (doc.originalDiskPath) {
      const originalHash = await digest(doc.originalDiskPath).catch(e => { if(e.code === 'ENOENT') return null; throw e; });
      if (originalHash === version) {
        versions[path.basename(working)] = version;
        continue;
      }
    } else if (!(doc.revision || doc.annotationRevision)) continue;
    const { response } = await dialog.showMessageBox(window, {
      type:'question', title:'Cambios sin guardar',
      message:`¿Guardar los cambios de «${doc.name}»?`,
      detail:'Los cambios todavía no están guardados en el archivo original.',
      buttons:['Guardar','Descartar','Cancelar'], defaultId:0, cancelId:2, noLink:true,
    });
    if (response === 2) return false;
    if (response === 1) {
      versions[path.basename(working)] = version;
      continue;
    }
    let target = doc.originalDiskPath;
    if (!target) {
      const result = await dialog.showSaveDialog(window, { title:'Guardar PDF', defaultPath:doc.name, filters:[{name:'PDF',extensions:['pdf']}] });
      if (result.canceled || !result.filePath) return false;
      target = result.filePath;
    }
    await savePdf(working,target,uploads);
    versions[path.basename(working)] = version;
  }
  return true;
}
module.exports = { confirmDocuments };
