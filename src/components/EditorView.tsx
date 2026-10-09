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
  HelpCircle
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

  const handleParagraphClick = (p: ParagraphInfo) => {
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
      // Reload page image & paragraphs
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

    // Convert pixel coordinates to PDF point coordinates (scale based on natural width)
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

  // Convert PDF coordinates [x1, y1, x2, y2] to CSS % coordinates over the image
  const getBoxStyle = (pRect: [number, number, number, number]) => {
    if (!imageRef.current) return { display: 'none' };
    
    // PDF points: width/height in points typically 612x792 (US Letter) or 595x842 (A4)
    // pdfcraft renders at 120 DPI (where 1 point = 120/72 pixels = 1.666 pixels)
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

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-4rem)] overflow-hidden bg-magic-bg select-none">
      {/* Top Toolbar */}
      <div className="h-12 border-b border-magic-border bg-magic-card/90 px-4 flex items-center justify-between shrink-0">
        {/* Left: Page Navigation */}
        <div className="flex items-center gap-2">
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

          {/* Add Text tool */}
          <button
            onClick={() => {
              setIsAddingText(!isAddingText);
              setEditingParagraph(null);
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
        <div className="hidden md:flex items-center gap-1.5 text-xs text-gray-400 bg-magic-bg px-3 py-1 rounded-full border border-magic-border/70">
          <HelpCircle className="w-3.5 h-3.5 text-indigo-400" />
          <span>Haz clic sobre cualquier texto en la página para editarlo</span>
        </div>

        {/* Right: Zoom controls */}
        <div className="flex items-center gap-1 bg-magic-bg px-1.5 py-1 rounded-lg border border-magic-border">
          <button
            onClick={() => setZoom(z => Math.max(0.5, z - 0.15))}
            className="p-1 rounded text-gray-400 hover:text-white hover:bg-magic-hover transition-colors"
            title="Reducir"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          <span className="text-xs font-mono text-gray-300 px-1.5 min-w-[48px] text-center">
            {Math.round(zoom * 100)}%
          </span>

          <button
            onClick={() => setZoom(z => Math.min(2.5, z + 0.15))}
            className="p-1 rounded text-gray-400 hover:text-white hover:bg-magic-hover transition-colors"
            title="Ampliar"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setZoom(1.0)}
            className="p-1 rounded text-gray-400 hover:text-white hover:bg-magic-hover transition-colors ml-1"
            title="Ajustar a 100%"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div 
        ref={containerRef}
        className="flex-1 overflow-auto p-8 flex items-center justify-center relative bg-magic-bg"
      >
        <div 
          onClick={handlePageClick}
          className={`relative shadow-2xl transition-transform duration-150 origin-top rounded-sm overflow-hidden border border-gray-700/50 ${
            isAddingText ? 'cursor-crosshair' : 'cursor-default'
          }`}
          style={{ transform: `scale(${zoom})` }}
        >
          {/* High-res page rendering */}
          <img
            ref={imageRef}
            src={getPageImageUrl(document.filename, currentPage, 120)}
            alt={`Página ${currentPage}`}
            onLoad={() => setImageLoaded(true)}
            className="block max-w-none pointer-events-none select-none bg-white"
            style={{ width: '850px' }}
          />

          {/* Interactive Bounding Boxes for Paragraphs */}
          {imageLoaded && paragraphs.map((p) => {
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
                {/* Tooltip on hover */}
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

      {/* Floating WYSIWYG Format Bar & Modal for Paragraph Edit */}
      {editingParagraph && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-2xl bg-magic-card border border-magic-border/90 rounded-2xl p-4 shadow-2xl shadow-black/60 backdrop-blur-xl z-40 animate-in fade-in slide-in-from-bottom-4">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-magic-border">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-bold text-white">
                Editando Párrafo #{editingParagraph.paragraph} (Página {currentPage})
              </span>
            </div>

            {/* Typography Controls */}
            <div className="flex items-center gap-2">
              {/* Font Selector */}
              <select
                value={editFont}
                onChange={(e) => setEditFont(e.target.value)}
                className="bg-magic-bg border border-magic-border rounded-lg text-xs text-gray-200 px-2 py-1 outline-none focus:border-indigo-500"
              >
                <option value="helvetica">Helvetica</option>
                <option value="times">Times Roman</option>
                <option value="courier">Courier</option>
              </select>

              {/* Font Size */}
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

              {/* Bold & Italic */}
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

              {/* Color Picker */}
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

          {/* Textarea */}
          <textarea
            value={editTextValue}
            onChange={(e) => setEditTextValue(e.target.value)}
            rows={3}
            autoFocus
            className="w-full bg-magic-bg/90 border border-magic-border rounded-xl p-3 text-sm text-gray-100 font-sans outline-none focus:border-indigo-500 transition-colors resize-none leading-relaxed"
            placeholder="Escribe el nuevo texto aquí..."
          />

          {/* Bottom Actions */}
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
