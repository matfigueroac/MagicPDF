import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import { isAnnotationHidden } from "../api/annotationLayers";
import type { DrawingAnnotation } from "../types/annotations";

type Drag = {
  page: number;
  originX: number;
  originY: number;
  rect: DOMRect;
  previous: DrawingAnnotation[];
  element: HTMLElement;
  pointerId: number;
};

type Options = {
  viewer: PDFViewer | null;
  annotations: DrawingAnnotation[];
  selectedRows: DrawingAnnotation[];
  blocked: () => boolean;
  selectRows: (rows: DrawingAnnotation[]) => void;
};

function dragBounds(drag: Drag, event: PointerEvent) {
  const x = event.clientX - drag.rect.left;
  const y = event.clientY - drag.rect.top;
  return {
    page: drag.page,
    x: Math.min(x, drag.originX),
    y: Math.min(y, drag.originY),
    w: Math.abs(x - drag.originX),
    h: Math.abs(y - drag.originY),
  };
}

export function useAnnotationMarquee({
  viewer, annotations, selectedRows, blocked, selectRows,
}: Options) {
  const drag = useRef<Drag | null>(null);
  const [marquee, setMarquee] = useState<ReturnType<typeof dragBounds> | null>(null);

  const releaseDrag = useCallback(() => {
    const active = drag.current;
    drag.current = null;
    if (active?.element.hasPointerCapture(active.pointerId))
      active.element.releasePointerCapture(active.pointerId);
  }, []);
  const cancelMarquee = useCallback(() => {
    releaseDrag();
    setMarquee(null);
  }, [releaseDrag]);

  const start = useEffectEvent((event: PointerEvent) => {
    const target = event.target;
    if (
      !(target instanceof Element) ||
      event.button !== 0 ||
      event.pointerType !== "mouse" ||
      drag.current ||
      blocked() ||
      target.closest(
        "[data-annotation-id],.annotationLayer,.textLayer span,input,button,a,[contenteditable]",
      )
    )
      return;
    const element = target.closest<HTMLElement>(".reader .page");
    const svg = element?.querySelector<SVGSVGElement>(".annotation-overlay");
    if (!element || !svg) return;
    const page = Number(element.dataset.pageNumber);
    if (viewer?.getPageView(page - 1)?.div !== element) return;

    event.preventDefault();
    element.tabIndex = -1;
    element.focus({ preventScroll: true });
    window.getSelection()?.removeAllRanges();
    const rect = svg.getBoundingClientRect();
    drag.current = {
      page,
      originX: event.clientX - rect.left,
      originY: event.clientY - rect.top,
      rect,
      previous: event.ctrlKey || event.metaKey ? selectedRows : [],
      element,
      pointerId: event.pointerId,
    };
    element.setPointerCapture(event.pointerId);
  });

  const finish = useEffectEvent((event: PointerEvent) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    cancelMarquee();
    const { x, y, w, h } = dragBounds(active, event);
    if (Math.hypot(w, h) < 4) {
      selectRows(active.previous);
      return;
    }
    const viewport = viewer?.getPageView(active.page - 1)?.viewport;
    if (!viewport) return;
    const rows = annotations.filter((a) => {
      if (
        a.page !== active.page ||
        isAnnotationHidden(a) ||
        a.kind === "highlight" ||
        a.kind === "underline"
      )
        return false;
      const points = a.points.map(([px, py]) => viewport.convertToViewportPoint(px, py));
      return (
        Math.max(...points.map(([px]) => px)) >= x &&
        Math.min(...points.map(([px]) => px)) <= x + w &&
        Math.max(...points.map(([, py]) => py)) >= y &&
        Math.min(...points.map(([, py]) => py)) <= y + h
      );
    });
    const combined = new Map([...active.previous, ...rows].map((a) => [a.id, a]));
    selectRows([...combined.values()]);
  });

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const active = drag.current;
      if (!active || active.pointerId !== event.pointerId) return;
      event.preventDefault();
      setMarquee(dragBounds(active, event));
    };
    const cancel = (event: PointerEvent) => {
      if (drag.current?.pointerId === event.pointerId) cancelMarquee();
    };
    document.addEventListener("pointerdown", start);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("lostpointercapture", cancel);
    return () => {
      document.removeEventListener("pointerdown", start);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("lostpointercapture", cancel);
      releaseDrag();
    };
  }, [cancelMarquee, releaseDrag]);

  return { marquee, cancelMarquee, isMarqueeActive: () => drag.current !== null };
}
