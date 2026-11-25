import { useEffect, useRef, useState } from "react";
import { ToolbarPortal } from "./ToolbarPortal";
import { AnnotationWorkspace } from "./AnnotationWorkspace";
import type { DrawingAnnotation, DrawingKind } from "../types/annotations";
import { writeAnnotation } from "../api/client";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import {
  EventBus,
  PDFViewer,
  PDFLinkService,
  PDFFindController,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Search,
  Highlighter,
  Edit3,
  Hand,
  MousePointer,
  X,
  Bookmark,
  Focus,
  Underline,
  Settings2,
  Copy,
} from "lucide-react";
import type { PdfDocument } from "../types";
GlobalWorkerOptions.workerSrc = workerUrl;
type ReadingPosition = {
  page: number;
  scale: string;
  rotation: number;
  top: number;
  left: number;
};
const readingPositions = new Map<string, ReadingPosition>();
type Props = {
  theme: "dark" | "light";
  onThemeChange: (theme: "dark" | "light") => void;
  document: PdfDocument;
  currentPage: number;
  onPageChange: (page: number) => void;
  onEnterEditMode: () => void;
  onDocumentUpdated: () => void;
  onAnnotationsUpdated: () => void;
};
type TextSelection = {
  page: number;
  rects: number[][];
  text: string;
  anchor: { x: number; y: number };
};
function setting(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Optional preferences. */
  }
}

