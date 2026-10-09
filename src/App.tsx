import React, { useState, useRef, useEffect } from 'react';
import { Header } from './components/Header';
import { Sidebar, SidebarTab } from './components/Sidebar';
import { DashboardView } from './components/DashboardView';
import { ViewerView } from './components/ViewerView';
import { EditorView } from './components/EditorView';
import { OrganizeView } from './components/OrganizeView';
import { ToolsView } from './components/ToolsView';
import { PdfDocument, ViewMode, ToolType } from './types';
import { 
  uploadFiles, 
  openFilePath, 
  exportDocumentText, 
  compressDocument,
  organizePages,
  saveToPath 
} from './api/client';
import { Copy, Check, Download, X } from 'lucide-react';

declare global {
  interface Window {
    electronAPI?: {
      onOpenPdf: (callback: (filePath: string) => void) => void;
      getInitialFile: () => Promise<string | null>;
      openFileDialog: () => Promise<{ canceled: boolean; filePaths: string[] }>;
      saveFileAs: (params: { defaultName: string; tempPath: string }) => Promise<{ success: boolean; filePath?: string; canceled?: boolean }>;
      saveFile: (params: { originalPath: string; tempPath: string }) => Promise<{ success: boolean; filePath?: string; error?: string }>;
      printDocument: () => Promise<void>;
    };
  }
}

