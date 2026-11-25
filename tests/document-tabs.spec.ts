import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import fs from 'node:fs/promises';
import path from 'node:path';

test('PDF tabs switch documents and close only the requested file', async ({ page, request }) => {
  const files = [];
  for (const name of ['Primero', 'Segundo', 'Tercero']) {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= (name === 'Primero' ? 3 : 1); i++) {
      pdf.addPage().drawText(`${name} pagina ${i}`, { x: 50, y: 750, font });
    }
    files.push({ name: `${name}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  }
  const filenames: string[] = [];
  const uploads: Promise<void>[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.url().endsWith('/api/upload')) uploads.push(response.json().then(data => {
      filenames.push(...data.documents.map((d: { filename: string }) => d.filename));
    }));
  });
  try {
    await page.goto('/');
    await page.locator('input[type=file]').first().setInputFiles(files);
    await expect(page.getByRole('tab')).toHaveCount(3);
    await expect(page.getByRole('tab', { name: 'Primero.pdf', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.reader .textLayer').first()).toContainText('Primero pagina 1');
    await page.getByRole('tab', { selected: true }).press('End');
    await expect(page.getByRole('tab', { selected: true })).toHaveText('Tercero.pdf');
    await expect(page.getByRole('tab', { selected: true })).toBeFocused();
    await page.getByRole('tab', { selected: true }).press('Home');
    await expect(page.getByRole('tab', { selected: true })).toHaveText('Primero.pdf');
    await page.getByLabel('Número de página', { exact: true }).fill('3');
    await expect(page.getByLabel('Número de página', { exact: true })).toHaveValue('3');

    // Canceling a native save prompt must keep every tab and the active PDF.
    await page.evaluate(() => {
      (window as any).tabConfirmations = [];
      (window as any).allowTabClose = false;
      window.electronAPI = {
        confirmDocuments: async documents => {
          (window as any).tabConfirmations.push(documents.map(d => d.name));
          return (window as any).allowTabClose;
        },
      } as NonNullable<Window['electronAPI']>;
    });
    await page.getByRole('button', { name: 'Cerrar Segundo.pdf', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).tabConfirmations)).toEqual([['Segundo.pdf']]);
    await expect(page.getByRole('tab')).toHaveCount(3);
    await expect(page.getByRole('tab', { selected: true })).toHaveText('Primero.pdf');
    await page.evaluate(() => { (window as any).allowTabClose = true; });

    await page.getByRole('tab', { name: 'Segundo.pdf', exact: true }).click();
    await expect(page.locator('.reader .textLayer').first()).toContainText('Segundo pagina 1');
    await page.getByRole('button', { name: 'Cerrar Segundo.pdf', exact: true }).click();
    await expect(page.getByRole('tab')).toHaveCount(2);
    await expect(page.getByRole('tab', { selected: true })).toHaveText('Tercero.pdf');
    await expect(page.getByLabel('Número de página', { exact: true })).toHaveValue('1');
    await expect(page.locator('.reader .textLayer').first()).toContainText('Tercero pagina 1');
    // Closing a background tab must leave the current PDF untouched.
    await page.getByRole('button', { name: 'Cerrar Primero.pdf', exact: true }).click();
    await expect(page.getByRole('tab')).toHaveCount(1);
    await expect(page.getByRole('tab', { selected: true })).toHaveText('Tercero.pdf');
    await expect(page.locator('.reader .textLayer').first()).toContainText('Tercero pagina 1');
    await page.getByRole('button', { name: 'Cerrar Tercero.pdf', exact: true }).click();
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Área de trabajo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Abrir PDF', exact: true }).first()).toBeFocused();
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(uploads);
    await page.close();
    await expect.poll(async () => {
      const health = await (await request.get('/api/info/__health')).json();
      return health.renders.active + health.renders.queued;
    }).toBe(0);
    for (const filename of filenames) {
      await fs.rm(path.join('storage/uploads', filename), { force: true });
      for (const name of await fs.readdir('storage/temp')) {
        if (name.startsWith(`render_${path.basename(filename, '.pdf')}_`)) await fs.rm(path.join('storage/temp', name), { force: true });
      }
    }
  }
});
