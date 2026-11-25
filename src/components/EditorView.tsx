import React, { useState, useEffect, useRef } from "react";
import { ToolbarPortal } from "./ToolbarPortal";
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
  Upload,
} from "lucide-react";
import { PdfDocument, ParagraphInfo, ImageInfo } from "../types";
import {
  getPageImageUrl,
  getParagraphs,
  editText,
  addText,
  getPageImages,
  editImage,
} from "../api/client";

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
  onReturnToViewer,
}) => {
  const [zoom, setZoom] = useState(1.0);
  const [paragraphs, setParagraphs] = useState<ParagraphInfo[]>([]);
  const [images, setImages] = useState<ImageInfo[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Tool mode: 'select' (click to edit) vs 'hand' (click & drag to pan)
  const [interactionMode, setInteractionMode] = useState<"select" | "hand">(
    "select",
  );
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const [dragStart, setDragStart] = useState({
    x: 0,
    y: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });

  // Selected/Editing paragraph state
  const [editingParagraph, setEditingParagraph] =
    useState<ParagraphInfo | null>(null);
  const [editTextValue, setEditTextValue] = useState("");
  const [editFont, setEditFont] = useState("helvetica");
  const [editSize, setEditSize] = useState<number>(14);
  const [editColor, setEditColor] = useState("#222226");
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Selected Image state
  const [selectedImage, setSelectedImage] = useState<ImageInfo | null>(null);
  const [imageBox, setImageBox] = useState<[number, number, number, number]>([
    0, 0, 100, 100,
  ]);

  // Add new text mode
  const [isAddingText, setIsAddingText] = useState(false);
  const [newTextCoords, setNewTextCoords] = useState<[number, number] | null>(
    null,
  );
  const [newTextValue, setNewTextValue] = useState("");

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
        getPageImages(document.filename, currentPage).catch(() => []),
      ]);
      setParagraphs(paraData);
      setImages(imgData);
    } catch (err) {
      console.error("Error loading page data:", err);
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
  }, [document.filename, document.revision, currentPage]);

  // Track spacebar for quick panning
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.code === "Space" &&
        !editingParagraph &&
        (e.target as HTMLElement).tagName !== "TEXTAREA"
      ) {
        setIsSpacePressed(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setIsSpacePressed(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [editingParagraph]);

  // Mouse wheel zoom with Ctrl
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      setZoom((prev) =>
        Math.min(Math.max(0.4, Number((prev + delta).toFixed(2))), 3.0),
      );
    }
  };

  // Canvas Drag / Pan Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (interactionMode === "hand" || isSpacePressed || e.button === 1) {
      if (!containerRef.current) return;
      setIsDraggingCanvas(true);
      setDragStart({
        x: e.clientX,
        y: e.clientY,
        scrollLeft: containerRef.current.scrollLeft,
        scrollTop: containerRef.current.scrollTop,
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
    if (interactionMode === "hand" || isSpacePressed) return;
    setSelectedImage(null);
    setEditingParagraph(p);
    setEditTextValue(p.text);
    setEditFont(p.font || "helvetica");
    setEditSize(p.size ? Math.round(p.size) : 14);
    setEditColor(p.color || "#222226");
  };

  // Save edited paragraph
  const handleSaveEdit = async () => {
    if (!editingParagraph) return;
    try {
      setIsSaving(true);
      await editText(
        document.filename,
        currentPage,
        editingParagraph.paragraph,
        editTextValue,
        {
          font: editFont,
          size: editSize,
          color: editColor,
          bold: isBold,
          italic: isItalic,
        },
      );
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
    if (interactionMode === "hand" || isSpacePressed) return;
    setEditingParagraph(null);
    setSelectedImage(img);
    setImageBox([...img.box]);
  };

  // Image actions (Rotate 90°, Delete, Flip)
  const handleRotateImage = async () => {
    if (!selectedImage) return;
    try {
      setIsSaving(true);
      await editImage(
        document.filename,
        currentPage,
        selectedImage.image,
        "rotate",
        { quarters: 1 },
      );
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
    if (!confirm("¿Eliminar esta imagen del PDF?")) return;
    try {
      setIsSaving(true);
      await editImage(
        document.filename,
        currentPage,
        selectedImage.image,
        "delete",
      );
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
      await editImage(
        document.filename,
        currentPage,
        selectedImage.image,
        "flip_horizontal",
      );
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
    setNewTextValue("Nuevo texto");
  };

  const handleSaveNewText = async () => {
    if (!newTextCoords || !newTextValue.trim()) return;
    try {
      setIsSaving(true);
      await addText(
        document.filename,
        currentPage,
        newTextValue,
        newTextCoords,
        {
          size: editSize,
          font: editFont,
          color: editColor,
          bold: isBold,
          italic: isItalic,
        },
      );
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
    if (!imageRef.current) return { display: "none" };
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

  const isHandActive = interactionMode === "hand" || isSpacePressed;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#E5E7EB] dark:bg-[#08080C] select-none transition-colors">
      <ToolbarPortal id="reader-controls">
        <div className="reader-group primary-tools">
          <button
            aria-label="Editar contenido"
            aria-pressed={interactionMode === "select" && !isAddingText}
            onClick={() => {
              setInteractionMode("select");
              setIsAddingText(false);
            }}
          >
            <MousePointer size={17} />
            <span className="tool-label">Editar contenido</span>
          </button>
          <button
            aria-label="Mover página"
            aria-pressed={interactionMode === "hand"}
            onClick={() => {
              setInteractionMode("hand");
              setIsAddingText(false);
              setEditingParagraph(null);
              setSelectedImage(null);
            }}
          >
            <Hand size={17} />
          </button>
          <button
            aria-label="Añadir texto"
            aria-pressed={isAddingText}
            onClick={() => {
              setIsAddingText((v) => !v);
              setInteractionMode("select");
              setEditingParagraph(null);
              setSelectedImage(null);
            }}
          >
            <PlusCircle size={17} />
            <span className="tool-label">Añadir texto</span>
          </button>
        </div>
        <span className="bar-divider" />
        <select
          aria-label="Zoom de edición"
          value=""
          onChange={(e) => setZoom(Number(e.target.value))}
        >
          <option value="" disabled>
            {Math.round(zoom * 100)}%
          </option>
          {[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((n) => (
            <option key={n} value={n}>
              {n * 100}%
            </option>
          ))}
        </select>
      </ToolbarPortal>
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
            ? isDraggingCanvas
              ? "cursor-grabbing"
              : "cursor-grab"
            : isAddingText
              ? "cursor-crosshair"
              : "cursor-default"
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
            {imageLoaded &&
              !isHandActive &&
              paragraphs.map((p) => {
                const isEditing = editingParagraph?.paragraph === p.paragraph;
                const style = getBoxStyle(p.rect);

                return (
                  <div
                    key={`p_${p.paragraph}`}
                    onClick={(e) => handleParagraphClick(p, e)}
                    style={style}
                    className={`absolute group cursor-pointer transition-all rounded-sm ${
                      isEditing
                        ? "ring-2 ring-indigo-500 bg-indigo-500/20 z-20"
                        : "hover:ring-2 hover:ring-indigo-400/80 hover:bg-indigo-500/10 z-10"
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
            {imageLoaded &&
              !isHandActive &&
              images.map((img) => {
                const isSelected = selectedImage?.image === img.image;
                const style = getBoxStyle(img.box);

                return (
                  <div
                    key={`img_${img.image}`}
                    onClick={(e) => handleImageClick(img, e)}
                    style={style}
                    className={`absolute group cursor-pointer transition-all border-2 border-dashed rounded-sm ${
                      isSelected
                        ? "border-emerald-500 bg-emerald-500/20 ring-2 ring-emerald-500 z-20"
                        : "border-emerald-400/60 hover:border-emerald-500 hover:bg-emerald-500/10 z-10"
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
      <footer className="editor-footer">
        <span>
          {isAddingText
            ? "Haz clic en la página para añadir texto."
            : isHandActive
              ? "Arrastra para mover la página."
              : "Haz clic en un párrafo o una imagen para editar su contenido."}
        </span>
        <div>
          <button
            aria-label="Página anterior"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(currentPage - 1)}
          >
            <ChevronLeft size={14} />
          </button>
          <span>
            {currentPage} / {document.pages}
          </span>
          <button
            aria-label="Página siguiente"
            disabled={currentPage >= document.pages}
            onClick={() => onPageChange(currentPage + 1)}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </footer>
      {selectedImage && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-md bg-white dark:bg-magic-card border border-gray-200 dark:border-magic-border rounded-2xl p-4 shadow-2xl z-40 animate-in fade-in slide-in-from-bottom-4">
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-gray-200 dark:border-magic-border">
            <div className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-emerald-500" />
              <span className="text-xs font-bold text-gray-900 dark:text-white">
                Imagen #{selectedImage.image} (
                {selectedImage.pixels
                  ? `${selectedImage.pixels[0]}x${selectedImage.pixels[1]}px`
                  : "Detectada"}
                )
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
          <div className="grid grid-cols-4 gap-2 mt-3">
            {imageBox.map((value, i) => (
              <label key={i} className="text-[10px] text-gray-500">
                {["X1", "Y1", "X2", "Y2"][i]}
                <input
                  aria-label={`Imagen ${["X1", "Y1", "X2", "Y2"][i]}`}
                  className="w-full p-1 rounded border bg-transparent"
                  type="number"
                  value={Math.round(value)}
                  onChange={(e) =>
                    setImageBox(
                      (box) =>
                        box.map((n, j) =>
                          j === i ? Number(e.target.value) : n,
                        ) as [number, number, number, number],
                    )
                  }
                />
              </label>
            ))}
          </div>
          <button
            disabled={isSaving}
            className="mt-2 w-full py-2 rounded-lg bg-indigo-600 text-white text-xs"
            onClick={async () => {
              if (imageBox[2] <= imageBox[0] || imageBox[3] <= imageBox[1]) {
                alert("El ancho y alto deben ser positivos.");
                return;
              }
              try {
                setIsSaving(true);
                await editImage(
                  document.filename,
                  currentPage,
                  selectedImage.image,
                  "move",
                  { rect: imageBox },
                );
                setSelectedImage(null);
                onDocumentUpdated();
              } catch (e) {
                alert(
                  e instanceof Error ? e.message : "No se pudo mover la imagen",
                );
              } finally {
                setIsSaving(false);
              }
            }}
          >
            Aplicar posición y tamaño
          </button>
        </div>
      )}

      {/* Floating WYSIWYG Format Bar for Paragraph Editing (Light & Dark theme aware!) */}
      {editingParagraph && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-2xl bg-white dark:bg-magic-card border border-gray-200 dark:border-magic-border rounded-2xl p-4 shadow-2xl z-40 animate-in fade-in slide-in-from-bottom-4 transition-colors">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-gray-200 dark:border-magic-border">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-bold text-gray-900 dark:text-white">
                Editando Párrafo #{editingParagraph.paragraph} (Página{" "}
                {currentPage})
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
                className={`p-1 rounded text-xs transition-colors ${isBold ? "bg-indigo-600 text-white" : "text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white"}`}
              >
                <Bold className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setIsItalic(!isItalic)}
                className={`p-1 rounded text-xs transition-colors ${isItalic ? "bg-indigo-600 text-white" : "text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white"}`}
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
            <span className="text-xs font-bold text-gray-900 dark:text-white">
              Añadir Nuevo Texto
            </span>
            <button
              onClick={() => setNewTextCoords(null)}
              className="text-gray-400 hover:text-gray-700 dark:hover:text-white"
            >
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
