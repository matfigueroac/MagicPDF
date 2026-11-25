import { useLayoutEffect, useRef } from "react";
import type { DrawingAnnotation } from "../types/annotations";

export function InlineAnnotationText({ annotation: a, scale, onChange, onFinish, onCancel }: {
  annotation: DrawingAnnotation;
  scale: number;
  onChange: (text: string) => void;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useLayoutEffect(() => {
    const el = ref.current!;
    el.style.height = "100%";
    el.style.height = `${Math.max(el.clientHeight, el.scrollHeight + 2)}px`;
  }, [a.text, a.fontSize, scale]);
  return <textarea ref={ref} className="inline-annotation-text" aria-label="Editar texto sobre el PDF"
    placeholder="Escribe aquí…" value={a.text}
    style={{ color: a.color, fontSize: a.fontSize * scale, lineHeight: 1.25,
      padding: `${3 * scale}px ${4 * scale}px`,
      fontFamily: a.fontFamily === "serif" ? "Times New Roman" : a.fontFamily === "mono" ? "Courier New" : "Arial" }}
    onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
    onChange={(e) => onChange(e.target.value)}
    onBlur={(e) => { if (!(e.relatedTarget instanceof Element && e.relatedTarget.closest('.draw-properties,.annotation-quick-tools'))) onFinish(); }}
    onKeyDown={(e) => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onFinish(); }
    }} />;
}
