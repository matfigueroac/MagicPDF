import { useCallback, useEffect, useRef, useState } from "react";
import { openFilePath, uploadFiles } from "../api/client";
import type { PdfDocument, ViewMode } from "../types";

type Source = string | File;

export function useDocumentOpening(onOpened: (docs: PdfDocument[], view: ViewMode) => void) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pickerView = useRef<ViewMode>("viewer");
  const initialFile = useRef<Promise<string | null> | null>(null);
  const [pending, setPending] = useState(0);
  const [openError, setOpenError] = useState("");

  const openSources = useCallback(async (sources: Source[], view: ViewMode = "viewer") => {
    if (!sources.length) return;
    setPending(count => count + 1);
    setOpenError("");
    const opened: PdfDocument[] = [];
    const failed: string[] = [];
    let storageError = "";
    try {
      for (const source of sources) {
        const name = typeof source === "string" ? source.split(/[\\/]/).pop() || source : source.name;
        try {
          if (!/\.pdf$/i.test(name)) throw new Error("formato");
          const diskPath = typeof source === "string" ? source : (source as File & { path?: string }).path;
          if (diskPath) opened.push(await openFilePath(diskPath));
          else if (typeof source !== "string") opened.push(...await uploadFiles([source]));
        } catch (error) {
          if (error instanceof Error && error.message.startsWith("El espacio de recuperación")) storageError = error.message;
          failed.push(name);
        }
      }
      if (opened.length) onOpened(opened, view);
      if (failed.length) setOpenError(storageError || `No se pudo abrir: ${failed.join(", ")}. Selecciona un PDF válido y vuelve a intentarlo.`);
    } finally {
      setPending(count => count - 1);
    }
  }, [onOpened]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    let subscribed = true;
    const unsubscribe = api.onOpenPdf(path => { void openSources([path]); });
    initialFile.current ??= api.getInitialFile();
    initialFile.current.then(path => {
      if (subscribed && path) void openSources([path]);
    }).catch(() => {
      if (subscribed) setOpenError("No se pudo leer el archivo inicial. Usa Abrir PDF para intentarlo de nuevo.");
    });
    return () => { subscribed = false; unsubscribe?.(); };
  }, [openSources]);

  async function openPicker(view: ViewMode = "viewer") {
    if (window.electronAPI?.openFileDialog) {
      try {
        const result = await window.electronAPI.openFileDialog();
        if (!result.canceled) await openSources(result.filePaths, view);
        return;
      } catch {
        // El selector HTML también funciona cuando el diálogo nativo no está disponible.
      }
    }
    pickerView.current = view;
    fileInputRef.current?.click();
  }

  function acceptSelection(input: HTMLInputElement) {
    const files = Array.from(input.files ?? []);
    input.value = "";
    void openSources(files, pickerView.current);
    pickerView.current = "viewer";
  }

  return { fileInputRef, openPicker, openSources, acceptSelection, isUploading: pending > 0,
    openError, dismissError: () => setOpenError("") };
}
