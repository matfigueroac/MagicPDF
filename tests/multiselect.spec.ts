import { test, expect } from "@playwright/test";
import { setReaderZoom100 } from "./reader-zoom";
import { PDFDocument, StandardFonts, PDFName, PDFArray } from "pdf-lib";
import fs from "node:fs/promises";
import path from "node:path";

test("multi selection: Ctrl+click toggle, marquee, atomic move/copy/duplicate/delete and undo without reload", async ({
  page,
  request,
}) => {
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf
    .addPage([595, 842])
    .drawText("Seleccionar varios", { x: 50, y: 790, size: 20, font });
  let filename = "",
    loads = 0;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("/api/reader-file/")) loads++;
  });
  const scene = async () =>
    (await (await request.get(`/api/scene/${filename}`)).json()).annotations;
  const selected = page.locator("g[data-selected=true]");
  const batch = async (action: () => Promise<unknown>) => {
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/drawing-batch") &&
        r.request().method() === "POST",
    );
    await action();
    const res = await saved;
    expect(res.ok(), await res.text()).toBeTruthy();
    if (res.request().postDataJSON().remove)
      await expect(selected).toHaveCount(0);
    else
      await expect(
        page.getByRole("button", {
          name: "Duplicar selección · Ctrl+D",
          exact: true,
        }),
      ).toBeEnabled();
    return (await res.json()).annotations;
  };
  const ctrlRect = async () => {
    const box = await page
      .locator(
        'g[data-annotation-id="magicpdf-group-rectangle"] .annotation-hit-target rect',
      )
      .boundingBox();
    await page.keyboard.down("Control");
    await page.mouse.click(box!.x + 6, box!.y + box!.height / 2);
    await page.keyboard.up("Control");
  };
  const marquee = async (
    x: number, y: number, w: number, h: number, beforeRelease?: () => Promise<void>,
  ) => {
    const box = await page.locator(".annotation-overlay").first().boundingBox(),
      scale = box!.width / 595;
    await page.mouse.move(box!.x + x * scale, box!.y + y * scale);
    await page.mouse.down();
    await page.mouse.move(box!.x + (x + w) * scale, box!.y + (y + h) * scale, {
      steps: 12,
    });
    try {
      await beforeRelease?.();
    } finally {
      await page.mouse.up();
    }
  };
  try {
    await page.goto("/");
    const upload = page.waitForResponse((r) => r.url().endsWith("/api/upload"));
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "multi-automated-test.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(await pdf.save()),
      });
    filename = (await (await upload).json()).documents[0].filename;
    await expect(page.locator(".reader .textLayer").first()).toContainText(
      "Seleccionar varios",
    );
    const base = {
      page: 1,
      color: "#2563eb",
      width: 2,
      lineStyle: "dashed",
      text: "",
      fontSize: 14,
      fontFamily: "sans",
      border: false,
      borderColor: "#dc2626",
    };
    const rows = [
      {
        ...base,
        id: "magicpdf-group-text",
        kind: "text",
        text: "Grupo editable",
        points: [
          [70, 700],
          [250, 640],
        ],
      },
      {
        ...base,
        id: "magicpdf-group-rectangle",
        kind: "rectangle",
        points: [
          [300, 700],
          [430, 640],
        ],
      },
      {
        ...base,
        id: "magicpdf-group-ellipse",
        kind: "ellipse",
        points: [
          [70, 560],
          [140, 500],
        ],
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
    await expect(page.locator("g[data-kind=text]")).toHaveCount(1);
    await setReaderZoom100(page, 595);
    const rectangle = page.locator('g[data-annotation-id="magicpdf-group-rectangle"]');
    for (const key of ["Enter", "Space"]) {
      await rectangle.press(key);
      await expect(selected).toHaveCount(1);
      await expect(selected).toHaveAttribute("data-annotation-id", "magicpdf-group-rectangle");
      await page.keyboard.press("Escape");
      await expect(selected).toHaveCount(0);
    }
    await rectangle.press("Enter");
    await page.keyboard.down("Control");
    try {
      await marquee(50, 120, 215, 100);
    } finally {
      await page.keyboard.up("Control");
    }
    await expect(selected).toHaveCount(2);
    await page.keyboard.press("Escape");
    await page.locator("g[data-kind=text] text").click();
    await ctrlRect();
    await expect(selected).toHaveCount(2);
    await ctrlRect();
    await expect(selected).toHaveCount(1);
    await ctrlRect();
    await expect(selected).toHaveCount(2);
    const canvas = await page.locator(".reader canvas").first().elementHandle(),
      baseline = loads;
    const historyBefore = await (
      await request.get(`/api/history/${filename}`)
    ).json();
    const box = await page
      .locator("g[data-kind=text] .annotation-selection > rect:first-child")
      .boundingBox();
    const moved = await batch(async () => {
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        box!.x + box!.width / 2 + 40,
        box!.y + box!.height / 2 + 24,
        { steps: 12 },
      );
      await page.mouse.up();
    });
    expect(moved).toHaveLength(2);
    for (const a of moved) {
      const before = rows.find((row) => row.id === a.id)!;
      expect(a.points[0][0] - before.points[0][0]).toBeCloseTo(30, 0);
      expect(a.points[0][1] - before.points[0][1]).toBeCloseTo(-18, 0);
    }
    expect(
      (await (await request.get(`/api/history/${filename}`)).json()).undo,
    ).toBe(historyBefore.undo + 1);
    const originalBytes = await (
      await request.get(`/api/download/${filename}`)
    ).body();
    const invalid = await request.post("/api/drawing-batch", {
      data: {
        filename,
        annotations: [
          {
            ...moved[0],
            points: [
              [80, 700],
              [260, 640],
            ],
          },
          {
            ...moved[1],
            kind: "text",
            text: "No cabe",
            points: [
              [1, 1],
              [5, 5],
            ],
            fontSize: 96,
          },
        ],
      },
    });
    expect(invalid.status()).toBe(400);
    expect(
      await (await request.get(`/api/download/${filename}`)).body(),
    ).toEqual(originalBytes);
    await page.keyboard.press("Control+c");
    const copies = await batch(() => page.keyboard.press("Control+d"));
    expect(copies).toHaveLength(2);
    expect(await scene()).toHaveLength(5);
    const dx = copies[0].points[0][0] - moved[0].points[0][0],
      dy = copies[0].points[0][1] - moved[0].points[0][1];
    expect(copies[1].points[0][0] - moved[1].points[0][0]).toBeCloseTo(dx, 4);
    expect(copies[1].points[0][1] - moved[1].points[0][1]).toBeCloseTo(dy, 4);
    const pasted = await batch(() => page.keyboard.press("Control+v"));
    expect(new Set([...copies, ...pasted].map((a) => a.id)).size).toBe(4);
    expect(await scene()).toHaveLength(7);
    await batch(() => page.keyboard.press("Delete"));
    expect(await scene()).toHaveLength(5);
    // Undo restores the entire deleted group with one action; redo removes it again.
    expect(
      (await request.post("/api/history/undo", { data: { filename } })).ok(),
    ).toBeTruthy();
    expect(await scene()).toHaveLength(7);
    expect(
      (await request.post("/api/history/redo", { data: { filename } })).ok(),
    ).toBeTruthy();
    expect(await scene()).toHaveLength(5);
    await page.keyboard.press("Escape");
    const pdfPage = page.locator(".reader .page").first();
    await pdfPage.evaluate(el => {
      el.addEventListener("pointerdown", event => {
        el.setAttribute("data-test-pointer-id", String((event as PointerEvent).pointerId));
      }, { once: true });
    });
    const hasCapture = () => pdfPage.evaluate(el =>
      el.hasPointerCapture(Number(el.getAttribute("data-test-pointer-id"))),
    );
    await marquee(50, 120, 480, 150, async () => {
      await expect(page.locator(".annotation-marquee")).toBeVisible();
      expect(await hasCapture()).toBe(true);
      await page.keyboard.press("Escape");
      await expect(page.locator(".annotation-marquee")).toHaveCount(0);
      expect(await hasCapture()).toBe(false);
    });
    await expect(selected).toHaveCount(0);
    await marquee(530, 270, -480, -150);
    await expect(selected).toHaveCount(4);
    await page.screenshot({ path: "work/multiselect-verified.png" });
    await batch(() => page.keyboard.press("Delete"));
    expect(await scene()).toHaveLength(1);
    await expect(page.locator("g[data-kind=ellipse]")).toHaveCount(1);
    const finalPdf = await PDFDocument.load(
      await (await request.get(`/api/download/${filename}`)).body(),
    );
    expect(
      finalPdf.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray).size(),
    ).toBe(1);
    expect(loads).toBe(baseline);
    expect(
      await canvas!.evaluate(
        (el) => el === document.querySelector(".reader canvas"),
      ),
    ).toBeTruthy();
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