export const App: React.FC = () => {
  const [documents, setDocuments] = useState<PdfDocument[]>([]);
  const [activeDoc, setActiveDoc] = useState<PdfDocument | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTab>('thumbnails');
  const [activeTool, setActiveTool] = useState<ToolType>('merge');
  const [isUploading, setIsUploading] = useState(false);
  const [saveStatusMessage, setSaveStatusMessage] = useState<string | null>(null);

  // Global Light / Night Theme
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('magicpdf_theme') as 'dark' | 'light') || 'dark';
  });

  // Export Text Modal
  const [exportedText, setExportedText] = useState<string | null>(null);
  const [hasCopiedText, setHasCopiedText] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Synchronize Theme class with document element
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('magicpdf_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  // Helper toast notification
  const showToast = (msg: string) => {
    setSaveStatusMessage(msg);
    setTimeout(() => {
      setSaveStatusMessage(null);
    }, 3500);
  };

  // File association listener (Windows double-click & CLI)
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.onOpenPdf(async (filePath) => {
        try {
          setIsUploading(true);
          const doc = await openFilePath(filePath);
          setDocuments(prev => [...prev.filter(d => d.id !== doc.id), doc]);
          setActiveDoc(doc);
          setCurrentPage(1);
          setViewMode('viewer'); // Opens in VIEWER mode by default
        } catch (err: any) {
          console.error('Error al abrir PDF:', err);
        } finally {
          setIsUploading(false);
        }
      });

      window.electronAPI.getInitialFile().then(async (filePath) => {
        if (filePath) {
          try {
            setIsUploading(true);
            const doc = await openFilePath(filePath);
            setDocuments(prev => [...prev.filter(d => d.id !== doc.id), doc]);
            setActiveDoc(doc);
            setCurrentPage(1);
            setViewMode('viewer'); // Opens in VIEWER mode by default
          } catch (err: any) {
            console.error('Error al abrir archivo inicial:', err);
          } finally {
            setIsUploading(false);
          }
        }
      });
    }
  }, []);

  // Keyboard Shortcuts (Ctrl+S, Ctrl+Shift+S, Ctrl+P, Ctrl+O)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (e.shiftKey) {
          handleSaveAs();
        } else {
          handleSave();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        handlePrint();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        handleOpenAction();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeDoc]);

  // Open files using native Windows picker or fallback to web input
  const handleOpenAction = async () => {
    if (window.electronAPI?.openFileDialog) {
      try {
        const res = await window.electronAPI.openFileDialog();
        if (!res.canceled && res.filePaths && res.filePaths.length > 0) {
          setIsUploading(true);
          const loadedDocs: PdfDocument[] = [];
          for (const filePath of res.filePaths) {
            const doc = await openFilePath(filePath);
            loadedDocs.push(doc);
          }
          setDocuments(prev => {
            const ids = new Set(loadedDocs.map(d => d.id));
            return [...prev.filter(d => !ids.has(d.id)), ...loadedDocs];
          });
          if (loadedDocs.length > 0) {
            setActiveDoc(loadedDocs[0]);
            setCurrentPage(1);
            setViewMode('viewer'); // Opens in VIEWER mode by default
          }
        }
        return;
      } catch (err) {
        console.warn('Native open dialog failed, falling back to input:', err);
      } finally {
        setIsUploading(false);
      }
    }
    fileInputRef.current?.click();
  };

  // Open multiple files from disk or drag-and-drop
  const handleFilesSelected = async (files: File[]) => {
    try {
      setIsUploading(true);
      const loadedDocs: PdfDocument[] = [];
      for (const file of files) {
        const diskPath = (file as any).path;
        if (diskPath && typeof diskPath === 'string') {
          const doc = await openFilePath(diskPath);
          loadedDocs.push(doc);
        } else {
          const uploaded = await uploadFiles([file]);
          loadedDocs.push(...uploaded);
        }
      }
      setDocuments(prev => {
        const ids = new Set(loadedDocs.map(d => d.id));
        return [...prev.filter(d => !ids.has(d.id)), ...loadedDocs];
      });
      if (loadedDocs.length > 0) {
        setActiveDoc(loadedDocs[0]);
        setCurrentPage(1);
        setViewMode('viewer'); // Opens in VIEWER mode by default
      }
    } catch (err: any) {
      alert(`Error al abrir archivos: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSelectDoc = (doc: PdfDocument) => {
    setActiveDoc(doc);
    setCurrentPage(1);
    if (viewMode === 'dashboard') {
      setViewMode('viewer');
    }
  };

  const handleCloseDoc = (docId: string) => {
    setDocuments(prev => {
      const next = prev.filter(d => d.id !== docId);
      if (activeDoc?.id === docId) {
        const fallback = next.length > 0 ? next[0] : null;
        setActiveDoc(fallback);
        if (!fallback) {
          setViewMode('dashboard');
        }
      }
      return next;
    });
  };

  const handleNavigate = (mode: ViewMode, tool?: ToolType) => {
    if (tool) setActiveTool(tool);
    setViewMode(mode);
  };

  const handleDocumentAdded = (newDoc: PdfDocument) => {
    setDocuments(prev => [...prev, newDoc]);
    setActiveDoc(newDoc);
    setCurrentPage(1);
    setViewMode('viewer');
  };

  const handleDocumentUpdated = () => {
    if (activeDoc) {
      setActiveDoc({ ...activeDoc });
    }
  };

  // NATIVE DESKTOP FILE OPERATIONS (Overwrites in-place on disk)
  const handleSave = async () => {
    if (!activeDoc) return;
    if (activeDoc.originalDiskPath) {
      if (window.electronAPI?.saveFile) {
        try {
          const res = await window.electronAPI.saveFile({
            originalPath: activeDoc.originalDiskPath,
            tempPath: activeDoc.path
          });
          if (res.success) {
            showToast(`✓ Guardado en ${activeDoc.name}`);
            return;
          }
        } catch (err) {
          console.warn('Error en saveFile de electronAPI, probando API server:', err);
        }
      }
      try {
        await saveToPath(activeDoc.filename, activeDoc.originalDiskPath);
        showToast(`✓ Guardado en ${activeDoc.name}`);
        return;
      } catch (err) {
        console.error('Error al guardar archivo en disco:', err);
      }
    }
    // Only if there is no originalDiskPath (e.g. web browser preview), ask where to save
    await handleSaveAs();
  };

  const handleSaveAs = async () => {
    if (!activeDoc) return;
    if (window.electronAPI?.saveFileAs) {
      const res = await window.electronAPI.saveFileAs({
        defaultName: activeDoc.name,
        tempPath: activeDoc.path
      });
      if (res.success && res.filePath) {
        activeDoc.originalDiskPath = res.filePath;
        showToast(`✓ Guardado como ${activeDoc.name}`);
      }
    } else {
      // Fallback for browser testing
      const a = document.createElement('a');
      a.href = `/api/download/${encodeURIComponent(activeDoc.filename)}`;
      a.download = activeDoc.name;
      a.click();
    }
  };

  const handlePrint = () => {
    if (window.electronAPI) {
      window.electronAPI.printDocument();
    } else {
      window.print();
    }
  };

  const handleExportText = async () => {
    if (!activeDoc) return;
    try {
      const text = await exportDocumentText(activeDoc.filename);
      setExportedText(text);
      setHasCopiedText(false);
    } catch (err: any) {
      alert(`Error al exportar texto: ${err.message}`);
    }
  };

  const handleExportCompressed = async () => {
    if (!activeDoc) return;
    try {
      showToast('Comprimiendo PDF...');
      const res = await compressDocument(activeDoc.filename);
      handleDocumentUpdated();
      showToast(`¡Comprimido -${res.reducedPercent}%! Elige dónde guardarlo:`);
      await handleSaveAs();
    } catch (err: any) {
      alert(`Error al comprimir: ${err.message}`);
    }
  };

  // Quick page actions from sidebar
  const handleRotateCurrentPage = async () => {
    if (!activeDoc) return;
    try {
      await organizePages(activeDoc.filename, [{ page: currentPage, by: 90 }], []);
      handleDocumentUpdated();
      showToast(`Página ${currentPage} girada 90°`);
    } catch (err: any) {
      alert(`Error al rotar página: ${err.message}`);
    }
  };

  const handleDeleteCurrentPage = async () => {
    if (!activeDoc || activeDoc.pages <= 1) {
      alert('No se puede eliminar la única página del documento.');
      return;
    }
    if (!confirm(`¿Eliminar la página ${currentPage} de forma permanente?`)) return;
    try {
      await organizePages(activeDoc.filename, [], [currentPage]);
      activeDoc.pages -= 1;
      setCurrentPage(p => Math.min(p, activeDoc.pages));
      handleDocumentUpdated();
      showToast(`Página ${currentPage} eliminada`);
    } catch (err: any) {
      alert(`Error al eliminar página: ${err.message}`);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-gray-50 dark:bg-magic-bg text-gray-900 dark:text-gray-100 font-sans transition-colors">
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => {
          if (e.target.files) handleFilesSelected(Array.from(e.target.files));
        }}
        accept="application/pdf"
        multiple
        className="hidden"
      />

      {/* Top Header with Quick File Actions & Theme Selector */}
      <Header
        documents={documents}
        activeDoc={activeDoc}
        onSelectDoc={handleSelectDoc}
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
        onOpenDashboard={() => setViewMode('dashboard')}
      />

      {/* Main Workspace */}
      <main className="flex-1 flex overflow-hidden relative">
        {/* Left Sidebar (Only visible when a document is opened) */}
        {activeDoc && viewMode !== 'dashboard' && (
          <Sidebar
            document={activeDoc}
            currentPage={currentPage}
            onPageSelect={(page) => setCurrentPage(page)}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            activeSidebarTab={activeSidebarTab}
            onSelectSidebarTab={setActiveSidebarTab}
            onSelectTool={(tool) => {
              setActiveTool(tool);
              setViewMode('tools');
            }}
            onRotateCurrentPage={handleRotateCurrentPage}
            onDeleteCurrentPage={handleDeleteCurrentPage}
          />
        )}

        {/* Central View Modes */}
        <div className="flex-1 flex overflow-hidden relative">
          {viewMode === 'dashboard' && (
            <DashboardView
              onFilesSelected={handleFilesSelected}
              documents={documents}
              onSelectDoc={handleSelectDoc}
              onNavigate={handleNavigate}
              isUploading={isUploading}
              onOpenClick={handleOpenAction}
            />
          )}

          {viewMode === 'viewer' && activeDoc && (
            <ViewerView
              document={activeDoc}
              currentPage={currentPage}
              onPageChange={setCurrentPage}
              onEnterEditMode={() => setViewMode('editor')}
            />
          )}

          {viewMode === 'editor' && activeDoc && (
            <EditorView
              document={activeDoc}
              currentPage={currentPage}
              onPageChange={setCurrentPage}
              onDocumentUpdated={handleDocumentUpdated}
              onReturnToViewer={() => setViewMode('viewer')}
            />
          )}

          {viewMode === 'organize' && activeDoc && (
            <OrganizeView
              document={activeDoc}
              onDocumentUpdated={handleDocumentUpdated}
            />
          )}

          {viewMode === 'tools' && (
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

      {/* Modal: Exported Text Viewer */}
      {exportedText !== null && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-in fade-in duration-150">
          <div className="w-full max-w-2xl bg-white dark:bg-magic-card border border-gray-200 dark:border-magic-border rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[85vh]">
            <div className="p-4 border-b border-gray-200 dark:border-magic-border flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                Texto Extraído de {activeDoc?.name}
              </h3>
              <button
                onClick={() => setExportedText(null)}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-magic-hover"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 p-4 overflow-y-auto">
              <textarea
                readOnly
                value={exportedText}
                className="w-full h-80 p-3 bg-gray-50 dark:bg-magic-bg border border-gray-200 dark:border-magic-border rounded-xl font-mono text-xs text-gray-800 dark:text-gray-200 outline-none resize-none leading-relaxed"
              />
            </div>

            <div className="p-4 border-t border-gray-200 dark:border-magic-border flex items-center justify-end gap-2 bg-gray-50 dark:bg-magic-bg/50">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(exportedText);
                  setHasCopiedText(true);
                  setTimeout(() => setHasCopiedText(false), 2000);
                }}
                className="px-4 py-2 rounded-xl border border-gray-200 dark:border-magic-border hover:bg-gray-100 dark:hover:bg-magic-hover text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                {hasCopiedText ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{hasCopiedText ? '¡Copiado!' : 'Copiar al Portapapeles'}</span>
              </button>
              <button
                onClick={() => {
                  const blob = new Blob([exportedText], { type: 'text/plain;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${activeDoc?.name || 'documento'}.txt`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/30 flex items-center gap-1.5 transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Descargar archivo .txt</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
