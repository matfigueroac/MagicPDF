import { _electron as electron, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const sourceDir = await fs.mkdtemp(path.resolve('work/tabs-native-'));
const prefix = path.basename(sourceDir);
const opened = [];
let app;
try {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText('Prueba de pestanas PDF', { x: 50, y: 750, size: 20, font });
  const bytes = await pdf.save();
  const sources = [];
  for (let i = 1; i <= 10; i++) {
    const file = path.join(sourceDir, `Documento-${i}-${prefix}.pdf`);
    await fs.writeFile(file, bytes);
    sources.push(file);
  }
  app = await electron.launch(process.env.MAGICPDF_EXECUTABLE
    ? { executablePath: path.resolve(process.env.MAGICPDF_EXECUTABLE), args: [], timeout: 30000 }
    : { args: [path.resolve('.')], timeout: 30000 });
  if (process.env.MAGICPDF_EXECUTABLE) assert.equal(await app.evaluate(({ app }) => app.getVersion()), JSON.parse(await fs.readFile('package.json', 'utf8')).version);
  await app.evaluate(({ dialog }, files) => {
    globalThis.tabCloseResponse = 2;
    globalThis.tabClosePrompts = [];
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
    dialog.showMessageBox = async (_win, options) => {
      globalThis.tabClosePrompts.push(options);
      return { response: globalThis.tabCloseResponse };
    };
  }, sources);
  const win = await app.firstWindow();
  const responses = [];
  win.on('response', response => {
    if (response.url().endsWith('/api/open-file-path')) responses.push(response.json().then(data => opened.push(data.document)));
  });
  await win.locator('.new-document-tab').click();
  await expect(win.getByRole('tab')).toHaveCount(10);
  await Promise.all(responses);
  assert.equal(opened.length, 10);
  await expect(win.locator('.reader .textLayer').first()).toContainText('Prueba de pestanas PDF');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()), true);
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.unmaximize();
    window.setSize(960, 700);
  });
  await expect.poll(() => win.evaluate(() => innerWidth)).toBeLessThan(1000);
  await win.getByRole('tab', { selected: true }).press('End');
  await expect(win.getByRole('tab', { selected: true })).toHaveText(path.basename(sources[9]));
  await expect.poll(() => win.locator('.document-tabs').evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  const overlay = await win.evaluate(() => ({
    rect: navigator.windowControlsOverlay.getTitlebarAreaRect().toJSON(),
    visible: navigator.windowControlsOverlay.visible,
    plus: document.querySelector('.new-document-tab').getBoundingClientRect().toJSON(),
    tab: document.querySelector('[aria-selected=true]').getBoundingClientRect().toJSON(),
    strip: document.querySelector('.document-tabs').getBoundingClientRect().toJSON(),
  }));
  assert(overlay.visible, 'Native Windows controls must be visible');
  assert(overlay.plus.right <= overlay.rect.width, 'Tabs must leave space for native window controls');
  assert(overlay.tab.right <= overlay.strip.right + 1, 'Active tab must scroll fully into view');
  await expect(win.locator('.reader .textLayer').first()).toContainText('Prueba de pestanas PDF');
  await win.screenshot({ path: 'work/document-tabs-verified.png' });
  // Make only the last working copy dirty to exercise the real native close guard.
  const dirty = opened[9];
  await fs.appendFile(dirty.path, '\n% tabs close test\n');
  await win.getByRole('button', { name: `Cerrar ${dirty.name}`, exact: true }).click();
  await expect.poll(() => app.evaluate(() => globalThis.tabClosePrompts.length)).toBe(1);
  await expect(win.getByRole('tab')).toHaveCount(10);
  assert((await app.evaluate(() => globalThis.tabClosePrompts[0].message)).includes(dirty.name));
  await app.evaluate(() => { globalThis.tabCloseResponse = 1; });
  await win.getByRole('button', { name: `Cerrar ${dirty.name}`, exact: true }).click();
  await expect(win.getByRole('tab')).toHaveCount(9);
  await expect(win.getByRole('tab', { selected: true })).toHaveText(opened[8].name);
  await win.getByRole('button', { name: `Cerrar ${opened[0].name}`, exact: true }).click();
  await expect(win.getByRole('tab')).toHaveCount(8);
  await expect(win.getByRole('tab', { selected: true })).toHaveText(opened[8].name);
  console.log('PASS desktop tabs: native controls, 960px overflow, keyboard, cancel, individual close, adjacent tab, background close');
} finally {
  if (app) {
    await app.evaluate(() => { globalThis.tabCloseResponse = 1; }).catch(() => {});
    await app.close();
  }
  for (const doc of opened) {
    await fs.rm(doc.path, { force: true });
    const temp = path.join(path.dirname(path.dirname(doc.path)), 'temp');
    for (const name of await fs.readdir(temp)) {
      if (name.startsWith(`render_${path.basename(doc.filename, '.pdf')}_`)) await fs.rm(path.join(temp, name), { force: true });
    }
  }
  // This directory contains only the generated PDFs of this finished test.
  assert.equal(path.dirname(sourceDir), path.resolve('work'));
  await fs.rm(sourceDir, { recursive: true, force: true });
}
