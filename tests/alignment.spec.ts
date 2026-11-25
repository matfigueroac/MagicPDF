import { test, expect } from "@playwright/test";
import { setReaderZoom100 } from "./reader-zoom";
import { PDFDocument, StandardFonts, PDFArray, PDFName } from "pdf-lib";
import fs from "node:fs/promises";
import path from "node:path";

test("alignment and equal gaps preserve sizes/styles, persist atomically and keep the PDF canvas", async ({
  page,
  request,
}) => {
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf
    .addPage([595, 842])
    .drawText("Alinear y distribuir", { x: 50, y: 790, size: 20, font });
  let filename = "",
    loads = 0,
    writes = 0;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("/api/reader-file/")) loads++;
    if (r.url().endsWith("/api/drawing-batch") && r.method() === "POST")
      writes++;
  });
  const scene = async () =>
    (await (await request.get(`/api/scene/${filename}`)).json()).annotations;
  const bounds = (a: any) => ({
    left: Math.min(...a.points.map((p: number[]) => p[0])),
    right: Math.max(...a.points.map((p: number[]) => p[0])),
    top: Math.max(...a.points.map((p: number[]) => p[1])),
    bottom: Math.min(...a.points.map((p: number[]) => p[1])),
  });
  const act = async (name: string) => {
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/drawing-batch") &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name, exact: true }).click();
    const res = await response;
    expect(res.ok(), await res.text()).toBeTruthy();
    await expect(page.getByRole("button", { name, exact: true })).toBeEnabled();
    return (await res.json()).annotations;
  };
  const selectOutline = async (kind: string) => {
    const b = await page
      .locator(`g[data-kind=${kind}] .annotation-hit-target`)
      .boundingBox();
    await page.keyboard.down("Control");
    await page.mouse.click(b!.x + 6, b!.y + b!.height / 2);
    await page.keyboard.up("Control");
  };
  try {
    await page.goto("/");
    const upload = page.waitForResponse((r) => r.url().endsWith("/api/upload"));
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "alignment-automated-test.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(await pdf.save()),
      });
    filename = (await (await upload).json()).documents[0].filename;
    await expect(page.locator(".reader .textLayer").first()).toContainText(
      "Alinear y distribuir",
    );
    const base = {
      page: 1,
      color: "#2563eb",
      width: 2,
      lineStyle: "dashed",
      text: "",
      fontSize: 12,
      fontFamily: "sans",
      border: false,
      borderColor: "#dc2626",
    };
    const original = [
      {
        ...base,
        id: "magicpdf-align-text",
        kind: "text",
        text: "Texto alineado",
        points: [
          [60, 710],
          [160, 650],
        ],
      },
      {
        ...base,
        id: "magicpdf-align-rectangle",
        kind: "rectangle",
        points: [
          [240, 580],
          [300, 550],
        ],
      },
      {
        ...base,
        id: "magicpdf-align-ellipse",
        kind: "ellipse",
        points: [
          [450, 450],
          [490, 420],
        ],
      },
    ];
    expect(
      (
        await request.post("/api/drawing-batch", {
          data: { filename, annotations: original },
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
    await page.locator("g[data-kind=text] text").click();
    await selectOutline("rectangle");
    await expect(
      page.getByRole("button", {
        name: "Distribuir horizontalmente",
        exact: true,
      }),
    ).toHaveCount(0);
    await selectOutline("ellipse");
    await expect(page.locator("g[data-selected=true]")).toHaveCount(3);
    const canvas = await page.locator(".reader canvas").first().elementHandle(),
      baseline = loads;
    const historyBefore = (
      await (await request.get(`/api/history/${filename}`)).json()
    ).undo;
    const horizontal = (await act("Distribuir horizontalmente"))
      .map(bounds)
      .sort((a: any, b: any) => a.left - b.left);
    expect(horizontal[0].left).toBeCloseTo(60, 5);
    expect(horizontal[2].right).toBeCloseTo(490, 5);
    expect(horizontal[1].left - horizontal[0].right).toBeCloseTo(
      horizontal[2].left - horizontal[1].right,
      5,
    );
    const vertical = (await act("Distribuir verticalmente"))
      .map(bounds)
      .sort((a: any, b: any) => b.top - a.top);
    expect(vertical[0].top).toBeCloseTo(710, 5);
    expect(vertical[2].bottom).toBeCloseTo(420, 5);
    expect(vertical[0].bottom - vertical[1].top).toBeCloseTo(
      vertical[1].bottom - vertical[2].top,
      5,
    );
    let before = await scene();
    const left = await act("Alinear a la izquierda");
    for (const a of left) {
      expect(bounds(a).left).toBeCloseTo(60, 5);
      expect(bounds(a).bottom).toBeCloseTo(
        bounds(before.find((b: any) => b.id === a.id)).bottom,
        5,
      );
    }
    before = await scene();
    const targetCenter =
      (Math.min(...before.map((a: any) => bounds(a).left)) +
        Math.max(...before.map((a: any) => bounds(a).right))) /
      2;
    const centered = await act("Alinear al centro");
    for (const a of centered)
      expect((bounds(a).left + bounds(a).right) / 2).toBeCloseTo(
        targetCenter,
        5,
      );
    before = await scene();
    const targetRight = Math.max(...before.map((a: any) => bounds(a).right));
    const right = await act("Alinear a la derecha");
    for (const a of right) expect(bounds(a).right).toBeCloseTo(targetRight, 5);
    for (const a of right) {
      const old = original.find((b) => b.id === a.id)!;
      expect(bounds(a).right - bounds(a).left).toBeCloseTo(
        bounds(old).right - bounds(old).left,
        5,
      );
      expect(bounds(a).top - bounds(a).bottom).toBeCloseTo(
        bounds(old).top - bounds(old).bottom,
        5,
      );
      expect(a.color).toBe(old.color);
      expect(a.lineStyle).toBe(old.lineStyle);
      expect(a.text).toBe(old.text);
    }
    expect(
      (await (await request.get(`/api/history/${filename}`)).json()).undo,
    ).toBe(historyBefore + 5);
    await page.screenshot({ path: "work/alignment-verified.png" });
    const beforeOverlap = writes;
    const overlapping = (await act("Distribuir horizontalmente"))
      .sort((a: any, b: any) => bounds(a).left - bounds(b).left);
    expect(bounds(overlapping[1]).left - bounds(overlapping[0]).right).toBeCloseTo(
      bounds(overlapping[2]).left - bounds(overlapping[1]).right, 5,
    );
    expect(writes).toBe(beforeOverlap + 1);
    expect(loads).toBe(baseline);
    expect(
      await canvas!.evaluate(
        (el) => el === document.querySelector(".reader canvas"),
      ),
    ).toBeTruthy();
    const saved = await PDFDocument.load(
      await (await request.get(`/api/download/${filename}`)).body(),
    );
    expect(
      saved.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray).size(),
    ).toBe(3);
    const undoOverlap = page.waitForResponse(r => r.url().endsWith("/api/history/undo") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Deshacer", exact: true }).click();
    expect((await undoOverlap).ok()).toBeTruthy();
    await expect.poll(async () => JSON.stringify((await scene()).map((a: any) => [a.id, a.points]).sort()))
      .toBe(JSON.stringify(right.map((a: any) => [a.id, a.points]).sort()));
    await expect.poll(() => loads).toBe(baseline + 1);
    await expect(page.locator(".reader-loading")).toHaveCount(0);
    const undone = page.waitForResponse(r => r.url().endsWith("/api/history/undo") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Deshacer", exact: true }).click();
    expect((await undone).ok()).toBeTruthy();
    await expect
      .poll(async () =>
        JSON.stringify(
          (await scene()).map((a: any) => [a.id, a.points]).sort(),
        ),
      )
      .toBe(JSON.stringify(centered.map((a: any) => [a.id, a.points]).sort()));
    await expect.poll(() => loads).toBe(baseline + 2);
    await expect(page.locator(".reader-loading")).toHaveCount(0);
    await expect(page.locator(".reader .textLayer").first()).toContainText(
      "Alinear y distribuir",
    );
    await expect(page.locator("g[data-kind=text]")).toHaveCount(1);
    await page.getByLabel("Opciones de lectura", { exact: true }).click();
    await page
      .getByRole("button", { name: "Girar vista", exact: true })
      .click();
    await page.getByLabel("Opciones de lectura", { exact: true }).click();
    await expect
      .poll(async () => {
        const b = await page.locator(".reader .page").first().boundingBox();
        return b!.width > b!.height;
      })
      .toBe(true);
    await page.locator("g[data-kind=text] text").click();
    await selectOutline("rectangle");
    await selectOutline("ellipse");
    const rotatedLoads = loads,
      rotatedCanvas = await page
        .locator(".reader canvas")
        .first()
        .elementHandle();
    const rotated = await act("Alinear a la izquierda");
    const lowest = Math.min(...centered.map((a: any) => bounds(a).bottom));
    for (const a of rotated) {
      expect(bounds(a).bottom).toBeCloseTo(lowest, 5);
      expect(bounds(a).left).toBeCloseTo(
        bounds(centered.find((b: any) => b.id === a.id)).left,
        5,
      );
    }
    expect(loads).toBe(rotatedLoads);
    expect(
      await rotatedCanvas!.evaluate(
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
