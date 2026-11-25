import type { DrawingAnnotation } from "../types/annotations";

export type StackAction = "front" | "back" | "forward" | "backward";
export function reorderStack<T extends { selected: boolean }>(
  items: T[],
  action: StackAction,
): T[] {
  if (action === "front")
    return [
      ...items.filter((a) => !a.selected),
      ...items.filter((a) => a.selected),
    ];
  if (action === "back")
    return [
      ...items.filter((a) => a.selected),
      ...items.filter((a) => !a.selected),
    ];
  const ordered = [...items];
  if (action === "forward")
    for (let i = ordered.length - 2; i >= 0; i--) {
      if (ordered[i].selected && !ordered[i + 1].selected)
        [ordered[i], ordered[i + 1]] = [ordered[i + 1], ordered[i]];
    }
  if (action === "backward")
    for (let i = 1; i < ordered.length; i++) {
      if (ordered[i].selected && !ordered[i - 1].selected)
        [ordered[i], ordered[i - 1]] = [ordered[i - 1], ordered[i]];
    }
  return ordered;
}

export function mergeAnnotations(
  current: DrawingAnnotation[],
  updates: DrawingAnnotation[],
  remove = false,
) {
  const changes = new Map(updates.map((a) => [a.id, a])),
    known = new Set(current.map((a) => a.id));
  return remove
    ? current.filter((a) => !changes.has(a.id))
    : [
        ...current.map((a) => changes.get(a.id) || a),
        ...updates.filter((a) => !known.has(a.id)),
      ];
}
export function restoreAnnotations(
  current: DrawingAnnotation[],
  previous: DrawingAnnotation[],
  ids: Set<string>,
) {
  const baseline = new Map(previous.map((a) => [a.id, a])),
    values = new Map(current.map((a) => [a.id, a]));
  for (const id of ids) {
    const old = baseline.get(id);
    if (old) values.set(id, old);
    else values.delete(id);
  }
  return [
    ...previous.filter((a) => values.has(a.id)).map((a) => values.get(a.id)!),
    ...current.filter((a) => !baseline.has(a.id) && values.has(a.id)),
  ];
}
