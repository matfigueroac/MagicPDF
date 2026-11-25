import fs from "node:fs/promises";
import path from "node:path";
import { createWorker } from "tesseract.js";
import {
  PDFDocument,
  StandardFonts,
  TextRenderingMode,
  setTextRenderingMode,
  degrees,
} from "pdf-lib";
import { renderPage, getPageLines } from "./pdfcraft.js";
let running = false;
export async function recognizePdf(
  file: string,
  pageNumbers: number[],
  language: string,
  progress: (message: string) => void,
) {
  if (running) throw new Error("Ya hay un OCR en curso. Espera a que termine.");
  if (
    !["spa", "eng", "spa+eng"].includes(language) ||
    !Array.isArray(pageNumbers) ||
    !pageNumbers.length ||
    pageNumbers.length > 20
  )
    throw new Error("Selecciona de 1 a 20 páginas e idioma español o inglés.");
  running = true;
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  try {
    const pdf = await PDFDocument.load(await fs.readFile(file));
    if (
      pageNumbers.some(
        (n) => !Number.isInteger(n) || n < 1 || n > pdf.getPageCount(),
      ) ||
      new Set(pageNumbers).size !== pageNumbers.length
    )
      throw new Error("Rango de páginas inválido");
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const langPath =
      process.resourcesPath && !process.defaultApp
        ? path.join(process.resourcesPath, "ocr")
        : path.resolve(__dirname, "../dist-ocr");
    const workerPath = path.join(langPath, "worker.cjs");
    progress("Preparando reconocimiento local…");
    worker = await createWorker(language, 1, {
      workerPath,
      langPath,
      cacheMethod: "none",
      gzip: true,
    });
    const results: Array<{ page: number; text: string; confidence: number }> =
      [];
    for (const number of pageNumbers) {
      progress(
        `Reconociendo página ${number} (${results.length + 1}/${pageNumbers.length})…`,
      );
      const existing = await getPageLines(file, number);
      if (existing.some((line) => line.text.trim())) {
        results.push({
          page: number,
          text: "Página omitida: ya contiene texto seleccionable.",
          confidence: 100,
        });
        continue;
      }
      const image = await renderPage(file, number, 200);
      const page = pdf.getPage(number - 1),
        box = page.getCropBox(),
        rotation = ((page.getRotation().angle % 360) + 360) % 360;
      const imageBytes = await fs.readFile(image),
        pixelWidth = imageBytes.readUInt32BE(16),
        pixelHeight = imageBytes.readUInt32BE(20);
      if (pixelWidth * pixelHeight > 20000000)
        throw new Error(
          "Esta página es demasiado grande para el OCR de Pro Lite. Reduce su tamaño antes de continuar.",
        );
      const { data } = await worker.recognize(
        image,
        {},
        { text: true, blocks: true },
      );
      const viewWidth = rotation % 180 ? box.height : box.width,
        viewHeight = rotation % 180 ? box.width : box.height;
      const convert = (u: number, v: number) => {
        const x = (u / pixelWidth) * viewWidth,
          y = (v / pixelHeight) * viewHeight;
        return rotation === 90
          ? [box.x + y, box.y + x]
          : rotation === 180
            ? [box.x + box.width - x, box.y + y]
            : rotation === 270
              ? [box.x + box.width - y, box.y + box.height - x]
              : [box.x + x, box.y + box.height - y];
      };
      page.pushOperators(setTextRenderingMode(TextRenderingMode.Invisible));
      for (const block of data.blocks || [])
        for (const paragraph of block.paragraphs)
          for (const line of paragraph.lines)
            for (const word of line.words) {
              const text = Array.from(word.text)
                .filter((c) => {
                  try {
                    font.encodeText(c);
                    return true;
                  } catch {
                    return false;
                  }
                })
                .join("");
              if (!text.trim()) continue;
              const [x, y] = convert(word.bbox.x0, word.bbox.y1),
                size = Math.max(
                  3,
                  ((word.bbox.y1 - word.bbox.y0) / pixelHeight) * viewHeight,
                );
              page.drawText(text, {
                x,
                y,
                font,
                size,
                rotate: degrees(rotation),
              });
            }
      page.pushOperators(setTextRenderingMode(TextRenderingMode.Fill));
      results.push({
        page: number,
        text: data.text,
        confidence: data.confidence,
      });
    }
    const temporary = file + ".ocr-writing";
    try {
      await fs.writeFile(temporary, await pdf.save());
      await fs.rename(temporary, file);
    } finally {
      await fs.rm(temporary, { force: true });
    }
    return results;
  } finally {
    if (worker) await worker.terminate();
    running = false;
  }
}
