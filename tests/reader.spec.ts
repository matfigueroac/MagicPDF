import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts, PDFName, PDFArray } from 'pdf-lib';
import fs from 'node:fs/promises';
import path from 'node:path';

test('read, search, select, embed highlight, edit and reopen PDF', async ({page,request})=>{
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
  for(let i=0;i<3;i++){const p=pdf.addPage([595,842]);p.drawText(`MagicPDF page ${i+1}`,{x:60,y:760,size:24,font});p.drawText('Select this text and highlight it.',{x:60,y:700,size:16,font});}
  const bytes=await pdf.save(),errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  let filename='';
  try {
    await page.goto('/');
    const uploaded=page.waitForResponse(r=>r.url().endsWith('/api/upload'));
    await page.locator('input[type=file]').first().setInputFiles({name:'reader-automated-test.pdf',mimeType:'application/pdf',buffer:Buffer.from(bytes)});
    filename=(await (await uploaded).json()).documents[0].filename;
    await expect(page.locator('.reader .textLayer').first()).toContainText('MagicPDF page 1');
    await expect(page.getByRole('status').filter({hasText:'Preparando'})).toHaveCount(0);
    await page.getByLabel('Zoom',{exact:true}).selectOption('2');
    const sheet = page.locator('.reader .page').first();
    const viewportWidth = await page.evaluate(()=>document.documentElement.clientWidth);
    const pdfWidth = await sheet.evaluate(el=>el.getBoundingClientRect().width);
    const anchor = {x:700,y:420};
    const documentPoint = await sheet.evaluate((el,p)=>{
      const r=el.getBoundingClientRect();return [(p.x-r.left)/r.width,(p.y-r.top)/r.height];
    },anchor);
    await page.mouse.move(anchor.x,anchor.y);
    await page.keyboard.down('Control'); await page.mouse.wheel(0,-120); await page.keyboard.up('Control');
    await expect.poll(()=>sheet.evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThan(pdfWidth);
    const afterPoint = await sheet.evaluate((el,p)=>{
      const r=el.getBoundingClientRect();return [(p.x-r.left)/r.width,(p.y-r.top)/r.height];
    },anchor);
    afterPoint.forEach((value,i)=>expect(value).toBeCloseTo(documentPoint[i],2));
    expect(await page.evaluate(()=>document.documentElement.clientWidth)).toBe(viewportWidth);
    await page.keyboard.down('Control'); await page.mouse.wheel(0,120); await page.keyboard.up('Control');
    await expect.poll(()=>sheet.evaluate(el=>Math.round(el.getBoundingClientRect().width))).toBeCloseTo(pdfWidth,0);
    // Repeated wheel input stops at the same limits as the toolbar (25–400%).
    for (const [delta,expected] of [[-240,4],[240,0.25]]) {
      await page.locator('.reader-scroll').evaluate((el,dy)=>{
        for(let i=0;i<12;i++)el.dispatchEvent(new WheelEvent('wheel',{deltaY:dy,ctrlKey:true,bubbles:true,cancelable:true}));
      },delta);
      await expect(page.getByLabel('Zoom',{exact:true}).locator('option:disabled')).toHaveText(`${expected*100}%`);
    }
    await page.getByLabel('Zoom',{exact:true}).selectOption('1');
    await page.getByRole('button',{name:'Buscar',exact:true}).click();
    await page.getByRole('textbox',{name:'Buscar texto'}).fill('Select this');
    await expect(page.locator('.reader-search [aria-live]')).toHaveText('1 / 3');
    await page.getByRole('button',{name:'Cerrar búsqueda'}).click();
    await page.locator('.reader .textLayer').first().evaluate(el=>{
      const span=Array.from(el.querySelectorAll('span')).find(e=>e.textContent?.includes('Select this'))!;
      const range=document.createRange();range.selectNodeContents(span);window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);
      el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
    });
    await page.getByRole('button',{name:'Resaltar selección'}).click();
    await expect(page.locator('.reader-notice')).toContainText('Resaltado incorporado');
    await expect(page.locator('.reader-loading')).toHaveCount(0);
    const saved=await request.get(`/api/download/${filename}`);
    const reopened=await PDFDocument.load(await saved.body());
    const annots=reopened.getPage(0).node.lookup(PDFName.of('Annots'),PDFArray);
    expect(annots.size()).toBeGreaterThan(0);
    await page.getByLabel('Opciones de lectura',{exact:true}).click();
    await page.getByRole('button',{name:'Marcar página',exact:true}).click();
    await expect(page.getByRole('button',{name:'Marcar página',exact:true})).toHaveAttribute('aria-pressed','true');
    await page.getByLabel('Color de lectura').selectOption('sepia');
    const options=page.getByLabel('Opciones de lectura',{exact:true});
    if(!await options.evaluate(el=>(el.closest('details') as HTMLDetailsElement).open))await options.click();
    await page.getByRole('button',{name:'Ampliar zoom'}).click();
    await page.getByRole('button',{name:'Girar vista',exact:true}).click();
    await expect(page.locator('.reader .page').first()).toHaveAttribute('data-loaded','true');
    // Return to portrait at 100% for a useful visual checkpoint.
    for(let i=0;i<3;i++) await page.getByRole('button',{name:'Girar vista',exact:true}).click();
    await page.getByLabel('Zoom',{exact:true}).selectOption('1');
    await expect(page.locator('.reader .textLayer').first()).toContainText('MagicPDF page 1');
    await page.locator('.reader .page canvas').first().evaluate(canvas=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    await page.screenshot({path:'work/reader-verified.png'});
    const paragraphs=await (await request.get(`/api/paragraphs/${filename}/1`)).json();
    expect(paragraphs.paragraphs.length).toBeGreaterThan(0);
    const renderUrl=`/api/page-image/${filename}/1?dpi=120`;
    const renders=await Promise.all([request.get(renderUrl),request.get(renderUrl)]);
    const before=await renders[0].body();
    expect(before.equals(await renders[1].body())).toBeTruthy();
    const edited=await request.post('/api/edit-text',{data:{filename,page:1,paragraph:paragraphs.paragraphs[0].paragraph,text:'Edited with MagicPDF',font:'helvetica',size:24,color:'#222226'}});
    expect(edited.ok()).toBeTruthy();
    const lines=await (await request.get(`/api/lines/${filename}/1`)).json();
    expect(JSON.stringify(lines)).toContain('Edited with MagicPDF');
    const after=await request.get(renderUrl);
    expect(before.equals(await after.body())).toBeFalsy();
    const editedPdf=await PDFDocument.load(await (await request.get(`/api/download/${filename}`)).body());
    expect(editedPdf.getPage(0).node.lookup(PDFName.of('Annots'),PDFArray).size()).toBeGreaterThan(0);
    const bad=await request.post('/api/highlight',{data:{filename:'../invalid.pdf',page:1,rects:[],color:'#fde047',text:''}});
    expect(bad.status()).toBe(400);
    const blocked=await request.post('/api/highlight',{headers:{Origin:'https://example.com'},data:{}});expect(blocked.status()).toBe(403);
    expect(errors).toEqual([]);
  } finally {
    // Only this test's uploaded copy and renders, after consumers have stopped.
    await page.close();
    await expect.poll(async()=>{const h=await(await request.get('/api/info/__health')).json();return h.renders.active+h.renders.queued;}).toBe(0);
    if(filename){await fs.rm(path.join('storage/uploads',filename),{force:true});for(const name of await fs.readdir('storage/temp'))if(name.startsWith(`render_${path.basename(filename,'.pdf')}_`))await fs.rm(path.join('storage/temp',name),{force:true});}
  }
});
