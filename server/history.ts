import fs from "node:fs";
import path from "node:path";
import type { RequestHandler } from "express";
const { replaceFile } = require('../electron/atomic-save.cjs');
type Snapshot = { bytes: Buffer; time: number };
const histories = new Map<
  string,
  { undo: Snapshot[]; redo: Snapshot[]; limited: boolean }
>();
const locks = new Set<string>();
export async function withDocumentLock<T>(name: string, operation: () => Promise<T>) {
  if (locks.has(name)) throw new Error('Hay otra operación en este documento. Espera a que termine.');
  locks.add(name);
  try { return await operation(); }
  finally { locks.delete(name); }
}
const limit = 128 * 1024 * 1024;
const operations = new Set([
  'drawing',
  'drawing-batch',
  'annotation-lock',
  'annotation-order',
  'annotation-layer',
  "highlight",
  "edit-text",
  "image-edit",
  "add-text",
  "organize",
  "sign",
  "redact",
  "protect",
  "compress",
  "watermark",
  "forms",
  "layout",
  "ocr",
]);
function state(name: string) {
  if (!histories.has(name))
    histories.set(name, { undo: [], redo: [], limited: false });
  return histories.get(name)!;
}
function trim() {
  let all = [...histories.values()].flatMap((h) => [...h.undo, ...h.redo]);
  let bytes = all.reduce((n, s) => n + s.bytes.length, 0);
  while (bytes > limit && all.length) {
    const oldest = all.reduce((a, b) => (a.time < b.time ? a : b));
    for (const h of histories.values())
      for (const stack of [h.undo, h.redo]) {
        const i = stack.indexOf(oldest);
        if (i >= 0) stack.splice(i, 1);
      }
    bytes -= oldest.bytes.length;
    all = all.filter((s) => s !== oldest);
  }
}
export function historyStatus(name: string) {
  const h = state(name);
  return {
    undo: h.undo.length,
    redo: h.redo.length,
    limited: h.limited,
    limitMiB: 128,
  };
}
export function transactionMiddleware(directory: string): RequestHandler {
  return async (req, res, next) => {
    const operation = req.path.replace("/api/", "");
    if (
      req.method !== "POST" ||
      (!operations.has(operation) && !operation.startsWith("history/"))
    )
      return next();
    const name = req.body?.filename;
    if (
      typeof name !== "string" ||
      name !== path.basename(name) ||
      /[\\/]/.test(name)
    )
      return void res.status(400).json({ error: "Archivo inválido" });
    if (locks.has(name))
      return void res
        .status(409)
        .json({
          error: "Hay otra operación en este documento. Espera a que termine.",
        });
    locks.add(name);
    let before: Buffer | undefined;
    try {
      const file = path.join(directory, name);
      const stat = await fs.promises.stat(file);
      if (stat.size <= 64 * 1024 * 1024 && !operation.startsWith("history/"))
        before = await fs.promises.readFile(file);
    } catch {
      locks.delete(name);
      return void res.status(404).json({ error: "Documento no encontrado" });
    }
    const send = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (!operation.startsWith("history/") && res.statusCode < 400 && !(['annotation-order','annotation-layer'].includes(operation)&&(body as {changed?:boolean})?.changed===false)) {
        const h = state(name);
        h.redo = [];
        h.limited = !before;
        if (before) h.undo.push({ bytes: before, time: Date.now() });
        else h.undo = [];
        while (h.undo.length > 20) h.undo.shift();
        trim();
      }
      locks.delete(name);
      return send(body);
    }) as typeof res.json;
    next();
  };
}
export async function restoreHistory(
  directory: string,
  name: string,
  direction: "undo" | "redo",
) {
  const h = state(name),
    from = h[direction],
    to = h[direction === "undo" ? "redo" : "undo"];
  const snapshot = from.at(-1);
  if (!snapshot)
    throw new Error(
      "No hay cambios para " + (direction === "undo" ? "deshacer" : "rehacer"),
    );
  const file = path.join(directory, name),
    current = await fs.promises.readFile(file),
    temporary = file + ".history-writing";
  try {
    await fs.promises.writeFile(temporary, snapshot.bytes);
    await replaceFile(temporary, file);
  } finally {
    await fs.promises.rm(temporary, { force: true });
  }
  from.pop();
  to.push({ bytes: current, time: Date.now() });
  trim();
}
