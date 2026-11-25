import { test, expect } from "@playwright/test";
import { setReaderZoom100 } from "./reader-zoom";
import {
  PDFDocument,
  StandardFonts,
  PDFName,
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFNumber,
} from "pdf-lib";
import fs from "node:fs/promises";
import path from "node:path";

test("persistent locks protect text, shapes and groups, permit independent locked copies and undo, with no PDF reload", async ({
  page,
  request,
}) => {
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf
    .addPage([595, 842])
    .drawText("Bloquear y desbloquear", { x: 50, y: 790, size: 20, font });
  const files: string[] = [],
    errors: string[] = [];
  let filename = "",
    loads = 0,
    writes = 0;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("/api/reader-file/")) loads++;
    if (r.method() === "POST" && /\/api\/drawing(-batch)?$/.test(r.url()))
      writes++;
  });
  const scene = async () =>
    (await (await request.get(`/api/scene/${filename}`)).json()).annotations;
  const selectId = async (id: string) => {
    await page.locator(`g[data-annotation-id="${id}"]`).focus();
    await page.keyboard.press("Enter");
  };
  const action = async (
    endpoint: string,
    run: () => Promise<unknown>,
    count: number,
  ) => {
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/${endpoint}`) && r.request().method() === "POST",
    );
    await run();
    const res = await response;
    expect(res.ok(), await res.text()).toBeTruthy();
    await expect(
      page.locator("g[data-selected=true][role=button]"),
    ).toHaveCount(count);
    const body = await res.json();
    return body.annotations || [body.annotation];
  };
  const upload = async (buffer: Buffer, name: string) => {
    const response = page.waitForResponse((r) =>
      r.url().endsWith("/api/upload"),
    );
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({ name, mimeType: "application/pdf", buffer });
    filename = (await (await response).json()).documents[0].filename;
    files.push(filename);
  };
  const dragSelected = async (dx: number, dy: number) => {
    const b = await page
      .locator("g[data-selected=true] .annotation-selection > rect:first-child, .annotation-group-selection > rect:first-child")
      .first()
      .boundingBox();
    await page.mouse.move(b!.x + 8, b!.y + 8);
    await page.mouse.down();
    await page.mouse.move(b!.x + 8 + dx, b!.y + 8 + dy, { steps: 12 });
    await page.mouse.up();
  };
  try {
    await page.goto("/");
    await upload(Buffer.from(await pdf.save()), "locking-automated-test.pdf");
    await expect(page.locator(".reader .textLayer").first()).toContainText(
      "Bloquear y desbloquear",
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
        id: "magicpdf-lock-text",
        kind: "text",
        text: "Texto del grupo",
        points: [
          [70, 700],
          [250, 640],
        ],
        groupId: "magicpdf-group-lock-test",
      },
      {
        ...base,
        id: "magicpdf-lock-rectangle",
        kind: "rectangle",
        points: [
          [300, 700],
          [430, 640],
        ],
        groupId: "magicpdf-group-lock-test",
      },
      {
        ...base,
        id: "magicpdf-lock-single",
        kind: "text",
        text: "Texto individual",
        points: [
          [70, 560],
          [280, 500],
        ],
      },
      {
        ...base,
        id: "magicpdf-lock-ellipse",
        kind: "ellipse",
        points: [
          [320, 560],
          [420, 500],
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
    await expect(page.locator("g[data-kind=text]")).toHaveCount(2);
    await setReaderZoom100(page, 595);
    const canvas = await page.locator(".reader canvas").first().elementHandle(),
      baseline = loads;
    await selectId(rows[2].id);
    const single = (
      await action(
        "annotation-lock",
        () =>
          page
            .getByRole("button", { name: "Bloquear elemento", exact: true })
            .click(),
        1,
      )
    )[0];
    expect(single.locked).toBe(true);
    await expect(
      page.getByLabel("Texto de anotación", { exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Aplicar anotación", exact: true }),
    ).toBeDisabled();
    await expect(page.locator("[data-resize-handle]")).toHaveCount(0);
    const beforeBlocked = writes;
    await dragSelected(50, 25);
    await page.keyboard.press("Delete");
    expect(writes).toBe(beforeBlocked);
    expect((await scene()).find((a: any) => a.id === single.id).points).toEqual(
      single.points,
    );
    const bytes = await (await request.get(`/api/download/${filename}`)).body();
    for (const data of [
      {
        filename,
        annotation: { ...single, text: "No debe cambiar", locked: false },
      },
      { filename, annotation: single, remove: true },
    ])
      expect((await request.post("/api/drawing", { data })).status()).toBe(400);
    expect(
      (
        await request.post("/api/drawing-batch", {
          data: {
            filename,
            annotations: [
              {
                ...rows[3],
                points: [
                  [330, 560],
                  [430, 500],
                ],
              },
              single,
            ],
            remove: true,
          },
        })
      ).status(),
    ).toBe(400);
    expect(
      await (await request.get(`/api/download/${filename}`)).body(),
    ).toEqual(bytes);
    await action(
      "annotation-lock",
      () =>
        page
          .getByRole("button", { name: "Desbloquear elemento", exact: true })
          .click(),
      1,
    );
    await expect(
      page.getByLabel("Texto de anotación", { exact: true }),
    ).toBeEnabled();
    const moved = await action("drawing", () => dragSelected(20, 10), 1);
    expect(moved[0].points).not.toEqual(single.points);
    await selectId(rows[0].id);
    const group = await action(
      "annotation-lock",
      () =>
        page
          .getByRole("button", { name: "Bloquear selección", exact: true })
          .click(),
      2,
    );
    expect(group.every((a: any) => a.locked)).toBeTruthy();
    await expect(page.locator('[data-group-resize-handle]')).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Desagrupar", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", {
        name: "Eliminar selección · Supr",
        exact: true,
      }),
    ).toBeDisabled();
    const groupWrites = writes;
    await dragSelected(50, 20);
    await page.keyboard.press("Delete");
    expect(writes).toBe(groupWrites);
    const partial = await request.post("/api/annotation-lock", {
      data: { filename, ids: [rows[0].id], locked: true },
    });
    expect((await partial.json()).annotations).toHaveLength(2);
    await page.keyboard.press("Control+c");
    const duplicate = await action(
      "drawing-batch",
      () => page.keyboard.press("Control+d"),
      2,
    );
    expect(duplicate.every((a: any) => a.locked)).toBeTruthy();
    expect(duplicate[0].groupId).not.toBe(group[0].groupId);
    await action(
      "annotation-lock",
      () =>
        page
          .getByRole("button", { name: "Desbloquear selección", exact: true })
          .click(),
      2,
    );
    expect(
      (await scene())
        .filter((a: any) => a.groupId === group[0].groupId)
        .every((a: any) => a.locked),
    ).toBeTruthy();
    const pasted = await action(
      "drawing-batch",
      () => page.keyboard.press("Control+v"),
      2,
    );
    expect(pasted.every((a: any) => a.locked)).toBeTruthy();
    expect(pasted[0].groupId).not.toBe(group[0].groupId);
    await selectId(rows[3].id);
    await action(
      "annotation-lock",
      () =>
        page
          .getByRole("button", { name: "Bloquear elemento", exact: true })
          .click(),
      1,
    );
    await expect(
      page.getByLabel("Grosor de línea", { exact: true }),
    ).toBeDisabled();
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
          !!(await scene()).find((a: any) => a.id === rows[3].id).locked,
      )
      .toBe(false);
    await expect.poll(() => loads).toBe(baseline + 1);
    await expect(page.locator(".reader-loading")).toHaveCount(0);
    await page.getByLabel("Herramientas", { exact: true }).click();
    await page.getByRole("button", { name: "Rehacer", exact: true }).click();
    await expect
      .poll(
        async () =>
          !!(await scene()).find((a: any) => a.id === rows[3].id).locked,
      )
      .toBe(true);
    const downloaded = await (
        await request.get(`/api/download/${filename}`)
      ).body(),
      native = await PDFDocument.load(downloaded);
    let lockedCount = 0;
    for (const ref of native
      .getPage(0)
      .node.lookup(PDFName.of("Annots"), PDFArray)
      .asArray()) {
      const a = native.context.lookup(ref, PDFDict),
        data = JSON.parse(
          a.lookup(PDFName.of("MagicPDFData"), PDFHexString).decodeText(),
        ),
        flags = a.lookup(PDFName.of("F"), PDFNumber).asNumber();
      if (data.locked) {
        lockedCount++;
        expect(flags & 128).toBe(128);
        expect(flags & 512).toBe(512);
      } else expect(flags & 640).toBe(0);
    }
    expect(lockedCount).toBe(5);
    await page.getByLabel("Inicio", { exact: true }).click();
    await page
      .getByRole("button", { name: "Ir al inicio", exact: true })
      .click();
    await upload(downloaded, "locking-roundtrip-test.pdf");
    await expect(page.locator("g[data-locked=true]")).toHaveCount(5);
    await selectId(rows[0].id);
    await expect(
      page.getByRole("button", { name: "Desbloquear selección", exact: true }),
    ).toBeEnabled();
    await page.screenshot({ path: "work/locking-verified.png" });
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
