import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { DrawingAnnotation, DrawingKind } from "../types/annotations";
import {
  ANNOTATION_MIME,
  parseAnnotationSelection,
  serializeAnnotationClipboard,
} from "../api/annotationClipboard";

type Shortcuts = {
  selectedRows: DrawingAnnotation[];
  interactive: boolean;
  blocked: () => boolean;
  drawing: () => boolean;
  kindLabel: (kind: DrawingKind) => string | undefined;
  onNotice: (message: string) => void;
  insertCopies: (rows: DrawingAnnotation[], offset: number, keepPages?: boolean) => void;
  cancelSelection: () => void;
  removeSelection: () => void;
};

export function activateAnnotation(event: ReactKeyboardEvent, interactive: boolean, select: () => void) {
  if (interactive && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    select();
  }
}

export function useAnnotationShortcuts({
  selectedRows, interactive, blocked, drawing, kindLabel, onNotice,
  insertCopies, cancelSelection, removeSelection,
}: Shortcuts) {
  const pasteSequence = useRef({ raw: "", count: 0 });
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        cancelSelection();
      }
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  });
  useEffect(() => {
    const editing = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (!!target.closest("input,textarea,select") || target.isContentEditable);
    const available = () =>
      !blocked() && !drawing() &&
      !selectedRows.some(a => a.kind === "highlight" || a.kind === "underline") &&
      interactive;
    const copy = (event: ClipboardEvent) => {
      if (
        !selectedRows.length ||
        !available() ||
        editing(event.target) ||
        !window.getSelection()?.isCollapsed ||
        !event.clipboardData
      )
        return;
      const raw = serializeAnnotationClipboard(selectedRows);
      event.clipboardData.setData(ANNOTATION_MIME, raw);
      event.clipboardData.setData(
        "text/plain",
        selectedRows
          .map(
            (a) =>
              a.text ||
              kindLabel(a.kind) ||
              "Anotación MagicPDF",
          )
          .join("\n"),
      );
      event.preventDefault();
      pasteSequence.current = { raw, count: 0 };
      onNotice("Anotación copiada. Ctrl+V para pegar.");
    };
    const paste = (event: ClipboardEvent) => {
      if (!available() || editing(event.target) || !event.clipboardData) return;
      const raw = event.clipboardData.getData(ANNOTATION_MIME),
        source = parseAnnotationSelection(raw);
      if (!source) return;
      event.preventDefault();
      const count =
        pasteSequence.current.raw === raw ? pasteSequence.current.count + 1 : 1;
      pasteSequence.current = { raw, count };
      insertCopies(source, 18 * count);
    };
    const duplicate = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "d" ||
        editing(event.target) ||
        !selectedRows.length ||
        !interactive ||
        !window.getSelection()?.isCollapsed
      )
        return;
      event.preventDefault();
      if (available() && !event.repeat) insertCopies(selectedRows, 18, true);
    };
    document.addEventListener("copy", copy);
    document.addEventListener("paste", paste);
    window.addEventListener("keydown", duplicate);
    return () => {
      document.removeEventListener("copy", copy);
      document.removeEventListener("paste", paste);
      window.removeEventListener("keydown", duplicate);
    };
  });
  useEffect(() => {
    const remove = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        event.key !== "Delete" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        target.closest?.("input,textarea,select") ||
        target.isContentEditable ||
        !selectedRows.length ||
        blocked()
      )
        return;
      event.preventDefault();
      removeSelection();
    };
    window.addEventListener("keydown", remove);
    return () => window.removeEventListener("keydown", remove);
  });
}
