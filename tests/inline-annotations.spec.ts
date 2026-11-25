import { test, expect } from '@playwright/test';
import { setReaderZoom100 } from './reader-zoom';
import { PDFDocument } from 'pdf-lib';
import fs from 'node:fs/promises';
import path from 'node:path';

test('automatic figures, in-place text and contextual actions preserve the PDF canvas', async ({ page, request }) => {
  const pdf = await PDFDocument.create(); pdf.addPage([595,842]);
  let filename = '', loads = 0;
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (r.url().includes('/api/reader-file/')) loads++; });
  const scene = async () => (await (await request.get(`/api/scene/${filename}`)).json()).annotations;
  const saved = () => page.waitForResponse(r => r.url().endsWith('/api/drawing') && r.request().method() === 'POST', {timeout:5000});
  try {
    await page.goto('/');
    const uploaded = page.waitForResponse(r => r.url().endsWith('/api/upload'));
    await page.locator('input[type=file]').first().setInputFiles({ name:'inline-test.pdf', mimeType:'application/pdf', buffer:Buffer.from(await pdf.save()) });
    filename = (await (await uploaded).json()).documents[0].filename;
    await expect(page.locator('.reader canvas').first()).toBeVisible();
    await setReaderZoom100(page, 595);
    const canvas = await page.locator('.reader canvas').first().elementHandle();
    const baseline = loads;
    const box = (await page.locator('.reader .page').first().boundingBox())!;
    const clickBlank = () => page.mouse.click(box.x + 70, box.y + 490);
    await page.getByLabel('Figuras y dibujo', {exact:true}).click();
    await page.getByRole('button', {name:'Rectángulo',exact:true}).click();
    await page.mouse.move(box.x+80,box.y+150); await page.mouse.down();
    await page.mouse.move(box.x+250,box.y+220,{steps:8});
    const created = saved(); await page.mouse.up(); expect((await created).ok()).toBeTruthy();
    await clickBlank(); expect(await scene()).toHaveLength(1);
    await page.locator('[data-kind=rectangle] .annotation-hit-target rect').first().click({position:{x:1,y:25}});
    await expect(page.getByRole('toolbar',{name:'Acciones rápidas de anotación'})).toBeVisible();
    const recolored = saved();
    await page.getByLabel('Color rápido',{exact:true}).fill('#ed1234');
    expect((await recolored).ok()).toBeTruthy(); expect((await scene())[0].color).toBe('#ed1234');
    await page.getByRole('button',{name:'Duplicar anotación',exact:true}).click();
    await expect.poll(async () => (await scene()).length).toBe(2);
    await page.getByLabel('Eliminar anotación',{exact:true}).click();
    await expect.poll(async () => (await scene()).length).toBe(1);

    await page.getByLabel('Insertar cuadro de texto',{exact:true}).click();
    await page.mouse.click(box.x+100,box.y+320);
    const editor = page.getByRole('textbox',{name:'Editar texto sobre el PDF',exact:true});
    await expect(editor).toBeFocused();
    await editor.fill('Texto directo\nSegunda línea\nTercera línea\nCuarta línea');
    const written = saved(); await clickBlank(); expect((await written).ok()).toBeTruthy();
    const text = (await scene()).find((a: any) => a.kind === 'text');
    expect(text.text).toContain('Cuarta línea');
    expect(Math.abs(text.points[1][1]-text.points[0][1])).toBeGreaterThan(50);
    const textShape = page.locator(`[data-annotation-id="${text.id}"]`);
    await textShape.locator('text').dblclick();
    await expect(editor).toBeFocused(); await editor.fill('Cancelado'); await editor.press('Escape');
    expect((await scene()).find((a:any)=>a.id===text.id).text).toBe(text.text);
    await textShape.locator('text').dblclick();
    await editor.fill('Editado en la página'); const edited = saved(); await editor.press('Control+Enter');
    expect((await edited).ok()).toBeTruthy();
    expect((await scene()).find((a:any)=>a.id===text.id).text).toBe('Editado en la página');
    await page.getByLabel('Bloquear elemento',{exact:true}).click();
    await expect(textShape).toHaveAttribute('data-locked','true');
    await textShape.locator('text').dblclick(); await expect(editor).toHaveCount(0);
    await expect(page.getByLabel('Eliminar anotación',{exact:true})).toBeDisabled();
    expect(loads).toBe(baseline);
    expect(await canvas!.evaluate(el => el===document.querySelector('.reader canvas'))).toBeTruthy();
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await expect.poll(async () => { const h = await (await request.get('/api/info/__health')).json(); return h.renders.active+h.renders.queued; }).toBe(0);
    if (filename) {
      await fs.rm(path.join('storage/uploads',filename),{force:true});
      for (const name of await fs.readdir('storage/temp'))
        if (name.startsWith(`render_${path.basename(filename,'.pdf')}_`)) await fs.rm(path.join('storage/temp',name),{force:true});
    }
  }
});
