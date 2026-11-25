import type { DrawingAnnotation } from "../types/annotations";

export const ANNOTATION_MIME = "application/x-magicpdf-annotation+json";
export function parseAnnotationClipboard(
  raw: string,
): DrawingAnnotation | null {
  if (!raw || raw.length > 250000) return null;
  try {
    const payload = JSON.parse(raw),
      a = payload.annotation;
    if (
      payload.version !== 1 ||
      payload.type !== "magicpdf-annotation" ||
      !a ||
      ![
        "text",
        "rectangle",
        "square",
        "ellipse",
        "line",
        "arrow",
        "ink",
      ].includes(a.kind) ||
      !Array.isArray(a.points) ||
      a.points.length < 2 ||
      a.points.length > 2048 ||
      a.points.some(
        (point: unknown) =>
          !Array.isArray(point) ||
          point.length !== 2 ||
          point.some(
            (n) =>
              typeof n !== "number" ||
              !Number.isFinite(n) ||
              Math.abs(n) > 100000,
          ),
      ) ||
      typeof a.color !== "string" ||
      !/^#[a-f0-9]{6}$/i.test(a.color) ||
      typeof a.borderColor !== "string" ||
      !/^#[a-f0-9]{6}$/i.test(a.borderColor) ||
      !Number.isFinite(a.width) ||
      a.width < 0.5 ||
      a.width > 12 ||
      !["solid", "dashed", "dotted"].includes(a.lineStyle) ||
      typeof a.text !== "string" ||
      a.text.length > 20000 ||
      !Number.isFinite(a.fontSize) ||
      a.fontSize < 6 ||
      a.fontSize > 96 ||
      !["sans", "serif", "mono"].includes(a.fontFamily) ||
      typeof a.border !== "boolean" ||
      (a.locked !== undefined && typeof a.locked !== "boolean") ||
      [a.name, a.groupName].some(
        (v) =>
          v !== undefined &&
          (typeof v !== "string" || v.length > 80 || /[\x00-\x1f\x7f]/.test(v)),
      ) ||
      [a.hidden, a.groupHidden].some(
        (v) => v !== undefined && typeof v !== "boolean",
      ) ||
      (a.groupId !== undefined &&
        (typeof a.groupId !== "string" ||
          !/^magicpdf-group-[\w-]{8,80}$/.test(a.groupId)))
    )
      return null;
    return {
      id: "",
      page: Number.isInteger(a.page) && a.page > 0 ? a.page : 1,
      kind: a.kind,
      points: a.points.map((point: number[]) => [...point]),
      color: a.color,
      width: a.width,
      lineStyle: a.lineStyle,
      text: a.text,
      fontSize: a.fontSize,
      fontFamily: a.fontFamily,
      border: a.border,
      borderColor: a.borderColor,
      groupId: a.groupId,
      locked: a.locked,
      name: a.name,
      groupName: a.groupName,
      hidden: a.hidden,
      groupHidden: a.groupHidden,
    };
  } catch {
    return null;
  }
}

export function parseAnnotationSelection(
  raw: string,
): DrawingAnnotation[] | null {
  if (!raw || raw.length > 2000000) return null;
  try {
    const payload = JSON.parse(raw);
    if (payload.version === 1) {
      const a = parseAnnotationClipboard(raw);
      return a ? [a] : null;
    }
    if (
      payload.type !== "magicpdf-annotation" ||
      payload.version !== 2 ||
      !Array.isArray(payload.annotations) ||
      !payload.annotations.length ||
      payload.annotations.length > 500
    )
      return null;
    const rows = payload.annotations.map((annotation: unknown) =>
      parseAnnotationClipboard(
        JSON.stringify({ type: "magicpdf-annotation", version: 1, annotation }),
      ),
    );
    return rows.every((a: DrawingAnnotation | null) => a !== null)
      ? rows
      : null;
  } catch {
    return null;
  }
}
export function serializeAnnotationClipboard(
  annotation: DrawingAnnotation | DrawingAnnotation[],
) {
  if (Array.isArray(annotation)) {
    if (annotation.length === 1)
      return serializeAnnotationClipboard(annotation[0]);
    return JSON.stringify({
      type: "magicpdf-annotation",
      version: 2,
      annotations: annotation,
    });
  }
  return JSON.stringify({
    type: "magicpdf-annotation",
    version: 1,
    annotation,
  });
}
