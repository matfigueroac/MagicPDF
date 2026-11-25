import { useEffect, useState, type DragEvent } from "react";
import { ArrowRight, FilePlus2, FileText, FolderOpen, Layers, Lock, PenTool, Scissors, ShieldCheck } from "lucide-react";
import type { PdfDocument, ToolType, ViewMode } from "../types";

interface DashboardViewProps {
  onFilesSelected: (files: File[]) => void;
  documents: PdfDocument[];
  onSelectDoc: (doc: PdfDocument) => void;
  onNavigate: (mode: ViewMode, tool?: ToolType) => void;
  isUploading: boolean;
  onOpenClick: () => void;
}

const tools = [
  { title: "Editar texto e imágenes", description: "Modifica el contenido de una página.", icon: FileText, view: "editor", color: "text-blue-600 dark:text-blue-300 bg-blue-500/10" },
  { title: "Organizar páginas", description: "Reordena, gira o elimina páginas.", icon: Layers, view: "organize", color: "text-purple-700 dark:text-purple-300 bg-purple-500/10" },
  { title: "Unir documentos", description: "Combina varios PDF en un archivo.", icon: FilePlus2, view: "tools", tool: "merge", color: "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10" },
  { title: "Dividir PDF", description: "Separa páginas en varios archivos.", icon: Scissors, view: "tools", tool: "split", color: "text-amber-700 dark:text-amber-300 bg-amber-500/10" },
  { title: "Firmar documento", description: "Dibuja tu firma sobre una página.", icon: PenTool, view: "tools", tool: "sign", color: "text-rose-700 dark:text-rose-300 bg-rose-500/10" },
  { title: "Proteger con contraseña", description: "Pide una contraseña para abrir el PDF.", icon: Lock, view: "tools", tool: "protect", color: "text-cyan-700 dark:text-cyan-300 bg-cyan-500/10" },
] satisfies { title: string; description: string; icon: typeof FileText; view: ViewMode; tool?: ToolType; color: string }[];

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DashboardView({ documents, onSelectDoc, onFilesSelected, onNavigate, isUploading, onOpenClick }: DashboardViewProps) {
  const [dragging, setDragging] = useState(false);
  const [copies, setCopies] = useState<{filename:string; name:string; size:number}[]>([]);
  const [recoveryError, setRecoveryError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/workspace/recoveries', {signal:controller.signal});
        if (!response.ok) throw new Error();
        setCopies(await response.json());
        setRecoveryError("");
      } catch {
        if (!controller.signal.aborted) setRecoveryError("No se pudieron consultar las copias recuperables.");
      }
    })();
    return () => controller.abort();
  }, [documents.length]);
  async function discard(filename: string, name: string) {
    if (!window.confirm(`¿Descartar la copia recuperada de «${name}»? Si necesitas conservarla, descárgala primero.`)) return;
    try {
      const response = await fetch('/api/workspace/recoveries/' + encodeURIComponent(filename), {method:'DELETE'});
      if (!response.ok) throw new Error();
      setCopies(current => current.filter(copy => copy.filename !== filename));
      setRecoveryError("");
    } catch { setRecoveryError("No se pudo descartar la copia. Vuelve a intentarlo."); }
  }
  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (!isUploading) onFilesSelected(Array.from(event.dataTransfer.files));
  }

  return (
    <section aria-labelledby="dashboard-heading" className="dashboard flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-8 lg:py-10">
        <h1 id="dashboard-heading" className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">Área de trabajo</h1>
        <p className="mt-2 mb-5 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <ShieldCheck size={16} aria-hidden="true" /> Tus documentos se procesan en este equipo.
        </p>
        <div
          onDragOver={event => { event.preventDefault(); setDragging(true); }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
          onDrop={drop}
          className={`rounded-xl border-2 border-dashed ${dragging ? "border-indigo-500 bg-indigo-500/10" : "border-gray-300 dark:border-gray-600 bg-white dark:bg-magic-card"}`}
        >
          <button type="button" onClick={onOpenClick} disabled={isUploading} aria-busy={isUploading}
            className="group flex w-full items-center gap-4 rounded-xl p-6 text-left transition-colors hover:bg-indigo-500/5 disabled:cursor-wait">
            <span className="rounded-xl bg-indigo-600 p-3 text-white"><FolderOpen size={26} /></span>
            <span className="flex-1">
              <strong className="block text-xl">{isUploading ? "Abriendo PDF…" : "Abrir PDF"}</strong>
              <span className="block mt-1 text-sm text-gray-600 dark:text-gray-300">Selecciona uno o más archivos o arrástralos aquí.</span>
            </span>
            <kbd className="rounded-md border border-gray-300 dark:border-gray-600 px-2 py-1 text-xs">Ctrl+O</kbd>
          </button>
        </div>

        {recoveryError && <p role="alert" className="mt-4 text-sm">{recoveryError}</p>}
        {copies.length > 0 && (
          <section className="mt-7" aria-labelledby="recovery-heading">
            <h2 id="recovery-heading" className="text-lg font-semibold">Copias recuperables</h2>
            <p className="mb-2 text-sm">Ocupan {formatSize(copies.reduce((sum, copy) => sum + copy.size, 0))}. Puedes descargar cada PDF antes de liberar su espacio.</p>
            <ul className="divide-y divide-gray-300 dark:divide-gray-600">
              {copies.map(copy => <li key={copy.filename} className="flex items-center gap-4 py-2 text-sm">
                <span className="min-w-0 flex-1 break-words">{copy.name} · {formatSize(copy.size)}</span>
                <a className="underline" download={copy.name} href={'/api/workspace/recoveries/' + encodeURIComponent(copy.filename)}>Descargar</a>
                <button type="button" onClick={() => void discard(copy.filename, copy.name)}>Descartar</button>
              </li>)}
            </ul>
          </section>
        )}
        {documents.length > 0 && (
          <section className="mt-7" aria-labelledby="open-heading">
            <h2 id="open-heading" className="mb-3 text-lg font-semibold">Documentos abiertos ({documents.length})</h2>
            <div className="grid gap-2 md:grid-cols-2">
              {documents.map(doc => (
                <button type="button" key={doc.id} onClick={() => onSelectDoc(doc)}
                  className="flex min-w-0 items-center gap-3 rounded-lg border border-gray-200 dark:border-magic-border bg-white dark:bg-magic-card px-4 py-3 text-left hover:border-indigo-500">
                  <FileText size={19} className="shrink-0 text-indigo-600 dark:text-indigo-300" />
                  <span className="min-w-0 flex-1"><strong className="block truncate text-sm" title={doc.name}>{doc.name}</strong>
                    <span className="text-xs text-gray-600 dark:text-gray-300">{doc.pages} {doc.pages === 1 ? "página" : "páginas"} · {formatSize(doc.size)}</span>
                  </span>
                  <ArrowRight size={15} />
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="mt-8" aria-labelledby="tools-heading">
          <h2 id="tools-heading" className="mb-3 text-lg font-semibold">Herramientas</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tools.map(item => (
              <button type="button" key={item.title} onClick={() => onNavigate(item.view, item.tool)} disabled={isUploading}
                className="group rounded-xl border border-gray-200 dark:border-magic-border bg-white dark:bg-magic-card p-4 text-left hover:border-indigo-500 transition-colors">
                <span className="flex items-center justify-between">
                  <span className={`rounded-lg p-2 ${item.color}`}><item.icon size={19} /></span>
                  <ArrowRight size={15} className="text-gray-500 dark:text-gray-400 group-hover:text-indigo-500" />
                </span>
                <strong className="block mt-3 text-sm">{item.title}</strong>
                <span className="block mt-1 text-xs leading-relaxed text-gray-600 dark:text-gray-300">{item.description}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
