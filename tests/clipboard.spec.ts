import { test, expect } from "@playwright/test";
import { PDFDocument, StandardFonts, PDFName, PDFArray } from "pdf-lib";
import fs from "node:fs/promises";
import path from "node:path";

test("annotation clipboard: real shortcuts, styles, independent copies, normal text and paste on another page", async ({
  page,
  request,
}) => {
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++)
    pdf
      .addPage([595, 842])
      .drawText(`Portapapeles ${i + 1}`, { x: 50, y: 790, size: 20, font });
  let filename = "",
    loads = 0,
    writes = 0;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("/api/reader-file/")) loads++;
    if (r.url().endsWith("/api/drawing") && r.method() === "POST") writes++;
  });
  const scene = async () =>
    (await (await request.get(`/api/scene/${filename}`)).json()).annotations;
  const shortcut = async (key: string) => {
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/drawing") && r.request().method() === "POST",
    );
    await page.keyboard.press(key);
    const res = await response;
    expect(res.ok(), await res.text()).toBeTruthy();
    const saved = (await res.json()).annotation;
    if (key !== "Delete")
      await expect(
        page.locator(`g[data-annotation-id="${saved.id}"]`),
      ).toHaveAttribute("role", "button");
    return saved;
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
        name: "clipboard-automated-test.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(await pdf.save()),
      });
    filename = (await (await uploaded).json()).documents[0].filename;
    await expect(page.locator(".reader .textLayer").first()).toContainText(
      "Portapapeles",
    );
    const base = {
      page: 1,
      color: "#2563eb",
      width: 2,
      lineStyle: "dashed",
      text: "Texto para copiar",
      fontSize: 14,
      fontFamily: "serif",
      border: true,
      borderColor: "#dc2626",
    };
    for (const annotation of [
      {
        ...base,
        id: "magicpdf-clipboard-text",
        kind: "text",
        points: [
          [70, 650],
          [300, 570],
        ],
      },
      {
        ...base,
        id: "magicpdf-clipboard-rectangle",
        kind: "rectangle",
        text: "",
        points: [
          [70, 500],
          [240, 420],
        ],
      },
    ]) {
      const res = await request.post("/api/drawing", {
        data: { filename, annotation },
      });
      expect(res.ok()).toBeTruthy();
    }
    await page.getByLabel("Inicio", { exact: true }).click();
    await page
      .getByRole("button", { name: "Ir al inicio", exact: true })
      .click();
    await page
      .getByRole("tab", { selected: true })
      .click();
    await expect(page.locator("g[data-kind=text]")).toHaveCount(1);
    await page.locator("g[data-kind=text] text").click();
    const original = (await scene()).find((a: any) => a.kind === "text");
    const canvas = await page.locator(".reader canvas").first().elementHandle(),
      baseline = loads;
    await page.keyboard.press("Control+c");
    const duplicate = await shortcut("Control+d");
    expect(duplicate.id).not.toBe(original.id);
    expect(duplicate.points).not.toEqual(original.points);
    for (const key of [
      "kind",
      "text",
      "color",
      "width",
      "lineStyle",
      "fontSize",
      "fontFamily",
      "border",
      "borderColor",
    ])
      expect(duplicate[key]).toEqual(original[key]);
    const pasted = await shortcut("Control+v"),
      pastedAgain = await shortcut("Control+v");
    expect(
      new Set([original.id, duplicate.id, pasted.id, pastedAgain.id]).size,
    ).toBe(4);
    expect(pastedAgain.points).not.toEqual(pasted.points);
    expect(await scene()).toHaveLength(5);
    // Editing one copy leaves its siblings unchanged.
    await page
      .getByLabel("Texto de anotación", { exact: true })
      .fill("Solo cambia esta copia");
    const applied = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/drawing") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Aplicar anotación", exact: true })
      .click();
    expect((await applied).ok()).toBeTruthy();
    expect((await scene()).find((a: any) => a.id === original.id).text).toBe(
      original.text,
    );
    await page
      .locator(`g[data-annotation-id="${pastedAgain.id}"] text`)
      .click();
    const input = page.getByLabel("Texto de anotación", { exact: true });
    await input.focus();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+v");
    await expect(input).toHaveValue("Solo cambia esta copia");
    expect(await scene()).toHaveLength(5);
    await page.getByRole("button", { name: "Cerrar propiedades" }).click();
    // A normal text copy replaces the annotation clipboard; it must not paste a stale shape.
    await page.evaluate(() => {
      (window as any).__clipboardSeen = false;
      document.addEventListener(
        "paste",
        () => {
          (window as any).__clipboardSeen = true;
        },
        { once: true },
      );
    });
    const beforeNormalPaste = writes;
    await page.keyboard.press("Control+v");
    await expect
      .poll(() => page.evaluate(() => (window as any).__clipboardSeen))
      .toBe(true);
    expect(writes).toBe(beforeNormalPaste);
    const outline = await page
      .locator("g[data-kind=rectangle] .annotation-hit-target rect")
      .boundingBox();
    await page.mouse.click(outline!.x + 6, outline!.y + outline!.height / 2);
    await page.keyboard.press("Control+c");
    await page.getByLabel("Número de página", { exact: true }).fill("2");
    await page.getByLabel("Número de página", { exact: true }).press("Enter");
    await page
      .locator('.reader .page[data-page-number="2"]')
      .click({ position: { x: 20, y: 20 } });
    const shape = await shortcut("Control+v");
    expect(shape.page).toBe(2);
    expect(shape.kind).toBe("rectangle");
    expect(shape.color).toBe(base.color);
    await shortcut("Delete");
    expect(await scene()).toHaveLength(5);
    expect(loads).toBe(baseline);
    expect(
      await canvas!.evaluate(
        (el) => el === document.querySelector(".reader canvas"),
      ),
    ).toBeTruthy();
    const savedPdf = await PDFDocument.load(
      await (await request.get(`/api/download/${filename}`)).body(),
    );
    expect(
      savedPdf.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray).size(),
    ).toBe(5);
    await page.screenshot({ path: "work/clipboard-verified.png" });
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


