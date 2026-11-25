import { test, expect } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import fs from "node:fs/promises";
import path from "node:path";
async function clean(filename: string) {
  if (!filename) return;
  await fs.rm(path.join("storage/uploads", filename), { force: true });
  for (const name of await fs.readdir("storage/temp"))
    if (name.startsWith(`render_${path.basename(filename, ".pdf")}_`))
      await fs.rm(path.join("storage/temp", name), { force: true });
}
test("Pro Lite: editable forms, undo/redo, text layout and overflow validation", async ({
  page,
  request,
}) => {
  const pdf = await PDFDocument.create(),
    p = pdf.addPage(),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  p.drawText("Pro Lite form", { x: 50, y: 790, size: 22, font });
  const form = pdf.getForm();
  form
    .createTextField("Nombre")
    .addToPage(p, { x: 50, y: 700, width: 250, height: 25 });
  form
    .createCheckBox("Acepto")
    .addToPage(p, { x: 50, y: 650, width: 20, height: 20 });
  const list = form.createDropdown("País");
  list.addOptions(["Chile", "Argentina"]);
  list.select("Chile");
  list.addToPage(p, { x: 50, y: 600, width: 150, height: 25 });
  let filename = "";
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto("/");
    const uploaded = page.waitForResponse((r) =>
      r.url().endsWith("/api/upload"),
    );
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "pro-form-test.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(await pdf.save()),
      });
    filename = (await (await uploaded).json()).documents[0].filename;
    await page.getByLabel("Herramientas").click();
    await page.getByRole("button", { name: "Formulario", exact: true }).click();
    await page.getByLabel("Nombre", { exact: true }).fill("Matías Pro Lite");
    await page.getByLabel("Acepto", { exact: true }).check();
    await page.getByLabel("País", { exact: true }).selectOption("Argentina");
    const applied = page.waitForResponse(
      (r) => r.url().endsWith("/api/forms") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Aplicar formulario" }).click();
    expect((await applied).ok()).toBeTruthy();
    const download = async () =>
      PDFDocument.load(
        await (await request.get(`/api/download/${filename}`)).body(),
      );
    expect((await download()).getForm().getTextField("Nombre").getText()).toBe(
      "Matías Pro Lite",
    );
    expect(
      (await download()).getForm().getCheckBox("Acepto").isChecked(),
    ).toBeTruthy();
    await page.getByLabel("Herramientas").click();
    await expect(
      page.getByRole("button", { name: "Deshacer", exact: true }),
    ).toBeEnabled();
    const undo = page.waitForResponse(response =>
      response.url().endsWith("/api/history/undo") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Deshacer", exact: true }).click();
    const undoResponse = await undo;
    expect(undoResponse.ok(), await undoResponse.text()).toBeTruthy();
    await expect
      .poll(
        async () =>
          (await download()).getForm().getTextField("Nombre").getText() || "",
      )
      .toBe("");
    await page.getByLabel("Herramientas").click();
    await expect(
      page.getByRole("button", { name: "Rehacer", exact: true }),
    ).toBeEnabled();
    const redo = page.waitForResponse(response =>
      response.url().endsWith("/api/history/redo") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Rehacer", exact: true }).click();
    const redoResponse = await redo;
    expect(redoResponse.ok(), await redoResponse.text()).toBeTruthy();
    await expect
      .poll(async () =>
        (await download()).getForm().getTextField("Nombre").getText(),
      )
      .toBe("Matías Pro Lite");
    await page.getByRole("button", { name: "Cerrar panel" }).click();
    // Retain coverage of the legacy layout API without a duplicate text menu.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("magicpdf:tool", { detail: "layout" })));
    await page
      .getByLabel("Contenido", { exact: true })
      .fill("Precise layout with automatic wrapping and alignment.");
    await page.getByLabel("Alineación", { exact: true }).selectOption("center");
    const layout = page.waitForResponse((r) => r.url().endsWith("/api/layout"));
    await page.getByRole("button", { name: "Insertar cuadro", exact: true }).click();
    expect((await layout).ok()).toBeTruthy();
    const lines = await (await request.get(`/api/lines/${filename}/1`)).json();
    expect(JSON.stringify(lines)).toContain("Precise layout");
    const invalid = await request.post("/api/layout", {
      data: {
        filename,
        page: 1,
        text: "Too much text",
        x: 20,
        y: 20,
        width: 10,
        height: 10,
        size: 40,
        font: "sans",
        align: "left",
        color: "#222226",
      },
    });
    expect(invalid.status()).toBe(400);
    await expect(page.locator(".reader-loading")).toHaveCount(0);
    await expect(page.locator(".reader .textLayer").first()).toContainText(
      "Precise layout",
    );
    await page.screenshot({ path: "work/pro-lite-verified.png" });
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await expect
      .poll(async () => {
        const h = await (await request.get("/api/info/__health")).json();
        return h.renders.active + h.renders.queued;
      })
      .toBe(0);
    await clean(filename);
  }
});

