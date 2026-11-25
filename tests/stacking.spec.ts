import { test, expect } from "@playwright/test";
import { setReaderZoom100 } from "./reader-zoom";
import {
  PDFDocument,
  StandardFonts,
  PDFName,
  PDFArray,
  PDFDict,
  PDFString,
} from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";
import fs from "node:fs/promises";
import path from "node:path";

test("persistent annotation depth: four commands, groups, mixed selection, native appearance, stable edits/locks and undo without reload", async ({
  page,
  request,
}) => {
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica),
    p = pdf.addPage([595, 842]);
  p.drawText("Orden de capas", { x: 50, y: 790, size: 20, font });
  p.node.set(
    PDFName.of("Annots"),
    pdf.context.obj([
      pdf.context.register(
        pdf.context.obj({
          Type: "Annot",
          Subtype: "Text",
          Rect: [500, 750, 520, 770],
          F: 4,
          NM: PDFString.of("external-note"),
          Contents: PDFString.of("Keep this note"),
        }),
      ),
    ]),
  );
  const ids = [
    "magicpdf-stack-red",
    "magicpdf-stack-blue",
    "magicpdf-stack-group-circle",
    "magicpdf-stack-group-text",
    "magicpdf-stack-locked",
  ];
  const files: string[] = [],
    errors: string[] = [];
  let filename = "",
    loads = 0;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("/api/reader-file/")) loads++;
  });
  const editable = (rows: any[]) =>
    rows.filter((a) => !["highlight", "underline"].includes(a.kind));
  const scene = async () =>
    (await (await request.get(`/api/scene/${filename}`)).json()).annotations;
  const order = async () => editable(await scene()).map((a) => a.id);
  const selectId = async (id: string) => {
    await page.locator(`g[data-annotation-id="${id}"]`).focus();
    await page.keyboard.press("Enter");
  };
  const action = async (name: string, expected: string[]) => {
    const details = page.locator('.annotation-order');
    if (!await details.evaluate(el => (el as HTMLDetailsElement).open))
      await details.locator('summary').click();
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/annotation-order") &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name, exact: true }).click();
    const res = await saved;
    expect(res.ok(), await res.text()).toBeTruthy();
    const data = await res.json();
    await expect(page.getByRole("button", { name, exact: true })).toBeEnabled();
    expect(editable(data.annotations).map((a) => a.id)).toEqual(expected);
    expect(await order()).toEqual(expected);
    const dom = await page
      .locator("g[data-annotation-id]")
      .evaluateAll((nodes) =>
        nodes
          .filter(
            (n) =>
              !["highlight", "underline"].includes(
                n.getAttribute("data-kind")!,
              ),
          )
          .map((n) => n.getAttribute("data-annotation-id")),
      );
    expect(dom).toEqual(expected);
    return data;
  };
  const upload = async (bytes: Buffer, name: string) => {
    const saved = page.waitForResponse((r) => r.url().endsWith("/api/upload"));
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({ name, mimeType: "application/pdf", buffer: bytes });
    filename = (await (await saved).json()).documents[0].filename;
    files.push(filename);
  };
  const savedBytes = async () =>
    (await request.get(`/api/download/${filename}`)).body();
  const nativePixel = async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(await savedBytes()),
      isEvalSupported: false,
      useSystemFonts: false,
      standardFontDataUrl:
        path.resolve("node_modules/pdfjs-dist/standard_fonts") + "/",
    }).promise;
    const p = await doc.getPage(1),
      viewport = p.getViewport({ scale: 1 }),
      image = createCanvas(viewport.width, viewport.height),
      ctx = image.getContext("2d");
    await p.render({ canvasContext: ctx as any, viewport }).promise;
    const pixel = [...ctx.getImageData(250, 842 - 620, 1, 1).data];
    await doc.destroy();
    return pixel;
  };
  try {
    await page.goto("/");
    await upload(Buffer.from(await pdf.save()), "stacking-automated-test.pdf");
    await expect(page.locator(".reader .textLayer").first()).toContainText(
      "Orden de capas",
    );
    const base = {
      page: 1,
      color: "#ef4444",
      width: 6,
      lineStyle: "solid",
      text: "",
      fontSize: 14,
      fontFamily: "sans",
      border: false,
      borderColor: "#dc2626",
    };
    const rows = [
      {
        ...base,
        id: ids[0],
        kind: "rectangle",
        points: [
          [70, 700],
          [250, 580],
        ],
      },
      {
        ...base,
        id: ids[1],
        kind: "rectangle",
        color: "#2563eb",
        points: [
          [160, 740],
          [340, 620],
        ],
      },
      {
        ...base,
        id: ids[2],
        kind: "ellipse",
        color: "#16a34a",
        points: [
          [380, 700],
          [450, 650],
        ],
        groupId: "magicpdf-group-stack-test",
      },
      {
        ...base,
        id: ids[3],
        kind: "text",
        text: "Grupo",
        color: "#16a34a",
        points: [
          [380, 620],
          [500, 560],
        ],
        groupId: "magicpdf-group-stack-test",
      },
      {
        ...base,
        id: ids[4],
        kind: "ellipse",
        color: "#ea580c",
        points: [
          [80, 500],
          [140, 440],
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
    expect(
      (
        await request.post("/api/highlight", {
          data: {
            filename,
            page: 1,
            rects: [[50, 780, 270, 810]],
            color: "#fde047",
            text: "Orden de capas",
          },
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
    await expect(page.locator("g[data-kind=rectangle]")).toHaveCount(2);
    await setReaderZoom100(page, 595);
    const [A, B, C, D, E] = ids,
      canvas = await page.locator(".reader canvas").first().elementHandle(),
      baseline = loads;
    const below = await nativePixel();
    expect(below[2]).toBeGreaterThan(below[0]);
    await selectId(A);
    await action("Traer al frente", [B, C, D, E, A]);
    const above = await nativePixel();
    expect(above[0]).toBeGreaterThan(above[2]);
    await action("Atrasar", [B, C, D, A, E]);
    await action("Atrasar", [B, A, C, D, E]);
    await action("Adelantar", [B, C, D, A, E]);
    await action("Enviar al fondo", [A, B, C, D, E]);
    const beforeNoop = await savedBytes(),
      historyBefore = (
        await (await request.get(`/api/history/${filename}`)).json()
      ).undo;
    expect((await action("Enviar al fondo", [A, B, C, D, E])).changed).toBe(
      false,
    );
    expect(await savedBytes()).toEqual(beforeNoop);
    expect(
      (await (await request.get(`/api/history/${filename}`)).json()).undo,
    ).toBe(historyBefore);
    await page
      .getByLabel("Color de anotación", { exact: true })
      .fill("#a855f7");
    const edited = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/drawing") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Aplicar anotación", exact: true })
      .click();
    expect((await edited).ok()).toBeTruthy();
    expect(await order()).toEqual(ids);
    await selectId(A);
    const locked = page.waitForResponse((r) =>
      r.url().endsWith("/api/annotation-lock"),
    {timeout: 10000});
    await page
      .getByRole("button", { name: "Bloquear elemento", exact: true })
      .click();
    expect((await locked).ok()).toBeTruthy();
    expect(await order()).toEqual(ids);
    if (!await page.locator('.annotation-order').evaluate(el => (el as HTMLDetailsElement).open))
      await page.locator('.annotation-order summary').click();
    await expect(
      page.getByRole("button", { name: "Traer al frente", exact: true }),
    ).toBeDisabled();
    const lockedBytes = await savedBytes();
    expect(
      (
        await request.post("/api/annotation-order", {
          data: { filename, ids: [A], action: "front" },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await request.post("/api/annotation-order", {
          data: { filename, ids: [B, E], action: "back" },
        })
      ).status(),
    ).toBe(400);
    expect(await savedBytes()).toEqual(lockedBytes);
    const unlocked = page.waitForResponse((r) =>
      r.url().endsWith("/api/annotation-lock"),
    );
    await page
      .getByRole("button", { name: "Desbloquear elemento", exact: true })
      .click();
    expect((await unlocked).ok()).toBeTruthy();
    expect(await order()).toEqual(ids);
    const back = await nativePixel();
    expect(back[2]).toBeGreaterThan(back[0]);
    await selectId(C);
    await action("Traer al frente", [A, B, E, C, D]);
    const partial = await request.post("/api/annotation-order", {
      data: { filename, ids: [C], action: "front" },
    });
    expect((await partial.json()).changed).toBe(false);
    const box = await page
      .locator(`g[data-annotation-id="${A}"] .annotation-hit-target rect`)
      .boundingBox();
    await page.keyboard.down("Control");
    await page.mouse.click(box!.x + 6, box!.y + box!.height / 2);
    await page.keyboard.up("Control");
    await expect(page.locator("g[data-selected=true]")).toHaveCount(3);
    await action("Enviar al fondo", [A, C, D, B, E]);
    await action("Adelantar", [B, A, C, D, E]);
    await action("Traer al frente", [B, E, A, C, D]);
    await action("Atrasar", [B, A, C, D, E]);
    const current = await scene();
    for (const old of rows) {
      const a = current.find((a: any) => a.id === old.id);
      expect(a.points).toEqual(old.points);
      expect(a.groupId).toBe(old.groupId);
      expect(!!a.locked).toBe(!!old.locked);
    }
    expect(loads).toBe(baseline);
    expect(
      await canvas!.evaluate(
        (el) => el === document.querySelector(".reader canvas"),
      ),
    ).toBeTruthy();
    await page.screenshot({ path: "work/stacking-verified.png" });
    const native = await PDFDocument.load(await savedBytes()),
      annots = native.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
    expect(annots.size()).toBe(7);
    expect(
      native.context
        .lookup(annots.get(0), PDFDict)
        .lookup(PDFName.of("NM"), PDFString)
        .decodeText(),
    ).toBe("external-note");
    await page.getByLabel("Herramientas", { exact: true }).click();
    await page.getByRole("button", { name: "Deshacer", exact: true }).click();
    await expect.poll(order).toEqual([B, E, A, C, D]);
    await expect.poll(() => loads).toBe(baseline + 1);
    await expect(page.locator(".reader-loading")).toHaveCount(0);
    await page.getByLabel("Herramientas", { exact: true }).click();
    await page.getByRole("button", { name: "Rehacer", exact: true }).click();
    await expect.poll(order).toEqual([B, A, C, D, E]);
    const downloaded = await savedBytes();
    await page.getByLabel("Inicio", { exact: true }).click();
    await page
      .getByRole("button", { name: "Ir al inicio", exact: true })
      .click();
    await upload(downloaded, "stacking-roundtrip-test.pdf");
    await expect(page.locator("g[data-annotation-id]")).toHaveCount(6);
    expect(await order()).toEqual([B, A, C, D, E]);
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
