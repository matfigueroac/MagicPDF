import type { DrawingAnnotation } from "../types/annotations";
export type LayerScope = "item" | "group";
export type LayerPatch = { name?: string; hidden?: boolean };
export const isAnnotationHidden = (a: DrawingAnnotation) =>
  !!(a.hidden || (a.groupId && a.groupHidden));
export function layerLabel(a: DrawingAnnotation) {
  if (a.name) return a.name;
  if (a.kind === "text")
    return a.text.trim().split("\n")[0].slice(0, 40) || "Cuadro de texto";
  return (
    (
      {
        rectangle: "Rectángulo",
        square: "Cuadrado",
        ellipse: "Círculo / óvalo",
        line: "Línea",
        arrow: "Flecha",
        ink: "Dibujo libre",
        highlight: "Resaltado",
        underline: "Subrayado",
      } as Record<string, string>
    )[a.kind] || "Anotación"
  );
}
