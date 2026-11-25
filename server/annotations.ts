import { writeDrawing } from "./drawings.js";
export async function addHighlight(
  file: string,
  page: number,
  rects: number[][],
  color: string,
  text: string,
  kind: "highlight" | "underline" = "highlight",
) {
  const points = rects.flatMap((r) => [
    [r[0], r[1]],
    [r[2], r[3]],
  ]);
  return writeDrawing(file, {
    id: `magicpdf-${crypto.randomUUID()}`,
    page,
    kind,
    points,
    rects,
    color,
    text,
    width: 1.5,
    lineStyle: "solid",
    fontSize: 14,
    fontFamily: "sans",
    border: false,
    borderColor: color,
  });
}
