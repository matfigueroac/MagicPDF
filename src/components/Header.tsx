import React from 'react';
import { 
  Sparkles, 
  FileText, 
  Layers, 
  Wrench, 
  Download, 
  Plus, 
  Edit3, 
  FileCheck2,
  X
} from 'lucide-react';
import { PdfDocument, ViewMode } from '../types';
import { getDownloadUrl } from '../api/client';

interface HeaderProps {
  documents: PdfDocument[];
  activeDoc: PdfDocument | null;
  onSelectDoc: (doc: PdfDocument) => void;
  onCloseDoc: (docId: string) => void;
  onUploadClick: () => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

export const Header: React.FC<HeaderProps> = ({
  documents,
  activeDoc,
  onSelectDoc,
  onCloseDoc,
  onUploadClick,
  viewMode,
  onViewModeChange,
}) => {
  return (
    <header className="h-16 border-b border-magic-border bg-magic-bg/90 backdrop-blur-md px-4 flex items-center justify-between shrink-0 select-none z-30">
      {/* Brand & Document Tabs */}
      <div className="flex items-center gap-4 overflow-hidden">
        {/* Brand */}
        <div 
          onClick={() => onViewModeChange('dashboard')}
          className="flex items-center gap-2 cursor-pointer group shrink-0 pr-3 border-r border-magic-border/70"
        >
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:scale-105 transition-transform">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-base tracking-tight bg-gradient-to-r from-white via-indigo-100 to-indigo-300 bg-clip-text text-transparent">
              MagicPDF
            </span>
            <span className="text-[10px] uppercase font-semibold tracking-wider text-indigo-400/80 -mt-1">
              Pro Studio
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
          {documents.map((doc) => {
            const isActive = activeDoc?.id === doc.id;
            return (
              <div
                key={doc.id}
                onClick={() => onSelectDoc(doc)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all border ${
                  isActive
                    ? 'bg-magic-card text-indigo-200 border-indigo-500/40 shadow-sm shadow-indigo-500/10'
                    : 'bg-magic-bg hover:bg-magic-hover text-gray-400 border-transparent hover:text-gray-200'
                }`}
              >
                <FileText className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-indigo-400' : 'text-gray-500'}`} />
                <span className="truncate max-w-[140px]">{doc.name}</span>
                <span className="text-[10px] text-gray-500 font-mono">({doc.pages}p)</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseDoc(doc.id);
                  }}
                  className="hover:bg-gray-700/50 p-0.5 rounded text-gray-400 hover:text-white transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}

          <button
            onClick={onUploadClick}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-white hover:bg-magic-hover transition-colors shrink-0"
            title="Abrir otro documento"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Abrir</span>
          </button>
        </div>
      </div>

      {/* Mode Navigation */}
      {activeDoc && (
        <div className="flex items-center bg-magic-card p-1 rounded-xl border border-magic-border shrink-0 shadow-inner">
          <button
            onClick={() => onViewModeChange('editor')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              viewMode === 'editor'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-gray-400 hover:text-gray-200 hover:bg-magic-hover'
            }`}
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Editar Texto</span>
          </button>

          <button
            onClick={() => onViewModeChange('organize')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              viewMode === 'organize'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-gray-400 hover:text-gray-200 hover:bg-magic-hover'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Organizar Páginas</span>
          </button>

          <button
            onClick={() => onViewModeChange('tools')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              viewMode === 'tools'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-gray-400 hover:text-gray-200 hover:bg-magic-hover'
            }`}
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>Herramientas Pro</span>
          </button>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {activeDoc && (
          <a
            href={getDownloadUrl(activeDoc.filename)}
            download={activeDoc.name}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-semibold shadow-lg shadow-emerald-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Descargar PDF</span>
          </a>
        )}
      </div>
    </header>
  );
};
