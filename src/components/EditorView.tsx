import React, { useState, useEffect, useRef } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  ZoomIn, 
  ZoomOut, 
  Maximize2, 
  Type, 
  Check, 
  X, 
  Bold, 
  Italic, 
  Palette, 
  RefreshCw,
  PlusCircle,
  HelpCircle,
  Hand,
  MousePointer,
  RotateCcw,
  Minimize2
} from 'lucide-react';
import { PdfDocument, ParagraphInfo } from '../types';
import { getPageImageUrl, getParagraphs, editText, addText } from '../api/client';

interface EditorViewProps {
  document: PdfDocument;
  onDocumentUpdated: () => void;
}

export const EditorView: React.FC<EditorViewProps> = ({ document, onDocumentUpdated }) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1.0);
  const [paragraphs, setParagraphs] = useState<ParagraphInfo[]>([]);
  const [isLoadingParagraphs, setIsLoadingParagraphs] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  
  // Tool mode: 'select' (click to edit) vs 'hand' (click & drag to pan)
  const [interactionMode, setInteractionMode] = useState<'select' | 'hand'>('select');
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  // Selected/Editing paragraph state
  const [editingParagraph, setEditingParagraph] = useState<ParagraphInfo | null>(null);
  const [editTextValue, setEditTextValue] = useState('');
  const [editFont, setEditFont] = useState('helvetica');
  const [editSize, setEditSize] = useState<number>(14);
  const [editColor, setEditColor] = useState('#222226');
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Add new text mode
  const [isAddingText, setIsAddingText] = useState(false);
  const [newTextCoords, setNewTextCoords] = useState<[number, number] | null>(null);
  const [newTextValue, setNewTextValue] = useState('');

  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Base page width in CSS pixels (at 100% zoom)
  const BASE_WIDTH = 850;

  // Load paragraphs for current page
  const loadPageData = async () => {
    try {
      setIsLoadingParagraphs(true);
      const data = await getParagraphs(document.filename, currentPage);
      setParagraphs(data);
    } catch (err) {
      console.error('Error loading paragraphs:', err);
    } finally {
      setIsLoadingParagraphs(false);
    }
  };

  useEffect(() => {
    setImageLoaded(false);
    setEditingParagraph(null);
    setNewTextCoords(null);
    loadPageData();
  }, [document.filename, currentPage]);

  // Track spacebar for quick panning
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !editingParagraph && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
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
  }, [editingParagraph]);

  // Pan / Drag handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Enable pan if in hand mode, space pressed, or middle mouse click (button 1)
    if (interactionMode === 'hand' || isSpacePressed || e.button === 1) {
      if (!containerRef.current) return;
      setIsDraggingCanvas(true);
      setDragStart({
        x: e.clientX,
        y: e.clientY,
        scrollLeft: containerRef.current.scrollLeft,
        scrollTop: containerRef.current.scrollTop
      });
      e.preventDefault();
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingCanvas || !containerRef.current) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    containerRef.current.scrollLeft = dragStart.scrollLeft - dx;
    containerRef.current.scrollTop = dragStart.scrollTop - dy;
  };

  const handleMouseUp = () => {
    setIsDraggingCanvas(false);
  };

  // Ctrl + Wheel to Zoom
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      setZoom(z => Math.min(3.0, Math.max(0.4, Number((z + delta).toFixed(2)))));
    }
  };

  // Fit Width & Fit Page
  const handleFitWidth = () => {
    if (!containerRef.current) return;
    const containerWidth = containerRef.current.clientWidth - 80;
    const newZoom = Math.min(2.5, Math.max(0.4, containerWidth / BASE_WIDTH));
    setZoom(Number(newZoom.toFixed(2)));
  };

  const handleFitPage = () => {
    if (!containerRef.current || !imageRef.current) return;
    const containerHeight = containerRef.current.clientHeight - 80;
    const aspectRatio = (imageRef.current.naturalHeight || 1100) / (imageRef.current.naturalWidth || 850);
    const pageHeight = BASE_WIDTH * aspectRatio;
    const newZoom = Math.min(2.5, Math.max(0.4, containerHeight / pageHeight));
    setZoom(Number(newZoom.toFixed(2)));
  };

  const handleParagraphClick = (p: ParagraphInfo) => {
    if (interactionMode === 'hand' || isSpacePressed) return;
    setEditingParagraph(p);
    setEditTextValue(p.text);
    setEditSize(p.size ? Math.round(p.size) : 14);
    setEditFont(p.font ? p.font.toLowerCase() : 'helvetica');
    setEditColor(p.color || '#222226');
  };

  const handleSaveEdit = async () => {
    if (!editingParagraph) return;
    try {
      setIsSaving(true);
      await editText(document.filename, currentPage, editingParagraph.paragraph, editTextValue, {
        font: editFont,
        size: editSize,
        color: editColor,
        bold: isBold,
        italic: isItalic
      });
      setEditingParagraph(null);
      setImageLoaded(false);
      await loadPageData();
      onDocumentUpdated();
    } catch (err: any) {
      alert(`Error al guardar edición: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isAddingText || !imageRef.current) return;
    const rect = imageRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const scaleX = (imageRef.current.naturalWidth / 96 * 72) / rect.width;
    const scaleY = (imageRef.current.naturalHeight / 96 * 72) / rect.height;

    const pdfX = Math.round(clickX * scaleX);
    const pdfY = Math.round(clickY * scaleY);

    setNewTextCoords([pdfX, pdfY]);
    setNewTextValue('Nuevo texto');
  };

  const handleSaveNewText = async () => {
    if (!newTextCoords || !newTextValue.trim()) return;
    try {
      setIsSaving(true);
      await addText(document.filename, currentPage, newTextValue, newTextCoords, {
        size: editSize,
        font: editFont,
        color: editColor,
        bold: isBold,
        italic: isItalic,
      });
      setNewTextCoords(null);
      setIsAddingText(false);
      setImageLoaded(false);
      await loadPageData();
      onDocumentUpdated();
    } catch (err: any) {
      alert(`Error al añadir texto: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Coordinates mapping
  const getBoxStyle = (pRect: [number, number, number, number]) => {
    if (!imageRef.current) return { display: 'none' };
    
    const docPtWidth = (imageRef.current.naturalWidth / 120) * 72;
    const docPtHeight = (imageRef.current.naturalHeight / 120) * 72;

    const [x1, y1, x2, y2] = pRect;
    const left = (x1 / docPtWidth) * 100;
    const top = (y1 / docPtHeight) * 100;
    const width = ((x2 - x1) / docPtWidth) * 100;
    const height = ((y2 - y1) / docPtHeight) * 100;

    return {
      left: `${left}%`,
      top: `${top}%`,
      width: `${Math.max(width, 2)}%`,
      height: `${Math.max(height, 2)}%`,
    };
  };

  const isHandActive = interactionMode === 'hand' || isSpacePressed;

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-4rem)] overflow-hidden bg-magic-bg select-none">
      {/* Top Toolbar */}
      <div className="h-12 border-b border-magic-border bg-magic-card/90 px-4 flex items-center justify-between shrink-0 z-20">
        {/* Left: Page Navigation & Mode */}
        <div className="flex items-center gap-2">
          {/* Page controls */}
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-magic-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <span className="text-xs font-semibold text-gray-200">
            Página <span className="text-indigo-400">{currentPage}</span> de {document.pages}
          </span>

          <button
            onClick={() => setCurrentPage(p => Math.min(document.pages, p + 1))}
            disabled={currentPage >= document.pages}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-magic-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-magic-border mx-1" />

          {/* Tool Toggles: Select vs Hand (Pan) */}
          <div className="flex items-center bg-magic-bg p-0.5 rounded-lg border border-magic-border">
            <button
              onClick={() => {
                setInteractionMode('select');
                setIsAddingText(false);
              }}
              className={`p-1.5 rounded-md text-xs transition-colors ${
                interactionMode === 'select' && !isAddingText
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-400 hover:text-white'
              }`}
              title="Herramienta Selección / Edición de Texto"
            >
              <MousePointer className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                setInteractionMode('hand');
                setIsAddingText(false);
                setEditingParagraph(null);
              }}
              className={`p-1.5 rounded-md text-xs transition-colors ${
                interactionMode === 'hand'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-400 hover:text-white'
              }`}
              title="Herramienta Mano para mover la página (o mantén pulsada la barra espaciadora)"
            >
              <Hand className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Add Text tool */}
          <button
            onClick={() => {
              setIsAddingText(!isAddingText);
              setEditingParagraph(null);
              setInteractionMode('select');
            }}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all ${
              isAddingText
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-gray-300 hover:text-white hover:bg-magic-hover'
            }`}
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>{isAddingText ? 'Haz clic en el PDF' : '+ Añadir Texto'}</span>
          </button>
        </div>

        {/* Center: Hint */}
        <div className="hidden lg:flex items-center gap-1.5 text-xs text-gray-400 bg-magic-bg px-3 py-1 rounded-full border border-magic-border/70">
          <HelpCircle className="w-3.5 h-3.5 text-indigo-400" />
          <span>
            {isHandActive 
              ? 'Arrastra con el ratón para mover la página' 
              : 'Haz clic en cualquier texto para editarlo • Ctrl + Rueda para Zoom'}
          </span>
        </div>

        {/* Right: Zoom Controls */}
        <div className="flex items-center gap-1 bg-magic-bg px-1.5 py-1 rounded-lg border border-magic-border">
          <button
            onClick={() => setZoom(z => Math.max(0.4, Number((z - 0.15).toFixed(2))))}
            className="p-1 rounded text-gray-400 hover:text-white hover:bg-magic-hover transition-colors"
            title="Reducir Zoom"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          <span className="text-xs font-mono text-gray-300 px-1.5 min-w-[48px] text-center">
            {Math.round(zoom * 100)}%
          </span>

          <button
            onClick={() => setZoom(z => Math.min(3.0, Number((z + 0.15).toFixed(2))))}
            className="p-1 rounded text-gray-400 hover:text-white hover:bg-magic-hover transition-colors"
            title="Aumentar Zoom"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>

          <div className="h-3 w-px bg-magic-border mx-0.5" />

          {/* Reset Zoom */}
          <button
            onClick={() => setZoom(1.0)}
            className="p-1 rounded text-gray-400 hover:text-white hover:bg-magic-hover transition-colors text-[10px] font-mono"
            title="100%"
          >
            100%
          </button>

          {/* Fit Width */}
          <button
            onClick={handleFitWidth}
            className="p-1 rounded text-gray-400 hover:text-white hover:bg-magic-hover transition-colors"
            title="Ajustar al Ancho"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>

          {/* Fit Page */}
          <button
            onClick={handleFitPage}
            className="p-1 rounded text-gray-400 hover:text-white hover:bg-magic-hover transition-colors"
            title="Ajustar Página Completa"
          >
            <Minimize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Scrollable Canvas Area (Never clips top or left!) */}
      <div 
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        className={`flex-1 overflow-auto relative bg-[#060608] ${
          isHandActive
            ? isDraggingCanvas ? 'cursor-grabbing' : 'cursor-grab'
            : isAddingText ? 'cursor-crosshair' : 'cursor-default'
        }`}
      >
        {/* Inner wrapper ensures top padding and horizontal centering without flex centering bugs */}
        <div className="min-h-full min-w-full flex items-start justify-center p-10 pb-28">
          <div 
            onClick={handlePageClick}
            style={{ width: `${BASE_WIDTH * zoom}px` }}
            className="relative shadow-2xl transition-all duration-75 rounded-sm overflow-hidden border border-gray-700/60 bg-white shrink-0"
          >
            {/* High-res page rendering */}
            <img
              ref={imageRef}
              src={getPageImageUrl(document.filename, currentPage, 120)}
              alt={`Página ${currentPage}`}
              onLoad={() => setImageLoaded(true)}
              className="w-full h-auto block pointer-events-none select-none bg-white"
            />

            {/* Interactive Bounding Boxes for Paragraphs (Only active in Select mode) */}
            {imageLoaded && !isHandActive && paragraphs.map((p) => {
              const isEditing = editingParagraph?.paragraph === p.paragraph;
              const style = getBoxStyle(p.rect);

              return (
                <div
                  key={p.paragraph}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleParagraphClick(p);
                  }}
                  style={style}
                  className={`absolute group cursor-pointer transition-all ${
                    isEditing
                      ? 'ring-2 ring-indigo-500 bg-indigo-500/20 z-20'
                      : 'hover:ring-2 hover:ring-indigo-400/80 hover:bg-indigo-500/10 z-10'
                  }`}
                  title={`Párrafo ${p.paragraph}: Haz clic para editar`}
                >
                  {!isEditing && (
                    <div className="hidden group-hover:flex items-center gap-1 absolute -top-6 left-0 px-1.5 py-0.5 rounded bg-magic-card text-[10px] text-white font-medium border border-magic-border shadow-lg pointer-events-none whitespace-nowrap z-30">
                      <Type className="w-2.5 h-2.5 text-indigo-400" />
                      <span>Editar texto</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Floating WYSIWYG Format Bar for Editing */}
      {editingParagraph && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-2xl bg-magic-card border border-magic-border/90 rounded-2xl p-4 shadow-2xl shadow-black/70 backdrop-blur-xl z-40 animate-in fade-in slide-in-from-bottom-4">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-magic-border">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-bold text-white">
                Editando Párrafo #{editingParagraph.paragraph} (Página {currentPage})
              </span>
            </div>

            {/* Typography Controls */}
            <div className="flex items-center gap-2">
              <select
                value={editFont}
                onChange={(e) => setEditFont(e.target.value)}
                className="bg-magic-bg border border-magic-border rounded-lg text-xs text-gray-200 px-2 py-1 outline-none focus:border-indigo-500"
              >
                <option value="helvetica">Helvetica</option>
                <option value="times">Times Roman</option>
                <option value="courier">Courier</option>
              </select>

              <div className="flex items-center gap-1 bg-magic-bg border border-magic-border rounded-lg px-2 py-1 text-xs text-gray-200">
                <span className="text-[10px] text-gray-500">Tam:</span>
                <input
                  type="number"
                  min="6"
                  max="120"
                  value={editSize}
                  onChange={(e) => setEditSize(Number(e.target.value))}
                  className="w-10 bg-transparent text-center font-mono outline-none"
                />
              </div>

              <button
                onClick={() => setIsBold(!isBold)}
                className={`p-1 rounded text-xs transition-colors ${isBold ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                <Bold className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setIsItalic(!isItalic)}
                className={`p-1 rounded text-xs transition-colors ${isItalic ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                <Italic className="w-3.5 h-3.5" />
              </button>

              <div className="flex items-center gap-1 pl-1">
                <Palette className="w-3.5 h-3.5 text-gray-400" />
                <input
                  type="color"
                  value={editColor}
                  onChange={(e) => setEditColor(e.target.value)}
                  className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent"
                />
              </div>
            </div>
          </div>

          <textarea
            value={editTextValue}
            onChange={(e) => setEditTextValue(e.target.value)}
            rows={3}
            autoFocus
            className="w-full bg-magic-bg/90 border border-magic-border rounded-xl p-3 text-sm text-gray-100 font-sans outline-none focus:border-indigo-500 transition-colors resize-none leading-relaxed"
            placeholder="Escribe el nuevo texto aquí..."
          />

          <div className="flex items-center justify-end gap-2 mt-3">
            <button
              onClick={() => setEditingParagraph(null)}
              disabled={isSaving}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold text-gray-400 hover:text-white hover:bg-magic-hover transition-colors"
            >
              Cancelar
            </button>

            <button
              onClick={handleSaveEdit}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Aplicando cambio...</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Guardar en PDF</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Floating Modal for Adding New Text */}
      {newTextCoords && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-md bg-magic-card border border-magic-border rounded-2xl p-4 shadow-2xl z-40">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-magic-border">
            <span className="text-xs font-bold text-white">Añadir Nuevo Texto</span>
            <button onClick={() => setNewTextCoords(null)} className="text-gray-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>

          <textarea
            value={newTextValue}
            onChange={(e) => setNewTextValue(e.target.value)}
            rows={2}
            autoFocus
            className="w-full bg-magic-bg border border-magic-border rounded-xl p-2.5 text-xs text-white outline-none focus:border-indigo-500 resize-none"
            placeholder="Escribe el texto a insertar..."
          />

          <div className="flex items-center justify-end gap-2 mt-2">
            <button
              onClick={handleSaveNewText}
              disabled={isSaving}
              className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors"
            >
              {isSaving ? 'Insertando...' : 'Insertar en PDF'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
