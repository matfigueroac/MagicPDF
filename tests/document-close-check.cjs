const fs = require('fs/promises');
const path = require('path');
const assert = require('assert/strict');
const { confirmDocuments } = require('../electron/document-close.cjs');
(async () => {
  const dir = await fs.mkdtemp(path.resolve('work/close-check-'));
  try {
    const uploads = path.join(dir,'uploads'); await fs.mkdir(uploads);
    const original = path.join(dir,'original.pdf'), working = path.join(uploads,'working.pdf');
    await fs.writeFile(original,'initial'); await fs.copyFile(original,working);
    const doc = {name:'Propio.pdf',path:working,originalDiskPath:original};
    let response = 2, prompts = [];
    const dialog = {showMessageBox:async (_win,options)=>{prompts.push(options);return {response};},showSaveDialog:async()=>({canceled:true})};
    assert.equal(await confirmDocuments(null,[doc],dialog,uploads),true); assert.equal(prompts.length,0);
    await fs.writeFile(working,'changed');
    assert.equal(await confirmDocuments(null,[doc],dialog,uploads),false);
    assert.deepEqual(prompts[0].buttons,['Guardar','Descartar','Cancelar']);
    assert.equal(await fs.readFile(original,'utf8'),'initial');
    response=1; assert.equal(await confirmDocuments(null,[doc],dialog,uploads),true);
    assert.equal(await fs.readFile(original,'utf8'),'initial');
    response=0; assert.equal(await confirmDocuments(null,[doc],dialog,uploads),true);
    assert.equal(await fs.readFile(original,'utf8'),'changed');
    prompts=[]; assert.equal(await confirmDocuments(null,[doc],dialog,uploads),true); assert.equal(prompts.length,0);
    const fresh={...doc,originalDiskPath:undefined,annotationRevision:1};
    assert.equal(await confirmDocuments(null,[fresh],dialog,uploads),false);
    const exportPath=path.join(dir,'export.pdf'); dialog.showSaveDialog=async()=>({filePath:exportPath,canceled:false});
    assert.equal(await confirmDocuments(null,[fresh],dialog,uploads),true);
    assert.equal(await fs.readFile(exportPath,'utf8'),'changed');
    await assert.rejects(confirmDocuments(null,[{...doc,path:original}],dialog,uploads),/Ruta/);
    console.log('PASS close guard: unchanged, cancel, discard, save, save-as, path validation');
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exitCode=1;});
