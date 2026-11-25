import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import fs from 'node:fs/promises';
import path from 'node:path';

test('organizar desde Inicio conserva orden, giro e historial del PDF', async ({ page, request }) => {
  const pdf = await PDFDocument.create();
  for (const width of [301, 302, 303, 304]) pdf.addPage([width, 400]).drawText(`Pagina ${width - 300}`);
  let file = '';
  try {
    await page.goto('/');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const organize = page.getByRole('button', { name: /^Organizar páginas/ });
    const picker = page.waitForEvent('filechooser');
    await organize.focus();
    await organize.press('Enter');
    const uploaded = page.waitForResponse(response => response.url().endsWith('/api/upload'));
    await (await picker).setFiles({ name: 'Organizar.PDF', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
    file = (await (await uploaded).json()).documents[0].filename;
    const apply = page.getByRole('button', { name: 'Aplicar cambios' });
    await expect(apply).toBeDisabled();
    await page.getByTitle('Mover a la izquierda').nth(2).click();
    await expect(apply).toBeEnabled();
    await page.getByTitle('Rotar 90°', { exact: true }).nth(1).click();
    await page.getByTitle('Eliminar página').last().click();
    await apply.click();
    await expect(page.getByText('3 de 3 páginas activas')).toBeVisible();
    await expect(apply).toBeDisabled();

    const readPages = async () => {
      const bytes = await (await request.get(`/api/download/${file}`)).body();
      return (await PDFDocument.load(bytes)).getPages().map(page => [page.getWidth(), page.getRotation().angle]);
    };
    expect(await readPages()).toEqual([[301, 0], [303, 90], [302, 0]]);
    await page.getByRole('button', { name: 'Deshacer', exact: true }).click();
    await expect(page.getByText('4 de 4 páginas activas')).toBeVisible();
    expect(await readPages()).toEqual([[301, 0], [302, 0], [303, 0], [304, 0]]);
  } finally {
    await page.close();
    await expect.poll(async () => {
      const { renders } = await (await request.get('/api/info/__health')).json();
      return renders.active + renders.queued;
    }).toBe(0);
    if (file) {
      await fs.rm(path.join('storage/uploads', file), { force: true });
      for (const name of await fs.readdir('storage/temp')) {
        if (name.startsWith(`render_${path.parse(file).name}_`)) await fs.rm(path.join('storage/temp', name));
      }
    }
  }
});

test('un PDF dañado no impide abrir los demás y se puede reintentar la selección', async ({ page }) => {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 400]);
  const good = { name: 'Válido ñ 100%.PDF', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
  const bad = { name: 'Dañado.pdf', mimeType: 'application/pdf', buffer: Buffer.from('Archivo incompleto') };
  const files: string[] = [];
  try {
    await page.goto('/');
    const input = page.locator('input[type=file]').first();
    for (let attempt = 1; attempt <= 2; attempt++) {
      const uploaded = page.waitForResponse(response => response.url().endsWith('/api/upload') && response.ok());
      await input.setInputFiles([bad, good]);
      files.push((await (await uploaded).json()).documents[0].filename);
      await expect(page.getByRole('tab')).toHaveCount(attempt);
      await expect(page.getByRole('tab', { name: good.name, exact: true })).toHaveCount(attempt);
      await expect(page.getByRole('alert')).toContainText(bad.name);
      await page.getByRole('button', { name: 'Cerrar aviso' }).click();
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(input).toHaveValue('');
    }
  } finally {
    await page.close();
    for (const file of files) await fs.rm(path.join('storage/uploads', file), { force: true });
  }
});
