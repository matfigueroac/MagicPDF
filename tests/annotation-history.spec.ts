import { test, expect } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import fs from "node:fs/promises";
import path from "node:path";

test("marks: nested text, duplicate events, pending undo, redo, color and deletion", async ({ page, request }) => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([595, 842]).drawText("Selecciona y borra esta marca", { x: 60, y: 730, size: 18, font });
  let filename = "";
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  const scene = async () => (await (await request.get(`/api/scene/${filename}`)).json()).annotations;
  const history = async () => (await (await request.get(`/api/history/${filename}`)).json());
  try {
    await page.goto("/");
    const upload = page.waitForResponse(r => r.url().endsWith("/api/upload"));
    await page.locator("input[type=file]").first().setInputFiles({
      name: "marks-history-test.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()),
    });
    filename = (await (await upload).json()).documents[0].filename;
    await expect(page.locator(".reader .textLayer").first()).toContainText("Selecciona y borra");
    await page.getByLabel("Zoom", { exact: true }).selectOption("1");
    await expect(page.locator("#history-controls").getByRole("button", { name: "Deshacer", exact: true })).toBeDisabled();
    let writes = 0;
    await page.route("**/api/highlight", async route => {
      writes++;
      await new Promise(resolve => setTimeout(resolve, 250));
      await route.continue();
    });
    await page.getByRole("button", { name: "Resaltar texto", exact: true }).click();
    await page.locator(".textLayer").first().evaluate(el => {
      const span = Array.from(el.querySelectorAll("span")).find(s => s.textContent?.includes("Selecciona y borra"))!;
      const child = document.createElement("span");
      child.textContent = span.textContent;
      span.replaceChildren(child);
      const range = document.createRange(); range.selectNodeContents(span);
      window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    });
    await expect.poll(async () => (await history()).redo).toBe(1);
    expect(writes).toBe(1);
    expect(await scene()).toHaveLength(0);
    await page.getByRole("button", { name: "Rehacer", exact: true }).click();
    await expect(page.locator("g[data-kind=highlight]")).toHaveCount(1);
    expect((await scene())[0].rects).toHaveLength(1);
    await page.getByRole("button", { name: "Seleccionar texto", exact: true }).click();
    const mark = page.locator("g[data-kind=highlight] > path");
    const bounds = await mark.boundingBox();
    await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await expect(page.getByRole("button", { name: "Eliminar anotación", exact: true })).toBeVisible();
    const colored = page.waitForResponse(r => r.url().endsWith("/api/drawing") && r.request().method() === "POST");
    await page.getByLabel("Color rápido").fill("#22c55e");
    expect((await colored).ok()).toBeTruthy();
    expect((await scene())[0].color).toBe("#22c55e");
    await page.getByRole("button", { name: "Eliminar anotación", exact: true }).click();
    await expect.poll(async () => (await scene()).length).toBe(0);
    await page.keyboard.press("Control+z");
    await expect(page.locator("g[data-kind=highlight]")).toHaveCount(1);
    await page.keyboard.press("Control+y");
    await expect(page.locator("g[data-kind=highlight]")).toHaveCount(0);

    await page.getByRole("button", { name: "Subrayar texto", exact: true }).click();
    await page.locator(".textLayer").first().evaluate(el => {
      const span = Array.from(el.querySelectorAll("span")).find(s => s.textContent?.includes("Selecciona y borra"))!;
      const range = document.createRange(); range.selectNodeContents(span);
      window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await expect(page.locator("g[data-kind=underline]")).toHaveCount(1);
    await page.getByRole("button", { name: "Seleccionar texto", exact: true }).click();
    const line = await page.locator("g[data-kind=underline] > line").boundingBox();
    await page.mouse.click(line!.x + line!.width / 2, line!.y);
    await expect(page.getByRole("button", { name: "Eliminar anotación", exact: true })).toBeVisible();
    await page.keyboard.press("Delete");
    await expect.poll(async () => (await scene()).length).toBe(0);
    expect(errors).toEqual([]);
    await page.screenshot({ path: "work/annotation-history-verified.png" });
  } finally {
    await page.close();
    if (filename) await fs.rm(path.join("storage/uploads", filename), { force: true });
  }
});

test("overlapping rectangles have uniform color in both live overlay and saved PDF", async ({ page, request }) => {
  const pdf = await PDFDocument.create(); pdf.addPage([595, 842]);
  const seed = await request.post("/api/upload", { multipart: { files: {
    name: "overlap-source-test.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()),
  } } });
  const filename = (await seed.json()).documents[0].filename;
  let opened = "";
  try {
    expect((await request.post("/api/highlight", { data: {
      filename, page: 1, rects: [[60, 600, 180, 640], [120, 600, 240, 640]], color: "#fde047", text: "Solapamiento",
    } })).ok()).toBeTruthy();
    const bytes = await (await request.get(`/api/download/${filename}`)).body();
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const native = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
    try {
      const p = await native.getPage(1), viewport = p.getViewport({ scale: 1 });
      const canvas = createCanvas(viewport.width, viewport.height), ctx = canvas.getContext("2d");
      await p.render({ canvasContext: ctx as any, viewport }).promise;
      const pixel = (x: number) => [...ctx.getImageData(x, 220, 1, 1).data];
      expect(pixel(90)).toEqual(pixel(150));
      expect(pixel(150)).toEqual(pixel(210));
      expect(pixel(90).slice(0, 3)).not.toEqual([255, 255, 255]);
    } finally { await native.destroy(); }
    await page.goto("/");
    const upload = page.waitForResponse(r => r.url().endsWith("/api/upload"));
    await page.locator("input[type=file]").first().setInputFiles({ name: "overlap-live-test.pdf", mimeType: "application/pdf", buffer: bytes });
    opened = (await (await upload).json()).documents[0].filename;
    await expect(page.locator("g[data-kind=highlight] > path")).toHaveCount(1);
    await page.getByLabel("Zoom", { exact: true }).selectOption("1");
    const image = await loadImage(await page.locator("g[data-kind=highlight] > path").screenshot());
    const canvas = createCanvas(image.width, image.height), ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0);
    const pixel = (fraction: number) => [...ctx.getImageData(Math.floor(image.width * fraction), Math.floor(image.height / 2), 1, 1).data];
    expect(pixel(1 / 6)).toEqual(pixel(1 / 2));
    expect(pixel(1 / 2)).toEqual(pixel(5 / 6));
  } finally {
    await page.close();
    for (const name of [filename, opened].filter(Boolean)) await fs.rm(path.join("storage/uploads", name), { force: true });
  }
});
