import React, { lazy, Suspense, useCallback, useState, useRef, useEffect } from "react";
import { Header } from "./components/Header";
import { DocumentTabs } from "./components/DocumentTabs";
import { PageRail } from "./components/PageRail";
import { DashboardView } from "./components/DashboardView";
const ViewerView = lazy(() =>
  import("./components/ReaderView").then((module) => ({
    default: module.ViewerView,
  })),
);
import { useDocumentOpening } from "./hooks/useDocumentOpening";
import { invalidatePageImages } from "./api/client";
import { awaitAnnotationWrites } from "./api/client";
import { EditorView } from "./components/EditorView";
import { OrganizeView } from "./components/OrganizeView";
import { ToolsView } from "./components/ToolsView";
import { ProTools } from "./components/ProTools";
import { PdfDocument, ViewMode, ToolType } from "./types";
import {
  exportDocumentText,
  compressDocument,
  saveToPath,
} from "./api/client";
import { X } from "lucide-react";
import { ExportTextDialog } from "./components/ExportTextDialog";

declare global {
  interface Window {
    electronAPI?: {
      appVersion?: string;
      onOpenPdf: (callback: (filePath: string) => void) => () => void;
      getInitialFile: () => Promise<string | null>;
      checkUpdates: () => Promise<void>;
      onRequestClose: (callback: () => void) => () => void;
      confirmDocuments: (documents: PdfDocument[], withVersions?: boolean) => Promise<boolean | Record<string,string>>;
      closeConfirmed: () => void;
      openFileDialog: () => Promise<{ canceled: boolean; filePaths: string[] }>;
      saveFileAs: (params: {
        defaultName: string;
        tempPath: string;
      }) => Promise<{
        success: boolean;
        filePath?: string;
        canceled?: boolean;
        error?: string;
      }>;
      saveFile: (params: {
        originalPath: string;
        tempPath: string;
      }) => Promise<{ success: boolean; filePath?: string; error?: string }>;
      printDocument: (filePath: string) => Promise<void>;
    };
  }
}

