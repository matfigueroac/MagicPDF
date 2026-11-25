import { test, expect } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import fs from "node:fs/promises";
import path from "node:path";

test("left panels, dedicated document menus and linked day/night paper", async ({ page, request }) => {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([595, 842]).drawText("Menus y papel sincronizados", { x: 60, y: 740, size: 20, font });
  let filename = "";
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  try {
    await page.addInitScript(() => {
      localStorage.setItem("magicpdf_theme", "light");
      localStorage.setItem("magicpdf.reading", "sepia");
    });
    await page.goto("/");
    const upload = page.waitForResponse(r => r.url().endsWith("/api/upload"));
    await page.locator("input[type=file]").first().setInputFiles({ name: "toolbar-theme-test.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
    filename = (await (await upload).json()).documents[0].filename;
    await expect(page.locator(".reader .textLayer").first()).toContainText("Menus y papel");
    expect(await page.locator(".workspace-bar").evaluate(el => el.scrollWidth <= el.clientWidth)).toBeTruthy();
    const canvas = await page.locator(".reader canvas").first().elementHandle();
    const pages = page.getByRole("button", { name: "Mostrar páginas", exact: true });
    const layers = page.getByRole("button", { name: "Capas", exact: true });
    const homeBox = await page.getByLabel("Inicio", { exact: true }).boundingBox();
    const pagesBox = await pages.boundingBox(), layersBox = await layers.boundingBox();
    const undoBox = await page.getByRole("button", { name: "Deshacer", exact: true }).boundingBox();
    expect(pagesBox!.x).toBeGreaterThan(homeBox!.x);
    expect(pagesBox!.x - (homeBox!.x + homeBox!.width)).toBeLessThan(20);
    expect(layersBox!.x).toBeGreaterThan(pagesBox!.x);
    expect(layersBox!.x).toBeLessThan(undoBox!.x);
    await pages.click();
    await expect(page.getByLabel("Páginas del documento")).toBeVisible();
    await pages.click();
    await expect(page.getByLabel("Páginas del documento")).toHaveCount(0);
    await layers.click();
    await expect(page.getByLabel("Panel de capas", { exact: true })).toBeVisible();
    await layers.click();
    await expect(page.getByLabel("Panel de capas", { exact: true })).toHaveCount(0);

    const paper = page.getByLabel("Color de lectura"), scroll = page.locator(".reader-scroll");
    const toggle = page.getByRole("button", { name: "Cambiar tema", exact: true });
    await expect(paper).toHaveValue("sepia");
    await toggle.click();
    await expect(paper).toHaveValue("night");
    await expect(scroll).toHaveClass(/reading-night/);
    await expect.poll(() => page.locator(".reader .page").first().evaluate(el => getComputedStyle(el).filter)).toContain("invert");
    await page.screenshot({ path: "work/toolbar-night-verified.png" });
    await toggle.click();
    await expect(paper).toHaveValue("sepia");
    await expect(scroll).toHaveClass(/reading-sepia/);
    await paper.selectOption("normal");
    await toggle.click();
    await expect(paper).toHaveValue("night");
    await toggle.click();
    await expect(paper).toHaveValue("normal");
    await expect(scroll).toHaveClass(/reading-normal/);
    await paper.selectOption("night");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await paper.selectOption("sepia");
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    expect(await canvas!.evaluate(el => el === document.querySelector(".reader canvas"))).toBeTruthy();

    const organize = page.getByLabel("Organizar", { exact: true });
    const tools = page.getByLabel("Herramientas", { exact: true });
    expect((await organize.boundingBox())!.x).toBeGreaterThan((await page.getByLabel("Editar PDF", { exact: true }).boundingBox())!.x);
    await tools.click();
    await expect(page.getByRole("button", { name: "OCR local", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Formulario", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cuadro de texto", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Insertar cuadro de texto", exact: true })).toHaveCount(1);
    await organize.click();
    await expect(tools.locator("..")).not.toHaveAttribute("open", "");
    await page.getByRole("button", { name: "Unir PDF", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Unir Múltiples PDFs en Uno Solo" })).toBeVisible();
    await organize.click();
    await page.locator(".workspace-bar").getByRole("button", { name: "Dividir PDF", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Dividir PDF en Partes" })).toBeVisible();
    await organize.click();
    await page.getByRole("button", { name: "Organizar páginas", exact: true }).click();
    await expect(page.getByRole("button", { name: "Rotar Todo 90°" })).toBeVisible();
    await page.getByRole("button", { name: "Volver a lectura", exact: true }).click();
    await expect(paper).toHaveValue("sepia");
    await expect(page.locator(".reader .textLayer").first()).toContainText("Menus y papel");
    await expect(page.locator(".reader-loading")).toHaveCount(0);
    await page.screenshot({ path: "work/toolbar-day-verified.png" });
    for (const width of [1440, 1280, 1100, 960]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.locator(".workspace-bar").evaluate(el => el.scrollWidth <= el.clientWidth), `Toolbar fits ${width}px`).toBeTruthy();
    }
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await expect.poll(async () => {
      const health = await (await request.get("/api/info/__health")).json();
      return health.renders.active + health.renders.queued;
    }).toBe(0);
    if (filename) {
      await fs.rm(path.join("storage/uploads", filename), { force: true });
      for (const name of await fs.readdir("storage/temp"))
        if (name.startsWith(`render_${path.basename(filename, ".pdf")}_`)) await fs.rm(path.join("storage/temp", name), { force: true });
    }
  }
});
