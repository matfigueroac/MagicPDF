import { _electron as electron, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PDFDocument, StandardFonts, PDFArray, PDFName } from 'pdf-lib';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const runId = randomUUID();
const source = path.resolve(`work/desktop-smoke-${runId}.pdf`);
const scanFile = path.resolve(`work/desktop-scan-smoke-${runId}.pdf`);
await fs.mkdir('work',{recursive:true});
const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
pdf.addPage().drawText('Desktop verification',{x:50,y:750,size:20,font});
await fs.writeFile(source,await pdf.save());
let app,copy;
try {
  app=await electron.launch({executablePath:process.env.MAGICPDF_EXECUTABLE||path.resolve('release/win-unpacked/MagicPDF Pro.exe'),args:[source],timeout:30000});
  await app.evaluate(({dialog}) => {
    globalThis.closeResponse = 1; globalThis.closePrompts = [];
    dialog.showMessageBox = async (_window, options) => {globalThis.closePrompts.push(options);return {response:globalThis.closeResponse};};
    const originalFetch = globalThis.fetch;
    globalThis.checkedGitHub = false;
    globalThis.fetch = (input, options) => {
      if (input !== 'https://api.github.com/repos/matfigueroac/MagicPDF/releases/latest') return originalFetch(input, options);
      globalThis.checkedGitHub = true;
      return Promise.resolve(Response.json({
        tag_name: 'v65535.0.0',
        assets: [{ name: 'MagicPDF-Pro-Setup-65535.0.0.exe', state: 'uploaded', size: 3, digest: 'sha256:' + 'a'.repeat(64) }],
      }));
    };
  });
  const win=await app.firstWindow();
  await win.locator('.reader .textLayer').first().getByText('Desktop verification').waitFor({timeout:30000});
  await win.getByLabel('Inicio',{exact:true}).click();
  await win.getByRole('button',{name:'Buscar actualizaciones…',exact:true}).click();
  await expect.poll(() => app.evaluate(() => globalThis.closePrompts[0]?.title))
    .toBe('Actualizaciones de MagicPDF');
  if (process.env.MAGICPDF_TEST_GITHUB_UPDATE === '1') {
    assert.equal(await app.evaluate(() => globalThis.checkedGitHub), true);
    assert.match(await app.evaluate(() => globalThis.closePrompts[0]?.message), /MagicPDF 65535\.0\.0 está disponible/);
  }
  await expect(win.getByRole('tab')).toHaveCount(1);
  const expectedVersion=JSON.parse(await fs.readFile('package.json','utf8')).version;
  assert.equal(await app.evaluate(({app})=>app.getVersion()),expectedVersion);
  assert.equal(await win.locator('.titlebar-version').textContent(),expectedVersion);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMaximized()),true,'The PDF window must open maximized');
  assert.equal(await win.locator('.workspace-bar').count(),1);
  assert.equal(await win.locator('.reader-toolbar,.pro-toolbar').count(),0);
  assert.equal(await win.getByRole('button',{name:'Insertar cuadro de texto',exact:true}).isVisible(),true);
  assert.equal(await win.getByLabel('Figuras y dibujo',{exact:true}).isVisible(),true);
  const homeBounds=await win.getByLabel('Inicio',{exact:true}).boundingBox();
  const pagesBounds=await win.getByRole('button',{name:'Mostrar páginas',exact:true}).boundingBox();
  const layersBounds=await win.getByRole('button',{name:'Capas',exact:true}).boundingBox();
  const undoBounds=await win.getByRole('button',{name:'Deshacer',exact:true}).boundingBox();
  assert(pagesBounds.x>homeBounds.x && layersBounds.x>pagesBounds.x && layersBounds.x<undoBounds.x);
  assert.equal(await win.getByLabel('Organizar',{exact:true}).isVisible(),true);
  assert.equal(await win.getByLabel('Herramientas',{exact:true}).isVisible(),true);
  assert.equal(await win.getByRole('button',{name:'Cuadro de texto',exact:true}).count(),0);
  const originalPaper=await win.getByLabel('Color de lectura').inputValue();
  await win.getByRole('button',{name:'Cambiar tema',exact:true}).click();
  const toggledPaper=await win.getByLabel('Color de lectura').inputValue();
  assert(originalPaper==='night' ? toggledPaper!=='night' : toggledPaper==='night');
  await win.getByRole('button',{name:'Cambiar tema',exact:true}).click();
  assert.equal(await win.getByLabel('Color de lectura').inputValue(),originalPaper);
  await win.getByLabel('Zoom',{exact:true}).selectOption('1');
  const zoomWidth=await win.locator('.reader .page').first().evaluate(el=>el.getBoundingClientRect().width);
  const zoomRect=await win.locator('.reader .page').first().boundingBox();
  await win.mouse.move(zoomRect.x+200,zoomRect.y+200);
  await win.keyboard.down('Control');await win.mouse.wheel(0,-120);await win.keyboard.up('Control');
  await win.waitForFunction(w=>document.querySelector('.reader .page').getBoundingClientRect().width>w,zoomWidth);
  await win.keyboard.down('Control');await win.mouse.wheel(0,120);await win.keyboard.up('Control');
  await win.waitForFunction(w=>Math.abs(document.querySelector('.reader .page').getBoundingClientRect().width-w)<2,zoomWidth);
  await win.locator('.reader canvas').first().evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const originalCanvas=await win.locator('.reader canvas').first().elementHandle();
  await win.getByRole('button',{name:'Insertar cuadro de texto',exact:true}).click();
  const pageBox=await win.locator('.reader .page').first().boundingBox();
  await win.mouse.move(pageBox.x+80,pageBox.y+220);await win.mouse.down();
  await win.mouse.move(pageBox.x+360,pageBox.y+310,{steps:12});await win.mouse.up();
  const inlineText=win.getByLabel('Editar texto sobre el PDF',{exact:true});
  await inlineText.fill('Mover y borrar');
  const inserted=win.waitForResponse(r=>r.url().endsWith('/api/drawing')&&r.request().method()==='POST');
  await inlineText.press('Control+Enter');assert.equal((await inserted).ok(),true);
  assert.equal(await win.getByRole('toolbar',{name:'Acciones rápidas de anotación'}).isVisible(),true);
  await win.screenshot({path:'work/desktop-quick-tools.png'});
  await win.locator('g[data-kind=text] text').click();
  const setLock=async(name,locked,count)=>{
    const response=win.waitForResponse(r=>r.url().endsWith('/api/annotation-lock')&&r.request().method()==='POST');
    await win.getByRole('button',{name,exact:true}).click();const res=await response;assert.equal(res.ok(),true);
    const rows=(await res.json()).annotations;assert.equal(rows.length,count);assert(rows.every(a=>a.locked===locked));
    if(locked)await win.locator('g[data-selected=true][data-locked=true]').first().waitFor();
    else await win.locator('g[data-selected=true]:not([data-locked])').first().waitFor();
    return rows;
  };
  await setLock('Bloquear elemento',true,1);assert.equal(await win.locator('[data-resize-handle]').count(),0);
  assert.equal(await win.getByLabel('Texto de anotación',{exact:true}).isEnabled(),false);
  await setLock('Desbloquear elemento',false,1);
  const handle=await win.locator('[data-resize-handle=se]').boundingBox();
  const resized=win.waitForResponse(r=>r.url().endsWith('/api/drawing')&&r.request().method()==='POST');
  await win.mouse.move(handle.x+5,handle.y+5);await win.mouse.down();await win.mouse.move(handle.x+45,handle.y+25,{steps:10});await win.mouse.up();assert.equal((await resized).ok(),true);
  await win.getByRole('button',{name:'Aplicar anotación',exact:true}).waitFor();
  const selection=await win.locator('g[data-selected=true] .annotation-selection > rect:first-child').boundingBox();
  const moved=win.waitForResponse(r=>r.url().endsWith('/api/drawing')&&r.request().method()==='POST');
  await win.mouse.move(selection.x+selection.width/2,selection.y+selection.height/2);await win.mouse.down();await win.mouse.move(selection.x+selection.width/2+30,selection.y+selection.height/2+20,{steps:10});await win.mouse.up();assert.equal((await moved).ok(),true);
  await win.getByRole('button',{name:'Aplicar anotación',exact:true}).waitFor();
  const originalAnnotationId=await win.locator('g[data-selected=true]').getAttribute('data-annotation-id');
  await win.keyboard.press('Control+c');
  const copyShortcut=async(key)=>{
    const response=win.waitForResponse(r=>r.url().endsWith('/api/drawing')&&r.request().method()==='POST');
    await win.keyboard.press(key);const res=await response;assert.equal(res.ok(),true);const saved=(await res.json()).annotation;
    if(key!=='Delete')await win.locator(`g[data-annotation-id="${saved.id}"][role=button]`).waitFor();
    return saved;
  };
  const duplicated=await copyShortcut('Control+d');
  const pasted=await copyShortcut('Control+v');assert.notEqual(duplicated.id,pasted.id);
  assert.equal(await win.locator('g[data-kind=text]').count(),3);
  const originalText=await win.locator(`g[data-annotation-id="${originalAnnotationId}"] text`).boundingBox();
  await win.keyboard.down('Control');await win.mouse.click(originalText.x+2,originalText.y+2);await win.keyboard.up('Control');
  assert.equal(await win.locator('g[data-selected=true]').count(),2);
  const batchAction=async(action)=>{
    const response=win.waitForResponse(r=>r.url().endsWith('/api/drawing-batch')&&r.request().method()==='POST');
    await action();const res=await response;assert.equal(res.ok(),true);
    return (await res.json()).annotations;
  };
  const grouped=await win.locator(`g[data-annotation-id="${originalAnnotationId}"] .annotation-selection > rect:first-child`).boundingBox();
  await batchAction(async()=>{await win.mouse.move(grouped.x+8,grouped.y+8);await win.mouse.down();await win.mouse.move(grouped.x+18,grouped.y+16,{steps:10});await win.mouse.up();});
  await win.getByRole('button',{name:'Duplicar selección · Ctrl+D',exact:true}).waitFor();
  const aligned=await batchAction(()=>win.getByRole('button',{name:'Alinear a la izquierda',exact:true}).click());
  const leftEdges=aligned.map(a=>Math.min(...a.points.map(point=>point[0])));
  assert(Math.abs(leftEdges[0]-leftEdges[1])<.01,'Group alignment must persist equal left edges');
  const persistent=await batchAction(()=>win.getByRole('button',{name:'Agrupar',exact:true}).click());
  assert(persistent[0].groupId&&persistent.every(a=>a.groupId===persistent[0].groupId));
  const compactPanel=win.getByLabel('Selección múltiple',{exact:true});
  const compactBounds=await compactPanel.boundingBox(),barBounds=await win.locator('.workspace-bar').boundingBox();
  assert(compactBounds.height<300,'Group inspector must stay compact');
  assert(compactBounds.y>=barBounds.y+barBounds.height,'Inspector header must remain below the toolbar');
  assert.equal(await win.getByRole('button',{name:'Desagrupar',exact:true}).count(),1);
  assert.equal(await win.getByRole('button',{name:'Duplicar selección · Ctrl+D',exact:true}).count(),1);
  assert.equal(await win.locator('.annotation-order').evaluate(el=>el.open),false);
  assert.equal(await win.locator('[data-group-resize-handle]').count(),4);
  const groupCorner=await win.locator('[data-group-resize-handle=se]').boundingBox();
  const scaled=await batchAction(async()=>{
    await win.mouse.move(groupCorner.x+6,groupCorner.y+6);await win.mouse.down();
    await win.mouse.move(groupCorner.x+36,groupCorner.y+24,{steps:8});await win.mouse.up();
  });
  assert(scaled.every(a=>a.fontSize>persistent.find(old=>old.id===a.id).fontSize));
  await win.screenshot({path:'work/desktop-compact-panel.png'});
  const orderAction=async(name)=>{
    const details=win.locator('.annotation-order');
    if(!await details.evaluate(el=>el.open))await details.locator('summary').click();
    const response=win.waitForResponse(r=>r.url().endsWith('/api/annotation-order')&&r.request().method()==='POST');
    await win.getByRole('button',{name,exact:true}).click();const res=await response;assert.equal(res.ok(),true);const rows=(await res.json()).annotations;
    const indices=rows.map((a,i)=>a.groupId===persistent[0].groupId?i:-1).filter(i=>i>=0);assert.equal(indices.length,2);assert.equal(indices[1]-indices[0],1);
  };
  for(const name of ['Traer al frente','Enviar al fondo','Adelantar','Atrasar','Traer al frente'])await orderAction(name);
  await win.getByRole('button',{name:'Capas',exact:true}).click();
  const layerPanel=win.getByLabel('Panel de capas',{exact:true}),layerRow=layerPanel.locator(`[data-layer-scope="group"][data-layer-id="${persistent[0].groupId}"]`);
  const layerAction=async(run)=>{const response=win.waitForResponse(r=>r.url().endsWith('/api/annotation-layer')&&r.request().method()==='POST');await run();const res=await response;assert.equal(res.ok(),true);return(await res.json()).annotations;};
  await layerRow.getByRole('button',{name:/^Renombrar /}).click();const nameInput=layerPanel.getByLabel('Nombre de la capa',{exact:true});await nameInput.fill('Grupo de prueba');
  assert((await layerAction(()=>nameInput.press('Enter'))).every(a=>a.groupName==='Grupo de prueba'));
  await layerAction(()=>layerRow.locator('.layer-visibility').click());assert.equal(await win.locator(`g[data-group-id="${persistent[0].groupId}"]`).count(),0);
  await layerRow.locator('.layer-select').click();
  assert.equal(await compactPanel.getByRole('button',{name:'Desagrupar',exact:true}).count(),1,'Hidden groups keep their sole action toolbar in the inspector');
  await layerAction(()=>layerRow.locator('.layer-visibility').click());await win.locator(`g[data-group-id="${persistent[0].groupId}"]`).last().waitFor();
  await win.getByRole('button',{name:'Cerrar panel de capas',exact:true}).click();
  await win.keyboard.press('Escape');await win.locator(`g[data-group-id="${persistent[0].groupId}"] text`).last().click();
  assert.equal(await win.locator('g[data-selected=true]').count(),2);
  let drawingRequests=0;win.on('request',r=>{if(r.method()==='POST'&&/\/api\/drawing(-batch)?$/.test(r.url()))drawingRequests++;});
  await setLock('Bloquear selección',true,2);assert.equal(await win.getByRole('button',{name:'Desagrupar',exact:true}).isEnabled(),false);
  if(!await win.locator('.annotation-order').evaluate(el=>el.open))await win.locator('.annotation-order summary').click();
  assert.equal(await win.getByRole('button',{name:'Traer al frente',exact:true}).isEnabled(),false);
  const lockedBox=await win.locator('.annotation-group-selection > rect:first-child').boundingBox(),beforeLockedMove=drawingRequests;
  await win.mouse.move(lockedBox.x+8,lockedBox.y+8);await win.mouse.down();await win.mouse.move(lockedBox.x+38,lockedBox.y+28,{steps:10});await win.mouse.up();await win.keyboard.press('Delete');assert.equal(drawingRequests,beforeLockedMove);
  await setLock('Desbloquear selección',false,2);
  await win.keyboard.press('Control+c');
  const duplicateGroup=await batchAction(()=>win.keyboard.press('Control+d'));
  const pastedGroup=await batchAction(()=>win.keyboard.press('Control+v'));
  assert.equal(duplicateGroup.length,2);assert.equal(pastedGroup.length,2);
  assert.equal(new Set([persistent[0].groupId,duplicateGroup[0].groupId,pastedGroup[0].groupId]).size,3);
  const ungrouped=await batchAction(()=>win.getByRole('button',{name:'Desagrupar',exact:true}).click());assert(ungrouped.every(a=>!a.groupId));
  await expect(win.getByRole('button',{name:'Agrupar',exact:true})).toBeEnabled();
  await batchAction(()=>win.keyboard.press('Delete'));
  assert.equal(await win.locator('g[data-kind=text]').count(),5);
  await win.keyboard.press('Escape');
  await win.mouse.move(pageBox.x+40,pageBox.y+180);await win.mouse.down();await win.mouse.move(pageBox.x+Math.min(700,pageBox.width-20),pageBox.y+500,{steps:14});await win.mouse.up();
  assert.equal(await win.locator('g[data-selected=true]').count(),5);
  await expect(win.getByRole('button',{name:'Agrupar',exact:true})).toBeEnabled();
  await batchAction(()=>win.keyboard.press('Delete'));
  assert.equal(await win.locator('g[data-kind=text]').count(),0);
  assert.equal(await originalCanvas.evaluate(el=>el===document.querySelector('.reader canvas')),true,'Manipulation must preserve the PDF canvas');
  const textBox=await win.locator('.reader .textLayer span').filter({hasText:'Desktop verification'}).first().boundingBox();
  await win.mouse.move(textBox.x+2,textBox.y+textBox.height/2);await win.mouse.down();await win.mouse.move(textBox.x+textBox.width-2,textBox.y+textBox.height/2,{steps:20});await win.mouse.up();
  assert.match(await win.evaluate(()=>window.getSelection()?.toString()),/Desktop verification/);
  await win.getByRole('button',{name:'Subrayar selección',exact:true}).click();
  await win.locator('.reader-notice').filter({hasText:'Subrayado incorporado'}).waitFor();
  assert.equal(await originalCanvas.evaluate(el=>el===document.querySelector('.reader canvas')),true,'Annotations must not reload the PDF canvas');
  const result=await win.evaluate(async()=>{
    const file=await window.electronAPI.getInitialFile();
    const opened=await (await fetch('/api/open-file-path',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({targetPath:file})})).json();
    const doc=opened.document;
    const highlight=await fetch('/api/highlight',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:doc.filename,page:1,rects:[[50,745,245,772]],color:'#fde047',text:'Desktop verification'})});
    if(!highlight.ok)throw new Error(await highlight.text());
    const saved=await window.electronAPI.saveFile({originalPath:file,tempPath:doc.path});
    await window.electronAPI.printDocument(doc.path);
    return {saved,copy:doc.path};
  });
  copy=result.copy;assert.equal(result.saved.success,true);
  const saved=await PDFDocument.load(await fs.readFile(source));
  assert.equal(saved.getPage(0).node.lookup(PDFName.of('Annots'),PDFArray).size(),1);
  const windows=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>w.webContents.getURL()));
  assert.equal(windows.length,2);assert(windows.some(url=>url.startsWith('file:')&&url.endsWith('.pdf')));
  const png=await win.evaluate(()=>{const c=document.createElement('canvas');c.width=1190;c.height=1684;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='black';ctx.font='48px Arial';ctx.fillText('PACKAGED OFFLINE OCR',100,180);ctx.fillText('Reconocimiento de texto en español',100,260);return c.toDataURL('image/png').split(',')[1];});
  const scan=await PDFDocument.create(),image=await scan.embedPng(Buffer.from(png,'base64'));scan.addPage([595,842]).drawImage(image,{x:0,y:0,width:595,height:842});
  await fs.writeFile(scanFile,await scan.save());
  try {
    await app.evaluate(({session}) => {
      session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']}, (details, done) => {
        done({cancel:new URL(details.url).hostname !== '127.0.0.1'});
      });
    });
    const bytes=Array.from(await fs.readFile(scanFile));
    const rejected=await win.evaluate(async bytes=>{
      const form=new FormData();
      form.append('files',new File([new Uint8Array(bytes)],'rejected-multipart.pdf'));
      form.append('unexpected',new File([new Uint8Array(bytes)],'other.pdf'));
      return (await fetch('/api/upload',{method:'POST',body:form})).status;
    },bytes);
    assert.equal(rejected,400);
    const storage=path.join(process.env.APPDATA,'MagicPDF');
    assert(!(await fs.readdir(path.join(storage,'uploads'))).some(name=>name.endsWith('_rejected-multipart.pdf')));
    for (const filename of await fs.readdir(path.join(storage,'work-copy-records'))) {
      const receipt=await fs.readFile(path.join(storage,'work-copy-records',filename),'utf8');
      assert(!receipt.includes('rejected-multipart.pdf'));
    }
    for (const language of ['eng','spa','spa+eng']) {
      const ocr=await win.evaluate(async ({name, bytes, language})=>{
        const form=new FormData();
        form.append('files',new File([new Uint8Array(bytes)],name,{type:'application/pdf'}));
        const upload=await fetch('/api/upload',{method:'POST',body:form});
        if(!upload.ok)throw new Error(await upload.text());
        const [doc]=(await upload.json()).documents;
        const images=await(await fetch(`/api/images/${doc.filename}/1`)).json();
        if(!Array.isArray(images.images[0].box))throw new Error('El ejecutable no contiene la corrección de coordenadas de imágenes');
        const res=await fetch('/api/ocr',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:doc.filename,pages:[1],language})});
        return {status:res.status,...await res.json()};
      },{name:path.basename(scanFile),bytes,language});
      assert.equal(ocr.status,200,JSON.stringify(ocr));
      assert.match(ocr.results[0].text,language==='eng' ? /PACKAGED OFFLINE OCR/ : /Reconocimiento de texto en español/);
    }
  } finally {await fs.rm(scanFile,{force:true});}
  await win.screenshot({path:'work/desktop-verified.png'});
  // Closing flushes in-place text, Cancel keeps the window, Save updates our fixture only.
  const beforeClose = await fs.readFile(source);
  await win.getByRole('button',{name:'Insertar cuadro de texto',exact:true}).click();
  const closeBox=await win.locator('.reader .page').first().boundingBox();
  await win.mouse.click(closeBox.x+90,closeBox.y+380);
  await win.getByLabel('Editar texto sobre el PDF',{exact:true}).fill('Pendiente al cerrar');
  await win.screenshot({path:'work/desktop-inline-editor.png'});
  await app.evaluate(({BrowserWindow}) => {globalThis.closeResponse=2;globalThis.closePrompts=[];BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('http:')).close();});
  // Poll the main process, without touching the user's files.
  for(let i=0;i<100;i++) { if(await app.evaluate(()=>globalThis.closePrompts.length>0))break; await new Promise(r=>setTimeout(r,50)); }
  assert.equal(await app.evaluate(()=>globalThis.closePrompts[0]?.title),'Cambios sin guardar');
  assert.equal(win.isClosed(),false);assert.deepEqual(await fs.readFile(source),beforeClose);
  await win.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const closedEvent=win.waitForEvent('close',{timeout:15000});
  await app.evaluate(({BrowserWindow})=>{globalThis.closeResponse=0;BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('http:')).close();});
  await closedEvent;
  const closedPdf=await PDFDocument.load(await fs.readFile(source));
  const closeAnnots=closedPdf.getPage(0).node.lookup(PDFName.of('Annots'),PDFArray);
  assert(Array.from({length:closeAnnots.size()},(_,i)=>closeAnnots.lookup(i)).some(a=>a.get(PDFName.of('MagicPDFData'))?.decodeText().includes('Pendiente al cerrar')));
  console.log('PASS packaged Pro Lite: inline text, quick tools, close cancel/save with pending text; layers, depth, locking, grouping, native save, print and offline OCR');
} finally {
  if(app) {
    await app.evaluate(()=>{globalThis.closeResponse=1;}).catch(()=>{});
    await app.close();
  }
  await fs.rm(source,{force:true});
  // Copies created by this smoke test only; preserve all other user documents.
  const uploads=path.join(process.env.APPDATA,'MagicPDF/uploads');
  const copies = (await fs.readdir(uploads).catch(() => [])).filter(name =>
    [source, scanFile].some(file => name.endsWith('_' + path.basename(file))));
  const temp = path.join(process.env.APPDATA, 'MagicPDF/temp');
  for (const image of await fs.readdir(temp).catch(() => [])) {
    if (copies.some(file => image.startsWith(`render_${path.parse(file).name}_p`))) {
      await fs.rm(path.join(temp, image), { force: true });
    }
  }
  for (const file of copies) await fs.rm(path.join(uploads, file), { force: true });
}
