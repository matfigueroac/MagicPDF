import { test, expect } from "@playwright/test";
import { setReaderZoom100 } from "./reader-zoom";
import { PDFDocument } from "pdf-lib";
import fs from "node:fs/promises";
import path from "node:path";
import { layoutSelection } from "../src/api/annotationLayout";
import type { DrawingAnnotation } from "../src/types/annotations";

test("uniform overlap works vertically and keeps groups rigid in a rotated viewport", () => {
  const viewport = {
    convertToViewportPoint: (x: number, y: number) => [y, x],
    convertToPdfPoint: (x: number, y: number) => [y, x],
  };
  const rows = [
    { id: "a", points: [[0, 0], [100, 20]], groupId: "g" },
    { id: "b", points: [[20, 0], [30, 20]], groupId: "g" },
    { id: "c", points: [[10, 30], [90, 50]] },
    { id: "d", points: [[40, 60], [120, 80]] },
  ].map((a) => ({ ...a, page: 1 }) as DrawingAnnotation);
  const result = layoutSelection(rows, "vertical", viewport);
  const gap1 = result[2].points[0][0] - result[0].points[1][0];
  const gap2 = result[3].points[0][0] - result[2].points[1][0];
  expect(gap1).toBeCloseTo(gap2, 6);
  expect(gap1).toBeLessThan(0);
  expect(result[0].points).toEqual(rows[0].points);
  expect(result[1].points).toEqual(rows[1].points);
  expect(result[3].points).toEqual(rows[3].points);
});

test("selection quick tools group, lock, distribute and change an existing shape", async ({ page, request }) => {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  let filename = "";
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const scene = async () => (await (await request.get(`/api/scene/${filename}`)).json()).annotations;
  const clickWrite = async (label: string, endpoint: string) => {
    const response = page.waitForResponse((r) => r.url().endsWith(endpoint) && r.request().method() === "POST");
    await page.getByRole("button", { name: label, exact: true }).click();
    expect((await response).ok()).toBeTruthy();
    await expect(page.getByRole("button", { name: "Duplicar selección · Ctrl+D", exact: true })).toBeEnabled();
  };
  try {
    await page.goto("/");
    const upload = page.waitForResponse((r) => r.url().endsWith("/api/upload"));
    await page.locator("input[type=file]").first().setInputFiles({ name: "quick-tools-test.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
    filename = (await (await upload).json()).documents[0].filename;
    await expect(page.locator(".reader canvas").first()).toBeVisible();
    const base = { page: 1, kind: "rectangle", color: "#2563eb", width: 2, lineStyle: "dashed", text: "", fontSize: 12, fontFamily: "sans", border: false, borderColor: "#dc2626" };
    const original = [
      { ...base, id: "magicpdf-quick-aaa", points: [[60, 710], [160, 650]] },
      { ...base, id: "magicpdf-quick-bbb", points: [[240, 700], [300, 640]] },
      { ...base, id: "magicpdf-quick-ccc", points: [[420, 675], [480, 615]] },
    ];
    const seeded = await request.post("/api/drawing-batch", { data: { filename, annotations: original } });
    expect(seeded.ok(), await seeded.text()).toBeTruthy();
    await page.getByLabel("Inicio", { exact: true }).click();
    await page.getByRole("button", { name: "Ir al inicio", exact: true }).click();
    await page.getByRole("tab", { selected: true }).click();
    await expect(page.locator("g[data-kind=rectangle]")).toHaveCount(3);
    await setReaderZoom100(page, 595);
    const canvas = await page.locator(".reader .page canvas").first().elementHandle();
    for (let i = 0; i < 3; i++) {
      const b = await page.locator(`g[data-annotation-id="${original[i].id}"] .annotation-hit-target`).boundingBox();
      await page.keyboard.down("Control");
      await page.mouse.click(b!.x + 3, b!.y + b!.height / 2);
      await page.keyboard.up("Control");
      if (i === 1) await expect(page.getByRole("button", { name: "Distribuir verticalmente", exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole("toolbar", { name: "Acciones rápidas de selección" })).toBeVisible();
    await clickWrite("Distribuir verticalmente", "/api/drawing-batch");
    const distributed = await scene();
    const ordered = distributed.sort((a: any, b: any) => b.points[0][1] - a.points[0][1]);
    expect(ordered[0].points[1][1] - ordered[1].points[0][1]).toBeCloseTo(ordered[1].points[1][1] - ordered[2].points[0][1], 5);
    await clickWrite("Agrupar", "/api/drawing-batch");
    expect(new Set((await scene()).map((a: any) => a.groupId)).size).toBe(1);
    await expect(page.getByRole("button", { name: "Alinear al centro", exact: true })).toHaveCount(0);
    await clickWrite("Bloquear selección", "/api/annotation-lock");
    expect((await scene()).every((a: any) => a.locked)).toBeTruthy();
    await expect(page.getByRole("button", { name: "Desagrupar", exact: true })).toBeDisabled();
    await clickWrite("Desbloquear selección", "/api/annotation-lock");
    await clickWrite("Desagrupar", "/api/drawing-batch");
    await page.getByRole("button", { name: "Cancelar selección", exact: true }).click();
    const b = await page.locator(`g[data-annotation-id="${original[0].id}"] .annotation-hit-target`).boundingBox();
    await page.mouse.click(b!.x + 3, b!.y + b!.height / 2);
    const convert = async (kind: string) => {
      const response = page.waitForResponse((r) => r.url().endsWith("/api/drawing") && r.request().method() === "POST");
      await page.getByLabel("Cambiar forma rápido", { exact: true }).selectOption(kind);
      expect((await response).ok()).toBeTruthy();
      await expect(page.getByLabel("Cambiar forma rápido", { exact: true })).toBeEnabled();
    };
    await convert("ellipse");
    let shape = (await scene()).find((a: any) => a.id === original[0].id);
    expect(shape.kind).toBe("ellipse");
    expect(shape.points).toEqual(distributed.find((a: any) => a.id === shape.id).points);
    expect(shape.color).toBe(base.color);
    expect(shape.lineStyle).toBe(base.lineStyle);
    await convert("square");
    shape = (await scene()).find((a: any) => a.id === original[0].id);
    expect(Math.abs(shape.points[1][0] - shape.points[0][0])).toBeCloseTo(Math.abs(shape.points[1][1] - shape.points[0][1]), 5);
    await page.getByRole("button", { name: "Bloquear elemento", exact: true }).click();
    await expect(page.getByLabel("Cambiar forma rápido", { exact: true })).toBeDisabled();
    expect(await canvas!.evaluate((el) => el === document.querySelector(".reader .page canvas"))).toBeTruthy();
    expect(errors).toEqual([]);
    await page.screenshot({ path: "work/quick-tools-verified.png" });
  } finally {
    await page.close();
    if (filename) {
      await fs.rm(path.join("storage/uploads", filename), { force: true });
      await expect.poll(async () => {
        const health = await (await request.get("/api/info/__health")).json();
        return health.renders.active + health.renders.queued;
      }).toBe(0);
      for (const name of await fs.readdir("storage/temp"))
        if (name.startsWith(`render_${path.basename(filename, ".pdf")}_`)) await fs.rm(path.join("storage/temp", name), { force: true });
    }
  }
});
