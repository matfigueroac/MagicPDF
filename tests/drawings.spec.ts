import { test, expect } from "@playwright/test";
import {
  PDFDocument,
  PDFArray,
  PDFDict,
  PDFName,
  StandardFonts,
} from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";
import fs from "node:fs/promises";
import path from "node:path";
test("live annotations: no document reload, transparent shapes, editable text and native PDF appearance", async ({
  page,
  request,
}) => {
  test.setTimeout(30000);
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf
    .addPage([595, 842])
    .drawText("Anotaciones sin saltos", { x: 50, y: 790, size: 22, font });
  let filename = "";
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let readerLoads = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/reader-file/")) readerLoads++;
  });
  const draw = async (
    x: number,
    y: number,
    w: number,
    h: number,
    ink = false,
  ) => {
    const box = await page.locator(".reader .page").first().boundingBox();
    const scale = box!.width / 595;
    await page.mouse.move(box!.x + x * scale, box!.y + y * scale);
    await page.mouse.down();
    if (ink) {
      for (let i = 1; i <= 12; i++)
        await page.mouse.move(
          box!.x + (x + (w * i) / 12) * scale,
          box!.y + (y + h * Math.sin(i / 3)) * scale,
        );
    } else
      await page.mouse.move(
        box!.x + (x + w) * scale,
        box!.y + (y + h) * scale,
        { steps: 12 },
      );
    await page.mouse.up();
    await expect(page.getByLabel("Propiedades de anotación")).toBeVisible();
  };
  const apply = async () => {
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/drawing") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Aplicar anotación", exact: true })
      .click();
    const res = await saved;
    expect(res.ok(), await res.text()).toBeTruthy();
    await expect(page.getByLabel("Propiedades de anotación")).toHaveCount(0);
  };
  const choose = async (name: string) => {
    await page.getByLabel("Figuras y dibujo", { exact: true }).click();
    await page.getByRole("button", { name, exact: true }).click();
  };
  try {
    await page.goto("/");
    const uploaded = page.waitForResponse((r) =>
      r.url().endsWith("/api/upload"),
    );
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "drawings-automated-test.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(await pdf.save()),
      });
    filename = (await (await uploaded).json()).documents[0].filename;
    await expect(page.locator(".reader .textLayer").first()).toContainText(
      "Anotaciones sin saltos",
    );
    await page.getByLabel("Zoom", { exact: true }).selectOption("1");
    await page
      .locator(".reader .textLayer")
      .first()
      .evaluate((el) => {
        const span = el.querySelector("span")!;
        const range = document.createRange();
        range.selectNodeContents(span);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
        el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      });
    const canvas = await page.locator(".reader canvas").first().elementHandle(),
      loads = readerLoads;
    await page
      .getByRole("button", { name: "Resaltar selección", exact: true })
      .click();
    await expect(page.locator(".reader-notice")).toContainText(
      "Resaltado incorporado",
    );
    expect(readerLoads).toBe(loads);
    expect(
      await canvas!.evaluate(
        (el) => el === document.querySelector(".reader canvas"),
      ),
    ).toBeTruthy();
    await expect(page.locator(".reader-loading")).toHaveCount(0);
    await choose("Rectángulo");
    await draw(75, 120, 170, 85);
    await page
      .getByLabel("Color de anotación", { exact: true })
      .fill("#2563eb");
    await page.getByLabel("Grosor de línea", { exact: true }).fill("3");
    await apply();
    await page
      .getByRole("button", { name: "Insertar cuadro de texto", exact: true })
      .click();
    await draw(75, 250, 230, 100);
    await expect(page.getByLabel("Mostrar borde de texto")).not.toBeChecked();
    await page
      .getByLabel("Texto de anotación", { exact: true })
      .fill("Texto editable y sin borde");
    await apply();
    const text = page.locator("g[data-kind=text]").first();
    await text.locator("text").click();
    await page.getByLabel("Mostrar borde de texto").check();
    await page
      .getByLabel("Tipo de línea", { exact: true })
      .selectOption("dashed");
    await page.getByLabel("Color del borde", { exact: true }).fill("#dc2626");
    await page.getByLabel("Grosor de línea", { exact: true }).fill("2");
    await apply();
    await choose("Flecha");
    await draw(75, 390, 120, 45);
    await apply();
    await choose("Círculo / óvalo");
    await draw(300, 120, 80, 80);
    await apply();
    await choose("Línea");
    await draw(310, 300, 70, 20);
    await apply();
    await choose("Dibujo libre");
    await draw(80, 470, 130, 15, true);
    await apply();
    expect(readerLoads).toBe(loads);
    expect(
      await canvas!.evaluate(
        (el) => el === document.querySelector(".reader canvas"),
      ),
    ).toBeTruthy();
    const scene = await (await request.get(`/api/scene/${filename}`)).json();
    expect(scene.annotations).toHaveLength(7);
    expect(scene.annotations.find((a: any) => a.kind === "text")).toMatchObject(
      { border: true, lineStyle: "dashed", borderColor: "#dc2626" },
    );
    const downloaded = await (
      await request.get(`/api/download/${filename}`)
    ).body();
    const native = await PDFDocument.load(downloaded);
    expect(
      native.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray).size(),
    ).toBe(7);
    for (const a of native
      .getPage(0)
      .node.lookup(PDFName.of("Annots"), PDFArray)
      .asArray()) {
      const dict = native.context.lookup(a, PDFDict);
      expect(dict.get(PDFName.of("AP"))).toBeTruthy();
    }
    // Render the actual saved PDF, independently of our editable SVG overlay.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const nativeDoc = await pdfjs.getDocument({
      data: new Uint8Array(downloaded),
      isEvalSupported: false,
      useSystemFonts: false,
      standardFontDataUrl:
        path.resolve("node_modules/pdfjs-dist/standard_fonts") + "/",
    }).promise;
    const nativePage = await nativeDoc.getPage(1),
      viewport = nativePage.getViewport({ scale: 1 });
    const image = createCanvas(viewport.width, viewport.height),
      ctx = image.getContext("2d");
    await nativePage.render({ canvasContext: ctx as any, viewport }).promise;
    const center = ctx.getImageData(160, 165, 1, 1).data;
    expect([...center].slice(0, 3)).toEqual([255, 255, 255]);
    const edge = ctx.getImageData(75, 160, 1, 1).data;
    expect(edge[2]).toBeGreaterThan(edge[0]);
    await fs.writeFile("work/native-drawings.png", image.toBuffer("image/png"));
    await nativeDoc.destroy();
    await page.screenshot({ path: "work/drawings-verified.png" });
    await page.getByLabel("Inicio", { exact: true }).click();
    await page
      .getByRole("button", { name: "Ir al inicio", exact: true })
      .click();
    await page
      .getByRole("tab", { selected: true })
      .click();
    await expect(page.locator("g[data-kind=text]")).toHaveCount(1);
    await page.locator("g[data-kind=text] text").click();
    await page
      .getByLabel("Texto de anotación", { exact: true })
      .fill("Editado después de volver a abrir");
    await apply();
    // Manipulation uses real pointer events and persists without replacing the canvas.
    const manipulationCanvas=await page.locator('.reader canvas').first().elementHandle();
    const manipulationLoads=readerLoads;
    const sceneNow = async () =>
      (await (await request.get(`/api/scene/${filename}`)).json()).annotations;
    const rectangle = page.locator("g[data-kind=rectangle]");
    const selectOutline = async (selector: string) => {
      const outline = await page.locator(selector).boundingBox();
      await page.mouse.click(outline!.x + 6, outline!.y + outline!.height / 2);
      await expect(page.locator("g[data-selected=true]")).toHaveCount(1);
    };
    const savedDrag = async (selector: string, dx: number, dy: number) => {
      const box = await page.locator(selector).boundingBox();
      const saved = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/drawing") && r.request().method() === "POST",
      );
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        box!.x + box!.width / 2 + dx,
        box!.y + box!.height / 2 + dy,
        { steps: 12 },
      );
      await page.mouse.up();
      expect((await saved).ok()).toBeTruthy();
      await expect(
        page.getByRole("button", { name: "Aplicar anotación", exact: true }),
      ).toBeEnabled();
    };
    const beforeMove = (await sceneNow()).find(
      (a: any) => a.kind === "rectangle",
    );
    await selectOutline("g[data-kind=rectangle] .annotation-hit-target rect");
    await savedDrag(
      "g[data-selected=true] .annotation-selection > rect:first-child",
      40,
      -20,
    );
    const moved = (await sceneNow()).find((a: any) => a.kind === "rectangle");
    expect(moved.points[0][0] - beforeMove.points[0][0]).toBeCloseTo(30, 0);
    expect(moved.points[0][1] - beforeMove.points[0][1]).toBeCloseTo(15, 0);
    await savedDrag("[data-resize-handle=se]", 60, 40);
    const resized = (await sceneNow()).find((a: any) => a.kind === "rectangle");
    expect(
      Math.abs(resized.points[1][0] - resized.points[0][0]),
    ).toBeGreaterThan(Math.abs(moved.points[1][0] - moved.points[0][0]) + 40);
    await page.getByRole("button", { name: "Cerrar propiedades" }).click();
    await page.locator("g[data-kind=text] text").click();
    const beforeText = (await sceneNow()).find((a: any) => a.kind === "text");
    await savedDrag("[data-resize-handle=se]", 50, 25);
    await savedDrag(
      "g[data-selected=true] .annotation-selection > rect:first-child",
      20,
      15,
    );
    const afterText = (await sceneNow()).find((a: any) => a.kind === "text");
    expect(afterText.text).toBe(beforeText.text);
    expect(afterText.points).not.toEqual(beforeText.points);
    await page.screenshot({path:'work/manipulation-verified.png'});
    await page.getByLabel("Texto de anotación", { exact: true }).focus();
    await page.keyboard.press("End");
    await page.keyboard.press("Delete");
    expect(await sceneNow()).toHaveLength(7);
    await page.getByRole("button", { name: "Cerrar propiedades" }).click();
    const arrow = page.locator(
        "g[data-kind=arrow] .annotation-hit-target polyline",
      ),
      arrowBox = await arrow.boundingBox();
    await page.mouse.click(
      arrowBox!.x + arrowBox!.width / 2,
      arrowBox!.y + arrowBox!.height / 2,
    );
    const beforeArrow = (await sceneNow()).find((a: any) => a.kind === "arrow");
    await savedDrag("[data-resize-handle=endpoint1]", 30, 30);
    const afterArrow = (await sceneNow()).find((a: any) => a.kind === "arrow");
    expect(afterArrow.points[0]).toEqual(beforeArrow.points[0]);
    expect(afterArrow.points[1]).not.toEqual(beforeArrow.points[1]);
    await page.getByRole("button", { name: "Cerrar propiedades" }).click();
    await selectOutline("g[data-kind=rectangle] .annotation-hit-target rect");
    const deleted = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/drawing") && r.request().method() === "POST",
    );
    await page.keyboard.press("Delete");
    expect((await deleted).ok()).toBeTruthy();
    await expect(rectangle).toHaveCount(0);
    expect(await sceneNow()).toHaveLength(6);
    const savedPdf = await PDFDocument.load(
      await (await request.get(`/api/download/${filename}`)).body(),
    );
    expect(
      savedPdf.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray).size(),
    ).toBe(6);
    expect(await manipulationCanvas!.evaluate(el=>el===document.querySelector('.reader canvas'))).toBeTruthy();
    expect(readerLoads).toBe(manipulationLoads);
    // Home navigation intentionally reopened the view; manipulation itself makes no new requests.
    expect(readerLoads).toBe(loads + 1);
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
