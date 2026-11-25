import { test, expect } from "@playwright/test";
import { setReaderZoom100 } from "./reader-zoom";
import {
  PDFDocument,
  StandardFonts,
  PDFName,
  PDFArray,
  PDFDict,
  PDFHexString,
} from "pdf-lib";
import fs from "node:fs/promises";
import path from "node:path";

test("persistent groups select/move together, clone independently, merge, ungroup, undo and survive PDF roundtrip without reload", async ({
  page,
  request,
}) => {
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf
    .addPage([595, 842])
    .drawText("Grupos persistentes", { x: 50, y: 790, size: 20, font });
  const files: string[] = [],
    errors: string[] = [];
  let filename = "",
    loads = 0;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("/api/reader-file/")) loads++;
  });
  const scene = async () =>
    (await (await request.get(`/api/scene/${filename}`)).json()).annotations;
  const selectId = async (id: string) => {
    await page.locator(`g[data-annotation-id="${id}"]`).focus();
    await page.keyboard.press("Enter");
  };
  const action = async (
    run: () => Promise<unknown>,
    count = 2,
    endpoint = "drawing-batch",
  ) => {
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/${endpoint}`) && r.request().method() === "POST",
    );
    await run();
    const res = await saved;
    expect(res.ok(), await res.text()).toBeTruthy();
    await expect(
      page.locator("g[data-selected=true][role=button]"),
    ).toHaveCount(count);
    const body = await res.json();
    return body.annotations || [body.annotation];
  };
  const upload = async (buffer: Buffer, name: string) => {
    const saved = page.waitForResponse((r) => r.url().endsWith("/api/upload"));
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({ name, mimeType: "application/pdf", buffer });
    filename = (await (await saved).json()).documents[0].filename;
    files.push(filename);
  };
  try {
    await page.goto("/");
    await upload(Buffer.from(await pdf.save()), "grouping-automated-test.pdf");
    await expect(page.locator(".reader .textLayer").first()).toContainText(
      "Grupos persistentes",
    );
    const base = {
      page: 1,
      color: "#2563eb",
      width: 2,
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
        id: "magicpdf-persist-text",
        kind: "text",
        text: "Movernos juntos",
        points: [
          [70, 700],
          [250, 640],
        ],
      },
      {
        ...base,
        id: "magicpdf-persist-rect",
        kind: "rectangle",
        points: [
          [300, 700],
          [430, 640],
        ],
      },
      {
        ...base,
        id: "magicpdf-persist-ellipse",
        kind: "ellipse",
        points: [
          [70, 520],
          [140, 460],
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
    await selectId(rows[0].id);
    const rect = await page
      .locator("g[data-kind=rectangle] .annotation-hit-target rect")
      .boundingBox();
    await page.keyboard.down("Control");
    await page.mouse.click(rect!.x + 6, rect!.y + rect!.height / 2);
    await page.keyboard.up("Control");
    const canvas = await page.locator(".reader canvas").first().elementHandle(),
      baseline = loads;
    const original = await action(() =>
      page.getByRole("button", { name: "Agrupar", exact: true }).click(),
    );
    const group = original[0].groupId;
    expect(group).toMatch(/^magicpdf-group-/);
    expect(original.every((a: any) => a.groupId === group)).toBeTruthy();
    await expect(
      page.getByRole("button", { name: "Agrupar", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Alinear a la izquierda", exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    // Starting the drag directly on an unselected group selects all members and moves them.
    const text = await page
      .locator(`g[data-annotation-id="${rows[0].id}"] text`)
      .boundingBox();
    const moved = await action(async () => {
      await page.mouse.move(text!.x + 10, text!.y + text!.height / 2);
      await page.mouse.down();
      await page.mouse.move(text!.x + 50, text!.y + text!.height / 2 + 24, {
        steps: 12,
      });
      await page.mouse.up();
    });
    for (const a of moved) {
      const old = rows.find((row) => row.id === a.id)!;
      expect(a.points[0][0] - old.points[0][0]).toBeCloseTo(30, 0);
      expect(a.points[0][1] - old.points[0][1]).toBeCloseTo(-18, 0);
      expect(a.groupId).toBe(group);
    }
    await expect(page.locator('.annotation-group-selection')).toHaveCount(1);
    await expect(page.locator('g[data-selected=true] .annotation-selection')).toHaveCount(0);
    await expect(page.locator('[data-group-resize-handle]')).toHaveCount(4);
    // Every corner scales geometry, text and strokes around the opposite corner.
    for (const corner of ['se', 'nw', 'ne', 'sw']) {
      const before = (await scene()).filter((a: any) => a.groupId === group);
      const frame = await page.locator('.annotation-group-selection > rect').first().boundingBox();
      const handle = await page.locator(`[data-group-resize-handle=${corner}]`).boundingBox();
      const factor = corner === 'sw' ? 0.8 : 1.08;
      const anchor = [corner.includes('w') ? Math.max(...before.flatMap((a: any) => a.points.map((p: number[]) => p[0]))) : Math.min(...before.flatMap((a: any) => a.points.map((p: number[]) => p[0]))),
        corner.includes('n') ? Math.min(...before.flatMap((a: any) => a.points.map((p: number[]) => p[1]))) : Math.max(...before.flatMap((a: any) => a.points.map((p: number[]) => p[1])))];
      const resized = await action(async () => {
        const x = handle!.x + handle!.width / 2, y = handle!.y + handle!.height / 2;
        await page.mouse.move(x, y); await page.mouse.down();
        await page.mouse.move(x + frame!.width * (factor - 1) * (corner.includes('w') ? -1 : 1),
          y + frame!.height * (factor - 1) * (corner.includes('n') ? -1 : 1), { steps: 8 });
        await page.mouse.up();
      });
      for (const a of resized) {
        const old = before.find((row: any) => row.id === a.id);
        const actualFactor = a.width / old.width;
        expect(actualFactor).toBeCloseTo(factor, 2);
        a.points.forEach((point: number[], i: number) => point.forEach((value, axis) =>
          expect(value).toBeCloseTo(anchor[axis] + (old.points[i][axis] - anchor[axis]) * actualFactor, 3)));
        if (a.kind === 'text') expect(a.fontSize).toBeCloseTo(old.fontSize * actualFactor, 3);
        expect(a.groupId).toBe(group);
      }
    }
    await page.screenshot({ path: 'work/group-resize-verified.png' });
    const beforeCancel = await scene();
    const cancelHandle = await page.locator('[data-group-resize-handle=se]').boundingBox();
    await page.mouse.move(cancelHandle!.x + 6, cancelHandle!.y + 6);
    await page.mouse.down();
    await page.mouse.move(cancelHandle!.x + 45, cancelHandle!.y + 30, { steps: 5 });
    await page.keyboard.press('Escape'); await page.mouse.up();
    expect(await scene()).toEqual(beforeCancel);
    await page.keyboard.press("Escape");
    await selectId(rows[1].id);
    await expect(page.locator("g[data-selected=true]")).toHaveCount(2);
    await page.keyboard.press("Control+c");
    const duplicate = await action(() => page.keyboard.press("Control+d")),
      pasted = await action(() => page.keyboard.press("Control+v"));
    expect(new Set([group, duplicate[0].groupId, pasted[0].groupId]).size).toBe(
      3,
    );
    expect(
      duplicate.every((a: any) => a.groupId === duplicate[0].groupId),
    ).toBeTruthy();
    expect(
      pasted.every((a: any) => a.groupId === pasted[0].groupId),
    ).toBeTruthy();
    expect(await scene()).toHaveLength(7);
    const ungrouped = await action(() =>
      page.getByRole("button", { name: "Desagrupar", exact: true }).click(),
    );
    expect(ungrouped.every((a: any) => !a.groupId)).toBeTruthy();
    await page.keyboard.press("Escape");
    await selectId(pasted[0].id);
    await expect(page.locator("g[data-selected=true]")).toHaveCount(1);
    const selectedBox = await page
      .locator("g[data-selected=true] .annotation-selection > rect:first-child")
      .boundingBox();
    const beforeSingle = await scene();
    await action(
      async () => {
        await page.mouse.move(selectedBox!.x + 10, selectedBox!.y + 10);
        await page.mouse.down();
        await page.mouse.move(selectedBox!.x + 25, selectedBox!.y + 20, {
          steps: 10,
        });
        await page.mouse.up();
      },
      1,
      "drawing",
    );
    const afterSingle = await scene();
    for (const old of beforeSingle.filter((a: any) => a.id !== pasted[0].id))
      expect(afterSingle.find((a: any) => a.id === old.id).points).toEqual(
        old.points,
      );
    // Ctrl+click adds an entire existing group; Agrupar merges the selection into one flat group.
    await selectId(duplicate[0].id);
    const other = await page
      .locator(
        `g[data-annotation-id="${rows[1].id}"] .annotation-hit-target rect`,
      )
      .boundingBox();
    await page.keyboard.down("Control");
    await page.mouse.click(other!.x + 6, other!.y + other!.height / 2);
    await page.keyboard.up("Control");
    await expect(page.locator("g[data-selected=true]")).toHaveCount(4);
    const checkRigid = (before: any[], after: any[]) => {
      for (const gid of [group, duplicate[0].groupId]) {
        const old = before.filter((a) => a.groupId === gid),
          first = after.find((a) => a.id === old[0].id);
        const dx = first.points[0][0] - old[0].points[0][0],
          dy = first.points[0][1] - old[0].points[0][1];
        for (const a of old) {
          const moved = after.find((b) => b.id === a.id);
          expect(moved.points[0][0] - a.points[0][0]).toBeCloseTo(dx, 5);
          expect(moved.points[0][1] - a.points[0][1]).toBeCloseTo(dy, 5);
        }
      }
    };
    const beforeAlign = await scene(),
      aligned = await action(
        () =>
          page
            .getByRole("button", {
              name: "Alinear a la izquierda",
              exact: true,
            })
            .click(),
        4,
      );
    checkRigid(beforeAlign, aligned);
    const ellipse = await page
      .locator("g[data-kind=ellipse] .annotation-hit-target ellipse")
      .boundingBox();
    const toggleEllipse = async () => {
      await page.keyboard.down("Control");
      await page.mouse.click(ellipse!.x + 6, ellipse!.y + ellipse!.height / 2);
      await page.keyboard.up("Control");
    };
    await toggleEllipse();
    await expect(page.locator("g[data-selected=true]")).toHaveCount(5);
    const beforeDistribute = await scene(),
      distributed = await action(
        () =>
          page
            .getByRole("button", {
              name: "Distribuir verticalmente",
              exact: true,
            })
            .click(),
        5,
      );
    checkRigid(beforeDistribute, distributed);
    await toggleEllipse();
    await expect(page.locator("g[data-selected=true]")).toHaveCount(4);
    const merged = await action(
      () => page.getByRole("button", { name: "Agrupar", exact: true }).click(),
      4,
    );
    expect(new Set(merged.map((a: any) => a.groupId)).size).toBe(1);
    await action(
      () =>
        page.getByRole("button", { name: "Desagrupar", exact: true }).click(),
      4,
    );
    expect((await scene()).every((a: any) => !a.groupId)).toBeTruthy();
    expect(loads).toBe(baseline);
    expect(
      await canvas!.evaluate(
        (el) => el === document.querySelector(".reader canvas"),
      ),
    ).toBeTruthy();
    await page.getByLabel("Herramientas", { exact: true }).click();
    await page.getByRole("button", { name: "Deshacer", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await scene()).filter((a: any) => a.groupId === merged[0].groupId)
            .length,
      )
      .toBe(4);
    await expect.poll(() => loads).toBe(baseline + 1);
    await expect(page.locator(".reader-loading")).toHaveCount(0);
    await selectId(rows[0].id);
    await expect(page.locator("g[data-selected=true]")).toHaveCount(4);
    const downloaded = await (
        await request.get(`/api/download/${filename}`)
      ).body(),
      native = await PDFDocument.load(downloaded);
    const annotations = native
      .getPage(0)
      .node.lookup(PDFName.of("Annots"), PDFArray)
      .asArray()
      .map((ref) =>
        JSON.parse(
          native.context
            .lookup(ref, PDFDict)
            .lookup(PDFName.of("MagicPDFData"), PDFHexString)
            .decodeText(),
        ),
      );
    expect(
      annotations.filter((a) => a.groupId === merged[0].groupId),
    ).toHaveLength(4);
    await page.getByLabel("Inicio", { exact: true }).click();
    await page
      .getByRole("button", { name: "Ir al inicio", exact: true })
      .click();
    await upload(downloaded, "grouping-roundtrip-test.pdf");
    await expect(page.locator("g[data-group-id]")).toHaveCount(4);
    await selectId(rows[0].id);
    await expect(page.locator("g[data-selected=true]")).toHaveCount(4);
    await page.screenshot({ path: "work/grouping-verified.png" });
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
