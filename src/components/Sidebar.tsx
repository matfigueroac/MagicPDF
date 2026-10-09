import React from 'react';
import { 
  FileText, 
  Edit3, 
  Layers, 
  Wrench, 
  Info, 
  ChevronLeft, 
  ChevronRight,
  RotateCw,
  Trash2,
  FilePlus2,
  Shield,
  Scissors,
  PenTool,
  Minimize2,
  Stamp,
  Eye
} from 'lucide-react';
import { PdfDocument, ViewMode, ToolType } from '../types';
import { getPageImageUrl } from '../api/client';

export type SidebarTab = 'thumbnails' | 'organize' | 'tools' | 'info' | null;

interface SidebarProps {
  document: PdfDocument;
  currentPage: number;
  onPageSelect: (page: number) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  activeSidebarTab: SidebarTab;
  onSelectSidebarTab: (tab: SidebarTab) => void;
  onSelectTool: (tool: ToolType) => void;
  onRotateCurrentPage?: () => void;
  onDeleteCurrentPage?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  document,
  currentPage,
  onPageSelect,
  viewMode,
  onViewModeChange,
  activeSidebarTab,
  onSelectSidebarTab,
  onSelectTool,
  onRotateCurrentPage,
  onDeleteCurrentPage,
}) => {
  const isExpanded = activeSidebarTab !== null;

  const toggleTab = (tab: SidebarTab) => {
    if (activeSidebarTab === tab) {
      onSelectSidebarTab(null);
    } else {
      onSelectSidebarTab(tab);
    }
  };

  return (
    <aside className="flex h-full border-r border-gray-200 dark:border-magic-border select-none z-20 shrink-0 transition-colors bg-gray-50 dark:bg-magic-card">
      {/* 1. Thin vertical icon strip (Foxit / Acrobat style) */}
      <div className="w-12 h-full flex flex-col items-center justify-between py-2 border-r border-gray-200 dark:border-magic-border/70 bg-white dark:bg-magic-bg">
        <div className="flex flex-col items-center gap-1.5 w-full px-1">
          {/* Thumbnails Tab */}
          <button
            onClick={() => toggleTab('thumbnails')}
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
              activeSidebarTab === 'thumbnails'
                ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-magic-hover'
            }`}
            title="Miniaturas de páginas"
          >
            <FileText className="w-4 h-4" />
          </button>

          {/* Quick Edit Mode Toggle */}
          <button
            onClick={() => {
              if (viewMode === 'editor') {
                onViewModeChange('viewer');
              } else {
                onViewModeChange('editor');
              }
            }}
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
              viewMode === 'editor'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-magic-hover'
            }`}
            title={viewMode === 'editor' ? 'Modo Visor (Lectura)' : 'Modo Editor de Texto'}
          >
            {viewMode === 'editor' ? <Eye className="w-4 h-4" /> : <Edit3 className="w-4 h-4" />}
          </button>

          {/* Organize Pages Tab */}
          <button
            onClick={() => toggleTab('organize')}
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
              activeSidebarTab === 'organize' || viewMode === 'organize'
                ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-magic-hover'
            }`}
            title="Organizar páginas"
          >
            <Layers className="w-4 h-4" />
          </button>

          {/* Pro Tools Tab */}
          <button
            onClick={() => toggleTab('tools')}
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
              activeSidebarTab === 'tools' || viewMode === 'tools'
                ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-magic-hover'
            }`}
            title="Herramientas Pro (Unir, Dividir, Comprimir, Firmar)"
          >
            <Wrench className="w-4 h-4" />
          </button>

          {/* Document Properties */}
          <button
            onClick={() => toggleTab('info')}
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
              activeSidebarTab === 'info'
                ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-magic-hover'
            }`}
            title="Información del documento"
          >
            <Info className="w-4 h-4" />
          </button>
        </div>

        {/* Collapse / Expand toggle button at bottom */}
        <button
          onClick={() => onSelectSidebarTab(isExpanded ? null : 'thumbnails')}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-magic-hover transition-colors"
          title={isExpanded ? 'Contraer panel lateral' : 'Expandir panel lateral'}
        >
          {isExpanded ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </div>

      {/* 2. Slide-out sidebar drawer (Thumbnails / Organize / Tools / Info) */}
      {isExpanded && (
        <div className="w-64 h-full flex flex-col bg-gray-50 dark:bg-magic-card border-r border-gray-200 dark:border-magic-border/70 overflow-hidden animate-in slide-in-from-left-4 duration-150">
          {/* Header */}
          <div className="h-10 px-3 border-b border-gray-200 dark:border-magic-border flex items-center justify-between bg-white dark:bg-magic-bg shrink-0">
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider">
              {activeSidebarTab === 'thumbnails' && 'Páginas'}
              {activeSidebarTab === 'organize' && 'Organizar'}
              {activeSidebarTab === 'tools' && 'Herramientas Pro'}
              {activeSidebarTab === 'info' && 'Propiedades'}
            </span>
            <button
              onClick={() => onSelectSidebarTab(null)}
              className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-magic-hover"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Drawer Content */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {/* THUMBNAILS TAB */}
            {activeSidebarTab === 'thumbnails' && (
              <div className="space-y-3">
                {Array.from({ length: document.pages }, (_, i) => i + 1).map((pageNum) => {
                  const isCurrent = currentPage === pageNum;
                  return (
                    <div
                      key={pageNum}
                      onClick={() => onPageSelect(pageNum)}
                      className={`group cursor-pointer rounded-xl p-2 border transition-all text-center flex flex-col items-center ${
                        isCurrent
                          ? 'border-indigo-500 bg-indigo-500/5 dark:bg-indigo-500/10 shadow-sm shadow-indigo-500/10'
                          : 'border-gray-200 dark:border-magic-border/70 bg-white dark:bg-magic-bg hover:border-gray-300 dark:hover:border-magic-hover'
                      }`}
                    >
                      <div className="w-36 h-48 bg-white border border-gray-200 dark:border-gray-800 rounded shadow-sm overflow-hidden flex items-center justify-center mb-1.5 relative">
                        <img
                          src={getPageImageUrl(document.filename, pageNum, 72)}
                          alt={`Página ${pageNum}`}
                          className="w-full h-full object-contain"
                          loading="lazy"
                        />
                        {isCurrent && (
                          <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-indigo-500 ring-2 ring-white dark:ring-magic-bg" />
                        )}
                      </div>
                      <span className={`text-xs font-medium ${isCurrent ? 'text-indigo-600 dark:text-indigo-300 font-semibold' : 'text-gray-500 dark:text-gray-400'}`}>
                        Página {pageNum}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ORGANIZE TAB */}
            {activeSidebarTab === 'organize' && (
              <div className="space-y-3 text-xs">
                <p className="text-gray-500 dark:text-gray-400 text-[11px]">
                  Acciones rápidas sobre la página {currentPage} de {document.pages}:
                </p>

                <div className="grid grid-cols-1 gap-2">
                  <button
                    onClick={onRotateCurrentPage}
                    className="flex items-center gap-2 p-2.5 rounded-lg border border-gray-200 dark:border-magic-border bg-white dark:bg-magic-bg hover:bg-gray-100 dark:hover:bg-magic-hover text-gray-700 dark:text-gray-200 transition-colors text-left"
                  >
                    <RotateCw className="w-4 h-4 text-indigo-500 shrink-0" />
                    <div>
                      <div className="font-medium">Rotar 90° Horaria</div>
                      <div className="text-[10px] text-gray-400">Gira la página actual</div>
                    </div>
                  </button>

                  <button
                    onClick={onDeleteCurrentPage}
                    className="flex items-center gap-2 p-2.5 rounded-lg border border-red-200 dark:border-red-900/30 bg-red-50/50 dark:bg-red-950/20 hover:bg-red-100/50 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 transition-colors text-left"
                  >
                    <Trash2 className="w-4 h-4 shrink-0" />
                    <div>
                      <div className="font-medium">Eliminar Página {currentPage}</div>
                      <div className="text-[10px] text-red-400/80">Quitar del documento</div>
                    </div>
                  </button>
                </div>

                <div className="pt-3 border-t border-gray-200 dark:border-magic-border">
                  <button
                    onClick={() => onViewModeChange('organize')}
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium text-center shadow-md shadow-indigo-600/20 transition-all flex items-center justify-center gap-1.5"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>Ver Cuadrícula Completa</span>
                  </button>
                </div>
              </div>
            )}

            {/* TOOLS TAB */}
            {activeSidebarTab === 'tools' && (
              <div className="space-y-2 text-xs">
                <button
                  onClick={() => {
                    onSelectTool('compress');
                    onViewModeChange('tools');
                  }}
                  className="w-full flex items-center gap-2.5 p-2 rounded-lg border border-gray-200 dark:border-magic-border bg-white dark:bg-magic-bg hover:bg-gray-100 dark:hover:bg-magic-hover text-gray-700 dark:text-gray-200 text-left transition-colors"
                >
                  <Minimize2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  <div>
                    <div className="font-medium">Comprimir PDF</div>
                    <div className="text-[10px] text-gray-400">Reduce el peso del archivo</div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    onSelectTool('merge');
                    onViewModeChange('tools');
                  }}
                  className="w-full flex items-center gap-2.5 p-2 rounded-lg border border-gray-200 dark:border-magic-border bg-white dark:bg-magic-bg hover:bg-gray-100 dark:hover:bg-magic-hover text-gray-700 dark:text-gray-200 text-left transition-colors"
                >
                  <FilePlus2 className="w-4 h-4 text-indigo-500 shrink-0" />
                  <div>
                    <div className="font-medium">Unir PDFs</div>
                    <div className="text-[10px] text-gray-400">Combina varios documentos</div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    onSelectTool('split');
                    onViewModeChange('tools');
                  }}
                  className="w-full flex items-center gap-2.5 p-2 rounded-lg border border-gray-200 dark:border-magic-border bg-white dark:bg-magic-bg hover:bg-gray-100 dark:hover:bg-magic-hover text-gray-700 dark:text-gray-200 text-left transition-colors"
                >
                  <Scissors className="w-4 h-4 text-pink-500 shrink-0" />
                  <div>
                    <div className="font-medium">Dividir PDF</div>
                    <div className="text-[10px] text-gray-400">Separa por páginas</div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    onSelectTool('sign');
                    onViewModeChange('tools');
                  }}
                  className="w-full flex items-center gap-2.5 p-2 rounded-lg border border-gray-200 dark:border-magic-border bg-white dark:bg-magic-bg hover:bg-gray-100 dark:hover:bg-magic-hover text-gray-700 dark:text-gray-200 text-left transition-colors"
                >
                  <PenTool className="w-4 h-4 text-amber-500 shrink-0" />
                  <div>
                    <div className="font-medium">Firmar / Rellenar</div>
                    <div className="text-[10px] text-gray-400">Dibuja o añade tu firma</div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    onSelectTool('watermark');
                    onViewModeChange('tools');
                  }}
                  className="w-full flex items-center gap-2.5 p-2 rounded-lg border border-gray-200 dark:border-magic-border bg-white dark:bg-magic-bg hover:bg-gray-100 dark:hover:bg-magic-hover text-gray-700 dark:text-gray-200 text-left transition-colors"
                >
                  <Stamp className="w-4 h-4 text-purple-500 shrink-0" />
                  <div>
                    <div className="font-medium">Marca de Agua</div>
                    <div className="text-[10px] text-gray-400">Añade texto personalizado</div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    onSelectTool('protect');
                    onViewModeChange('tools');
                  }}
                  className="w-full flex items-center gap-2.5 p-2 rounded-lg border border-gray-200 dark:border-magic-border bg-white dark:bg-magic-bg hover:bg-gray-100 dark:hover:bg-magic-hover text-gray-700 dark:text-gray-200 text-left transition-colors"
                >
                  <Shield className="w-4 h-4 text-blue-500 shrink-0" />
                  <div>
                    <div className="font-medium">Proteger Contraseña</div>
                    <div className="text-[10px] text-gray-400">Cifrado AES-256</div>
                  </div>
                </button>
              </div>
            )}

            {/* INFO TAB */}
            {activeSidebarTab === 'info' && (
              <div className="space-y-3 text-xs">
                <div className="p-3 bg-white dark:bg-magic-bg border border-gray-200 dark:border-magic-border rounded-xl space-y-2">
                  <div>
                    <span className="text-[10px] uppercase font-semibold text-gray-400">Nombre del archivo</span>
                    <div className="font-medium text-gray-800 dark:text-gray-200 truncate" title={document.name}>
                      {document.name}
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] uppercase font-semibold text-gray-400">Total de Páginas</span>
                    <div className="font-medium text-gray-800 dark:text-gray-200">
                      {document.pages} páginas
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] uppercase font-semibold text-gray-400">Tamaño</span>
                    <div className="font-medium text-gray-800 dark:text-gray-200">
                      {(document.size / (1024 * 1024)).toFixed(2)} MB ({document.size.toLocaleString()} bytes)
                    </div>
                  </div>

                  {document.originalDiskPath && (
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-gray-400">Ubicación en disco</span>
                      <div className="font-mono text-[10px] text-gray-500 break-all select-all">
                        {document.originalDiskPath}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};