export function ViewerView({
  theme,
  onThemeChange,
  document: doc,
  currentPage,
  onPageChange,
  onEnterEditMode,
  onDocumentUpdated,
  onAnnotationsUpdated,
}: Props) {
  const host = useRef<HTMLDivElement>(null),
    pages = useRef<HTMLDivElement>(null);
  const engine = useRef<{ viewer: PDFViewer; bus: EventBus } | null>(null);
  const savedView = useRef<ReadingPosition | null>(
    readingPositions.get(doc.id) || null,
  );
  const restoringView = useRef(true);
  const [annotations, setAnnotations] = useState<DrawingAnnotation[]>([]);
  const [drawingMode, setDrawingMode] = useState<DrawingKind | null>(null);
  useEffect(() => {
    let active = true;
    setAnnotations([]);
    void fetch(`/api/scene/${encodeURIComponent(doc.filename)}`)
      .then((r) => {
        if (!r.ok) throw new Error("No se pudieron cargar las anotaciones");
        return r.json();
      })
      .then((data) => {
        if (active) setAnnotations(data.annotations);
      })
      .catch((e) => {
        if (active) setNotice(e.message);
      });
    return () => {
      active = false;
    };
  }, [doc.filename, doc.revision]);
  const pageCallback = useRef(onPageChange);
  pageCallback.current = onPageChange;
  const initialPage = useRef(currentPage);
  initialPage.current = currentPage;
  const [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  const [query, setQuery] = useState(""),
    [searchOpen, setSearchOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const [matches, setMatches] = useState({ current: 0, total: 0 }),
    [zoom, setZoom] = useState(100);
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const annotating = useRef(false);
  const [color, setColor] = useState(() =>
    setting("magicpdf.highlight", "#fde047"),
  );
  const [dayPaper, setDayPaper] = useState(() =>
    setting("magicpdf.reading", "normal") === "sepia" ? "sepia" : "normal",
  );
  const mode = theme === "dark" ? "night" : dayPaper;
  const [tool, setTool] = useState<
    "select" | "hand" | "highlight" | "underline"
  >("select");
  const hand = tool === "hand";
  const [scanned, setScanned] = useState(false);
  const [focus, setFocus] = useState(false),
    [busy, setBusy] = useState(false);
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const [bookmarks, setBookmarks] = useState<number[]>(() => {
    try {
      return JSON.parse(
        setting(`magicpdf.bookmarks.${doc.originalDiskPath || doc.name}`, "[]"),
      );
    } catch {
      return [];
    }
  });
  const [marksOpen, setMarksOpen] = useState(false);
  useEffect(() => {
    if (!host.current || !pages.current) return;
    let disposed = false;
    restoringView.current = true;
    setReady(false);
    setError("");
    setSelection(null);
    const bus = new EventBus(),
      links = new PDFLinkService({ eventBus: bus, externalLinkTarget: 2 });
    const finder = new PDFFindController({ eventBus: bus, linkService: links });
    const viewer = new PDFViewer({
      container: host.current,
      viewer: pages.current,
      eventBus: bus,
      linkService: links,
      findController: finder,
      annotationMode: 1,
      textLayerMode: 1,
      maxCanvasPixels: 16777216,
    });
    links.setViewer(viewer);
    engine.current = { viewer, bus };
    bus.on("pagesinit", () => {
      if (disposed) return;
      viewer.pagesRotation = savedView.current?.rotation || 0;
      viewer.currentScaleValue = savedView.current?.scale || "auto";
      viewer.currentPageNumber = Math.min(
        initialPage.current,
        viewer.pagesCount,
      );
      setReady(true);
    });
    let positionRestored = false;
    bus.on("pagerendered", () => {
      if (
        !disposed &&
        !positionRestored &&
        savedView.current &&
        host.current &&
        savedView.current.page === initialPage.current
      ) {
        positionRestored = true;
        host.current.scrollTop = savedView.current.top;
        host.current.scrollLeft = savedView.current.left;
      }
      positionRestored = true;
      restoringView.current = false;
    });
    bus.on("pagechanging", ({ pageNumber }: { pageNumber: number }) => {
      if (!disposed) pageCallback.current(pageNumber);
    });
    bus.on("scalechanging", ({ scale }: { scale: number }) => {
      if (!disposed) setZoom(Math.round(scale * 100));
    });
    const counts = ({
      matchesCount,
    }: {
      matchesCount: { current: number; total: number };
    }) => {
      if (!disposed && matchesCount) setMatches(matchesCount);
    };
    bus.on("updatefindmatchescount", counts);
    bus.on("updatefindcontrolstate", counts);
    const task = getDocument({
      url: `/api/reader-file/${encodeURIComponent(doc.filename)}?v=${doc.revision || 0}`,
      isEvalSupported: false,
    });
    task.onPassword = (update: (password: string) => void, reason: number) => {
      const password = window.prompt(
        reason === 2
          ? "Contraseña incorrecta. Inténtalo otra vez:"
          : "Contraseña del PDF:",
      );
      if (password !== null) update(password);
      else {
        setError(
          "Apertura cancelada. Vuelve a abrir el documento para intentarlo.",
        );
        void task.destroy().catch(() => {});
      }
    };
    const initialized = task.promise
      .then(async (pdf) => {
        // PDFViewer leaves its metadata/config requests uncaught during teardown.
        // Resolve them inside this lifecycle before handing the document over.
        await Promise.all([
          pdf.getPage(1),
          pdf.getMetadata(),
          pdf.getOptionalContentConfig({ intent: "display" }),
        ]);
        if (!disposed) {
          links.setDocument(pdf);
          viewer.setDocument(pdf);
        }
      })
      .catch((e) => {
        if (!disposed) setError(e.message || "No se pudo abrir el PDF.");
      });
    const resize = new ResizeObserver(() => {
      if (
        !disposed &&
        viewer.pdfDocument &&
        ["auto", "page-width", "page-fit"].includes(viewer.currentScaleValue)
      )
        viewer.currentScaleValue = viewer.currentScaleValue;
    });
    resize.observe(host.current);
    const scrollHost = host.current;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      // Keep browser/window zoom fixed; only the PDF changes scale.
      event.preventDefault();
      if (disposed || !viewer.pdfDocument || !event.deltaY) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scrollHost.clientHeight : 1);
      const target = Math.min(4, Math.max(0.25,
        viewer.currentScale * Math.exp(-Math.max(-240, Math.min(240, delta)) * 0.002)));
      if (target === viewer.currentScale) return;
      const page = (event.target as Element).closest('.page') || viewer.getPageView(viewer.currentPageNumber - 1)?.div;
      const before = page?.getBoundingClientRect();
      viewer.updateScale({ scaleFactor: target / viewer.currentScale,
        origin: [event.clientX, event.clientY] });
      // Our page spacing differs from PDF.js defaults. Correct its scroll origin
      // using the page geometry so fast wheel input stays under the cursor too.
      if (page && before?.width && before.height) {
        const after = page.getBoundingClientRect();
        scrollHost.scrollLeft += after.left + (event.clientX - before.left) * after.width / before.width - event.clientX;
        scrollHost.scrollTop += after.top + (event.clientY - before.top) * after.height / before.height - event.clientY;
      }
    };
    scrollHost.addEventListener('wheel', wheel, { passive: false });
    return () => {
      savedView.current = {
        page: savedView.current?.page || initialPage.current,
        scale: viewer.currentScaleValue,
        rotation: viewer.pagesRotation,
        top: savedView.current?.top || 0,
        left: savedView.current?.left || 0,
      };
      readingPositions.set(doc.id, savedView.current);
      if (readingPositions.size > 32)
        readingPositions.delete(readingPositions.keys().next().value!);
      disposed = true;
      scrollHost.removeEventListener('wheel', wheel);
      resize.disconnect();
      engine.current = null;
      viewer.setDocument(null as never);
      links.setDocument(null as never);
      // PDF.js 4 throws inside its worker if terminated during document setup.
      // Detach the view now and release the worker after initialization settles.
      void initialized.then(() => task.destroy()).catch(() => {});
    };
  }, [doc.filename, doc.revision]);
  useEffect(() => {
    const v = engine.current?.viewer;
    if (ready && v && currentPage !== v.currentPageNumber)
      v.currentPageNumber = currentPage;
  }, [currentPage, ready]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchInput.current?.focus(), 0);
      }
      if (e.key === "Escape") {
        setDrawingMode(null);
        setSearchOpen(false);
        setFocus(false);
        window.getSelection()?.removeAllRanges();
        setSelection(null);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const find = (again = false, previous = false) =>
    engine.current?.bus.dispatch("find", {
      source: null,
      type: again ? "again" : "",
      query,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: previous,
      matchDiacritics: false,
    });
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => find(), 200);
    return () => clearTimeout(timer);
  }, [query, ready]);
  useEffect(() => {
    let active = true;
    setScanned(false);
    if (ready)
      void engine.current?.viewer.pdfDocument
        ?.getPage(currentPage)
        .then((page) => page.getTextContent())
        .then((content) => {
          if (active)
            setScanned(
              !content.items.some((item) => "str" in item && item.str.trim()),
            );
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [ready, currentPage, doc.filename, doc.revision]);
  useEffect(() => {
    const changed = () => {
      if (window.getSelection()?.isCollapsed) setSelection(null);
    };
    document.addEventListener("selectionchange", changed);
    return () => document.removeEventListener("selectionchange", changed);
  }, []);
  const annotate = async (
    selected: TextSelection,
    kind: "highlight" | "underline",
  ) => {
    if (annotating.current) return;
    annotating.current = true;
    setBusy(true);
    setNotice("");
    try {
      const result = await writeAnnotation("/api/highlight", {
        filename: doc.filename,
        page: selected.page,
        rects: selected.rects,
        text: selected.text,
        color,
        kind,
      });
      setAnnotations((rows) => [...rows, result.annotation]);
      window.getSelection()?.removeAllRanges();
      setSelection(null);
      onAnnotationsUpdated();
      setNotice(
        `${kind === "underline" ? "Subrayado" : "Resaltado"} incorporado al PDF. Ctrl+S para guardar en disco.`,
      );
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "No se pudo guardar la anotación",
      );
    } finally {
      annotating.current = false;
      setBusy(false);
    }
  };
  const capture = () => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount || hand || drawingMode) {
      setSelection(null);
      return;
    }
    const range = s.getRangeAt(0),
      page = range.startContainer.parentElement?.closest<HTMLElement>(".page");
    if (
      !page ||
      !pages.current?.contains(page) ||
      page !== range.endContainer.parentElement?.closest(".page")
    ) {
      setSelection(null);
      return;
    }
    const number = Number(page.dataset.pageNumber),
      view = engine.current?.viewer.getPageView(number - 1);
    if (!view) return;
    const bounds = page.getBoundingClientRect(),
      selectionBounds = range.getBoundingClientRect();
    // A DOM range also reports enclosing span rectangles. Collect only the
    // selected text nodes so nested PDF.js spans cannot paint a line twice.
    const textRects: DOMRect[] = [];
    const walker = document.createTreeWalker(page.querySelector(".textLayer") || page, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!range.intersectsNode(node)) continue;
      const part = document.createRange();
      part.selectNodeContents(node);
      if (node === range.startContainer) part.setStart(node, range.startOffset);
      if (node === range.endContainer) part.setEnd(node, range.endOffset);
      textRects.push(...Array.from(part.getClientRects()));
    }
    const rects = textRects
      .filter((r) => r.width > 1 && r.height > 1)
      .map((r) => {
        const [x1, y1] = view.viewport.convertToPdfPoint(
          r.left - bounds.left - page.clientLeft,
          r.top - bounds.top - page.clientTop,
        );
        const [x2, y2] = view.viewport.convertToPdfPoint(
          r.right - bounds.left - page.clientLeft,
          r.bottom - bounds.top - page.clientTop,
        );
        return [
          Math.min(x1, x2),
          Math.min(y1, y2),
          Math.max(x1, x2),
          Math.max(y1, y2),
        ];
      })
      .filter(
        (r, i, all) =>
          all.findIndex((other) =>
            other.every((n, j) => Math.abs(n - r[j]) < 0.1),
          ) === i,
      );
    const selected = {
      page: number,
      rects,
      text: s.toString(),
      anchor: {
        x: Math.max(
          12,
          Math.min(window.innerWidth - 390, selectionBounds.left),
        ),
        y: Math.max(
          76,
          Math.min(window.innerHeight - 80, selectionBounds.bottom + 8),
        ),
      },
    };
    if (!rects.length) return;
    setSelection(selected);
    if (tool === "highlight" || tool === "underline")
      void annotate(selected, tool);
  };
  const choose = (next: "select" | "hand" | "highlight" | "underline") => {
    setDrawingMode(null);
    setTool(next);
    if (selection && (next === "highlight" || next === "underline"))
      void annotate(selection, next);
  };
  const mark = () => {
    const next = bookmarks.includes(currentPage)
      ? bookmarks.filter((p) => p !== currentPage)
      : [...bookmarks, currentPage].sort((a, b) => a - b);
    setBookmarks(next);
    remember(
      `magicpdf.bookmarks.${doc.originalDiskPath || doc.name}`,
      JSON.stringify(next),
    );
  };
  const scale = (factor: number) => {
    const v = engine.current?.viewer;
    if (v && ready)
      v.currentScale = Math.min(4, Math.max(0.25, v.currentScale * factor));
  };
  return (
    <section
      className={`reader ${focus ? "reader-focus" : ""}`}
      aria-label="Visor PDF"
    >
      <ToolbarPortal id="reader-controls">
        <div
          className="reader-group primary-tools"
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).closest("button")) e.preventDefault();
          }}
        >
          <button
            title="Seleccionar y copiar texto"
            aria-label="Seleccionar texto"
            aria-pressed={tool === "select"}
            onClick={() => choose("select")}
          >
            <MousePointer size={17} />
            <span className="tool-label">Seleccionar</span>
          </button>
          <button
            title="Resaltar: arrastra sobre el texto"
            aria-label="Resaltar texto"
            aria-pressed={tool === "highlight"}
            disabled={busy}
            onClick={() => choose("highlight")}
          >
            <Highlighter size={17} />
            <span className="tool-label">Resaltar</span>
          </button>
          <button
            title="Subrayar: arrastra sobre el texto"
            aria-label="Subrayar texto"
            aria-pressed={tool === "underline"}
            disabled={busy}
            onClick={() => choose("underline")}
          >
            <Underline size={17} />
            <span className="tool-label">Subrayar</span>
          </button>
          <div id="drawing-controls" className="drawing-controls" />
          <button
            title="Mover la página"
            aria-label="Mover página"
            aria-pressed={hand}
            onClick={() => choose("hand")}
          >
            <Hand size={17} />
          </button>
        </div>
        <span className="bar-divider" />
        <button
          title="Buscar en el PDF (Ctrl+F)"
          aria-label="Buscar"
          aria-pressed={searchOpen}
          onClick={() => {
            setSearchOpen((v) => !v);
            setTimeout(() => searchInput.current?.focus(), 0);
          }}
        >
          <Search size={17} />
        </button>
        <select
          aria-label="Zoom"
          value=""
          disabled={!ready}
          onChange={(e) => {
            const v = engine.current?.viewer;
            if (v) v.currentScaleValue = e.target.value;
          }}
        >
          <option value="" disabled>
            {zoom}%
          </option>
          <option value="page-width">Ajustar al ancho</option>
          <option value="page-fit">Página completa</option>
          {[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((n) => (
            <option key={n} value={n}>
              {n * 100}%
            </option>
          ))}
        </select>
        <details className="workspace-menu menu-right">
          <summary title="Opciones de lectura" aria-label="Opciones de lectura">
            <Settings2 size={17} />
          </summary>
          <div className="workspace-dropdown">
            <div className="menu-section">Color de anotación</div>
            <div className="annotation-colors">
              {["#fde047", "#86efac", "#93c5fd", "#f9a8d4", "#6366f1"].map(
                (c) => (
                  <button
                    key={c}
                    title={c}
                    aria-label={`Color ${c}`}
                    aria-pressed={c === color}
                    style={{ background: c }}
                    onClick={() => {
                      setColor(c);
                      remember("magicpdf.highlight", c);
                    }}
                  />
                ),
              )}
            </div>
            <hr />
            <button aria-label="Reducir zoom" onClick={() => scale(1 / 1.2)}>
              <ZoomOut size={15} /> Reducir zoom
            </button>
            <button aria-label="Ampliar zoom" onClick={() => scale(1.2)}>
              <ZoomIn size={15} /> Ampliar zoom
            </button>
            <button
              aria-label="Girar vista"
              onClick={() => {
                const v = engine.current?.viewer;
                if (v) v.pagesRotation = (v.pagesRotation + 90) % 360;
              }}
            >
              <RotateCw size={15} /> Girar vista
            </button>
            <button
              aria-label="Marcar página"
              aria-pressed={bookmarks.includes(currentPage)}
              onClick={mark}
            >
              <Bookmark size={15} /> Marcar página actual
            </button>
            <button onClick={() => setMarksOpen((v) => !v)}>
              Ver marcadores ({bookmarks.length})
            </button>
            <button
              aria-label="Concentración"
              onClick={() => setFocus((v) => !v)}
            >
              <Focus size={15} /> Concentración
            </button>
          </div>
        </details>
        <button
          className="edit-mode-button"
          aria-label="Editar PDF"
          onClick={onEnterEditMode}
        >
          <Edit3 size={16} />
          <span>Editar PDF</span>
        </button>
      </ToolbarPortal>
      <AnnotationWorkspace
        filename={doc.filename}
        viewer={engine.current?.viewer || null}
        bus={engine.current?.bus || null}
        annotations={annotations}
        setAnnotations={setAnnotations}
        mode={drawingMode}
        onMode={(mode) => {
          setDrawingMode(mode);
          if (mode) {
            setTool("select");
            setSelection(null);
            window.getSelection()?.removeAllRanges();
          }
        }}
        onUpdated={onAnnotationsUpdated}
        onNotice={setNotice}
        interactive={tool === "select"}
        onActivateSelection={() => {
          setDrawingMode(null);
          setTool("select");
          setSelection(null);
          window.getSelection()?.removeAllRanges();
        }}
      />
      <ToolbarPortal id="reading-controls">
        <label
          className="paper-mode"
          title="El modo noche oscurece el papel; al volver al día se restaura blanco o sepia"
        >
          <span>Papel</span>
          <select
            aria-label="Color de lectura"
            value={mode}
            onChange={(event) => {
              const next = event.target.value;
              if (next === "night") onThemeChange("dark");
              else {
                setDayPaper(next);
                remember("magicpdf.reading", next);
                onThemeChange("light");
              }
            }}
          >
            <option value="normal">Blanco</option>
            <option value="sepia">Sepia</option>
            <option value="night">Noche</option>
          </select>
        </label>
      </ToolbarPortal>
      {searchOpen && (
        <div className="reader-search search-floating">
          <Search size={15} />
          <input
            ref={searchInput}
            aria-label="Buscar texto"
            placeholder="Buscar en el documento…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") find(true, e.shiftKey);
            }}
          />
          <span aria-live="polite">
            {matches.current} / {matches.total}
          </span>
          <button
            aria-label="Coincidencia anterior"
            onClick={() => find(true, true)}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            aria-label="Siguiente coincidencia"
            onClick={() => find(true)}
          >
            <ChevronRight size={16} />
          </button>
          <button
            aria-label="Cerrar búsqueda"
            onClick={() => {
              setSearchOpen(false);
              setQuery("");
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {marksOpen && (
        <div className="reader-search reader-bookmarks bookmarks-floating">
          {bookmarks.length ? (
            bookmarks.map((p) => (
              <button key={p} onClick={() => onPageChange(p)}>
                Página {p}
              </button>
            ))
          ) : (
            <span>Aún no hay marcadores.</span>
          )}
          <button
            aria-label="Cerrar marcadores"
            onClick={() => setMarksOpen(false)}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {selection && tool === "select" && (
        <div
          className="selection-popover"
          role="toolbar"
          aria-label="Acciones del texto seleccionado"
          style={{ left: selection.anchor.x, top: selection.anchor.y }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button
            title="Copiar selección"
            aria-label="Copiar selección"
            onClick={() => {
              void navigator.clipboard
                .writeText(selection.text)
                .then(() => setNotice("Texto copiado."))
                .catch(() => setNotice("Usa Ctrl+C para copiar."));
            }}
          >
            <Copy size={16} />
          </button>
          <span />
          <button
            disabled={busy}
            onClick={() => void annotate(selection, "highlight")}
          >
            <Highlighter size={16} /> Resaltar selección
          </button>
          <button
            disabled={busy}
            onClick={() => void annotate(selection, "underline")}
          >
            <Underline size={16} /> Subrayar selección
          </button>
        </div>
      )}
      {notice && (
        <div className="reader-notice reader-toast" role="status">
          {notice}
          <button aria-label="Cerrar aviso" onClick={() => setNotice("")}>
            <X size={14} />
          </button>
        </div>
      )}
      {scanned && (
        <div className="scan-hint">
          <span>
            Esta página es una imagen. Reconoce su texto para seleccionar y
            anotar.
          </span>
          <button
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("magicpdf:tool", { detail: "ocr" }),
              )
            }
          >
            Reconocer texto
          </button>
        </div>
      )}
      <div className="reader-stage">
        {!ready && !error && (
          <div className="reader-loading" role="status">
            Preparando documento…
          </div>
        )}
        {error && (
          <div className="reader-loading" role="alert">
            {error}
          </div>
        )}
        <div
          ref={host}
          role="region"
          aria-label={`Lectura de ${doc.name}`}
          tabIndex={0}
          onScroll={(event) => {
            const viewer = engine.current?.viewer;
            if (ready && viewer && !restoringView.current)
              savedView.current = {
                page: viewer.currentPageNumber,
                scale: viewer.currentScaleValue,
                rotation: viewer.pagesRotation,
                top: event.currentTarget.scrollTop,
                left: event.currentTarget.scrollLeft,
              };
          }}
          className={`reader-scroll reading-${mode} ${hand ? "reader-hand" : ""} ${tool === "highlight" || tool === "underline" ? "reader-annotating" : ""}`}
          onMouseUp={() => {
            drag.current = null;
            capture();
          }}
          onKeyUp={() => {
            if (tool === "select") capture();
          }}
          onMouseDown={(e) => {
            if (hand && host.current) {
              e.preventDefault();
              drag.current = {
                x: e.clientX,
                y: e.clientY,
                left: host.current.scrollLeft,
                top: host.current.scrollTop,
              };
            }
          }}
          onMouseMove={(e) => {
            if (drag.current && host.current) {
              host.current.scrollLeft =
                drag.current.left + drag.current.x - e.clientX;
              host.current.scrollTop =
                drag.current.top + drag.current.y - e.clientY;
            }
          }}
          onMouseLeave={() => {
            drag.current = null;
          }}
        >
          <div ref={pages} className="pdfViewer" />
        </div>
      </div>
      <footer className="reader-footer">
        <span>
          {busy
            ? "Guardando anotación…"
            : {
                select: "Selecciona texto para copiar, resaltar o subrayar.",
                hand: "Arrastra para mover la página.",
                highlight: "Resaltar · arrastra sobre el texto.",
                underline: "Subrayar · arrastra sobre el texto.",
              }[tool]}
        </span>
        <div className="reader-group">
          <button
            aria-label="Página anterior"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(currentPage - 1)}
          >
            <ChevronLeft size={15} />
          </button>
          <label>
            <input
              aria-label="Número de página"
              type="number"
              min={1}
              max={doc.pages}
              value={currentPage}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n >= 1 && n <= doc.pages)
                  onPageChange(n);
              }}
            />
            <span aria-hidden="true"> / {doc.pages}</span>
          </label>
          <button
            aria-label="Página siguiente"
            disabled={currentPage >= doc.pages}
            onClick={() => onPageChange(currentPage + 1)}
          >
            <ChevronRight size={15} />
          </button>
        </div>
        <span className="sr-only" role="status">
          {ready ? `Página ${currentPage} de ${doc.pages}` : ""}
        </span>
        <span>Ctrl+F buscar · Ctrl+S guardar</span>
      </footer>
    </section>
  );
}
