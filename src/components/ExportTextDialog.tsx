import { useEffect, useRef, useState } from "react";
import { Copy, Download, X } from "lucide-react";

export function ExportTextDialog({ name, text, onClose }: { name: string; text: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => {
      element.close();
      document.querySelector<HTMLElement>('.workspace-menu summary[aria-label="Inicio"]')?.focus();
    };
  }, []);

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Texto copiado.");
    } catch {
      setMessage("No se pudo copiar. Selecciona el texto y pulsa Ctrl+C.");
    }
  }

  function downloadText() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${name.replace(/\.pdf$/i, "")}.txt`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <dialog ref={dialog} aria-labelledby="export-heading" onCancel={event => { event.preventDefault(); onClose(); }}
      className="m-auto w-[min(42rem,90vw)] max-h-[85vh] rounded-xl border border-gray-300 bg-white p-5 text-gray-900 shadow-xl backdrop:bg-black/60 dark:border-magic-border dark:bg-magic-card dark:text-gray-100">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="export-heading" className="min-w-0 break-words font-semibold">Texto de {name}</h2>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded p-2"><X size={17} /></button>
      </div>
      <textarea aria-label="Texto extraído" readOnly value={text}
        className="h-[min(20rem,45vh)] w-full resize-none rounded-lg border border-gray-300 bg-gray-50 p-3 text-sm dark:border-magic-border dark:bg-magic-bg" />
      <p role="status" className="my-2 text-sm">{message}</p>
      <div className="flex justify-end gap-2 text-sm">
        <button type="button" onClick={copyText} className="flex items-center gap-2 rounded-lg border border-gray-400 px-3 py-2"><Copy size={15} />Copiar texto</button>
        <button type="button" onClick={downloadText} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-white"><Download size={15} />Descargar .txt</button>
      </div>
    </dialog>
  );
}
