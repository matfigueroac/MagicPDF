import { test, expect } from "@playwright/test";
import {
  PDFDocument,
  StandardFonts,
  PDFName,
  PDFArray,
  PDFDict,
  rgb,
} from "pdf-lib";
import fs from "node:fs/promises";
import path from "node:path";

test("one toolbar, real mouse selection, highlight and underline without edit mode", async ({
  page,
  request,
}) => {
  const pdf = await PDFDocument.create(),
    regular = await pdf.embedFont(StandardFonts.Helvetica),
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (let n = 1; n <= 4; n++) {
    const p = pdf.addPage([595, 842]);
    p.drawText("CUADERNO DE LECTURA", {
      x: 56,
      y: 788,
      size: 9,
      font: bold,
      color: rgb(0.45, 0.5, 0.58),
    });
    p.drawText("Un espacio para tus ideas", {
      x: 56,
      y: 733,
      size: 28,
      font: bold,
      color: rgb(0.12, 0.17, 0.24),
    });
    p.drawText("Lee con calma. Conserva lo importante.", {
      x: 56,
      y: 699,
      size: 13,
      font: regular,
      color: rgb(0.4, 0.45, 0.52),
    });
    p.drawLine({
      start: { x: 56, y: 674 },
      end: { x: 539, y: 674 },
      thickness: 1,
      color: rgb(0.85, 0.88, 0.92),
    });
    p.drawText("1. Una lectura sin distracciones", {
      x: 56,
      y: 636,
      size: 17,
      font: bold,
    });
    [
      "Selecciona esta línea para probar las anotaciones.",
      "Las buenas herramientas aparecen cuando las necesitas.",
      "El documento ocupa el centro; los controles quedan a mano.",
      "",
      "Subraya una idea, resalta un detalle y vuelve a leer.",
      "Tus anotaciones se guardan dentro del propio archivo PDF.",
      "",
      "2. Tu documento, a tu manera",
      "Ajusta el tamaño de lectura y muestra las páginas si las necesitas.",
      "El menú reúne las herramientas de edición y organización.",
    ].forEach((line, i) =>
      p.drawText(line, {
        x: 56,
        y: 602 - i * 26,
        size: 12,
        font: regular,
        color: rgb(0.24, 0.28, 0.34),
      }),
    );
    p.drawText(String(n), { x: 290, y: 35, size: 9, font: regular });
  }
  let filename = "";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const dragText = async () => {
    const line = page
      .locator(".reader .textLayer span")
      .filter({ hasText: "Selecciona esta línea" })
      .first();
    await line.scrollIntoViewIfNeeded();
    const rect = await line.boundingBox();
    expect(rect).not.toBeNull();
    await page.mouse.move(rect!.x + 2, rect!.y + rect!.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      rect!.x + rect!.width - 2,
      rect!.y + rect!.height / 2,
      { steps: 20 },
    );
    await page.mouse.up();
  };
  try {
    await page.goto("/");
    const upload = page.waitForResponse((r) => r.url().endsWith("/api/upload"));
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "Lectura-creativa.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(await pdf.save()),
      });
    filename = (await (await upload).json()).documents[0].filename;
    await expect(page.locator(".reader .textLayer").first()).toContainText(
      "Selecciona esta línea",
    );
    await expect(page.locator(".workspace-bar")).toHaveCount(1);
    await expect(page.locator(".reader-toolbar,.pro-toolbar")).toHaveCount(0);
    await expect(page.getByLabel("Páginas del documento")).toHaveCount(0);
    await expect(page.locator('.workspace-bar').getByLabel('Color de lectura')).toBeVisible();
    await expect(page.getByLabel('Color de lectura')).toHaveCount(1);
    await page.getByLabel('Color de lectura').selectOption('night');
    await expect(page.locator('.reader-scroll')).toHaveClass(/reading-night/);
    await page.getByLabel('Color de lectura').selectOption('normal');
    await page.getByLabel('Zoom',{exact:true}).selectOption('1');
    await page.mouse.move(700,450);await page.mouse.wheel(0,120);
    await expect.poll(()=>page.locator('.reader-scroll').evaluate(el=>el.scrollTop)).toBeGreaterThanOrEqual(120);
    await page.locator('.reader .textLayer').first().evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    await dragText();
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString()))
      .toContain("Selecciona esta línea");
    await expect(
      page.getByRole("toolbar", { name: "Acciones del texto seleccionado" }),
    ).toBeVisible();
    const scrollPosition=await page.locator('.reader-scroll').evaluate(el=>el.scrollTop);
    await page
      .getByRole("button", { name: "Subrayar selección", exact: true })
      .click();
    await expect(page.locator(".reader-notice")).toContainText(
      "Subrayado incorporado",
    );
    await expect(page.locator(".reader-loading")).toHaveCount(0);
    await expect.poll(()=>page.locator('.reader-scroll').evaluate(el=>el.scrollTop)).toBe(scrollPosition);
    await expect(page.getByLabel('Zoom',{exact:true}).locator('option:checked')).toHaveText('100%');
    const saved = await PDFDocument.load(
      await (await request.get(`/api/download/${filename}`)).body(),
    );
    const annotations = saved
      .getPage(0)
      .node.lookup(PDFName.of("Annots"), PDFArray);
    expect(
      annotations.lookup(0, PDFDict).get(PDFName.of("Subtype"))?.toString(),
    ).toBe("/Underline");
    await page
      .getByRole("button", { name: "Resaltar texto", exact: true })
      .click();
    const highlighted = page.waitForResponse((r) =>
      r.url().endsWith("/api/highlight"),
    );
    await dragText();
    expect((await highlighted).ok()).toBeTruthy();
    await expect(page.locator(".reader-notice")).toContainText(
      "Resaltado incorporado",
    );
    await expect(page.locator(".reader-loading")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Seleccionar texto", exact: true })
      .click();
    await page.getByRole("button", { name: "Mostrar páginas" }).click();
    await expect(page.getByLabel("Páginas del documento")).toBeVisible();
    await page.getByRole("button", { name: "Cerrar aviso" }).click();
    await page.locator('.reader-scroll').hover();await page.mouse.wheel(0,-1500);
    await expect.poll(()=>page.locator('.reader-scroll').evaluate(el=>el.scrollTop)).toBe(0);
    await page.screenshot({ path: "work/reading-ui-dark.png" });
    await page
      .getByRole("button", { name: "Cambiar tema", exact: true })
      .click();
    await page.screenshot({ path: "work/reading-ui-light.png" });
    await page.setViewportSize({ width: 960, height: 720 });
    const bar = page.locator(".workspace-bar");
    expect(
      await bar.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBeTruthy();
    await page.getByRole("button", { name: "Mostrar páginas" }).click();
    await dragText();
    await expect(
      page.getByRole("toolbar", { name: "Acciones del texto seleccionado" }),
    ).toBeVisible();
    await page.getByRole('button',{name:'Editar PDF',exact:true}).click();
    await expect(page.getByRole('button',{name:'Editar contenido',exact:true})).toBeVisible();
    await expect(page.locator('.workspace-bar')).toHaveCount(1);
    await expect(page.getByRole('button',{name:'Volver a lectura',exact:true})).toHaveCount(1);
    await page.getByRole('button',{name:'Volver a lectura',exact:true}).click();
    await expect(page.getByRole('button',{name:'Seleccionar texto',exact:true})).toBeVisible();
    await page.getByLabel('Número de página',{exact:true}).fill('2');
    await expect(page.getByLabel('Número de página',{exact:true})).toHaveValue('2');
    await page.getByLabel('Zoom',{exact:true}).selectOption('1');
    await page.getByLabel('Inicio',{exact:true}).click();await page.getByRole('button',{name:'Ir al inicio',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Área de trabajo'})).toBeVisible();
    await page.getByRole('tab',{selected:true}).click();
    await expect(page.getByLabel('Número de página',{exact:true})).toHaveValue('2');
    await expect(page.getByLabel('Zoom',{exact:true}).locator('option:checked')).toHaveText('100%');
    await expect(page.locator('.reader .textLayer').nth(1)).toContainText('Selecciona esta línea');
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await expect
      .poll(async () => {
        const h = await (await request.get("/api/info/__health")).json();
        return h.renders.active + h.renders.queued;
      })
      .toBe(0);
    if (filename) {
      await fs.rm(path.join("storage/uploads", filename), { force: true });
      for (const name of await fs.readdir("storage/temp"))
        if (name.startsWith(`render_${path.basename(filename, ".pdf")}_`))
          await fs.rm(path.join("storage/temp", name), { force: true });
    }
  }
});
