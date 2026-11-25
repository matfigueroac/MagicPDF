import fs from "node:fs/promises";
import {
  PDFDocument,
  PDFDict,
  PDFArray,
  PDFName,
  PDFHexString,
  PDFString,
  StandardFonts,
} from "pdf-lib";
import type { DrawingAnnotation } from "../src/types/annotations.js";
import {
  isAnnotationHidden,
  type LayerScope,
  type LayerPatch,
} from "../src/api/annotationLayers.js";
import { reorderStack, type StackAction } from "../src/api/annotationStack.js";
const key = PDFName.of("MagicPDFData");
function valid(a: DrawingAnnotation, pages: number) {
  for (const value of [a?.name, a?.groupName])
    if (
      value !== undefined &&
      (typeof value !== "string" ||
        value.length > 80 ||
        /[\x00-\x1f\x7f]/.test(value))
    )
      throw new Error("Nombre de capa inválido");
  for (const value of [a?.hidden, a?.groupHidden])
    if (value !== undefined && typeof value !== "boolean")
      throw new Error("Visibilidad inválida");
  if (
    a?.locked !== undefined &&
    (typeof a.locked !== "boolean" ||
      (a.locked && ["highlight", "underline"].includes(a.kind)))
  )
    throw new Error("Bloqueo inválido");
  if (
    a?.groupId !== undefined &&
    (typeof a.groupId !== "string" ||
      !/^magicpdf-group-[\w-]{8,80}$/.test(a.groupId) ||
      ["highlight", "underline"].includes(a.kind))
  )
    throw new Error("Grupo inválido");
  if (
    a?.lines !== undefined &&
    (!Array.isArray(a.lines) ||
      a.lines.some((line) => typeof line !== "string") ||
      a.lines.join("").length > 30000)
  )
    throw new Error("Líneas inválidas");
  if (
    !a ||
    !/^magicpdf-[\w-]{8,80}$/.test(a.id) ||
    !Number.isInteger(a.page) ||
    a.page < 1 ||
    a.page > pages ||
    ![
      "highlight",
      "underline",
      "text",
      "rectangle",
      "square",
      "ellipse",
      "line",
      "arrow",
      "ink",
    ].includes(a.kind)
  )
    throw new Error("Anotación inválida");
  if (
    !Array.isArray(a.points) ||
    a.points.length < 2 ||
    a.points.length > 2048 ||
    a.points.some(
      (p) =>
        !Array.isArray(p) ||
        p.length !== 2 ||
        p.some((n) => !Number.isFinite(n) || Math.abs(n) > 100000),
    )
  )
    throw new Error("Coordenadas inválidas");
  if (
    !/^#[a-f0-9]{6}$/i.test(a.color) ||
    !/^#[a-f0-9]{6}$/i.test(a.borderColor) ||
    !Number.isFinite(a.width) ||
    a.width < 0.5 ||
    a.width > 12 ||
    !["solid", "dashed", "dotted"].includes(a.lineStyle)
  )
    throw new Error("Estilo de línea inválido");
  if (
    typeof a.text !== "string" ||
    a.text.length > 20000 ||
    !Number.isFinite(a.fontSize) ||
    a.fontSize < 6 ||
    a.fontSize > 96 ||
    !["sans", "serif", "mono"].includes(a.fontFamily) ||
    typeof a.border !== "boolean"
  )
    throw new Error("Texto inválido");
  if (a.kind === "highlight" || a.kind === "underline")
    if (
      !Array.isArray(a.rects) ||
      !a.rects.length ||
      a.rects.length > 500 ||
      a.rects.some(
        (r) =>
          !Array.isArray(r) ||
          r.length !== 4 ||
          r.some((n) => !Number.isFinite(n)) ||
          r[2] <= r[0] ||
          r[3] <= r[1],
      )
    )
      throw new Error("Selección inválida");
}
function decode(dict: PDFDict, pages: number): DrawingAnnotation | null {
  try {
    const raw = dict.lookupMaybe(key, PDFHexString);
    if (!raw) return null;
    const a = JSON.parse(raw.decodeText());
    valid(a, pages);
    return a;
  } catch {
    return null;
  }
}
async function save(file: string, pdf: PDFDocument) {
  const temp = file + ".scene-writing";
  try {
    await fs.writeFile(temp, await pdf.save());
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
}
export async function writeDrawing(
  file: string,
  input: DrawingAnnotation,
  remove = false,
  fitText = false,
) {
  return (await writeDrawings(file, [input], remove, fitText))[0];
}
export async function writeDrawings(
  file: string,
  inputs: DrawingAnnotation[],
  remove = false,
  fitText = false,
) {
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 500)
    throw new Error("Selecciona entre 1 y 500 anotaciones");
  const pdf = await PDFDocument.load(await fs.readFile(file));
  for (const input of inputs) valid(input, pdf.getPageCount());
  if (new Set(inputs.map((a) => a.id)).size !== inputs.length)
    throw new Error("Anotaciones repetidas");
  const existing = ownedAnnotations(pdf);
  const lockedGroups = new Set(
    [...existing.values()]
      .filter((a) => a.locked && a.groupId)
      .map((a) => a.groupId),
  );
  for (const input of inputs) {
    const old = existing.get(input.id);
    if (
      old?.locked ||
      (old?.groupId && lockedGroups.has(old.groupId)) ||
      (input.groupId && lockedGroups.has(input.groupId))
    )
      throw new Error(
        "Hay elementos bloqueados. Desbloquéalos antes de editar o borrar.",
      );
    if (old && !!old.locked !== !!input.locked)
      throw new Error("Usa Bloquear o Desbloquear para cambiar el bloqueo.");
  }
  const result = [];
  for (const input of inputs)
    result.push(await updateDrawing(pdf, input, remove, fitText));
  await save(file, pdf);
  return result;
}
function ownedAnnotations(pdf: PDFDocument) {
  const rows = new Map<string, DrawingAnnotation>();
  for (const page of pdf.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (annots)
      for (const ref of annots.asArray()) {
        const a = decode(pdf.context.lookup(ref, PDFDict), pdf.getPageCount());
        if (a) rows.set(a.id, a);
      }
  }
  return rows;
}
export async function setDrawingLock(
  file: string,
  ids: string[],
  locked: boolean,
) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 500 ||
    ids.some((id) => typeof id !== "string") ||
    typeof locked !== "boolean"
  )
    throw new Error("Selección o bloqueo inválido");
  const pdf = await PDFDocument.load(await fs.readFile(file)),
    existing = ownedAnnotations(pdf);
  const wanted = new Set(ids);
  for (const id of ids) {
    const a = existing.get(id);
    if (!a) throw new Error("Anotación no encontrada");
    if (["highlight", "underline"].includes(a.kind))
      throw new Error("Selecciona textos o figuras");
  }
  const groups = new Set(
    ids.map((id) => existing.get(id)!.groupId).filter(Boolean),
  );
  const rows = [...existing.values()].filter(
    (a) => wanted.has(a.id) || (a.groupId && groups.has(a.groupId)),
  );
  if (rows.length > 500)
    throw new Error("Puedes bloquear hasta 500 anotaciones a la vez");
  const result = [];
  for (const a of rows)
    result.push(await updateDrawing(pdf, { ...a, locked }, false));
  await save(file, pdf);
  return result;
}
export async function setLayerProperties(
  file: string,
  scope: LayerScope,
  id: string,
  patch: LayerPatch,
) {
  if (
    !["item", "group"].includes(scope) ||
    typeof id !== "string" ||
    !patch ||
    typeof patch !== "object" ||
    !Object.keys(patch).length ||
    Object.keys(patch).some((k) => !["name", "hidden"].includes(k))
  )
    throw new Error("Capa o cambio inválido");
  if (
    patch.name !== undefined &&
    (typeof patch.name !== "string" ||
      patch.name.length > 80 ||
      /[\x00-\x1f\x7f]/.test(patch.name))
  )
    throw new Error("Nombre de capa inválido");
  if (patch.hidden !== undefined && typeof patch.hidden !== "boolean")
    throw new Error("Visibilidad inválida");
  const pdf = await PDFDocument.load(await fs.readFile(file)),
    existing = ownedAnnotations(pdf);
  const rows = [...existing.values()].filter(
    (a) =>
      !["highlight", "underline"].includes(a.kind) &&
      (scope === "group" ? a.groupId === id : a.id === id),
  );
  if (!rows.length || rows.length > 500)
    throw new Error("Capa no encontrada o grupo demasiado grande");
  const lockedGroups = new Set(
    [...existing.values()]
      .filter((a) => a.locked && a.groupId)
      .map((a) => a.groupId),
  );
  if (
    patch.name !== undefined &&
    rows.some((a) => a.locked || (a.groupId && lockedGroups.has(a.groupId)))
  )
    throw new Error("Desbloquea la capa antes de renombrarla");
  const updates = rows.map((a) => ({
    ...a,
    ...(patch.name !== undefined
      ? scope === "group"
        ? { groupName: patch.name.trim() || undefined }
        : { name: patch.name.trim() || undefined }
      : {}),
    ...(patch.hidden !== undefined
      ? scope === "group"
        ? { groupHidden: patch.hidden }
        : { hidden: patch.hidden }
      : {}),
  }));
  const changed = updates.some(
    (a, i) => JSON.stringify(a) !== JSON.stringify(rows[i]),
  );
  if (changed) {
    for (const a of updates) await updateDrawing(pdf, a, false);
    await save(file, pdf);
  }
  return { changed, annotations: updates };
}
export async function orderDrawings(
  file: string,
  ids: string[],
  action: StackAction,
) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 500 ||
    ids.some((id) => typeof id !== "string") ||
    !["front", "back", "forward", "backward"].includes(action)
  )
    throw new Error("Selección u orden inválido");
  const pdf = await PDFDocument.load(await fs.readFile(file)),
    existing = ownedAnnotations(pdf),
    wanted = new Set(ids);
  for (const id of ids) {
    const a = existing.get(id);
    if (!a || ["highlight", "underline"].includes(a.kind))
      throw new Error("Selecciona textos o figuras");
  }
  const groups = new Set(
    ids.map((id) => existing.get(id)!.groupId).filter(Boolean),
  );
  const selected = [...existing.values()].filter(
    (a) => wanted.has(a.id) || (a.groupId && groups.has(a.groupId)),
  );
  if (selected.length > 500)
    throw new Error("Puedes ordenar hasta 500 anotaciones a la vez");
  if (selected.some((a) => a.locked))
    throw new Error(
      "Hay elementos bloqueados. Desbloquéalos antes de cambiar su orden.",
    );
  const selectedIds = new Set(selected.map((a) => a.id));
  let changed = false;
  for (const page of pdf.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) continue;
    const original = annots.asArray();
    const editable = original
      .map((ref, index) => ({
        ref,
        index,
        data: decode(pdf.context.lookup(ref, PDFDict), pdf.getPageCount()),
      }))
      .filter(
        (row) =>
          row.data && !["highlight", "underline"].includes(row.data.kind),
      );
    if (!editable.some((row) => selectedIds.has(row.data!.id))) continue;
    const grouped = new Map<
      string,
      { members: typeof editable; last: number; selected: boolean }
    >();
    for (const row of editable) {
      const a = row.data!,
        key = a.groupId ? `group:${a.groupId}` : `item:${a.id}`,
        unit = grouped.get(key) || { members: [], last: 0, selected: false };
      unit.members.push(row);
      unit.last = row.index;
      unit.selected ||= selectedIds.has(a.id);
      grouped.set(key, unit);
    }
    const units = [...grouped.values()].sort((a, b) => a.last - b.last);
    const reordered = reorderStack(units, action).flatMap((unit) =>
      unit.members.map((row) => row.ref),
    );
    const slots = new Set(editable.map((row) => row.index));
    let index = 0;
    const result = original.map((ref, i) =>
      slots.has(i) ? reordered[index++] : ref,
    );
    if (result.some((ref, i) => ref !== original[i])) {
      page.node.set(PDFName.of("Annots"), pdf.context.obj(result));
      changed = true;
    }
  }
  if (changed) await save(file, pdf);
  return { changed, annotations: [...ownedAnnotations(pdf).values()] };
}
async function updateDrawing(
  pdf: PDFDocument,
  input: DrawingAnnotation,
  remove: boolean,
  fitText = false,
) {
  valid(input, pdf.getPageCount());
  const a: DrawingAnnotation = { ...input, lines: undefined };
  let previousIndex: number | undefined;
  for (const page of pdf.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const existing = annots.lookup(i, PDFDict),
        data = decode(existing, pdf.getPageCount());
      if (data?.id === a.id) {
        if (page === pdf.getPage(a.page - 1)) previousIndex = i;
        annots.remove(i);
      }
    }
  }
  if (remove) {
    return a;
  }
  const page = pdf.getPage(a.page - 1),
    all =
      (a.kind === "highlight" || a.kind === "underline"
        ? a.rects
        : undefined
      )?.flatMap((r) => [
        [r[0], r[1]],
        [r[2], r[3]],
      ]) || a.points;
  let [x1, y1, x2, y2] = [
    Math.min(...all.map((p) => p[0])),
    Math.min(...all.map((p) => p[1])),
    Math.max(...all.map((p) => p[0])),
    Math.max(...all.map((p) => p[1])),
  ];
  if (
    (a.kind === "text" ||
      ["rectangle", "square", "ellipse"].includes(a.kind)) &&
    (x2 - x1 < 4 || y2 - y1 < 4)
  )
    throw new Error("El cuadro es demasiado pequeño");
  const num = (n: number) => Number(n.toFixed(3)).toString(),
    rgb = (c: string) =>
      [1, 3, 5]
        .map((i) => num(parseInt(c.slice(i, i + 2), 16) / 255))
        .join(" ");
  const dash =
    a.lineStyle === "dashed"
      ? [a.width * 4, a.width * 2]
      : a.lineStyle === "dotted"
        ? [a.width, a.width * 2]
        : [];
  const commands = [
    "q",
    `${rgb(a.color)} RG`,
    `${rgb(a.color)} rg`,
    `${num(a.width)} w`,
    "1 J",
    "1 j",
    `[${dash.map(num).join(" ")}] 0 d`,
  ];
  let font;
  const resources: any = {};
  const line = (p: number[], q: number[]) =>
    `${num(p[0])} ${num(p[1])} m ${num(q[0])} ${num(q[1])} l S`;
  if (a.kind === "highlight") {
    resources.ExtGState = { GS0: { Type: "ExtGState", ca: 0.35, CA: 0.35 } };
    commands.push("/GS0 gs");
    for (const r of a.rects!)
      commands.push(
        `${num(r[0])} ${num(r[1])} ${num(r[2] - r[0])} ${num(r[3] - r[1])} re`,
      );
    // Paint once so overlapping selection rectangles cannot stack opacity.
    commands.push("f");
  } else if (a.kind === "underline") {
    for (const r of a.rects!) commands.push(line([r[0], r[1]], [r[2], r[1]]));
  } else if (a.kind === "rectangle" || a.kind === "square")
    commands.push(`${num(x1)} ${num(y1)} ${num(x2 - x1)} ${num(y2 - y1)} re S`);
  else if (a.kind === "ellipse") {
    const cx = (x1 + x2) / 2,
      cy = (y1 + y2) / 2,
      rx = (x2 - x1) / 2,
      ry = (y2 - y1) / 2,
      k = 0.55228475;
    commands.push(
      `${num(cx + rx)} ${num(cy)} m`,
      `${num(cx + rx)} ${num(cy + ry * k)} ${num(cx + rx * k)} ${num(cy + ry)} ${num(cx)} ${num(cy + ry)} c`,
      `${num(cx - rx * k)} ${num(cy + ry)} ${num(cx - rx)} ${num(cy + ry * k)} ${num(cx - rx)} ${num(cy)} c`,
      `${num(cx - rx)} ${num(cy - ry * k)} ${num(cx - rx * k)} ${num(cy - ry)} ${num(cx)} ${num(cy - ry)} c`,
      `${num(cx + rx * k)} ${num(cy - ry)} ${num(cx + rx)} ${num(cy - ry * k)} ${num(cx + rx)} ${num(cy)} c S`,
    );
  } else if (a.kind === "line" || a.kind === "arrow") {
    const start = a.points[0],
      end = a.points.at(-1)!;
    commands.push(line(start, end));
    if (a.kind === "arrow") {
      const angle = Math.atan2(end[1] - start[1], end[0] - start[0]),
        length = Math.max(8, a.width * 5);
      for (const delta of [-0.45, 0.45])
        commands.push(
          line(end, [
            end[0] - length * Math.cos(angle + delta),
            end[1] - length * Math.sin(angle + delta),
          ]),
        );
    }
  } else if (a.kind === "ink")
    commands.push(
      a.points
        .map((p, i) => `${num(p[0])} ${num(p[1])} ${i ? "l" : "m"}`)
        .join(" ") + " S",
    );
  else if (a.kind === "text") {
    const fonts = {
      sans: StandardFonts.Helvetica,
      serif: StandardFonts.TimesRoman,
      mono: StandardFonts.Courier,
    };
    font = await pdf.embedFont(fonts[a.fontFamily]);
    resources.Font = { F0: font.ref };
    const lines: string[] = [];
    for (const paragraph of a.text.split("\n")) {
      let current = "";
      const words: string[] = [];
      for (const word of paragraph.split(/\s+/)) {
        if (!fitText) { words.push(word); continue; }
        let chunk = "";
        for (const char of word) {
          if (font.widthOfTextAtSize(chunk + char, a.fontSize) > x2 - x1 - 8 && chunk) {
            words.push(chunk); chunk = "";
          }
          chunk += char;
        }
        words.push(chunk);
      }
      for (const word of words) {
        if (font.widthOfTextAtSize(word, a.fontSize) > x2 - x1 - 8)
          throw new Error(
            "Una palabra no cabe: amplía el cuadro o reduce el tamaño",
          );
        const next = current ? current + " " + word : word;
        if (font.widthOfTextAtSize(next, a.fontSize) > x2 - x1 - 8) {
          lines.push(current);
          current = word;
        } else current = next;
      }
      lines.push(current);
    }
    if (fitText && lines.length * a.fontSize * 1.25 > y2 - y1 - 6) {
      const bottom = y2 - lines.length * a.fontSize * 1.25 - 6;
      if (bottom < page.getCropBox().y)
        throw new Error("El texto supera el final de la página. Mueve o amplía el cuadro.");
      y1 = bottom;
      a.points = [[x1, y2], [x2, y1]];
    }
    if (lines.length * a.fontSize * 1.25 > y2 - y1 - 6 + 0.01)
      throw new Error("El texto no cabe. Amplía el cuadro o reduce el tamaño.");
    a.lines = lines;
    if (a.border)
      commands.push(
        `${rgb(a.borderColor)} RG`,
        `${num(x1)} ${num(y1)} ${num(x2 - x1)} ${num(y2 - y1)} re S`,
      );
    lines.forEach((text, i) =>
      commands.push(
        `BT /F0 ${num(a.fontSize)} Tf ${num(x1 + 4)} ${num(y2 - a.fontSize - 3 - i * a.fontSize * 1.25)} Td ${font!.encodeText(text).toString()} Tj ET`,
      ),
    );
  }
  commands.push("Q");
  const pad = a.width * 6,
    bounds = [x1 - pad, y1 - pad, x2 + pad, y2 + pad];
  const appearance = pdf.context.register(
    pdf.context.flateStream(commands.join("\n"), {
      Type: "XObject",
      Subtype: "Form",
      BBox: bounds,
      Resources: resources,
    }),
  );
  const subtype = {
    highlight: "Highlight",
    underline: "Underline",
    text: "FreeText",
    rectangle: "Square",
    square: "Square",
    ellipse: "Circle",
    line: "Line",
    arrow: "Line",
    ink: "Ink",
  }[a.kind];
  const spec: any = {
    Type: "Annot",
    Subtype: subtype,
    Rect: bounds,
    F: 4 | (a.locked ? 128 | 512 : 0) | (isAnnotationHidden(a) ? 2 : 0),
    NM: PDFString.of(a.id),
    T: PDFString.of("MagicPDF"),
    Contents: PDFHexString.fromText(a.text),
    MagicPDFData: PDFHexString.fromText(JSON.stringify(a)),
    C: [1, 3, 5].map((i) => parseInt(a.color.slice(i, i + 2), 16) / 255),
    AP: { N: appearance },
    BS: { W: a.width, S: dash.length ? "D" : "S", D: dash },
  };
  if (a.rects)
    spec.QuadPoints = a.rects.flatMap(([x, y, xx, yy]) => [
      x,
      yy,
      xx,
      yy,
      x,
      y,
      xx,
      y,
    ]);
  if (a.kind === "line" || a.kind === "arrow") {
    spec.L = [...a.points[0], ...a.points.at(-1)!];
    if (a.kind === "arrow") spec.LE = ["None", "OpenArrow"];
  }
  if (a.kind === "ink") spec.InkList = [a.points.flat()];
  if (a.kind === "text")
    spec.DA = PDFString.of(`/F0 ${a.fontSize} Tf ${rgb(a.color)} rg`);
  let annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (!annots) {
    annots = pdf.context.obj([]);
    page.node.set(PDFName.of("Annots"), annots);
  }
  const ref = pdf.context.register(pdf.context.obj(spec));
  if (previousIndex !== undefined)
    annots.insert(Math.min(previousIndex, annots.size()), ref);
  else annots.push(ref);
  return a;
}
const scenes = new Map<
  string,
  Promise<{ annotations: DrawingAnnotation[]; bytes: Uint8Array | null }>
>();
export async function readerScene(file: string) {
  const stat = await fs.stat(file),
    cacheKey = `${file}:${stat.mtimeMs}:${stat.size}`;
  const cached = scenes.get(cacheKey);
  if (cached) return cached;
  const task = (async () => {
    const bytes = await fs.readFile(file);
    let pdf;
    try {
      pdf = await PDFDocument.load(bytes);
    } catch {
      return { annotations: [], bytes: null };
    }
    const annotations: DrawingAnnotation[] = [];
    for (const page of pdf.getPages()) {
      const pageAnnotations: DrawingAnnotation[] = [];
      const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
      if (!annots) continue;
      for (let i = annots.size() - 1; i >= 0; i--) {
        const data = decode(annots.lookup(i, PDFDict), pdf.getPageCount());
        if (data) {
          pageAnnotations.unshift(data);
          annots.remove(i);
        }
      }
      annotations.push(...pageAnnotations);
    }
    return { annotations, bytes: annotations.length ? await pdf.save() : null };
  })();
  if (stat.size < 32 * 1024 * 1024) {
    scenes.set(cacheKey, task);
    if (scenes.size > 2) scenes.delete(scenes.keys().next().value!);
    task.catch(() => scenes.delete(cacheKey));
  }
  return task;
}
