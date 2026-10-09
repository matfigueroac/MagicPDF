import React, { useState, useEffect, useRef } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  ZoomIn, 
  ZoomOut, 
  Maximize2, 
  Hand, 
  MousePointer, 
  RotateCw, 
  Sun, 
  Moon, 
  BookOpen, 
  Edit3, 
  ChevronsLeft, 
  ChevronsRight,
  Minimize2
} from 'lucide-react';
import { PdfDocument, ReadingMode } from '../types';
import { getPageImageUrl } from '../api/client';

interface ViewerViewProps {
  document: PdfDocument;
  currentPage: number;
  onPageChange: (page: number) => void;
  onEnterEditMode: () => void;
}

export const ViewerView: React.FC<ViewerViewProps> = ({
  document,
  currentPage,
  onPageChange,
  onEnterEditMode,
}) => {
  const [zoom, setZoom] = useState(1.0);
  const [rotation, setRotation] = useState(0); // 0, 90, 180, 270 visual rotation
  const [readingMode, setReadingMode] = useState<ReadingMode>('normal');
  const [interactionMode, setInteractionMode] = useState<'hand' | 'select'>('hand');
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const BASE_WIDTH = 850;

  // Reset image loaded on page change
  useEffect(() => {
    setImageLoaded(false);
  }, [document.filename, currentPage]);

  // Spacebar pan listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'INPUT') {
        setIsSpacePressed(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Mouse wheel zoom with Ctrl
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.1 : -0.1;
        setZoom(prev => Math.min(Math.max(0.3, +(prev + delta).toFixed(2)), 3.0));
      }
    };
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  // Canvas Drag / Pan Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (interactionMode === 'hand' || isSpacePressed || e.button === 1) {
      if (!containerRef.current) return;
      setIsDraggingCanvas(true);
      setDragStart({
        x: e.clientX,
        y: e.clientY,
        scrollLeft: containerRef.current.scrollLeft,
        scrollTop: containerRef.current.scrollTop
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingCanvas || !containerRef.current) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    containerRef.current.scrollLeft = dragStart.scrollLeft - dx;
    containerRef.current.scrollTop = dragStart.scrollTop - dy;
  };

  const handleMouseUp = () => {
    setIsDraggingCanvas(false);
  };

  // Zoom helpers
  const handleZoomIn = () => setZoom(prev => Math.min(3.0, +(prev + 0.15).toFixed(2)));
  const handleZoomOut = () => setZoom(prev => Math.max(0.3, +(prev - 0.15).toFixed(2)));
  const handleResetZoom = () => setZoom(1.0);
  const handleFitWidth = () => {
    if (!containerRef.current) return;
    const availableWidth = containerRef.current.clientWidth - 80;
    setZoom(+(availableWidth / BASE_WIDTH).toFixed(2));
  };
  const handleFitPage = () => {
    if (!containerRef.current) return;
    const availableHeight = containerRef.current.clientHeight - 80;
    setZoom(+(availableHeight / (BASE_WIDTH * 1.414)).toFixed(2));
  };

  // Rotation
  const handleRotate = () => {
    setRotation(prev => (prev + 90) % 360);
  };

  // Filter style based on readingMode
  const getFilterStyle = () => {
    if (readingMode === 'night') {
      return { filter: 'invert(0.92) hue-rotate(180deg) contrast(1.15) brightness(0.95)' };
    }
    if (readingMode === 'sepia') {
      return { filter: 'sepia(0.35) contrast(0.95) brightness(0.96)' };
    }
    return {};
  };

  const isPanningActive = interactionMode === 'hand' || isSpacePressed;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#E5E7EB] dark:bg-[#08080C] overflow-hidden select-none transition-colors">
      {/* 1. Foxit-Style Viewer Ribbon / Toolbar */}
      <div className="h-11 border-b border-gray-200 dark:border-magic-border bg-white dark:bg-magic-card px-3 flex items-center justify-between shrink-0 z-10 transition-colors shadow-sm">
        {/* Left: Interaction Tools & Zoom */}
        <div className="flex items-center gap-1.5">
          {/* Hand / Select Toggle */}
          <div className="flex items-center bg-gray-100 dark:bg-magic-bg p-0.5 rounded-lg border border-gray-200 dark:border-magic-border">
            <button
              onClick={() => setInteractionMode('hand')}
              className={`p-1.5 rounded-md text-xs transition-all ${
                interactionMode === 'hand'
                  ? 'bg-white dark:bg-magic-card text-indigo-600 dark:text-indigo-300 shadow-sm'
                  : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
              }`}
              title="Herramienta Mano (Paneo) [H o Espacio]"
            >
              <Hand className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setInteractionMode('select')}
              className={`p-1.5 rounded-md text-xs transition-all ${
                interactionMode === 'select'
                  ? 'bg-white dark:bg-magic-card text-indigo-600 dark:text-indigo-300 shadow-sm'
                  : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
              }`}
              title="Herramienta Puntero de Selección [V]"
            >
              <MousePointer className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="h-4 w-px bg-gray-200 dark:bg-magic-border mx-1" />

          {/* Zoom controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={handleZoomOut}
              className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-magic-hover text-gray-600 dark:text-gray-300 transition-colors"
              title="Reducir Zoom (Ctrl -)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleResetZoom}
              className="px-2 py-0.5 rounded-md hover:bg-gray-100 dark:hover:bg-magic-hover text-xs font-mono font-medium text-gray-700 dark:text-gray-300 transition-colors min-w-[50px] text-center"
              title="Restablecer al 100%"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={handleZoomIn}
              className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-magic-hover text-gray-600 dark:text-gray-300 transition-colors"
              title="Aumentar Zoom (Ctrl +)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleFitWidth}
              className="px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-magic-hover text-xs font-medium text-gray-600 dark:text-gray-300 transition-colors hidden sm:inline"
              title="Ajustar al Ancho de la Ventana"
            >
              Ajustar ancho
            </button>
            <button
              onClick={handleFitPage}
              className="px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-magic-hover text-xs font-medium text-gray-600 dark:text-gray-300 transition-colors hidden sm:inline"
              title="Ajustar a la Página Completa"
            >
              Ajustar página
            </button>
          </div>

          <div className="h-4 w-px bg-gray-200 dark:bg-magic-border mx-1" />

          {/* Rotate View button */}
          <button
            onClick={handleRotate}
            className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-magic-hover text-gray-600 dark:text-gray-300 transition-colors flex items-center gap-1 text-xs"
            title="Girar vista 90°"
          >
            <RotateCw className="w-3.5 h-3.5 text-indigo-500" />
            <span className="hidden md:inline font-medium">Girar vista</span>
          </button>
        </div>

        {/* Right: Reading Mode (Luz / Noche / Sepia) & Edit Button */}
        <div className="flex items-center gap-2">
          {/* Reading Mode Selector */}
          <div className="flex items-center bg-gray-100 dark:bg-magic-bg p-0.5 rounded-lg border border-gray-200 dark:border-magic-border">
            <button
              onClick={() => setReadingMode('normal')}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1 ${
                readingMode === 'normal'
                  ? 'bg-white dark:bg-magic-card text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
              title="Modo Luz (Blanco original)"
            >
              <Sun className="w-3 h-3 text-amber-500" />
              <span className="hidden sm:inline">Luz</span>
            </button>

            <button
              onClick={() => setReadingMode('night')}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1 ${
                readingMode === 'night'
                  ? 'bg-white dark:bg-magic-card text-indigo-600 dark:text-indigo-400 shadow-sm'
                  : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
              title="Modo Noche (Invertido anti-fatiga visual)"
            >
              <Moon className="w-3 h-3 text-indigo-500" />
              <span className="hidden sm:inline">Noche</span>
            </button>

            <button
              onClick={() => setReadingMode('sepia')}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1 ${
                readingMode === 'sepia'
                  ? 'bg-white dark:bg-magic-card text-amber-700 dark:text-amber-400 shadow-sm'
                  : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
              title="Modo Sepia (Tono cálido tipo libro)"
            >
              <BookOpen className="w-3 h-3 text-amber-600" />
              <span className="hidden sm:inline">Sepia</span>
            </button>
          </div>

          <div className="h-4 w-px bg-gray-200 dark:bg-magic-border mx-1" />

          {/* Prominent "Editar PDF" Button */}
          <button
            onClick={onEnterEditMode}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/25 hover:scale-[1.02] active:scale-[0.98] transition-all"
            title="Activar Editor de Texto WYSIWYG"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Editar PDF</span>
          </button>
        </div>
      </div>

      {/* 2. Main Canvas Viewport */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className={`flex-1 overflow-auto p-8 flex items-start justify-center ${
          isPanningActive
            ? isDraggingCanvas ? 'cursor-grabbing' : 'cursor-grab'
            : 'cursor-default'
        }`}
      >
        <div 
          className="relative transition-all duration-75 ease-out shrink-0 my-auto shadow-2xl rounded-sm"
          style={{
            width: `${BASE_WIDTH * zoom}px`,
            transform: rotation !== 0 ? `rotate(${rotation}deg)` : undefined,
            transformOrigin: 'center center'
          }}
        >
          {/* High-res Rendered PDF Page */}
          <img
            ref={imageRef}
            src={getPageImageUrl(document.filename, currentPage, 150)}
            alt={`Página ${currentPage}`}
            onLoad={() => setImageLoaded(true)}
            style={getFilterStyle()}
            className={`w-full h-auto block select-none pointer-events-none rounded-sm transition-opacity duration-200 ${
              imageLoaded ? 'opacity-100' : 'opacity-20'
            }`}
            draggable={false}
          />

          {!imageLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/50 dark:bg-black/50 backdrop-blur-sm rounded-sm">
              <div className="flex flex-col items-center gap-2">
                <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Cargando página...</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3. Bottom Status Bar (Page Navigation & Zoom) */}
      <footer className="h-9 border-t border-gray-200 dark:border-magic-border bg-white dark:bg-magic-card px-4 flex items-center justify-between shrink-0 text-xs text-gray-600 dark:text-gray-400 transition-colors">
        {/* Left: Page Navigation */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onPageChange(1)}
            disabled={currentPage <= 1}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-magic-hover disabled:opacity-30 disabled:hover:bg-transparent"
            title="Primera página"
          >
            <ChevronsLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-magic-hover disabled:opacity-30 disabled:hover:bg-transparent"
            title="Página anterior"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center gap-1 px-1">
            <input
              type="number"
              min={1}
              max={document.pages}
              value={currentPage}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (val >= 1 && val <= document.pages) {
                  onPageChange(val);
                }
              }}
              className="w-10 h-6 text-center font-medium bg-gray-100 dark:bg-magic-bg border border-gray-200 dark:border-magic-border rounded text-gray-900 dark:text-gray-100 text-xs focus:outline-none focus:border-indigo-500"
            />
            <span>/</span>
            <span className="font-medium text-gray-700 dark:text-gray-300">{document.pages}</span>
          </div>

          <button
            onClick={() => onPageChange(Math.min(document.pages, currentPage + 1))}
            disabled={currentPage >= document.pages}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-magic-hover disabled:opacity-30 disabled:hover:bg-transparent"
            title="Página siguiente"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onPageChange(document.pages)}
            disabled={currentPage >= document.pages}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-magic-hover disabled:opacity-30 disabled:hover:bg-transparent"
            title="Última página"
          >
            <ChevronsRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Center / Right: Zoom summary & Document name */}
        <div className="flex items-center gap-3">
          <span className="truncate max-w-[200px] text-[11px] text-gray-400 hidden md:inline">
            {document.name}
          </span>
          <span className="font-mono text-[11px] text-gray-500">
            {Math.round(zoom * 100)}%
          </span>
        </div>
      </footer>
    </div>
  );
};
