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
  RotateCw,
  Trash2,
  Image as ImageIcon,
  Minimize2,
  FlipHorizontal,
  Upload
} from 'lucide-react';
import { PdfDocument, ParagraphInfo, ImageInfo } from '../types';
import { 
  getPageImageUrl, 
  getParagraphs, 
  editText, 
  addText, 
  getPageImages, 
  editImage 
} from '../api/client';

interface EditorViewProps {
  document: PdfDocument;
  currentPage: number;
  onPageChange: (page: number) => void;
  onDocumentUpdated: () => void;
  onReturnToViewer: () => void;
}

export const EditorView: React.FC<EditorViewProps> = ({ 
  document, 
  currentPage,
  onPageChange,
  onDocumentUpdated,
  onReturnToViewer 
}) => {
  const [zoom, setZoom] = useState(1.0);
  const [paragraphs, setParagraphs] = useState<ParagraphInfo[]>([]);
  const [images, setImages] = useState<ImageInfo[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
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

  // Selected Image state
  const [selectedImage, setSelectedImage] = useState<ImageInfo | null>(null);

  // Add new text mode
  const [isAddingText, setIsAddingText] = useState(false);
  const [newTextCoords, setNewTextCoords] = useState<[number, number] | null>(null);
  const [newTextValue, setNewTextValue] = useState('');

  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const replaceImageInputRef = useRef<HTMLInputElement>(null);

  const BASE_WIDTH = 850;

  // Load paragraphs and recognized images for current page
  const loadPageData = async () => {
    try {
      setIsLoadingData(true);
      const [paraData, imgData] = await Promise.all([
        getParagraphs(document.filename, currentPage),
        getPageImages(document.filename, currentPage).catch(() => [])
      ]);
      setParagraphs(paraData);
      setImages(imgData);
    } catch (err) {
      console.error('Error loading page data:', err);
    } finally {
      setIsLoadingData(false);
    }
  };

  useEffect(() => {
    setImageLoaded(false);
    setEditingParagraph(null);
    setSelectedImage(null);
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

  // Mouse wheel zoom with Ctrl
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      setZoom(prev => Math.min(Math.max(0.4, Number((prev + delta).toFixed(2))), 3.0));
    }
  };

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

  // Start editing a paragraph
  const handleParagraphClick = (p: ParagraphInfo, e: React.MouseEvent) => {
    e.stopPropagation();
    if (interactionMode === 'hand' || isSpacePressed) return;
    setSelectedImage(null);
    setEditingParagraph(p);
    setEditTextValue(p.text);
    setEditFont(p.font || 'helvetica');
    setEditSize(p.size ? Math.round(p.size) : 14);
    setEditColor(p.color || '#222226');
  };

  // Save edited paragraph
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
      alert(`Error al actualizar texto: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Click on recognized image
  const handleImageClick = (img: ImageInfo, e: React.MouseEvent) => {
    e.stopPropagation();
    if (interactionMode === 'hand' || isSpacePressed) return;
    setEditingParagraph(null);
    setSelectedImage(img);
  };

  // Image actions (Rotate 90°, Delete, Flip)
  const handleRotateImage = async () => {
    if (!selectedImage) return;
    try {
      setIsSaving(true);
      await editImage(document.filename, currentPage, selectedImage.image, 'rotate', { quarters: 1 });
      setSelectedImage(null);
      setImageLoaded(false);
      await loadPageData();
      onDocumentUpdated();
    } catch (err: any) {
      alert(`Error al rotar imagen: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteImage = async () => {
    if (!selectedImage) return;
    if (!confirm('¿Eliminar esta imagen del PDF?')) return;
    try {
      setIsSaving(true);
      await editImage(document.filename, currentPage, selectedImage.image, 'delete');
      setSelectedImage(null);
      setImageLoaded(false);
      await loadPageData();
      onDocumentUpdated();
    } catch (err: any) {
      alert(`Error al eliminar imagen: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleFlipImage = async () => {
    if (!selectedImage) return;
    try {
      setIsSaving(true);
      await editImage(document.filename, currentPage, selectedImage.image, 'flip_horizontal');
      setSelectedImage(null);
      setImageLoaded(false);
      await loadPageData();
      onDocumentUpdated();
    } catch (err: any) {
      alert(`Error al voltear imagen: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Add new text handling
  const handlePageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isAddingText || !imageRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const scaleX = imageRef.current.naturalWidth / rect.width;
    const scaleY = imageRef.current.naturalHeight / rect.height;

    const pdfX = Math.round((clickX * scaleX * 72) / 120);
    const pdfY = Math.round((clickY * scaleY * 72) / 120);

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

  // Box Coordinate mapping
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
      width: `${Math.max(width, 1.5)}%`,
      height: `${Math.max(height, 1.5)}%`,
    };
  };

  const isHandActive = interactionMode === 'hand' || isSpacePressed;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#E5E7EB] dark:bg-[#08080C] select-none transition-colors">
      {/* Top Toolbar */}
      <div className="h-11 border-b border-gray-200 dark:border-magic-border bg-white dark:bg-magic-card px-4 flex items-center justify-between shrink-0 z-20 shadow-sm transition-colors">
        {/* Left: Back to Viewer & Page Navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={onReturnToViewer}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-magic-bg hover:bg-gray-200 dark:hover:bg-magic-hover text-gray-700 dark:text-gray-300 text-xs font-medium border border-gray-200 dark:border-magic-border transition-colors mr-1"
            title="Volver al Modo Visor normal"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Modo Visor</span>
          </button>

          <div className="h-4 w-px bg-gray-200 dark:bg-magic-border mx-0.5" />

          {/* Page controls */}
          <button
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-magic-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
            Página <span className="text-indigo-600 dark:text-indigo-400">{currentPage}</span> de {document.pages}
          </span>

          <button
            onClick={() => onPageChange(Math.min(document.pages, currentPage + 1))}
            disabled={currentPage >= document.pages}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-magic-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-gray-200 dark:bg-magic-border mx-1" />

          {/* Tool Toggles: Select vs Hand (Pan) */}
          <div className="flex items-center bg-gray-100 dark:bg-magic-bg p-0.5 rounded-lg border border-gray-200 dark:border-magic-border">
            <button
              onClick={() => {
                setInteractionMode('select');
                setIsAddingText(false);
              }}
              className={`p-1.5 rounded-md text-xs transition-colors ${
                interactionMode === 'select' && !isAddingText
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
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
                setSelectedImage(null);
              }}
              className={`p-1.5 rounded-md text-xs transition-colors ${
                interactionMode === 'hand'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
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
              setSelectedImage(null);
              setInteractionMode('select');
            }}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all ${
              isAddingText
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-magic-hover'
            }`}
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>{isAddingText ? 'Haz clic en el PDF' : '+ Añadir Texto'}</span>
          </button>
        </div>

        {/* Center: Hint */}
        <div className="hidden lg:flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-magic-bg px-3 py-1 rounded-full border border-gray-200 dark:border-magic-border/70">
          <HelpCircle className="w-3.5 h-3.5 text-indigo-500" />
          <span>
            {isHandActive 
              ? 'Arrastra con el ratón para mover la página' 
              : 'Haz clic en texto o imágenes para editarlos • Ctrl + Rueda para Zoom'}
          </span>
        </div>

        {/* Right: Zoom Controls */}
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-magic-bg px-1.5 py-1 rounded-lg border border-gray-200 dark:border-magic-border">
          <button
            onClick={() => setZoom(z => Math.max(0.4, Number((z - 0.15).toFixed(2))))}
            className="p-1 rounded text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-magic-hover transition-colors"
            title="Reducir Zoom"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          <span className="text-xs font-mono text-gray-700 dark:text-gray-300 px-1.5 min-w-[48px] text-center">
            {Math.round(zoom * 100)}%
          </span>

          <button
            onClick={() => setZoom(z => Math.min(3.0, Number((z + 0.15).toFixed(2))))}
            className="p-1 rounded text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-magic-hover transition-colors"
            title="Aumentar Zoom"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>

          <div className="h-3 w-px bg-gray-200 dark:bg-magic-border mx-0.5" />

          <button
            onClick={() => setZoom(1.0)}
            className="p-1 rounded text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-magic-hover transition-colors text-[10px] font-mono"
            title="100%"
          >
            100%
          </button>
        </div>
      </div>

      {/* Main Scrollable Canvas Area (Adapts to light & dark mode) */}
      <div 
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        className={`flex-1 overflow-auto relative bg-[#E5E7EB] dark:bg-[#08080C] ${
          isHandActive
            ? isDraggingCanvas ? 'cursor-grabbing' : 'cursor-grab'
            : isAddingText ? 'cursor-crosshair' : 'cursor-default'
        }`}
      >
        <div className="min-h-full min-w-full flex items-start justify-center p-10 pb-36">
          <div 
            onClick={handlePageClick}
            style={{ width: `${BASE_WIDTH * zoom}px` }}
            className="relative shadow-2xl transition-all duration-75 rounded-sm overflow-hidden border border-gray-300 dark:border-gray-800 bg-white shrink-0"
          >
            {/* High-res page rendering */}
            <img
              ref={imageRef}
              src={getPageImageUrl(document.filename, currentPage, 120)}
              alt={`Página ${currentPage}`}
              onLoad={() => setImageLoaded(true)}
              className="w-full h-auto block pointer-events-none select-none bg-white"
            />

            {/* Interactive Bounding Boxes for Recognized Paragraphs */}
            {imageLoaded && !isHandActive && paragraphs.map((p) => {
              const isEditing = editingParagraph?.paragraph === p.paragraph;
              const style = getBoxStyle(p.rect);

              return (
                <div
                  key={`p_${p.paragraph}`}
                  onClick={(e) => handleParagraphClick(p, e)}
                  style={style}
                  className={`absolute group cursor-pointer transition-all rounded-sm ${
                    isEditing
                      ? 'ring-2 ring-indigo-500 bg-indigo-500/20 z-20'
                      : 'hover:ring-2 hover:ring-indigo-400/80 hover:bg-indigo-500/10 z-10'
                  }`}
                  title={`Párrafo ${p.paragraph}: Haz clic para editar texto`}
                >
                  {!isEditing && (
                    <div className="hidden group-hover:flex items-center gap-1 absolute -top-6 left-0 px-1.5 py-0.5 rounded bg-white dark:bg-magic-card text-[10px] text-gray-900 dark:text-white font-medium border border-gray-200 dark:border-magic-border shadow-lg pointer-events-none whitespace-nowrap z-30">
                      <Type className="w-2.5 h-2.5 text-indigo-500" />
                      <span>Editar texto</span>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Recognized Images on the page */}
            {imageLoaded && !isHandActive && images.map((img) => {
              const isSelected = selectedImage?.image === img.image;
              const style = getBoxStyle(img.box);

              return (
                <div
                  key={`img_${img.image}`}
                  onClick={(e) => handleImageClick(img, e)}
                  style={style}
                  className={`absolute group cursor-pointer transition-all border-2 border-dashed rounded-sm ${
                    isSelected
                      ? 'border-emerald-500 bg-emerald-500/20 ring-2 ring-emerald-500 z-20'
                      : 'border-emerald-400/60 hover:border-emerald-500 hover:bg-emerald-500/10 z-10'
                  }`}
                  title={`Imagen #${img.image} • Clic para rotar o eliminar`}
                >
                  <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-emerald-600 text-[10px] text-white font-semibold flex items-center gap-1 shadow">
                    <ImageIcon className="w-2.5 h-2.5" />
                    <span>Img #{img.image}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Floating Action Bar for Selected Image */}
      {selectedImage && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-md bg-white dark:bg-magic-card border border-gray-200 dark:border-magic-border rounded-2xl p-4 shadow-2xl z-40 animate-in fade-in slide-in-from-bottom-4">
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-gray-200 dark:border-magic-border">
            <div className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-emerald-500" />
              <span className="text-xs font-bold text-gray-900 dark:text-white">
                Imagen #{selectedImage.image} ({selectedImage.pixels ? `${selectedImage.pixels[0]}x${selectedImage.pixels[1]}px` : 'Detectada'})
              </span>
            </div>
            <button
              onClick={() => setSelectedImage(null)}
              className="text-gray-400 hover:text-gray-700 dark:hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRotateImage}
              disabled={isSaving}
              className="flex-1 py-2 rounded-xl bg-gray-100 dark:bg-magic-bg hover:bg-gray-200 dark:hover:bg-magic-hover text-xs font-medium text-gray-800 dark:text-gray-200 flex items-center justify-center gap-1.5 border border-gray-200 dark:border-magic-border transition-colors"
            >
              <RotateCw className="w-3.5 h-3.5 text-indigo-500" />
              <span>Girar 90°</span>
            </button>

            <button
              onClick={handleFlipImage}
              disabled={isSaving}
              className="flex-1 py-2 rounded-xl bg-gray-100 dark:bg-magic-bg hover:bg-gray-200 dark:hover:bg-magic-hover text-xs font-medium text-gray-800 dark:text-gray-200 flex items-center justify-center gap-1.5 border border-gray-200 dark:border-magic-border transition-colors"
            >
              <FlipHorizontal className="w-3.5 h-3.5 text-purple-500" />
              <span>Voltear H</span>
            </button>

            <button
              onClick={handleDeleteImage}
              disabled={isSaving}
              className="py-2 px-3 rounded-xl bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-900/40 text-xs font-medium text-red-600 dark:text-red-400 flex items-center justify-center gap-1.5 border border-red-200 dark:border-red-900/30 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Eliminar</span>
            </button>
          </div>
        </div>
      )}

      {/* Floating WYSIWYG Format Bar for Paragraph Editing (Light & Dark theme aware!) */}
      {editingParagraph && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-2xl bg-white dark:bg-magic-card border border-gray-200 dark:border-magic-border rounded-2xl p-4 shadow-2xl z-40 animate-in fade-in slide-in-from-bottom-4 transition-colors">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-gray-200 dark:border-magic-border">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-bold text-gray-900 dark:text-white">
                Editando Párrafo #{editingParagraph.paragraph} (Página {currentPage})
              </span>
            </div>

            {/* Typography Controls */}
            <div className="flex items-center gap-2">
              <select
                value={editFont}
                onChange={(e) => setEditFont(e.target.value)}
                className="bg-gray-50 dark:bg-magic-bg border border-gray-200 dark:border-magic-border rounded-lg text-xs text-gray-800 dark:text-gray-200 px-2 py-1 outline-none focus:border-indigo-500"
              >
                <option value="helvetica">Helvetica</option>
                <option value="times">Times Roman</option>
                <option value="courier">Courier</option>
              </select>

              <div className="flex items-center gap-1 bg-gray-50 dark:bg-magic-bg border border-gray-200 dark:border-magic-border rounded-lg px-2 py-1 text-xs text-gray-800 dark:text-gray-200">
                <span className="text-[10px] text-gray-400">Tam:</span>
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
                className={`p-1 rounded text-xs transition-colors ${isBold ? 'bg-indigo-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white'}`}
              >
                <Bold className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setIsItalic(!isItalic)}
                className={`p-1 rounded text-xs transition-colors ${isItalic ? 'bg-indigo-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white'}`}
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
            className="w-full bg-gray-50 dark:bg-magic-bg border border-gray-200 dark:border-magic-border rounded-xl p-3 text-sm text-gray-900 dark:text-gray-100 font-sans outline-none focus:border-indigo-500 transition-colors resize-none leading-relaxed"
            placeholder="Escribe el nuevo texto aquí..."
          />

          <div className="flex items-center justify-end gap-2 mt-3">
            <button
              onClick={() => setEditingParagraph(null)}
              disabled={isSaving}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-magic-hover transition-colors"
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
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-md bg-white dark:bg-magic-card border border-gray-200 dark:border-magic-border rounded-2xl p-4 shadow-2xl z-40">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-gray-200 dark:border-magic-border">
            <span className="text-xs font-bold text-gray-900 dark:text-white">Añadir Nuevo Texto</span>
            <button onClick={() => setNewTextCoords(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>

          <textarea
            value={newTextValue}
            onChange={(e) => setNewTextValue(e.target.value)}
            rows={2}
            className="w-full bg-gray-50 dark:bg-magic-bg border border-gray-200 dark:border-magic-border rounded-xl p-2.5 text-xs text-gray-900 dark:text-white outline-none focus:border-indigo-500 resize-none mb-3"
            placeholder="Texto a añadir..."
          />

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setNewTextCoords(null)}
              className="px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400"
            >
              Cancelar
            </button>
            <button
              onClick={handleSaveNewText}
              disabled={isSaving || !newTextValue.trim()}
              className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/30 disabled:opacity-50"
            >
              Estampar Texto
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
