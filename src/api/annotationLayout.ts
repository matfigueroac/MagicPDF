import type { DrawingAnnotation } from "../types/annotations";

export type LayoutAction =
  "left" | "center" | "right" | "horizontal" | "vertical";
type Viewport = {
  convertToViewportPoint(x: number, y: number): number[];
  convertToPdfPoint(x: number, y: number): number[];
};

export function layoutSelection(
  rows: DrawingAnnotation[],
  action: LayoutAction,
  viewport: Viewport,
) {
  if (rows.length < 2 || new Set(rows.map((a) => a.page)).size !== 1)
    throw new Error("Selecciona al menos dos elementos de una misma página.");
  const entries = rows.map((a) => {
    const points = a.points.map(([x, y]) =>
      viewport.convertToViewportPoint(x, y),
    );
    const left = Math.min(...points.map((p) => p[0])),
      right = Math.max(...points.map((p) => p[0]));
    const top = Math.min(...points.map((p) => p[1])),
      bottom = Math.max(...points.map((p) => p[1]));
    return { a, points, left, right, top, bottom, dx: 0, dy: 0 };
  });
  const grouped = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key = entry.a.groupId
      ? `group:${entry.a.groupId}`
      : `item:${entry.a.id}`;
    const members = grouped.get(key) || [];
    members.push(entry);
    grouped.set(key, members);
  }
  const boxes = [...grouped].map(([key, members]) => ({
    key,
    left: Math.min(...members.map((b) => b.left)),
    right: Math.max(...members.map((b) => b.right)),
    top: Math.min(...members.map((b) => b.top)),
    bottom: Math.max(...members.map((b) => b.bottom)),
    dx: 0,
    dy: 0,
  }));
  if (boxes.length < 2)
    throw new Error("Selecciona al menos dos elementos o grupos para alinear.");
  const left = Math.min(...boxes.map((b) => b.left)),
    right = Math.max(...boxes.map((b) => b.right));
  if (action === "left" || action === "center" || action === "right") {
    for (const b of boxes)
      b.dx =
        action === "left"
          ? left - b.left
          : action === "right"
            ? right - b.right
            : (left + right - b.left - b.right) / 2;
  } else {
    if (boxes.length < 3)
      throw new Error(
        "Selecciona al menos tres elementos o grupos para distribuir.",
      );
    const horizontal = action === "horizontal";
    const ordered = [...boxes].sort((a, b) =>
      horizontal ? a.left - b.left : a.top - b.top,
    );
    const start = Math.min(...boxes.map((b) => (horizontal ? b.left : b.top)));
    const end = Math.max(
      ...boxes.map((b) => (horizontal ? b.right : b.bottom)),
    );
    const total = boxes.reduce(
      (sum, b) => sum + (horizontal ? b.right - b.left : b.bottom - b.top),
      0,
    );
    const gap = (end - start - total) / (boxes.length - 1);
    // A negative gap is uniform overlap; compact selections can still be
    // distributed without requiring the user to separate items first.
    let cursor = start;
    for (const b of ordered) {
      if (horizontal) b.dx = cursor - b.left;
      else b.dy = cursor - b.top;
      cursor +=
        (horizontal ? b.right - b.left : b.bottom - b.top) + gap;
    }
  }
  const units = new Map(boxes.map((b) => [b.key, b]));
  return entries.map(({ a, points }) => {
    const { dx, dy } = units.get(
      a.groupId ? `group:${a.groupId}` : `item:${a.id}`,
    )!;
    return {
      ...a,
      points: points.map(([x, y]) =>
        viewport.convertToPdfPoint(x + dx, y + dy),
      ),
    };
  });
}
