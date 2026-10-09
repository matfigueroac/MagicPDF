import React, { useState } from 'react';
import { 
  RotateCw, 
  Trash2, 
  ArrowLeft, 
  ArrowRight, 
  Check, 
  RefreshCw, 
  RotateCcw,
  Sparkles,
  AlertTriangle
} from 'lucide-react';
import { PdfDocument } from '../types';
import { getPageImageUrl, organizePages } from '../api/client';

interface OrganizeViewProps {
  document: PdfDocument;
  onDocumentUpdated: () => void;
}

interface PageState {
  originalPage: number;
  rotation: number;
  isDeleted: boolean;
}

export const OrganizeView: React.FC<OrganizeViewProps> = ({ document, onDocumentUpdated }) => {
  // Initialize state for each page
  const [pages, setPages] = useState<PageState[]>(() => 
    Array.from({ length: document.pages }, (_, i) => ({
      originalPage: i + 1,
      rotation: 0,
      isDeleted: false,
    }))
  );
  const [isSaving, setIsSaving] = useState(false);

  // Rotate a page by +90 degrees
  const handleRotate = (index: number) => {
    setPages(prev => prev.map((p, i) => {
      if (i !== index) return p;
      return { ...p, rotation: (p.rotation + 90) % 360 };
    }));
  };

  // Toggle deletion
  const handleToggleDelete = (index: number) => {
    setPages(prev => prev.map((p, i) => {
      if (i !== index) return p;
      return { ...p, isDeleted: !p.isDeleted };
    }));
  };

  // Move page left
  const handleMoveLeft = (index: number) => {
    if (index <= 0) return;
    setPages(prev => {
      const copy = [...prev];
      const temp = copy[index - 1];
      copy[index - 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
  };

  // Move page right
  const handleMoveRight = (index: number) => {
    if (index >= pages.length - 1) return;
    setPages(prev => {
      const copy = [...prev];
      const temp = copy[index + 1];
      copy[index + 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
  };

  // Rotate all pages
  const handleRotateAll = () => {
    setPages(prev => prev.map(p => ({ ...p, rotation: (p.rotation + 90) % 360 })));
  };

  // Reset changes
  const handleReset = () => {
    setPages(Array.from({ length: document.pages }, (_, i) => ({
      originalPage: i + 1,
      rotation: 0,
      isDeleted: false,
    })));
  };

  // Save changes via backend API
  const handleSaveChanges = async () => {
    try {
      setIsSaving(true);
      const rotations: Array<{ page: number; by: number }> = [];
      const deletions: number[] = [];

      pages.forEach(p => {
        if (p.isDeleted) {
          deletions.push(p.originalPage);
        } else if (p.rotation > 0) {
          rotations.push({ page: p.originalPage, by: p.rotation });
        }
      });

      if (deletions.length === document.pages) {
        alert('No puedes eliminar todas las páginas del documento.');
        return;
      }

      await organizePages(document.filename, rotations, deletions);
      alert('¡Documento reorganizado con éxito!');
      onDocumentUpdated();
    } catch (err: any) {
      alert(`Error al organizar páginas: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const activePageCount = pages.filter(p => !p.isDeleted).length;
  const hasChanges = pages.some(p => p.rotation !== 0 || p.isDeleted);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden select-none bg-gray-50 dark:bg-magic-bg transition-colors">
      {/* Top Action Bar */}
      <div className="h-12 border-b border-gray-200 dark:border-magic-border bg-white dark:bg-magic-card px-4 flex items-center justify-between shrink-0 transition-colors">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-gray-900 dark:text-white">Organizar Páginas</span>
            <span className="text-xs text-gray-600 dark:text-gray-400 font-mono bg-gray-100 dark:bg-magic-bg px-2 py-0.5 rounded-md border border-gray-200 dark:border-magic-border">
              {activePageCount} de {document.pages} páginas activas
            </span>
          </div>

          <div className="h-4 w-px bg-gray-200 dark:bg-magic-border mx-1" />

          <button
            onClick={handleRotateAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-magic-bg hover:bg-gray-200 dark:hover:bg-magic-hover text-xs font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-magic-border transition-colors"
          >
            <RotateCw className="w-3.5 h-3.5 text-indigo-500" />
            <span>Rotar Todo 90°</span>
          </button>

          {hasChanges && (
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-magic-bg hover:bg-gray-200 dark:hover:bg-magic-hover text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-magic-border transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Restablecer</span>
            </button>
          )}
        </div>

        {/* Save button */}
        <button
          onClick={handleSaveChanges}
          disabled={isSaving || !hasChanges}
          className="flex items-center gap-2 px-4 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:scale-[1.02]"
        >
          {isSaving ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Guardando...</span>
            </>
          ) : (
            <>
              <Check className="w-3.5 h-3.5" />
              <span>Aplicar y Guardar Cambios</span>
            </>
          )}
        </button>
      </div>

      {/* Pages Grid */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6 max-w-7xl mx-auto">
          {pages.map((p, index) => {
            return (
              <div
                key={index}
                className={`group relative rounded-2xl border transition-all duration-200 flex flex-col bg-white dark:bg-magic-card overflow-hidden shadow-sm hover:shadow-lg ${
                  p.isDeleted
                    ? 'opacity-30 border-rose-500/50 bg-rose-50 dark:bg-rose-950/10'
                    : 'border-gray-200 dark:border-magic-border hover:border-indigo-500/60 hover:shadow-indigo-500/10'
                }`}
              >
                {/* Header Badge */}
                <div className="h-8 px-3 flex items-center justify-between bg-gray-50 dark:bg-magic-bg/70 border-b border-gray-200 dark:border-magic-border/50 text-[11px] font-semibold">
                  <span className={p.isDeleted ? 'line-through text-rose-500' : 'text-gray-700 dark:text-gray-300'}>
                    Página {p.originalPage}
                  </span>
                  {p.rotation > 0 && !p.isDeleted && (
                    <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-mono">
                      {p.rotation}°
                    </span>
                  )}
                </div>

                {/* Thumbnail Preview with Rotation Transform */}
                <div className="p-3 flex items-center justify-center bg-gray-100 dark:bg-gray-900/50 aspect-[3/4] overflow-hidden relative">
                  <img
                    src={getPageImageUrl(document.filename, p.originalPage, 60)}
                    alt={`Página ${p.originalPage}`}
                    style={{ transform: `rotate(${p.rotation}deg)` }}
                    className="max-h-full max-w-full object-contain transition-transform duration-200 shadow-md bg-white rounded-sm"
                  />

                  {/* Deleted Overlay */}
                  {p.isDeleted && (
                    <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center text-rose-400">
                      <Trash2 className="w-6 h-6 mb-1" />
                      <span className="text-[10px] font-bold uppercase tracking-wider">Eliminada</span>
                    </div>
                  )}
                </div>

                {/* Footer Controls */}
                <div className="h-10 px-2 flex items-center justify-around bg-gray-50 dark:bg-magic-bg/90 border-t border-gray-200 dark:border-magic-border/50">
                  {/* Rotate */}
                  <button
                    onClick={() => handleRotate(index)}
                    disabled={p.isDeleted}
                    title="Rotar 90°"
                    className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-magic-hover disabled:opacity-30 transition-colors"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                  </button>

                  {/* Move Left */}
                  <button
                    onClick={() => handleMoveLeft(index)}
                    disabled={index === 0 || p.isDeleted}
                    title="Mover a la izquierda"
                    className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-magic-hover disabled:opacity-20 transition-colors"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                  </button>

                  {/* Move Right */}
                  <button
                    onClick={() => handleMoveRight(index)}
                    disabled={index === pages.length - 1 || p.isDeleted}
                    title="Mover a la derecha"
                    className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-magic-hover disabled:opacity-20 transition-colors"
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>

                  {/* Delete Toggle */}
                  <button
                    onClick={() => handleToggleDelete(index)}
                    title={p.isDeleted ? 'Restaurar página' : 'Eliminar página'}
                    className={`p-1.5 rounded-lg transition-colors ${
                      p.isDeleted
                        ? 'text-rose-500 hover:bg-rose-500/20'
                        : 'text-gray-500 dark:text-gray-400 hover:text-rose-500 hover:bg-gray-200 dark:hover:bg-magic-hover'
                    }`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