async function releaseClosedDocuments(docs: PdfDocument[], decision: boolean | Record<string,string>) {
  await Promise.all(docs.map(async doc => {
    try {
      const res = await fetch('/api/workspace/release', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({filename:doc.filename, approvedVersion:typeof decision === 'object' ? decision[doc.filename] : undefined}),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch (error) {
      // The persisted receipt lets the next session retry cleanup.
      console.warn('Limpieza de copia pendiente', error);
    }
  }));
}

export const App: React.FC = () => {
  const [documents, setDocuments] = useState<PdfDocument[]>([]);
  const [activeDoc, setActiveDoc] = useState<PdfDocument | null>(null);
  const workspace = useRef({ documents, activeDoc });
  const closingDocuments = useRef(new Set<string>());
  useEffect(() => { workspace.current = { documents, activeDoc }; }, [documents, activeDoc]);
  useEffect(() => {
    if (window.electronAPI) return;
    const detach = (event: PageTransitionEvent) => {
      if (event.persisted) return;
      const filenames = workspace.current.documents.map(doc => doc.filename);
      if (filenames.length) navigator.sendBeacon('/api/workspace/detach',
        new Blob([JSON.stringify({filenames})], {type:'application/json'}));
    };
    window.addEventListener('pagehide', detach);
    return () => window.removeEventListener('pagehide', detach);
  }, []);
  const closing = useRef(false);
  const flushAnnotations = async (docs: PdfDocument[]) => {
    const pending: Promise<unknown>[] = [];
    window.dispatchEvent(new CustomEvent('magicpdf-flush-annotations', {detail:{waitUntil:(p:Promise<unknown>)=>pending.push(p)}}));
    await Promise.all(pending);
    await Promise.all(docs.map(d => awaitAnnotationWrites(d.filename)));
    return pending.length ? docs.map(d => d.id === activeDoc?.id ? {...d, annotationRevision:(d.annotationRevision || 0)+1} : d) : docs;
  };
  useEffect(() => window.electronAPI?.onRequestClose?.(() => {
    if (closing.current) return;
    closing.current = true;
    void (async () => {
      try {
        const flushed = await flushAnnotations(documents);
        const decision = await window.electronAPI!.confirmDocuments(flushed, true);
        if (decision) {
          await releaseClosedDocuments(flushed, decision);
          window.electronAPI!.closeConfirmed();
        }
      } catch { alert('Hay una anotación que no se pudo guardar. Revisa el documento antes de cerrar.'); }
      finally { closing.current = false; }
    })();
  }), [documents, activeDoc]);
  const [viewMode, setViewMode] = useState<ViewMode>("dashboard");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pagesOpen, setPagesOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolType>("merge");
  const [saveStatusMessage, setSaveStatusMessage] = useState<string | null>(
    null,
  );

  // Global Light / Night Theme
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    return (
      (localStorage.getItem("magicpdf_theme") as "dark" | "light") || "dark"
    );
  });

  // Export Text Modal
  const [exportedText, setExportedText] = useState<{ text: string; name: string } | null>(null);

  const acceptDocuments = useCallback((opened: PdfDocument[], view: ViewMode) => {
    const ids = new Set(opened.map(doc => doc.id));
    setDocuments(previous => [...previous.filter(doc => !ids.has(doc.id)), ...opened]);
    setActiveDoc(opened[0]);
    setCurrentPage(1);
    setViewMode(view);
  }, []);
  const opening = useDocumentOpening(acceptDocuments);
  const handleOpenAction = () => opening.openPicker();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // Synchronize Theme class with document element
  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("magicpdf_theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  // Helper toast notification
  const showToast = (msg: string) => {
    setSaveStatusMessage(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      setSaveStatusMessage(null);
    }, 3500);
  };

  // Keyboard Shortcuts (Ctrl+S, Ctrl+Shift+S, Ctrl+P, Ctrl+O)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (e.shiftKey) {
          handleSaveAs();
        } else {
          handleSave();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        handlePrint();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        handleOpenAction();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeDoc]);

  const handleSelectDoc = (doc: PdfDocument) => {
    setActiveDoc(doc);
    if (activeDoc?.id !== doc.id) setCurrentPage(1);
    setViewMode("viewer");
  };

  const handleCloseDoc = async (docId: string) => {
    const doc = workspace.current.documents.find(d => d.id === docId);
    if (!doc || closingDocuments.current.has(docId)) return;
    closingDocuments.current.add(docId);
    try {
      const flushed = await flushAnnotations([doc]);
      const decision = window.electronAPI?.confirmDocuments ? await window.electronAPI.confirmDocuments(flushed, true) : true;
      if (!decision) return;
      await releaseClosedDocuments(flushed, decision);
      const current = workspace.current;
      const index = current.documents.findIndex(d => d.id === docId);
      const next = current.documents.filter(d => d.id !== docId);
      const fallback = current.activeDoc?.id === docId
        ? next[Math.min(index, next.length - 1)] ?? null
        : current.activeDoc;
      workspace.current = { documents: next, activeDoc: fallback };
      setDocuments(next);
      if (current.activeDoc?.id === docId) {
        setActiveDoc(fallback);
        setCurrentPage(1);
        if (!fallback) {
          setViewMode("dashboard");
        }
      }
    } catch {
      alert('No se pudo guardar la anotación pendiente. El documento permanece abierto.');
    } finally {
      closingDocuments.current.delete(docId);
    }
  };

  const handleNavigate = (mode: ViewMode, tool?: ToolType) => {
    if (tool) setActiveTool(tool);
    if (!activeDoc && mode !== "dashboard") {
      void opening.openPicker(mode);
      return;
    }
    setViewMode(mode);
  };

  const handleDocumentAdded = (newDoc: PdfDocument) => {
    setDocuments((prev) => [...prev, newDoc]);
    setActiveDoc(newDoc);
    setCurrentPage(1);
    setViewMode("viewer");
  };

  const handleDocumentUpdated = (pageCount?: number) => {
    if (activeDoc) {
      invalidatePageImages(activeDoc.filename);
      const update = (doc: PdfDocument): PdfDocument => ({
        ...doc,
        pages: pageCount ?? doc.pages,
        revision: (doc.revision || 0) + 1,
      });
      if (pageCount && workspace.current.activeDoc?.id === activeDoc.id) {
        setCurrentPage(p => Math.min(p, pageCount));
      }
      setActiveDoc(current => current?.id === activeDoc.id ? update(current) : current);
      setDocuments(previous => previous.map(doc => doc.id === activeDoc.id ? update(doc) : doc));
    }
  };

  // NATIVE DESKTOP FILE OPERATIONS (Overwrites in-place on disk)
  const handleAnnotationsUpdated = () => {
    if (!activeDoc) return;
    invalidatePageImages(activeDoc.filename);
    const refresh = (d: PdfDocument) => ({
      ...d,
      annotationRevision: (d.annotationRevision || 0) + 1,
    });
    setActiveDoc((current) =>
      current?.id === activeDoc.id ? refresh(current) : current,
    );
    setDocuments((prev) =>
      prev.map((d) => (d.id === activeDoc.id ? refresh(d) : d)),
    );
  };
  const handleSave = async () => {
    if (!activeDoc) return;
    try {
      await flushAnnotations([activeDoc]);
    } catch {
      showToast(
        "La última anotación no se guardó. Reinténtala antes de guardar el archivo.",
      );
      return;
    }
    if (activeDoc.originalDiskPath) {
      try {
        if (window.electronAPI?.saveFile) {
          const res = await window.electronAPI.saveFile({
            originalPath: activeDoc.originalDiskPath,
            tempPath: activeDoc.path,
          });
          if (!res.success) throw new Error(res.error || "Error de escritura");
        } else {
          await saveToPath(activeDoc.filename, activeDoc.originalDiskPath);
        }
        showToast(`✓ Guardado en ${activeDoc.name}`);
      } catch (err) {
        showToast(`No se pudo guardar. ${err instanceof Error ? err.message : "Vuelve a intentarlo."}`);
      }
      return;
    }
    // Only if there is no originalDiskPath (e.g. web browser preview), ask where to save
    await handleSaveAs();
  };

  const handleSaveAs = async () => {
    if (!activeDoc) return;
    try {
      await flushAnnotations([activeDoc]);
    } catch {
      showToast("Espera a que termine el guardado de la anotación.");
      return;
    }
    if (window.electronAPI?.saveFileAs) {
      const res = await window.electronAPI.saveFileAs({
        defaultName: activeDoc.name,
        tempPath: activeDoc.path,
      }).catch((error: Error) => ({success:false, error:error.message, canceled:false, filePath:undefined}));
      if (res.success && res.filePath) {
        const originalDiskPath = res.filePath;
        setActiveDoc(current => current?.id === activeDoc.id ? {...current, originalDiskPath} : current);
        setDocuments(rows => rows.map(d => d.id === activeDoc.id ? {...d, originalDiskPath} : d));
        showToast(`✓ Guardado como ${activeDoc.name}`);
      } else if (!res.canceled) {
        showToast(`No se pudo guardar la copia. ${res.error || "Vuelve a intentarlo."}`);
      }
    } else {
      // Fallback for browser testing
      const a = document.createElement("a");
      a.href = `/api/download/${encodeURIComponent(activeDoc.filename)}`;
      a.download = activeDoc.name;
      a.click();
    }
  };

  const handlePrint = async () => {
    if (!activeDoc) return;
    try {
      await flushAnnotations([activeDoc]);
    } catch {
      showToast(
        "La anotación pendiente no se guardó. Reinténtala antes de imprimir.",
      );
      return;
    }
    if (window.electronAPI) {
      void window.electronAPI
        .printDocument(activeDoc.path)
        .catch(() => showToast("No se pudo abrir el PDF para imprimir."));
    } else {
      window.open(
        `/api/download/${encodeURIComponent(activeDoc.filename)}`,
        "_blank",
        "noopener",
      );
    }
  };

  const handleExportText = async () => {
    if (!activeDoc) return;
    try {
      const text = await exportDocumentText(activeDoc.filename);
      setExportedText({ text, name: activeDoc.name });
    } catch (err: any) {
      alert(`Error al exportar texto: ${err.message}`);
    }
  };

  const handleExportCompressed = async () => {
    if (!activeDoc) return;
    try {
      showToast("Comprimiendo PDF...");
      const res = await compressDocument(activeDoc.filename);
      handleDocumentUpdated();
      showToast(`¡Comprimido -${res.reducedPercent}%! Elige dónde guardarlo:`);
      await handleSaveAs();
    } catch (err: any) {
      alert(`Error al comprimir: ${err.message}`);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-gray-50 dark:bg-magic-bg text-gray-900 dark:text-gray-100 font-sans transition-colors">
      <input
        type="file"
        ref={opening.fileInputRef}
        onChange={e => opening.acceptSelection(e.currentTarget)}
        accept=".pdf,application/pdf"
        multiple
        className="hidden"
      />

      {/* Top Header with Quick File Actions & Theme Selector */}
      <DocumentTabs
        documents={documents}
        activeDoc={activeDoc}
        onSelectDoc={handleSelectDoc}
        onCloseDoc={handleCloseDoc}
        onOpen={handleOpenAction}
      />
      <Header
        activeDoc={activeDoc}
        onCloseDoc={handleCloseDoc}
        onUploadClick={handleOpenAction}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        onExportText={handleExportText}
        onExportCompressed={handleExportCompressed}
        onPrint={handlePrint}
        theme={theme}
        onToggleTheme={toggleTheme}
        saveStatusMessage={saveStatusMessage}
        onOpenDashboard={() => setViewMode("dashboard")}
        viewMode={viewMode}
        onRead={() => setViewMode("viewer")}
        pagesOpen={pagesOpen}
        onTogglePages={() => setPagesOpen((open) => !open)}
      />

      {opening.openError && (
        <div className="open-error">
          <span role="alert">{opening.openError}</span>
          <button type="button" aria-label="Cerrar aviso" onClick={opening.dismissError}><X size={16} /></button>
        </div>
      )}
      {/* Main Workspace */}
      {activeDoc && viewMode !== "dashboard" && (
        <ProTools
          key={activeDoc.id}
          document={activeDoc}
          currentPage={currentPage}
          onUpdated={handleDocumentUpdated}
          onNavigate={handleNavigate}
        />
      )}
      <main className="flex-1 flex overflow-hidden relative">
        {/* Left Sidebar (Only visible when a document is opened) */}
        {activeDoc && viewMode !== "dashboard" && pagesOpen && (
          <PageRail
            document={activeDoc}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
          />
        )}

        {/* Central View Modes */}
        <div className="flex-1 flex overflow-hidden relative">
          {viewMode === "dashboard" && (
            <DashboardView
              onFilesSelected={opening.openSources}
              documents={documents}
              onSelectDoc={handleSelectDoc}
              onNavigate={handleNavigate}
              isUploading={opening.isUploading}
              onOpenClick={handleOpenAction}
            />
          )}

          {viewMode === "viewer" && activeDoc && (
            <Suspense
              fallback={
                <div className="m-auto text-sm" role="status">
                  Cargando visor…
                </div>
              }
            >
              <ViewerView
                key={activeDoc.id}
                theme={theme}
                onThemeChange={setTheme}
                document={activeDoc}
                currentPage={currentPage}
                onPageChange={setCurrentPage}
                onEnterEditMode={() => setViewMode("editor")}
                onDocumentUpdated={handleDocumentUpdated}
                onAnnotationsUpdated={handleAnnotationsUpdated}
              />
            </Suspense>
          )}

          {viewMode === "editor" && activeDoc && (
            <EditorView
              document={activeDoc}
              currentPage={currentPage}
              onPageChange={setCurrentPage}
              onDocumentUpdated={handleDocumentUpdated}
              onReturnToViewer={() => setViewMode("viewer")}
            />
          )}

          {viewMode === "organize" && activeDoc && (
            <OrganizeView
              key={`${activeDoc.id}:${activeDoc.revision || 0}`}
              document={activeDoc}
              onDocumentUpdated={handleDocumentUpdated}
            />
          )}

          {viewMode === "tools" && (
            <ToolsView
              initialTool={activeTool}
              activeDoc={activeDoc}
              documents={documents}
              onDocumentAdded={handleDocumentAdded}
              onDocumentUpdated={handleDocumentUpdated}
            />
          )}
        </div>
      </main>

      {exportedText && <ExportTextDialog {...exportedText} onClose={() => setExportedText(null)} />}
    </div>
  );
};
