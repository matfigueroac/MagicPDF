import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

test('accessible reader in forced colors with a 500-page PDF', async ({ page, browser }) => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= 500; n++)
    pdf.addPage([595, 842]).drawText(`MagicPDF escala ${n}`, { x: 48, y: 770, size: 18, font });
  const buffer = Buffer.from(await pdf.save());
  const cdp = await page.context().newCDPSession(page);
  const system = await browser.newBrowserCDPSession();
  await cdp.send('Performance.enable');
  const memory = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    const heap = metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value;
    const { processInfo } = await system.send('SystemInfo.getProcessInfo');
    const ids = processInfo.filter(proc => proc.type.toLowerCase() === 'renderer').map(proc => proc.id);
    const privateBytes = ids.length && process.platform === 'win32' ? Number((await promisify(execFile)(
      'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `(Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | Measure-Object PrivateMemorySize64 -Sum).Sum`],
    )).stdout.trim()) : null;
    return { jsHeapMiB: Math.round((heap ?? 0) / 1024 ** 2), rendererPrivateMiB: privateBytes === null ? null : Math.round(privateBytes / 1024 ** 2) };
  };
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/');
  let filename = '';
  const pageText = (n: number) => page.locator(`.page[data-page-number="${n}"] .textLayer`).getByText(`MagicPDF escala ${n}`, { exact: true });
  try {
    const upload = page.waitForResponse(res => res.url().endsWith('/api/upload'));
    const start = performance.now();
    await page.locator('input[type=file]').first().setInputFiles({ name: 'Escala.pdf', mimeType: 'application/pdf', buffer });
    const result = await (await upload).json();
    expect(result.success).toBe(true);
    filename = result.documents[0].filename;
    await expect(pageText(1)).toBeVisible();
    const openMs = Math.round(performance.now() - start);
    const initialMemory = await memory();
    const reader = page.getByRole('region', { name: 'Lectura de Escala.pdf' });
    const number = page.getByRole('spinbutton', { name: 'Número de página' });
    const announcement = page.getByRole('status').filter({ hasText: /^Página \d+ de 500$/ });
    await expect(announcement).toHaveText('Página 1 de 500');
    await expect(reader.locator('.page[data-page-number="1"]')).toMatchAriaSnapshot(`
      - region:
        - text: MagicPDF escala 1
    `);
    await reader.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(reader).toBeFocused();
    await expect(reader).toHaveCSS('outline-style', 'solid');
    await expect(reader.locator('.page').first()).toHaveCSS('filter', 'none');
    const before = await reader.evaluate(el => el.scrollTop);
    const scrollStart = performance.now();
    await reader.press('PageDown');
    await expect(pageText(2)).toBeVisible();
    await expect.poll(() => reader.evaluate(el => el.scrollTop)).toBeGreaterThan(before);
    const scrollMs = Math.round(performance.now() - scrollStart);
    const jumpsMs: Record<number, number> = {};
    for (const n of [100, 250, 500]) {
      const jumpStart = performance.now();
      await number.fill(String(n));
      await expect(pageText(n)).toBeVisible();
      await expect(announcement).toHaveText(`Página ${n} de 500`);
      jumpsMs[n] = Math.round(performance.now() - jumpStart);
    }
    await expect(page.getByRole('button', { name: 'Página siguiente', exact: true })).toBeDisabled();
    const canvases = await reader.locator('canvas').count();
    expect(canvases).toBeLessThan(30);
    console.log(JSON.stringify({ pages: 500, pdfBytes: buffer.length, openMs, scrollMs, jumpsMs, canvases, initialMemory, finalMemory: await memory() }));
  } finally {
    if (filename) {
      await page.close();
      await fs.rm(path.join('storage/uploads', filename), { force: true });
    }
  }
});