test("offline OCR turns a scanned page into searchable PDF and can be undone", async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  let filename = "";
  try {
    await page.goto("/");
    const png = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 1190;
      c.height = 1684;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = "black";
      ctx.font = "48px Arial";
      ctx.fillText("MAGICPDF OCR TEST", 100, 180);
      ctx.font = "32px Arial";
      ctx.fillText("Documento escaneado en espanol.", 100, 260);
      return c.toDataURL("image/png").split(",")[1];
    });
    const pdf = await PDFDocument.create(),
      image = await pdf.embedPng(Buffer.from(png, "base64"));
    pdf
      .addPage([595, 842])
      .drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
    const uploaded = page.waitForResponse((r) =>
      r.url().endsWith("/api/upload"),
    );
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "pro-scan-test.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(await pdf.save()),
      });
    filename = (await (await uploaded).json()).documents[0].filename;
    await page.getByLabel("Herramientas").click();
    await page.getByRole("button", { name: "OCR local" }).click();
    await page.getByLabel("Idioma", { exact: true }).selectOption("eng");
    const ocr = page.waitForResponse((r) => r.url().endsWith("/api/ocr"), {
      timeout: 75000,
    });
    await page.getByRole("button", { name: "Reconocer páginas" }).click();
    const response = await ocr;
    const data = await response.json();
    expect(data.error || response.status()).toBe(200);
    expect(data.results[0].text).toContain("MAGICPDF OCR TEST");
    await expect(page.locator(".reader .textLayer").first()).toContainText(
      "MAGICPDF",
    );
    const lines = await (await request.get(`/api/lines/${filename}/1`)).json();
    expect(JSON.stringify(lines)).toContain("MAGICPDF");
    await page.getByLabel("Herramientas").click();
    await expect(
      page.getByRole("button", { name: "Deshacer", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Deshacer", exact: true }).click();
    await expect
      .poll(async () => {
        const result = await (
          await request.get(`/api/lines/${filename}/1`)
        ).json();
        return result.lines.length;
      })
      .toBe(0);
    const images = await (
      await request.get(`/api/images/${filename}/1`)
    ).json();
    const moved = await request.post("/api/image-edit", {
      data: {
        filename,
        page: 1,
        image: images.images[0].image,
        action: "move",
        rect: [20, 20, 300, 420],
      },
    });
    expect(moved.ok(), await moved.text()).toBeTruthy();
    const movedImages = await (
      await request.get(`/api/images/${filename}/1`)
    ).json();
    expect(movedImages.images[0].box.map(Math.round)).toEqual([
      20, 20, 300, 420,
    ]);
  } finally {
    await page.close();
    await expect
      .poll(async () => {
        const h = await (await request.get("/api/info/__health")).json();
        return h.renders.active + h.renders.queued;
      })
      .toBe(0);
    await clean(filename);
  }
});
