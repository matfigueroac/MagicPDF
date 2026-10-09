import React, { useState, useRef, useEffect } from 'react';
import { 
  Sparkles, 
  FileText, 
  Save, 
  FolderOpen, 
  Printer, 
  Sun, 
  Moon, 
  Share2, 
  Plus, 
  X, 
  ChevronDown, 
  FileDown, 
  Check, 
  FileCode2,
  Minimize2,
  FileCheck
} from 'lucide-react';
import { PdfDocument } from '../types';

interface HeaderProps {
  documents: PdfDocument[];
  activeDoc: PdfDocument | null;
  onSelectDoc: (doc: PdfDocument) => void;
  onCloseDoc: (docId: string) => void;
  onUploadClick: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExportText: () => void;
  onExportCompressed: () => void;
  onPrint: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  saveStatusMessage?: string | null;
  onOpenDashboard: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  documents,
  activeDoc,
  onSelectDoc,
  onCloseDoc,
  onUploadClick,
  onSave,
  onSaveAs,
  onExportText,
  onExportCompressed,
  onPrint,
  theme,
  onToggleTheme,
  saveStatusMessage,
  onOpenDashboard,
}) => {
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Close export dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="h-12 border-b border-gray-200 dark:border-magic-border bg-white dark:bg-magic-bg px-3 flex items-center justify-between shrink-0 select-none z-30 transition-colors">
      {/* Left: Quick Access Toolbar & Brand */}
      <div className="flex items-center gap-2 overflow-hidden">
        {/* Brand */}
        <div 
          onClick={onOpenDashboard}
          className="flex items-center gap-1.5 cursor-pointer group shrink-0 pr-2 border-r border-gray-200 dark:border-magic-border/70"
          title="Ir al Inicio"
        >
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center shadow-md shadow-indigo-500/20 group-hover:scale-105 transition-transform">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-sm tracking-tight bg-gradient-to-r from-gray-900 via-indigo-950 to-indigo-800 dark:from-white dark:via-indigo-100 dark:to-indigo-300 bg-clip-text text-transparent hidden sm:inline">
            MagicPDF
          </span>
        </div>

        {/* Quick File Action Buttons (Acrobat / Foxit style) */}
        <div className="flex items-center gap-0.5 border-r border-gray-200 dark:border-magic-border/70 pr-2 shrink-0">
          <button
            onClick={onUploadClick}
            className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-magic-hover text-gray-600 dark:text-gray-300 transition-colors"
            title="Abrir PDF (Ctrl+O)"
          >
            <FolderOpen className="w-4 h-4" />
          </button>

          {activeDoc && (
            <>
              <button
                onClick={onSave}
                className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-magic-hover text-gray-600 dark:text-gray-300 transition-colors"
                title="Guardar cambios (Ctrl+S)"
              >
                <Save className="w-4 h-4" />
              </button>

              <button
                onClick={onSaveAs}
                className="px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-magic-hover text-xs font-medium text-gray-600 dark:text-gray-300 transition-colors hidden md:flex items-center gap-1"
                title="Guardar como... (Ctrl+Shift+S)"
              >
                <FileDown className="w-3.5 h-3.5 text-indigo-500" />
                <span>Guardar como</span>
              </button>

              {/* Export Dropdown */}
              <div className="relative" ref={exportMenuRef}>
                <button
                  onClick={() => setExportMenuOpen(!exportMenuOpen)}
                  className="px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-magic-hover text-xs font-medium text-gray-600 dark:text-gray-300 transition-colors hidden sm:flex items-center gap-1"
                  title="Exportar archivo"
                >
                  <Share2 className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Exportar</span>
                  <ChevronDown className="w-3 h-3 text-gray-400" />
                </button>

                {exportMenuOpen && (
                  <div className="absolute top-full left-0 mt-1 w-52 bg-white dark:bg-magic-card border border-gray-200 dark:border-magic-border rounded-xl shadow-xl py-1 z-50 text-xs animate-in fade-in zoom-in-95 duration-100">
                    <button
                      onClick={() => {
                        setExportMenuOpen(false);
                        onExportText();
                      }}
                      className="w-full px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-magic-hover flex items-center gap-2 text-gray-700 dark:text-gray-200"
                    >
                      <FileCode2 className="w-4 h-4 text-indigo-500" />
                      <div>
                        <div className="font-medium">Exportar a Texto (.txt)</div>
                        <div className="text-[10px] text-gray-400">Extrae el contenido textual</div>
                      </div>
                    </button>
                    <button
                      onClick={() => {
                        setExportMenuOpen(false);
                        onExportCompressed();
                      }}
                      className="w-full px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-magic-hover flex items-center gap-2 text-gray-700 dark:text-gray-200 border-t border-gray-100 dark:border-magic-border/50"
                    >
                      <Minimize2 className="w-4 h-4 text-emerald-500" />
                      <div>
                        <div className="font-medium">Exportar Comprimido</div>
                        <div className="text-[10px] text-gray-400">Reduce el tamaño del PDF</div>
                      </div>
                    </button>
                  </div>
                )}
              </div>

              <button
                onClick={onPrint}
                className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-magic-hover text-gray-600 dark:text-gray-300 transition-colors"
                title="Imprimir (Ctrl+P)"
              >
                <Printer className="w-4 h-4" />
              </button>
            </>
          )}
        </div>

        {/* Document Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
          <button
            onClick={onOpenDashboard}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-all border shrink-0 ${
              !activeDoc
                ? 'bg-gray-100 dark:bg-magic-card text-indigo-600 dark:text-indigo-300 border-indigo-500/30'
                : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 border-transparent hover:bg-gray-100 dark:hover:bg-magic-hover'
            }`}
          >
            <span>Inicio</span>
          </button>

          {documents.map((doc) => {
            const isActive = activeDoc?.id === doc.id;
            return (
              <div
                key={doc.id}
                onClick={() => onSelectDoc(doc)}
                className={`flex items-center gap-2 px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-all border shrink-0 max-w-[200px] ${
                  isActive
                    ? 'bg-gray-100 dark:bg-magic-card text-gray-900 dark:text-indigo-200 border-gray-300 dark:border-indigo-500/40 shadow-sm'
                    : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 border-transparent hover:bg-gray-100 dark:hover:bg-magic-hover'
                }`}
              >
                <FileText className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-indigo-500' : 'text-gray-400'}`} />
                <span className="truncate">{doc.name}</span>
                <span className="text-[10px] text-gray-400 font-mono">({doc.pages}p)</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseDoc(doc.id);
                  }}
                  className="hover:bg-gray-200 dark:hover:bg-gray-700/50 p-0.5 rounded text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors ml-1"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}

          <button
            onClick={onUploadClick}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-magic-hover transition-colors shrink-0"
            title="Abrir otro documento"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Right: Save Status & Theme Toggle */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Status notification toast */}
        {saveStatusMessage && (
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-full text-[11px] font-medium animate-in fade-in duration-200">
            <Check className="w-3 h-3" />
            <span>{saveStatusMessage}</span>
          </div>
        )}

        {/* Global Light / Night Mode Toggle */}
        <button
          onClick={onToggleTheme}
          className="p-1.5 rounded-lg border border-gray-200 dark:border-magic-border hover:bg-gray-100 dark:hover:bg-magic-hover text-gray-600 dark:text-gray-300 transition-all"
          title={theme === 'dark' ? 'Cambiar a Modo Luz ☀️' : 'Cambiar a Modo Noche 🌙'}
        >
          {theme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-400" />
          ) : (
            <Moon className="w-4 h-4 text-indigo-600" />
          )}
        </button>
      </div>
    </header>
  );
};
