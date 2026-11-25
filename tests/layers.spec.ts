import { test, expect } from "@playwright/test";
import {
  PDFDocument,
  StandardFonts,
  PDFName,
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFNumber,
} from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";
import fs from "node:fs/promises";
import path from "node:path";

test("layers panel selects, renames and controls inherited visibility, persists names/hidden PDF flags, and preserves the canvas", async ({
  page,
  request,
}) => {
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf
    .addPage([595, 842])
    .drawText("Panel de capas", { x: 50, y: 790, size: 20, font });
  const files: string[] = [],
    errors: string[] = [];
  let filename = "",
    loads = 0;
  page.on("pageerror", (e) => errors.push(e.stack || e.message));
  page.on("request", (r) => {
    if (r.url().includes("/api/reader-file/")) loads++;
  });
  const scene = async () =>
    (await (await request.get(`/api/scene/${filename}`)).json()).annotations;
  const panel = page.getByLabel("Panel de capas", { exact: true });
  const row = (id: string) => panel.locator(`[data-layer-id="${id}"]`);
  const itemName = (id: string) => row(id).locator(".layer-select");
  const upload = async (buffer: Buffer, name: string) => {
    const saved = page.waitForResponse((r) => r.url().endsWith("/api/upload"));
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({ name, mimeType: "application/pdf", buffer });
    filename = (await (await saved).json()).documents[0].filename;
    files.push(filename);
  };
  const layerAction = async (run: () => Promise<unknown>) => {
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/annotation-layer") &&
        r.request().method() === "POST",
    );
    await run();
    const res = await saved;
    expect(res.ok(), await res.text()).toBeTruthy();
    return (await res.json()).annotations;
  };
  const rename = async (id: string, name: string) => {
    await row(id)
      .getByRole("button", { name: /^Renombrar / })
      .click();
    const input = panel.getByLabel("Nombre de la capa", { exact: true });
    await input.fill(name);
    await layerAction(() => input.press("Enter"));
    await expect(input).toHaveCount(0);
  };
  const visibility = async (id: string) =>
    layerAction(() => row(id).locator(".layer-visibility").click());
  const pixel = async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"),
      bytes = await (await request.get(`/api/download/${filename}`)).body();
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: false,
      standardFontDataUrl:
        path.resolve("node_modules/pdfjs-dist/standard_fonts") + "/",
    }).promise;
    const p = await doc.getPage(1),
      viewport = p.getViewport({ scale: 1 }),
      canvas = createCanvas(viewport.width, viewport.height),
      ctx = canvas.getContext("2d");
    await p.render({ canvasContext: ctx as any, viewport }).promise;
    const result = [...ctx.getImageData(70, 842 - 490, 1, 1).data];
    await doc.destroy();
    return result;
  };
  try {
    await page.goto("/");
    await upload(Buffer.from(await pdf.save()), "layers-automated-test.pdf");
    await expect(page.locator(".reader .textLayer").first()).toContainText(
      "Panel de capas",
    );
    const base = {
      page: 1,
      color: "#2563eb",
      width: 3,
      lineStyle: "solid",
      text: "",
      fontSize: 14,
      fontFamily: "sans",
      border: false,
      borderColor: "#dc2626",
    };
    const [A, B, C, D, G] = [
      "magicpdf-layer-text",
      "magicpdf-layer-rect",
      "magicpdf-layer-circle",
      "magicpdf-layer-locked",
      "magicpdf-group-layer-test",
    ];
    const rows = [
      {
        ...base,
        id: A,
        kind: "text",
        text: "Texto del grupo",
        points: [
          [70, 700],
          [250, 640],
        ],
        groupId: G,
      },
      {
        ...base,
        id: B,
        kind: "rectangle",
        points: [
          [300, 700],
          [430, 640],
        ],
        groupId: G,
      },
      {
        ...base,
        id: C,
        kind: "ellipse",
        points: [
          [70, 520],
          [140, 460],
        ],
      },
      {
        ...base,
        id: D,
        kind: "rectangle",
        points: [
          [380, 520],
          [450, 460],
        ],
        locked: true,
      },
    ];
    expect(
      (
        await request.post("/api/drawing-batch", {
          data: { filename, annotations: rows },
        })
      ).ok(),
    ).toBeTruthy();
    await page.getByLabel("Inicio", { exact: true }).click();
    await page
      .getByRole("button", { name: "Ir al inicio", exact: true })
      .click();
    await page
      .getByRole("tab", { selected: true })
      .click();
    await expect(page.locator("g[data-kind=ellipse]")).toHaveCount(1);
    await page.getByLabel("Zoom", { exact: true }).selectOption("1");
    // Wait for PDF.js to finish the zoom render before retaining its canvas.
    await expect.poll(() => page.locator('.reader canvas').first().evaluate((el: HTMLCanvasElement) =>
      Math.abs(el.getBoundingClientRect().width - 595 * 4 / 3) < 2 && !el.closest('.page')?.querySelector('.loadingIcon')
    )).toBeTruthy();
    const canvas = await page.locator(".reader canvas").first().elementHandle(),
      baseline = loads;
    await page.getByRole("button", { name: "Capas", exact: true }).click();
    await expect(panel).toBeVisible();
    expect(
      await panel
        .locator(".layers-page > .layer-node > .layer-row")
        .evaluateAll((nodes) =>
          nodes.map((n) => n.getAttribute("data-layer-id")),
        ),
    ).toEqual([D, C, G]);
    await itemName(C).click();
    await expect(page.locator(`g[data-annotation-id="${C}"]`)).toHaveAttribute(
      "data-selected",
      "true",
    );
    await rename(C, "Sello de revisión");
    await expect(itemName(C)).toHaveText("Sello de revisión");
    expect((await scene()).find((a: any) => a.id === C).name).toBe(
      "Sello de revisión",
    );
    const visible = await pixel();
    expect(visible[2]).toBeGreaterThan(visible[0]);
    await visibility(C);
    await expect(page.locator(`g[data-annotation-id="${C}"]`)).toHaveCount(0);
    await expect(row(C)).toHaveAttribute("data-layer-hidden", "true");
    await itemName(C).click();
    await expect(row(C)).toHaveAttribute("data-layer-selected", "true");
    expect((await pixel()).slice(0, 3)).toEqual([255, 255, 255]);
    await rename(G, "Firma y marco");
    await expect(itemName(G)).toHaveText("Firma y marco");
    await row(G)
      .getByRole("button", {
        name: "Expandir grupo Firma y marco",
        exact: true,
      })
      .click();
    expect(
      await panel
        .locator(".layer-child .layer-row")
        .evaluateAll((nodes) =>
          nodes.map((n) => n.getAttribute("data-layer-id")),
        ),
    ).toEqual([B, A]);
    await rename(B, "Marco de firma");
    await visibility(B);
    await expect(page.locator(`g[data-annotation-id="${B}"]`)).toHaveCount(0);
    await itemName(B).click();
    await expect(row(G)).toHaveAttribute("data-layer-selected", "true");
    await visibility(G);
    await expect(page.locator(`g[data-group-id="${G}"]`)).toHaveCount(0);
    await visibility(G);
    await expect(page.locator(`g[data-annotation-id="${A}"]`)).toHaveCount(1);
    await expect(page.locator(`g[data-annotation-id="${B}"]`)).toHaveCount(0);
    await visibility(B);
    await expect(page.locator(`g[data-group-id="${G}"]`)).toHaveCount(2);
    await expect(
      row(D).getByRole("button", { name: /^Renombrar / }),
    ).toBeDisabled();
    const beforeLocked = await (
      await request.get(`/api/download/${filename}`)
    ).body();
    expect(
      (
        await request.post("/api/annotation-layer", {
          data: {
            filename,
            scope: "item",
            id: D,
            patch: { name: "No permitido" },
          },
        })
      ).status(),
    ).toBe(400);
    expect(
      await (await request.get(`/api/download/${filename}`)).body(),
    ).toEqual(beforeLocked);
    await visibility(D);
    await expect(page.locator(`g[data-annotation-id="${D}"]`)).toHaveCount(0);
    await visibility(D);
    await expect(page.locator(`g[data-annotation-id="${D}"]`)).toHaveAttribute(
      "data-locked",
      "true",
    );
    await itemName(C).click();
    await page.keyboard.press("Control+c");
    const duplicated = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/drawing") && r.request().method() === "POST",
    );
    await page.keyboard.press("Control+d");
    const copy = (await (await duplicated).json()).annotation;
    expect(copy.hidden).toBe(true);
    expect(copy.name).toBe("Sello de revisión");
    await expect(row(copy.id)).toBeVisible();
    await rename(copy.id, "Sello copia");
    expect((await scene()).find((a: any) => a.id === C).name).toBe(
      "Sello de revisión",
    );
    expect(loads).toBe(baseline);
    expect(
      await canvas!.evaluate(
        (el) => el === document.querySelector(".reader canvas"),
      ),
    ).toBeTruthy();
    await visibility(G);
    await page.getByLabel("Herramientas", { exact: true }).click();
    const undone = page.waitForResponse(r => r.url().endsWith('/api/history/undo') && r.request().method() === 'POST');
    await page.getByRole("button", { name: "Deshacer", exact: true }).click();
    expect((await undone).ok()).toBeTruthy();
    await expect
      .poll(
        async () => !!(await scene()).find((a: any) => a.id === A).groupHidden,
      )
      .toBe(false);
    await expect.poll(() => loads).toBe(baseline + 1);
    await expect(page.locator(".reader-loading")).toHaveCount(0);
    await page.getByLabel("Herramientas", { exact: true }).click();
    await page.getByRole("button", { name: "Rehacer", exact: true }).click();
    await expect
      .poll(
        async () => !!(await scene()).find((a: any) => a.id === A).groupHidden,
      )
      .toBe(true);
    const downloaded = await (
        await request.get(`/api/download/${filename}`)
      ).body(),
      native = await PDFDocument.load(downloaded);
    let hiddenCount = 0;
    for (const ref of native
      .getPage(0)
      .node.lookup(PDFName.of("Annots"), PDFArray)
      .asArray()) {
      const a = native.context.lookup(ref, PDFDict),
        data = JSON.parse(
          a.lookup(PDFName.of("MagicPDFData"), PDFHexString).decodeText(),
        ),
        flags = a.lookup(PDFName.of("F"), PDFNumber).asNumber();
      if (data.hidden || (data.groupId && data.groupHidden)) {
        hiddenCount++;
        expect(flags & 2).toBe(2);
      } else expect(flags & 2).toBe(0);
    }
    expect(hiddenCount).toBe(4);
    await page.getByLabel("Inicio", { exact: true }).click();
    await page
      .getByRole("button", { name: "Ir al inicio", exact: true })
      .click();
    await upload(downloaded, "layers-roundtrip-test.pdf");
    await expect(page.locator("g[data-annotation-id]")).toHaveCount(1);
    await page.getByRole("button", { name: "Capas", exact: true }).click();
    await expect(itemName(G)).toHaveText("Firma y marco");
    await expect(itemName(C)).toHaveText("Sello de revisión");
    await expect(itemName(copy.id)).toHaveText("Sello copia");
    await itemName(G).click();
    await visibility(G);
    await expect(page.locator(`g[data-group-id="${G}"]`)).toHaveCount(2);
    await expect(page.locator(`g[data-annotation-id="${C}"]`)).toHaveCount(0);
    const themeCanvas=await page.locator('.reader canvas').first().elementHandle(),themeLoads=loads;
    if(await page.evaluate(()=>document.documentElement.classList.contains('dark')))await page.getByRole('button',{name:'Cambiar tema',exact:true}).click();
    await expect(panel).toHaveCSS('background-color','rgb(255, 255, 255)');
    await page.screenshot({path:'work/layers-light-verified.png'});
    await page.getByRole('button',{name:'Cambiar tema',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>document.documentElement.classList.contains('dark'))).toBe(true);
    await expect(panel).not.toHaveCSS('background-color','rgb(255, 255, 255)');
    expect(loads).toBe(themeLoads);expect(await themeCanvas!.evaluate(el=>el===document.querySelector('.reader canvas'))).toBeTruthy();
    await page.screenshot({ path: "work/layers-verified.png" });
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await expect
      .poll(async () => {
        const h = await (await request.get("/api/info/__health")).json();
        return h.renders.active + h.renders.queued;
      })
      .toBe(0);
    for (const file of files) {
      await fs.rm(path.join("storage/uploads", file), { force: true });
      for (const name of await fs.readdir("storage/temp"))
        if (name.startsWith(`render_${path.basename(file, ".pdf")}_`))
          await fs.rm(path.join("storage/temp", name), { force: true });
    }
  }
});
