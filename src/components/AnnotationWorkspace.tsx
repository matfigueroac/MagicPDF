import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import type { PDFViewer, EventBus } from "pdfjs-dist/web/pdf_viewer.mjs";
import {
  Type,
  Shapes,
  ChevronDown,
  X,
  Trash2,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  GalleryHorizontal,
  GalleryVertical,
  Group,
  Ungroup,
  Lock,
  LockOpen,
  BringToFront,
  SendToBack,
  ArrowUp,
  ArrowDown,
  Layers3,
  Copy,
} from "lucide-react";
import { ToolbarPortal } from "./ToolbarPortal";
import { writeAnnotation } from "../api/client";
import { LayersPanel } from "./LayersPanel";
import { InlineAnnotationText } from "./InlineAnnotationText";
import {
  isAnnotationHidden,
  type LayerScope,
  type LayerPatch,
} from "../api/annotationLayers";
import {
  mergeAnnotations,
  restoreAnnotations,
  type StackAction,
} from "../api/annotationStack";
import { layoutSelection, type LayoutAction } from "../api/annotationLayout";
import { useAnnotationMarquee } from "../hooks/useAnnotationMarquee";
import { activateAnnotation, useAnnotationShortcuts } from "../hooks/useAnnotationShortcuts";
import type { DrawingAnnotation, DrawingKind } from "../types/annotations";
const kinds: [DrawingKind, string][] = [
  ["rectangle", "Rectángulo"],
  ["square", "Cuadrado"],
  ["ellipse", "Círculo / óvalo"],
  ["line", "Línea"],
  ["arrow", "Flecha"],
  ["ink", "Dibujo libre"],
];
type Props = {
  filename: string;
  viewer: PDFViewer | null;
  bus: EventBus | null;
  annotations: DrawingAnnotation[];
  setAnnotations: Dispatch<SetStateAction<DrawingAnnotation[]>>;
  mode: DrawingKind | null;
  onMode: (mode: DrawingKind | null) => void;
  onUpdated: () => void;
  onNotice: (text: string) => void;
  interactive: boolean;
  onActivateSelection: () => void;
};
export function AnnotationWorkspace(p: Props) {
  const [layersOpen, setLayersOpen] = useState(false),
    [layerError, setLayerError] = useState("");
  const [editingText, setEditingText] = useState<string | null>(null);
  const inlineOriginal = useRef<DrawingAnnotation | null>(null);
  const inlineActive = useRef<string | null>(null);
  const [, render] = useState(0),
    [draft, setDraft] = useState<DrawingAnnotation | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [style, setStyle] = useState({
    color: "#4f46e5",
    width: 1.5,
    lineStyle: "solid" as DrawingAnnotation["lineStyle"],
    border: false,
    borderColor: "#4f46e5",
    fontSize: 14,
    fontFamily: "sans" as DrawingAnnotation["fontFamily"],
  });
  const drawing = useRef<DrawingAnnotation | null>(null),
    known = useRef(new Set<string>());
  const hosts = useRef(new Map<number, HTMLDivElement>());
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [groupPreview, setGroupPreview] = useState<DrawingAnnotation[] | null>(
    null,
  );
  const groupDrag = useRef<{
    source: DrawingAnnotation[];
    current: DrawingAnnotation[];
    origin: number[];
    changed: boolean;
    resize?: { anchor: number[]; corner: number[] };
  } | null>(null);
  const groupRows = p.annotations.filter((a) => groupIds.includes(a.id));
  const selectedRows = groupRows.length > 1 ? groupRows : draft ? [draft] : [];
  const isLocked = (a: DrawingAnnotation) =>
    !!a.locked ||
    !!(
      a.groupId &&
      p.annotations.some((row) => row.groupId === a.groupId && row.locked)
    );
  const selectionLocked = selectedRows.some(isLocked);
  const samePage =
    groupRows.length > 1 &&
    groupRows.every((a) => a.page === groupRows[0].page);
  const membersOf = (a: DrawingAnnotation) =>
    a.groupId ? p.annotations.filter((row) => row.groupId === a.groupId) : [a];
  const isPersistentGroup =
    groupRows.length > 1 &&
    !!groupRows[0].groupId &&
    groupRows.every((a) => a.groupId === groupRows[0].groupId);
  const hasPersistentGroups = groupRows.some((a) => !!a.groupId);
  const layoutUnitCount = new Set(
    groupRows.map((a) => (a.groupId ? `group:${a.groupId}` : `item:${a.id}`)),
  ).size;
  const selectRows = (rows: DrawingAnnotation[]) => {
    const selected = [
      ...new Map(rows.flatMap(membersOf).map((a) => [a.id, a])).values(),
    ];
    if (selected.length > 500) {
      p.onNotice(
        "Puedes seleccionar hasta 500 anotaciones a la vez. El grupo se conserva completo.",
      );
      return;
    }
    setGroupIds(selected.length > 1 ? selected.map((a) => a.id) : []);
    setDraft(selected.length === 1 ? selected[0] : null);
    setError("");
  };
  const manipulation = useRef<{
    original: DrawingAnnotation;
    current: DrawingAnnotation;
    origin: number[];
    screenPoints: number[][];
    bounds: number[];
    handle: string;
    changed: boolean;
  } | null>(null);
  const selectionBlocked = () =>
    !!(busy || p.mode || manipulation.current || groupDrag.current);
  const { marquee, cancelMarquee, isMarqueeActive } = useAnnotationMarquee({
    viewer: p.viewer,
    annotations: p.annotations,
    selectedRows,
    blocked: () => !p.interactive || selectionBlocked(),
    selectRows,
  });
  useEffect(() => {
    known.current = new Set(p.annotations.map((a) => a.id));
  }, [p.annotations]);
  useEffect(() => {
    if (!p.bus) return;
    const tick = () => {
      if (p.viewer)
        for (let i = 0; i < p.viewer.pagesCount; i++) {
          const view = p.viewer.getPageView(i);
          if (!view?.div) continue;
          let host = hosts.current.get(i);
          if (!host) {
            host = document.createElement("div");
            host.className = "magicpdf-annotations";
            hosts.current.set(i, host);
          }
          if (host.parentNode !== view.div) view.div.append(host);
        }
      render((n) => n + 1);
    };
    for (const event of ["pagerendered", "scalechanging", "rotationchanging"])
      p.bus.on(event, tick);
    tick();
    return () => {
      for (const event of ["pagerendered", "scalechanging", "rotationchanging"])
        p.bus?.off(event, tick);
    };
  }, [p.bus, p.viewer]);
  useEffect(() => {
    setEditingText(null);
    inlineActive.current = null;
    setDraft(null);
    setLayerError('');
    setGroupIds([]);
    setGroupPreview(null);
    groupDrag.current = null;
    cancelMarquee();
    drawing.current = null;
    manipulation.current = null;
  }, [p.filename, p.viewer, cancelMarquee]);
  const choose = (kind: DrawingKind) => {
    setDraft(null);
    setGroupIds([]);
    p.onMode(p.mode === kind ? null : kind);
  };
  const commit = async (
    a: DrawingAnnotation,
    remove = false,
    keepSelected = false,
    fitText = false,
  ) => {
    if (busy) return;
    const saved = p.annotations.find((row) => row.id === a.id);
    if (saved && isLocked(saved)) {
      p.onNotice("Elemento bloqueado. Desbloquéalo antes de editar o borrar.");
      return;
    }
    setGroupIds([]);
    if (inlineActive.current === a.id) {
      inlineActive.current = null;
      setEditingText(null);
    }
    setBusy(true);
    setError("");
    const previous = p.annotations;
    p.setAnnotations((rows) => mergeAnnotations(rows, [a], remove));
    setDraft(keepSelected && !remove ? a : null);
    try {
      const result = await writeAnnotation("/api/drawing", {
        filename: p.filename,
        annotation: a,
        remove,
        fitText,
      });
      if (!remove)
        p.setAnnotations((rows) => mergeAnnotations(rows, [result.annotation]));
      if (keepSelected && !remove)
        setDraft((current) =>
          current?.id === a.id ? result.annotation : current,
        );
      p.onUpdated();
      p.onNotice(
        remove
          ? "Anotación eliminada."
          : "Anotación guardada. Ctrl+S para guardar el archivo.",
      );
    } catch (e) {
      p.setAnnotations((rows) =>
        restoreAnnotations(rows, previous, new Set([a.id])),
      );
      setDraft(a);
      setError(e instanceof Error ? e.message : "No se pudo guardar");
      p.onNotice(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  };
  const startInline = (a: DrawingAnnotation) => {
    if (busy || isLocked(a) || a.groupId) return;
    inlineOriginal.current = p.annotations.find((row) => row.id === a.id) || null;
    inlineActive.current = a.id;
    setEditingText(a.id);
    setGroupIds([]);
    setDraft(a);
    p.onMode(null);
    setError("");
  };
  const finishInline = () => {
    if (!draft || inlineActive.current !== draft.id || busy) return;
    inlineActive.current = null;
    setEditingText(null);
    if (!draft.text.trim()) {
      setDraft(inlineOriginal.current);
      return;
    }
    if (JSON.stringify(draft) !== JSON.stringify(inlineOriginal.current))
      return commit(draft, false, true, true);
  };
  const finishSelection = () => {
    if (inlineActive.current) { finishInline(); return; }
    const saved = p.annotations.find(a => a.id === draft?.id);
    if (draft && saved && !isLocked(saved) && JSON.stringify(saved) !== JSON.stringify(draft))
      return commit(draft, false, true, draft.kind === "text");
  };
  useEffect(() => {
    const flush = (event: Event) => {
      const pending = finishSelection();
      if (pending) (event as CustomEvent<{waitUntil:(p:Promise<unknown>)=>void}>).detail.waitUntil(pending);
    };
    window.addEventListener('magicpdf-flush-annotations', flush);
    return () => window.removeEventListener('magicpdf-flush-annotations', flush);
  });
  useEffect(() => {
    if (!draft || busy || p.mode || drawing.current) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest('.inline-annotation-text,.draw-properties,.annotation-quick-tools'))
        finishSelection();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  });
  const commitGroup = async (rows: DrawingAnnotation[], remove = false) => {
    if (rows.length === 1) {
      await commit(rows[0], remove, !remove);
      return;
    }
    if (busy || !rows.length) return;
    if (
      rows.some((a) => {
        const saved = p.annotations.find((row) => row.id === a.id);
        return saved && isLocked(saved);
      })
    ) {
      p.onNotice(
        "La selección contiene elementos bloqueados. Desbloquéalos antes de editar o borrar.",
      );
      return;
    }
    setBusy(true);
    setError("");
    setGroupPreview(null);
    const ids = new Set(rows.map((a) => a.id)),
      previous = p.annotations;
    p.setAnnotations((all) => mergeAnnotations(all, rows, remove));
    setDraft(null);
    setGroupIds(remove ? [] : rows.map((a) => a.id));
    try {
      const result = await writeAnnotation("/api/drawing-batch", {
        filename: p.filename,
        annotations: rows,
        remove,
      });
      if (!remove)
        p.setAnnotations((all) => mergeAnnotations(all, result.annotations));
      p.onUpdated();
      p.onNotice(
        `${rows.length} anotaciones ${remove ? "eliminadas" : "guardadas"}. Ctrl+S para guardar el archivo.`,
      );
    } catch (e) {
      p.setAnnotations((all) => restoreAnnotations(all, previous, ids));
      selectRows(previous.filter((a) => ids.has(a.id)));
      setError(e instanceof Error ? e.message : "No se pudo guardar el grupo");
      p.onNotice(
        e instanceof Error ? e.message : "No se pudo guardar el grupo",
      );
    } finally {
      setBusy(false);
    }
  };
  const changeOrder = async (action: StackAction) => {
    if (
      busy ||
      selectionLocked ||
      !selectedRows.length ||
      selectedRows.some((a) => !p.annotations.some((row) => row.id === a.id))
    )
      return;
    if (draft) {
      const saved = p.annotations.find((a) => a.id === draft.id)!;
      if (
        JSON.stringify({ ...saved, lines: undefined }) !==
        JSON.stringify({ ...draft, lines: undefined })
      ) {
        setError("Aplica o cancela los cambios antes de cambiar el orden.");
        return;
      }
    }
    setBusy(true);
    setError("");
    try {
      const result = await writeAnnotation("/api/annotation-order", {
        filename: p.filename,
        ids: selectedRows.map((a) => a.id),
        action,
      });
      p.setAnnotations(result.annotations);
      if (draft)
        setDraft(
          result.annotations.find(
            (a: DrawingAnnotation) => a.id === draft.id,
          ) || null,
        );
      if (result.changed) p.onUpdated();
      p.onNotice(
        result.changed
          ? "Orden actualizado. Ctrl+S para guardar el archivo."
          : "La selección ya está en ese orden.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cambiar el orden");
      p.onNotice(
        e instanceof Error ? e.message : "No se pudo cambiar el orden",
      );
    } finally {
      setBusy(false);
    }
  };
  const orderControls = (disabled: boolean) => (
    <details className="annotation-order annotation-details">
      <summary>Orden de capas</summary>
      <div>
        <button
          disabled={disabled}
          onClick={() => void changeOrder("front")}
          title="Por encima de las demás anotaciones"
        >
          <BringToFront size={16} />
          Traer al frente
        </button>
        <button
          disabled={disabled}
          onClick={() => void changeOrder("back")}
          title="Por debajo de las demás anotaciones"
        >
          <SendToBack size={16} />
          Enviar al fondo
        </button>
        <button
          disabled={disabled}
          onClick={() => void changeOrder("forward")}
          title="Subir una posición"
        >
          <ArrowUp size={16} />
          Adelantar
        </button>
        <button
          disabled={disabled}
          onClick={() => void changeOrder("backward")}
          title="Bajar una posición"
        >
          <ArrowDown size={16} />
          Atrasar
        </button>
      </div>
    </details>
  );
  const changeLock = async (locked: boolean) => {
    if (
      busy ||
      !selectedRows.length ||
      selectedRows.some((a) => !p.annotations.some((row) => row.id === a.id))
    )
      return;
    if (locked && draft) {
      const saved = p.annotations.find((a) => a.id === draft.id)!;
      if (
        JSON.stringify({ ...saved, lines: undefined }) !==
        JSON.stringify({ ...draft, lines: undefined })
      ) {
        setError("Aplica o cancela los cambios antes de bloquear.");
        return;
      }
    }
    setBusy(true);
    setError("");
    try {
      const result = await writeAnnotation("/api/annotation-lock", {
        filename: p.filename,
        ids: selectedRows.map((a) => a.id),
        locked,
      });
      const updated: DrawingAnnotation[] = result.annotations,
        map = new Map(updated.map((a) => [a.id, a]));
      p.setAnnotations((rows) => rows.map((a) => map.get(a.id) || a));
      setGroupIds(updated.length > 1 ? updated.map((a) => a.id) : []);
      setDraft(updated.length === 1 ? updated[0] : null);
      p.onUpdated();
      p.onNotice(
        `${locked ? "Bloqueo activado" : "Bloqueo desactivado"}. Ctrl+S para guardar el archivo.`,
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo cambiar el bloqueo",
      );
      p.onNotice(
        e instanceof Error ? e.message : "No se pudo cambiar el bloqueo",
      );
    } finally {
      setBusy(false);
    }
  };
  const translateRows = (rows: DrawingAnnotation[], dx: number, dy: number) => {
    const mapped = rows.map((a) => {
      const viewport = p.viewer!.getPageView(a.page - 1).viewport;
      return {
        a,
        viewport,
        points: a.points.map(([x, y]) => viewport.convertToViewportPoint(x, y)),
      };
    });
    let lowX = -Infinity,
      highX = Infinity,
      lowY = -Infinity,
      highY = Infinity;
    for (const { viewport, points } of mapped) {
      lowX = Math.max(lowX, -Math.min(...points.map((v) => v[0])));
      highX = Math.min(
        highX,
        viewport.width - Math.max(...points.map((v) => v[0])),
      );
      lowY = Math.max(lowY, -Math.min(...points.map((v) => v[1])));
      highY = Math.min(
        highY,
        viewport.height - Math.max(...points.map((v) => v[1])),
      );
    }
    const x = Math.max(lowX, Math.min(highX, dx)),
      y = Math.max(lowY, Math.min(highY, dy));
    return mapped.map(({ a, viewport, points }) => ({
      ...a,
      points: points.map(([px, py]) =>
        viewport.convertToPdfPoint(px + x, py + y),
      ),
    }));
  };
  const arrangeGroup = (action: LayoutAction) => {
    if (
      busy ||
      selectionLocked ||
      !samePage ||
      layoutUnitCount < 2 ||
      !p.viewer
    )
      return;
    setError("");
    try {
      const rows = layoutSelection(
        groupRows,
        action,
        p.viewer.getPageView(groupRows[0].page - 1).viewport,
      );
      if (
        rows.every((a, i) =>
          a.points.every((point, j) =>
            point.every(
              (n, k) => Math.abs(n - groupRows[i].points[j][k]) < 0.01,
            ),
          ),
        )
      ) {
        p.onNotice("La selección ya tiene esa disposición.");
        return;
      }
      void commitGroup(rows);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo organizar la selección",
      );
    }
  };
  const changeMembership = (group: boolean) => {
    if (
      busy ||
      selectionLocked ||
      groupRows.length < 2 ||
      (group && isPersistentGroup) ||
      (!group && !hasPersistentGroups)
    )
      return;
    const groupId = group ? `magicpdf-group-${crypto.randomUUID()}` : undefined;
    void commitGroup(
      groupRows.map((a) => ({
        ...a,
        groupId,
        groupName: undefined,
        groupHidden: undefined,
        hidden: isAnnotationHidden(a),
      })),
    );
  };
  const changeLayer = async (
    scope: LayerScope,
    id: string,
    patch: LayerPatch,
  ) => {
    if (busy) return false;
    setBusy(true);
    setLayerError("");
    try {
      const result = await writeAnnotation("/api/annotation-layer", {
        filename: p.filename,
        scope,
        id,
        patch,
      });
      p.setAnnotations((rows) => mergeAnnotations(rows, result.annotations));
      setDraft((current) => {
        const updated = result.annotations.find(
          (a: DrawingAnnotation) => a.id === current?.id,
        );
        return current && updated
          ? {
              ...current,
              name: updated.name,
              groupName: updated.groupName,
              hidden: updated.hidden,
              groupHidden: updated.groupHidden,
            }
          : current;
      });
      if (result.changed) p.onUpdated();
      p.onNotice(
        patch.name !== undefined
          ? "Nombre de capa actualizado. Ctrl+S para guardar."
          : "Visibilidad actualizada. Ctrl+S para guardar.",
      );
      return true;
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "No se pudo actualizar la capa";
      setLayerError(message);
      p.onNotice(message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const selectLayer = (rows: DrawingAnnotation[], additive: boolean) => {
    if (busy || !rows.length) return;
    p.onActivateSelection();
    drawing.current = null;
    manipulation.current = null;
    groupDrag.current = null;
    setGroupPreview(null);
    window.getSelection()?.removeAllRanges();
    const expanded = [
        ...new Map(rows.flatMap(membersOf).map((a) => [a.id, a])).values(),
      ],
      ids = new Set(expanded.map((a) => a.id));
    selectRows(
      additive
        ? expanded.every((a) => selectedRows.some((b) => b.id === a.id))
          ? selectedRows.filter((a) => !ids.has(a.id))
          : [...selectedRows, ...expanded]
        : expanded,
    );
    if (p.viewer && p.viewer.currentPageNumber !== rows[0].page)
      p.viewer.currentPageNumber = rows[0].page;
  };
  const insertCopies = (
    sources: DrawingAnnotation[],
    offset = 18,
    keepPages = false,
  ) => {
    const currentPage = p.viewer?.currentPageNumber;
    if (!currentPage || busy || !sources.length) return;
    const firstPage = Math.min(...sources.map((a) => a.page));
    const copiedGroups = new Map<string, string>();
    for (const source of sources)
      if (source.groupId && !copiedGroups.has(source.groupId))
        copiedGroups.set(
          source.groupId,
          `magicpdf-group-${crypto.randomUUID()}`,
        );
    const copies = sources.map((source) => ({
      ...source,
      id: `magicpdf-${crypto.randomUUID()}`,
      page: keepPages ? source.page : currentPage + source.page - firstPage,
      lines: undefined,
      groupId: source.groupId ? copiedGroups.get(source.groupId) : undefined,
    }));
    if (copies.some((a) => a.page > p.viewer!.pagesCount)) {
      p.onNotice("No hay suficientes páginas para pegar este grupo.");
      return;
    }
    window.getSelection()?.removeAllRanges();
    setError("");
    void commitGroup(translateRows(copies, offset, offset));
  };
  useAnnotationShortcuts({
    selectedRows,
    interactive: p.interactive,
    blocked: () => selectionBlocked() || isMarqueeActive(),
    drawing: () => !!drawing.current,
    kindLabel: kind => kinds.find(([value]) => value === kind)?.[1],
    onNotice: p.onNotice,
    insertCopies,
    cancelSelection: () => {
      setDraft(inlineActive.current ? inlineOriginal.current : null);
      inlineActive.current = null;
      setEditingText(null);
      setGroupIds([]);
      setGroupPreview(null);
      groupDrag.current = null;
      cancelMarquee();
      drawing.current = null;
      manipulation.current = null;
      setError("");
    },
    removeSelection: () => {
      if (selectionLocked) {
        p.onNotice(
          "La selección está bloqueada. Desbloquéala antes de borrar.",
        );
        return;
      }
      if (groupRows.length > 1) void commitGroup(groupRows, true);
      else if (draft && p.annotations.some((a) => a.id === draft.id))
        void commit(draft, true);
      else setDraft(null);
    },
  });
  useEffect(() => {
    if (
      !selectedRows.length ||
      document.activeElement?.matches("input,textarea,select,[contenteditable]")
    )
      return;
    document
      .querySelector<SVGGElement>(
        `g[data-annotation-id="${selectedRows[0].id}"]`,
      )
      ?.focus({ preventScroll: true });
  }, [draft?.id, groupIds.join(",")]);
  const update = (changes: Partial<DrawingAnnotation>) => {
    if (draft && isLocked(draft)) return;
    setDraft((a) => (a ? { ...a, ...changes, lines: undefined } : null));
  };
  useEffect(() => {
    // Let the text layer handle drags through existing marks. A plain click
    // selects the mark underneath without blocking native text selection.
    const selectMark = (event: MouseEvent) => {
      if (!p.interactive || p.mode || busy || event.button !== 0 ||
          !window.getSelection()?.isCollapsed || !(event.target instanceof Element) ||
          event.target.closest("[data-annotation-id],button,input,textarea,select")) return;
      const page = event.target.closest<HTMLElement>(".page[data-page-number]");
      if (!page) return;
      const number = Number(page.dataset.pageNumber);
      const view = p.viewer?.getPageView(number - 1);
      if (!view || view.div !== page) return;
      const bounds = page.getBoundingClientRect();
      const [x, y] = view.viewport.convertToPdfPoint(
        event.clientX - bounds.left - page.clientLeft,
        event.clientY - bounds.top - page.clientTop,
      );
      const mark = [...p.annotations].reverse().find(a =>
        a.page === number && !isAnnotationHidden(a) &&
        (a.kind === "highlight" || a.kind === "underline") &&
        a.rects?.some(r => x >= r[0] && x <= r[2] &&
          (a.kind === "highlight" ? y >= r[1] && y <= r[3] : Math.abs(y - r[1]) <= 5 / view.viewport.scale)),
      );
      if (mark) { selectRows([mark]); setError(""); }
    };
    document.addEventListener("click", selectMark);
    return () => document.removeEventListener("click", selectMark);
  });
  const selectionActions = () => (
    <div className="annotation-quick-tools" role="toolbar" aria-label="Acciones rápidas de selección"
      onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
      {!isPersistentGroup && <button aria-label="Agrupar" title="Agrupar" disabled={busy || selectionLocked || !samePage}
        onClick={() => changeMembership(true)}><Group size={16} /></button>}
      {hasPersistentGroups && <button aria-label="Desagrupar" title="Desagrupar" disabled={busy || selectionLocked}
        onClick={() => changeMembership(false)}><Ungroup size={16} /></button>}
      <button aria-label={selectionLocked ? "Desbloquear selección" : "Bloquear selección"}
        title={selectionLocked ? "Desbloquear selección" : "Bloquear selección"} disabled={busy}
        onClick={() => void changeLock(!selectionLocked)}>{selectionLocked ? <LockOpen size={16} /> : <Lock size={16} />}</button>
      {([
        ["left", "Alinear a la izquierda", AlignStartVertical],
        ["center", "Alinear al centro", AlignCenterVertical],
        ["right", "Alinear a la derecha", AlignEndVertical],
        ["horizontal", "Distribuir horizontalmente", GalleryHorizontal],
        ["vertical", "Distribuir verticalmente", GalleryVertical],
      ] as const).filter(([action]) => samePage && layoutUnitCount >= (action === "horizontal" || action === "vertical" ? 3 : 2))
        .map(([action, label, Icon]) => <button key={action} aria-label={label} title={label}
          disabled={busy || selectionLocked} onClick={() => arrangeGroup(action)}><Icon size={16} /></button>)}
      <button aria-label="Duplicar selección · Ctrl+D" title="Duplicar selección (Ctrl+D)" disabled={busy}
        onClick={() => insertCopies(groupRows, 18, true)}><Copy size={16} /></button>
      <button aria-label="Eliminar selección · Supr" title="Eliminar selección (Supr)" disabled={busy || selectionLocked}
        onClick={() => void commitGroup(groupRows, true)}><Trash2 size={16} /></button>
    </div>
  );
  const overlays = [];
  if (p.viewer?.pdfDocument)
    for (let index = 0; index < p.viewer.pagesCount; index++) {
      const view = p.viewer.getPageView(index);
      const host = hosts.current.get(index);
      if (!view?.div || !view.viewport || !host) continue;
      const viewport = view.viewport,
        scale = viewport.scale,
        toScreen = (point: number[]) =>
          viewport.convertToViewportPoint(point[0], point[1]);
      const point = (event: React.PointerEvent<SVGRectElement>) => {
        const r = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
        return viewport.convertToPdfPoint(
          event.clientX - r.left,
          event.clientY - r.top,
        );
      };
      const displayed = groupPreview
        ? p.annotations.map(
            (a) => groupPreview.find((row) => row.id === a.id) || a,
          )
        : p.annotations;
      const rows = displayed
        .filter((a) => a.page === index + 1)
        .map((a) => (a.id === draft?.id ? draft : a))
        .filter((a) => !isAnnotationHidden(a));
      if (
        draft?.page === index + 1 &&
        !isAnnotationHidden(draft) &&
        !rows.some((a) => a.id === draft.id)
      )
        rows.push(draft);
      const selectedPoints = rows.filter((a) => groupIds.includes(a.id)).flatMap((a) => a.points.map(toScreen));
      const groupBox = isPersistentGroup && samePage && selectedPoints.length ? {
        left: Math.min(...selectedPoints.map(v => v[0])),
        top: Math.min(...selectedPoints.map(v => v[1])),
        right: Math.max(...selectedPoints.map(v => v[0])),
        bottom: Math.max(...selectedPoints.map(v => v[1])),
      } : null;
      const quickWidth = Math.min(356, viewport.width - 8);
      const quickX = selectedPoints.length ? Math.max(4, Math.min(
        (Math.min(...selectedPoints.map((v) => v[0])) + Math.max(...selectedPoints.map((v) => v[0])) - quickWidth) / 2,
        viewport.width - quickWidth - 4,
      )) : 4;
      const quickY = selectedPoints.length ? Math.max(4, Math.min(...selectedPoints.map((v) => v[1])) - 46) : 4;
      overlays.push(
        createPortal(
          <svg
            className={`annotation-overlay ${p.mode ? "drawing-active" : ""}`}
            key={`svg-${index}`}
            viewBox={`0 0 ${viewport.width} ${viewport.height}`}
            aria-label={`Anotaciones de página ${index + 1}`}
          >
            {rows.map((a) => {
              const points = a.points.map(toScreen),
                xs = points.map((v) => v[0]),
                ys = points.map((v) => v[1]),
                x = Math.min(...xs),
                y = Math.min(...ys),
                w = Math.max(...xs) - x,
                h = Math.max(...ys) - y;
              const dash =
                a.lineStyle === "dashed"
                  ? `${a.width * 4 * scale} ${a.width * 2 * scale}`
                  : a.lineStyle === "dotted"
                    ? `${a.width * scale} ${a.width * 2 * scale}`
                    : undefined;
              const stroke = {
                stroke: a.kind === "text" ? a.borderColor : a.color,
                strokeWidth: a.width * scale,
                strokeDasharray: dash,
                strokeLinecap: "round" as const,
                strokeLinejoin: "round" as const,
                fill: "none",
              };
              const textMark = a.kind === "highlight" || a.kind === "underline";
              const interactive =
                p.interactive &&
                !p.mode &&
                !busy;
              const selected = draft?.id === a.id || groupIds.includes(a.id);
              const screenPoint = (event: React.PointerEvent<SVGElement>) => {
                const bounds =
                  event.currentTarget.ownerSVGElement!.getBoundingClientRect();
                return [
                  event.clientX - bounds.left,
                  event.clientY - bounds.top,
                ];
              };
              const begin = (
                event: React.PointerEvent<SVGElement>,
                handle = "move",
              ) => {
                if (!interactive || event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                const group = event.currentTarget.closest<SVGGElement>(
                  "g[data-annotation-id]",
                )!;
                group.focus({ preventScroll: true });
                window.getSelection()?.removeAllRanges();
                if (textMark) {
                  selectRows([a]);
                  setError("");
                  return;
                }
                if (event.ctrlKey || event.metaKey) {
                  const owned = selectedRows.filter((row) =>
                    p.annotations.some((saved) => saved.id === row.id),
                  );
                  const members = membersOf(a),
                    ids = new Set(members.map((row) => row.id));
                  selectRows(
                    owned.some((row) => row.id === a.id)
                      ? owned.filter((row) => !ids.has(row.id))
                      : [...owned, ...members],
                  );
                  return;
                }
                if (groupRows.length > 1 && groupIds.includes(a.id)) {
                  if (selectionLocked) return;
                  group.setPointerCapture(event.pointerId);
                  groupDrag.current = {
                    source: groupRows,
                    current: groupRows,
                    origin: [event.clientX, event.clientY],
                    changed: false,
                  };
                  return;
                }
                const members = membersOf(a);
                if (members.length > 1) {
                  if (members.length > 500) {
                    selectRows(members);
                    return;
                  }
                  selectRows(members);
                  if (members.some(isLocked)) return;
                  group.setPointerCapture(event.pointerId);
                  groupDrag.current = {
                    source: members,
                    current: members,
                    origin: [event.clientX, event.clientY],
                    changed: false,
                  };
                  return;
                }
                if (isLocked(a)) {
                  selectRows([a]);
                  return;
                }
                setGroupIds([]);
                group.setPointerCapture(event.pointerId);
                manipulation.current = {
                  original: a,
                  current: a,
                  origin: screenPoint(event),
                  screenPoints: points,
                  bounds: [x, y, w, h],
                  handle,
                  changed: false,
                };
                setDraft(a);
                setError("");
                p.onMode(null);
              };
              let visual;
              if (a.kind === "highlight")
                visual = <path fill={a.color} opacity={0.35}
                  d={a.rects?.map((r) => {
                    const first = toScreen([r[0], r[1]]), last = toScreen([r[2], r[3]]);
                    const x = Math.min(first[0], last[0]), y = Math.min(first[1], last[1]);
                    return `M ${x} ${y} h ${Math.abs(first[0] - last[0])} v ${Math.abs(first[1] - last[1])} H ${x} Z`;
                  }).join(" ")} />;
              else if (a.kind === "underline")
                visual = a.rects?.map((r, i) => {
                  const first = toScreen([r[0], r[1]]);
                  return (
                    <line
                      key={i}
                      x1={first[0]}
                      y1={first[1]}
                      x2={toScreen([r[2], r[1]])[0]}
                      y2={toScreen([r[2], r[1]])[1]}
                      {...stroke}
                    />
                  );
                });
              else if (a.kind === "rectangle" || a.kind === "square")
                visual = <rect x={x} y={y} width={w} height={h} {...stroke} />;
              else if (a.kind === "ellipse")
                visual = (
                  <ellipse
                    cx={x + w / 2}
                    cy={y + h / 2}
                    rx={w / 2}
                    ry={h / 2}
                    {...stroke}
                  />
                );
              else if (a.kind === "text")
                visual = (
                  <>
                    {a.border && (
                      <rect x={x} y={y} width={w} height={h} {...stroke} />
                    )}
                    <rect
                      x={x}
                      y={y}
                      width={w}
                      height={h}
                      fill="transparent"
                      stroke="none"
                    />
                    <text visibility={editingText === a.id ? "hidden" : undefined}
                      x={0}
                      y={0}
                      transform={`translate(${toScreen([Math.min(...a.points.map((v) => v[0])) + 4, Math.max(...a.points.map((v) => v[1])) - a.fontSize - 3]).join(" ")}) rotate(${viewport.rotation})`}
                      fill={a.color}
                      fontSize={a.fontSize * scale}
                      fontFamily={
                        a.fontFamily === "serif"
                          ? "Times New Roman"
                          : a.fontFamily === "mono"
                            ? "Courier New"
                            : "Arial"
                      }
                    >
                      {(a.lines || a.text.split("\n")).map((line, i) => (
                        <tspan
                          key={i}
                          x={0}
                          dy={i ? a.fontSize * 1.25 * scale : 0}
                        >
                          {line}
                        </tspan>
                      ))}
                    </text>
                  </>
                );
              else if (a.kind === "ink")
                visual = (
                  <polyline
                    points={points.map((v) => v.join(",")).join(" ")}
                    {...stroke}
                  />
                );
              else {
                const start = points[0],
                  end = points.at(-1)!,
                  angle = Math.atan2(end[1] - start[1], end[0] - start[0]),
                  length = Math.max(8, a.width * 5) * scale;
                visual = (
                  <>
                    <line
                      x1={start[0]}
                      y1={start[1]}
                      x2={end[0]}
                      y2={end[1]}
                      {...stroke}
                    />
                    {a.kind === "arrow" &&
                      [-0.45, 0.45].map((delta) => (
                        <line
                          key={delta}
                          x1={end[0]}
                          y1={end[1]}
                          x2={end[0] - length * Math.cos(angle + delta)}
                          y2={end[1] - length * Math.sin(angle + delta)}
                          {...stroke}
                        />
                      ))}
                  </>
                );
              }
              return (
                <g
                  key={a.id}
                  data-annotation-id={a.id}
                  data-kind={a.kind}
                  data-group-id={a.groupId}
                  data-locked={isLocked(a) || undefined}
                  className="live-annotation"
                  data-selected={selected || undefined}
                  role={interactive ? "button" : undefined}
                  aria-label={
                    interactive
                      ? a.kind === "text"
                        ? `Cuadro de texto: ${a.text}`
                        : textMark
                          ? `${a.kind === "highlight" ? "Resaltado" : "Subrayado"}: ${a.text}`
                        : kinds.find(([kind]) => kind === a.kind)?.[1]
                      : undefined
                  }
                  tabIndex={interactive ? 0 : undefined}
                  style={{
                    pointerEvents: textMark ? "none" : interactive
                      ? a.kind === "text" || a.kind === "highlight"
                        ? "all"
                        : "stroke"
                      : "none",
                    cursor: interactive
                      ? isLocked(a) || textMark
                        ? "pointer"
                        : "move"
                      : undefined,
                  }}
                  onKeyDown={event => activateAnnotation(event, interactive, () => {
                    selectRows(membersOf(a));
                    window.getSelection()?.removeAllRanges();
                    setError("");
                  })}
                  onDoubleClick={(event) => {
                    if (interactive && a.kind === "text" && !isLocked(a) && !a.groupId) {
                      event.preventDefault(); event.stopPropagation(); startInline(a);
                    }
                  }}
                  onPointerDown={(event) => {
                    if ((event.target as Element).closest('.inline-annotation-text,.annotation-quick-tools')) return;
                    begin(event);
                  }}
                  onPointerMove={(event) => {
                    const moving = groupDrag.current;
                    if (moving) {
                      const dx = event.clientX - moving.origin[0],
                        dy = event.clientY - moving.origin[1];
                      if (!moving.changed && Math.hypot(dx, dy) < 3) return;
                      event.preventDefault();
                      event.stopPropagation();
                      moving.changed = true;
                      moving.current = translateRows(moving.source, dx, dy);
                      setGroupPreview(moving.current);
                      return;
                    }
                    const drag = manipulation.current;
                    if (!drag || drag.original.id !== a.id) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const end = screenPoint(event),
                      dx = end[0] - drag.origin[0],
                      dy = end[1] - drag.origin[1];
                    if (!drag.changed && Math.hypot(dx, dy) < 3) return;
                    drag.changed = true;
                    const [bx, by, bw, bh] = drag.bounds;
                    let transformed: number[][];
                    if (drag.handle === "move") {
                      const moveX = Math.max(
                        -bx,
                        Math.min(viewport.width - bx - bw, dx),
                      );
                      const moveY = Math.max(
                        -by,
                        Math.min(viewport.height - by - bh, dy),
                      );
                      transformed = drag.screenPoints.map(([px, py]) => [
                        px + moveX,
                        py + moveY,
                      ]);
                    } else if (drag.handle.startsWith("endpoint")) {
                      const endpoint = Number(drag.handle.slice(-1)),
                        other = drag.screenPoints[1 - endpoint];
                      if (Math.hypot(end[0] - other[0], end[1] - other[1]) < 6)
                        return;
                      transformed = drag.screenPoints.map((point, i) =>
                        i === endpoint ? end : point,
                      );
                    } else {
                      let left = bx,
                        top = by,
                        right = bx + bw,
                        bottom = by + bh;
                      const minimum = Math.max(8, 6 * scale);
                      if (drag.handle.includes("w"))
                        left = Math.min(bx + dx, right - minimum);
                      if (drag.handle.includes("e"))
                        right = Math.max(bx + bw + dx, left + minimum);
                      if (drag.handle.includes("n"))
                        top = Math.min(by + dy, bottom - minimum);
                      if (drag.handle.includes("s"))
                        bottom = Math.max(by + bh + dy, top + minimum);
                      if (a.kind === "square") {
                        const size = Math.max(right - left, bottom - top);
                        if (drag.handle.includes("w")) left = right - size;
                        else right = left + size;
                        if (drag.handle.includes("n")) top = bottom - size;
                        else bottom = top + size;
                      }
                      transformed = drag.screenPoints.map(([px, py]) => [
                        left + (bw ? (px - bx) / bw : 0.5) * (right - left),
                        top + (bh ? (py - by) / bh : 0.5) * (bottom - top),
                      ]);
                    }
                    drag.current = {
                      ...drag.original,
                      points: transformed.map(([px, py]) =>
                        viewport.convertToPdfPoint(px, py),
                      ),
                      lines:
                        drag.handle === "move"
                          ? drag.original.lines
                          : undefined,
                    };
                    setDraft(drag.current);
                  }}
                  onPointerUp={(event) => {
                    const moving = groupDrag.current;
                    if (moving) {
                      groupDrag.current = null;
                      event.preventDefault();
                      event.stopPropagation();
                      event.currentTarget.releasePointerCapture(
                        event.pointerId,
                      );
                      setGroupPreview(null);
                      if (moving.changed) void commitGroup(moving.current);
                      return;
                    }
                    const drag = manipulation.current;
                    if (!drag || drag.original.id !== a.id) return;
                    event.preventDefault();
                    event.stopPropagation();
                    manipulation.current = null;
                    event.currentTarget.releasePointerCapture(event.pointerId);
                    if (
                      drag.changed &&
                      p.annotations.some((row) => row.id === a.id)
                    )
                      void commit(drag.current, false, true);
                  }}
                  onPointerCancel={() => {
                    if (groupDrag.current) {
                      groupDrag.current = null;
                      setGroupPreview(null);
                    }
                    const drag = manipulation.current;
                    if (drag?.original.id === a.id) {
                      manipulation.current = null;
                      setDraft(drag.original);
                    }
                  }}
                >
                  {visual}
                  {interactive && a.kind !== "text" && !textMark && (
                    <g
                      className="annotation-hit-target"
                      stroke="transparent"
                      strokeWidth={Math.max(12, a.width * scale)}
                      fill="none"
                      pointerEvents="stroke"
                    >
                      {a.kind === "rectangle" || a.kind === "square" ? (
                        <rect x={x} y={y} width={w} height={h} />
                      ) : a.kind === "ellipse" ? (
                        <ellipse
                          cx={x + w / 2}
                          cy={y + h / 2}
                          rx={w / 2}
                          ry={h / 2}
                        />
                      ) : (
                        <polyline
                          points={points
                            .map((point) => point.join(","))
                            .join(" ")}
                        />
                      )}
                    </g>
                  )}
                  {selected && !groupBox && (
                    <g className="annotation-selection">
                      <rect
                        x={x - 3}
                        y={y - 3}
                        width={w + 6}
                        height={h + 6}
                        fill="transparent"
                        stroke="#6366f1"
                        strokeWidth="1"
                        strokeDasharray="4 4"
                        pointerEvents={interactive && !textMark ? "all" : "none"}
                      />
                      {isLocked(a) && (
                        <Lock
                          x={x + w - 12}
                          y={y - 18}
                          width={14}
                          height={14}
                          color="#6366f1"
                          pointerEvents="none"
                        />
                      )}
                      {interactive &&
                        !textMark &&
                        !selectionLocked &&
                        !isLocked(a) &&
                        groupRows.length < 2 &&
                        (a.kind === "line" || a.kind === "arrow"
                          ? points.map(([hx, hy], i) => ({
                              name: `endpoint${i}`,
                              x: hx,
                              y: hy,
                              cursor: "crosshair",
                              label: i
                                ? "Mover extremo final"
                                : "Mover extremo inicial",
                            }))
                          : [
                              {
                                name: "nw",
                                x,
                                y,
                                cursor: "nwse-resize",
                                label:
                                  "Redimensionar esquina superior izquierda",
                              },
                              {
                                name: "ne",
                                x: x + w,
                                y,
                                cursor: "nesw-resize",
                                label: "Redimensionar esquina superior derecha",
                              },
                              {
                                name: "sw",
                                x,
                                y: y + h,
                                cursor: "nesw-resize",
                                label:
                                  "Redimensionar esquina inferior izquierda",
                              },
                              {
                                name: "se",
                                x: x + w,
                                y: y + h,
                                cursor: "nwse-resize",
                                label: "Redimensionar esquina inferior derecha",
                              },
                              ...(a.kind === "square"
                                ? []
                                : [
                                    {
                                      name: "n",
                                      x: x + w / 2,
                                      y,
                                      cursor: "ns-resize",
                                      label: "Redimensionar borde superior",
                                    },
                                    {
                                      name: "s",
                                      x: x + w / 2,
                                      y: y + h,
                                      cursor: "ns-resize",
                                      label: "Redimensionar borde inferior",
                                    },
                                    {
                                      name: "w",
                                      x,
                                      y: y + h / 2,
                                      cursor: "ew-resize",
                                      label: "Redimensionar borde izquierdo",
                                    },
                                    {
                                      name: "e",
                                      x: x + w,
                                      y: y + h / 2,
                                      cursor: "ew-resize",
                                      label: "Redimensionar borde derecho",
                                    },
                                  ]),
                            ]
                        ).map((handle) => (
                          <rect
                            key={handle.name}
                            data-resize-handle={handle.name}
                            aria-label={handle.label}
                            x={handle.x - 5}
                            y={handle.y - 5}
                            width={10}
                            height={10}
                            rx={2}
                            fill="white"
                            stroke="#6366f1"
                            strokeWidth={1.5}
                            pointerEvents="all"
                            style={{ cursor: handle.cursor }}
                            onPointerDown={(event) => begin(event, handle.name)}
                          />
                        ))}
                    </g>
                  )}
                  {editingText === a.id && (
                    <foreignObject
                      transform={`translate(${toScreen([Math.min(...a.points.map(v => v[0])), Math.max(...a.points.map(v => v[1]))]).join(" ")}) rotate(${viewport.rotation})`}
                      width={Math.abs(a.points[1][0] - a.points[0][0]) * scale}
                      height={Math.abs(a.points[1][1] - a.points[0][1]) * scale}
                      style={{ overflow: "visible", pointerEvents: "all" }}>
                      <InlineAnnotationText annotation={a} scale={scale}
                        onChange={(text) => update({ text })} onFinish={finishInline}
                        onCancel={() => {
                          inlineActive.current = null; setEditingText(null);
                          setDraft(inlineOriginal.current); setError("");
                        }} />
                    </foreignObject>
                  )}

                </g>
              );
            })}
            {groupBox && !p.mode && (
              <g className="annotation-group-selection"
                onPointerDown={(event) => {
                  if (event.button !== 0 || !p.interactive || busy) return;
                  event.preventDefault(); event.stopPropagation();
                  if (event.ctrlKey || event.metaKey) {
                    const target = document.elementsFromPoint(event.clientX, event.clientY)
                      .map(element => element.closest('[data-annotation-id]')?.getAttribute('data-annotation-id'))
                      .find(id => id && !groupIds.includes(id));
                    const row = p.annotations.find(a => a.id === target);
                    selectRows(row ? [...groupRows, ...membersOf(row)] : []);
                    return;
                  }
                  if (selectionLocked) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  groupDrag.current = { source: groupRows, current: groupRows,
                    origin: [event.clientX, event.clientY], changed: false };
                }}
                onPointerMove={(event) => {
                  const drag = groupDrag.current;
                  if (!drag) return;
                  event.preventDefault(); event.stopPropagation();
                  const dx = event.clientX - drag.origin[0], dy = event.clientY - drag.origin[1];
                  if (!drag.changed && Math.hypot(dx, dy) < 3) return;
                  if (!drag.resize) {
                    drag.changed = true;
                    drag.current = translateRows(drag.source, dx, dy);
                    setGroupPreview(drag.current);
                    return;
                  }
                  const { anchor, corner } = drag.resize;
                  const vx = corner[0] - anchor[0], vy = corner[1] - anchor[1];
                  const length = vx * vx + vy * vy;
                  if (!length) return;
                  // Project onto the original diagonal to keep every member proportional.
                  const minimum = Math.max(0.05, ...drag.source.map(row =>
                    Math.max(0.5 / row.width, row.kind === "text" ? 6 / row.fontSize : 0)));
                  const maximum = Math.min(...drag.source.map(row =>
                    Math.min(12 / row.width, row.kind === "text" ? 96 / row.fontSize : Infinity)));
                  let factor = Math.min(maximum, Math.max(minimum, ((vx + dx) * vx + (vy + dy) * vy) / length));
                  for (const row of drag.source) for (const point of row.points) {
                    const screen = toScreen(point);
                    for (let axis = 0; axis < 2; axis++) {
                      const delta = screen[axis] - anchor[axis];
                      const limit = axis === 0 ? viewport.width : viewport.height;
                      if (delta > 0) factor = Math.min(factor, (limit - anchor[axis]) / delta);
                      if (delta < 0) factor = Math.min(factor, -anchor[axis] / delta);
                    }
                  }
                  if (factor < minimum) return;
                  drag.changed = true;
                  drag.current = drag.source.map(row => ({ ...row,
                    points: row.points.map(point => {
                      const [x, y] = toScreen(point);
                      return viewport.convertToPdfPoint(anchor[0] + (x - anchor[0]) * factor, anchor[1] + (y - anchor[1]) * factor);
                    }),
                    width: row.width * factor,
                    fontSize: row.kind === "text" ? row.fontSize * factor : row.fontSize,
                  }));
                  setGroupPreview(drag.current);
                }}
                onPointerUp={(event) => {
                  const drag = groupDrag.current;
                  if (!drag) return;
                  event.preventDefault(); event.stopPropagation();
                  groupDrag.current = null;
                  event.currentTarget.releasePointerCapture(event.pointerId);
                  setGroupPreview(null);
                  if (drag.changed) void commitGroup(drag.current);
                }}
                onPointerCancel={() => { groupDrag.current = null; setGroupPreview(null); }}>
                <rect x={groupBox.left} y={groupBox.top}
                  width={groupBox.right - groupBox.left} height={groupBox.bottom - groupBox.top}
                  fill="transparent" stroke="#6366f1" strokeWidth={1.5}
                  pointerEvents={p.interactive ? "all" : "none"}
                  style={{ cursor: selectionLocked ? "default" : "move" }} />
                {selectionLocked && <Lock x={groupBox.right - 14} y={groupBox.top - 20}
                  width={14} height={14} color="#6366f1" pointerEvents="none" />}
                {p.interactive && !busy && !selectionLocked && [
                  { name: "nw", x: groupBox.left, y: groupBox.top, ax: groupBox.right, ay: groupBox.bottom },
                  { name: "ne", x: groupBox.right, y: groupBox.top, ax: groupBox.left, ay: groupBox.bottom },
                  { name: "sw", x: groupBox.left, y: groupBox.bottom, ax: groupBox.right, ay: groupBox.top },
                  { name: "se", x: groupBox.right, y: groupBox.bottom, ax: groupBox.left, ay: groupBox.top },
                ].map(handle => <rect key={handle.name} data-group-resize-handle={handle.name}
                  aria-label={`Redimensionar grupo ${handle.name}`} x={handle.x - 6} y={handle.y - 6}
                  width={12} height={12} rx={3} fill="white" stroke="#6366f1" strokeWidth={1.5}
                  pointerEvents="all" style={{ cursor: ["nw", "se"].includes(handle.name) ? "nwse-resize" : "nesw-resize" }}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.preventDefault(); event.stopPropagation();
                    event.currentTarget.parentElement!.setPointerCapture(event.pointerId);
                    window.getSelection()?.removeAllRanges();
                    groupDrag.current = { source: groupRows, current: groupRows,
                      origin: [event.clientX, event.clientY], changed: false,
                      resize: { anchor: [handle.ax, handle.ay], corner: [handle.x, handle.y] } };
                  }} />)}
              </g>
            )}
            {groupRows.length > 1 && selectedPoints.length > 0 && !p.mode && (
              <foreignObject x={quickX} y={quickY} width={quickWidth} height={42} style={{ pointerEvents: "all", overflow: "visible" }}>
                {selectionActions()}
              </foreignObject>
            )}
            {draft && groupIds.length < 2 && !editingText && !p.mode && rows.filter(a => a.id === draft.id).map(a => {
              const points = a.points.map(toScreen);
              const x = Math.min(...points.map(v => v[0])), y = Math.min(...points.map(v => v[1]));
              const w = Math.max(...points.map(v => v[0])) - x;
              const textMark = ["highlight", "underline"].includes(a.kind);
              return (<foreignObject key={a.id} x={Math.max(4, Math.min(x + w / 2 - 101, viewport.width - 206))}
                      y={Math.max(4, y - 46)} width={204} height={42} style={{ pointerEvents: "all", overflow: "visible" }}>
                      <div className="annotation-quick-tools" role="toolbar" aria-label="Acciones rápidas de anotación"
                        onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                        <label title="Cambiar color" className="quick-color">
                          <input type="color" aria-label="Color rápido" value={a.color} disabled={busy || isLocked(a)}
                            onChange={(e) => { const color = e.target.value; setStyle(s => ({ ...s, color })); void commit({ ...a, color }, false, true); }} />
                        </label>
                        {!textMark && <><button title="Duplicar (Ctrl+D)" aria-label="Duplicar anotación" disabled={busy}
                          onClick={() => insertCopies([a])}><Copy size={16} /></button>
                        <button title={isLocked(a) ? "Desbloquear" : "Bloquear"} aria-label={isLocked(a) ? "Desbloquear elemento" : "Bloquear elemento"} disabled={busy}
                          onClick={() => void changeLock(!isLocked(a))}>{isLocked(a) ? <LockOpen size={16} /> : <Lock size={16} />}</button></>}
                        {["rectangle", "square", "ellipse", "line", "arrow"].includes(a.kind) && (
                          <label className="quick-shape" title="Cambiar forma">
                            <Shapes size={16} aria-hidden="true" />
                            <select aria-label="Cambiar forma rápido" value={a.kind} disabled={busy || isLocked(a)}
                              onChange={(e) => {
                                const kind = e.target.value as DrawingKind;
                                let points = a.points;
                                if (kind === "square") {
                                  const [start, end] = a.points;
                                  const side = Math.min(Math.abs(end[0] - start[0]), Math.abs(end[1] - start[1]));
                                  const cx = (start[0] + end[0]) / 2, cy = (start[1] + end[1]) / 2;
                                  points = [[cx - side / 2, cy + side / 2], [cx + side / 2, cy - side / 2]];
                                }
                                if (points[0][0] === points[1][0] || points[0][1] === points[1][1]) {
                                  if (!["line", "arrow"].includes(kind)) {
                                    p.onNotice("Amplía la figura en ambas direcciones antes de cambiar a una forma cerrada.");
                                    return;
                                  }
                                }
                                void commit({ ...a, kind, points }, false, true);
                              }}>
                              <option value="rectangle">Rectángulo</option>
                              <option value="square">Cuadrado</option>
                              <option value="ellipse">Círculo / óvalo</option>
                              <option value="line">Línea</option>
                              <option value="arrow">Flecha</option>
                            </select>
                          </label>
                        )}
                        <button title="Eliminar (Supr)" aria-label="Eliminar anotación" disabled={busy || isLocked(a)}
                          onClick={() => void commit(a, true)}><Trash2 size={16} /></button>
                      </div>
                    </foreignObject>);
            })}
            {p.mode && (
              <rect
                x="0"
                y="0"
                width={viewport.width}
                height={viewport.height}
                fill="transparent"
                style={{ pointerEvents: "all", cursor: "crosshair" }}
                onPointerDown={(event) => {
                  if (busy || event.button !== 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  const origin = point(event);
                  const a: DrawingAnnotation = {
                    id: `magicpdf-${crypto.randomUUID()}`,
                    page: index + 1,
                    kind: p.mode!,
                    points: [origin, origin],
                    text: "",
                    ...style,
                  };
                  drawing.current = a;
                  setDraft(a);
                }}
                onPointerMove={(event) => {
                  const a = drawing.current;
                  if (!a) return;
                  let end = point(event);
                  if (a.kind === "square") {
                    const start = a.points[0],
                      side = Math.max(
                        Math.abs(end[0] - start[0]),
                        Math.abs(end[1] - start[1]),
                      );
                    end = [
                      start[0] + Math.sign(end[0] - start[0]) * side,
                      start[1] + Math.sign(end[1] - start[1]) * side,
                    ];
                  }
                  const points =
                    a.kind === "ink"
                      ? a.points.length < 2048
                        ? [...a.points, end]
                        : a.points
                      : [a.points[0], end];
                  drawing.current = { ...a, points };
                  setDraft(drawing.current);
                }}
                onPointerUp={(event) => {
                  const a = drawing.current;
                  if (!a) return;
                  event.preventDefault();
                  event.stopPropagation();
                  drawing.current = null;
                  event.currentTarget.releasePointerCapture(event.pointerId);
                  const end = a.points.at(-1)!,
                    start = a.points[0];
                  if (
                    Math.hypot(end[0] - start[0], end[1] - start[1]) < 3 &&
                    a.kind !== "ink" && a.kind !== "text"
                  ) {
                    setDraft(null);
                    return;
                  }
                  p.onMode(null);
                  if (a.kind === "text" && (Math.abs(end[0] - start[0]) < 12 || Math.abs(end[1] - start[1]) < 12)) {
                    const crop = view.pdfPage!.view;
                    const left = Math.min(start[0], crop[2] - 40), top = Math.max(start[1], crop[1] + 40);
                    a.points = [[left, top], [Math.min(left + 220, crop[2]), Math.max(top - 50, crop[1])]];
                  }
                  if (a.kind === "text") startInline(a);
                  else void commit(a, false, true);
                }}
                onPointerCancel={() => {
                  drawing.current = null;
                  setDraft(null);
                }}
              />
            )}
            {marquee?.page === index + 1 && (
              <rect
                className="annotation-marquee"
                x={marquee.x}
                y={marquee.y}
                width={marquee.w}
                height={marquee.h}
                fill="#6366f1"
                fillOpacity={0.1}
                stroke="#6366f1"
                strokeWidth={1}
                strokeDasharray="4 3"
                pointerEvents="none"
              />
            )}
          </svg>,
          host,
          `overlay-${index}`,
        ),
      );
    }
  return (
    <>
      <ToolbarPortal id="drawing-controls">
        <button
          aria-label="Insertar cuadro de texto"
          title="Dibuja un cuadro de texto"
          aria-pressed={p.mode === "text"}
          disabled={busy}
          onClick={() => choose("text")}
        >
          <Type size={17} />
        </button>
        <details className="workspace-menu">
          <summary aria-label="Figuras y dibujo" title="Figuras y dibujo libre">
            <Shapes size={17} />
            <ChevronDown size={10} />
          </summary>
          <div
            className="workspace-dropdown"
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("button"))
                event.currentTarget.closest("details")?.removeAttribute("open");
            }}
          >
            {kinds.map(([kind, label]) => (
              <button
                key={kind}
                aria-pressed={p.mode === kind}
                onClick={() => choose(kind)}
              >
                {label}
              </button>
            ))}
            <hr />
            <div className="menu-section">
              Sin relleno · dibuja sobre la página
            </div>
            <label>
              Color
              <input
                aria-label="Color de figura"
                type="color"
                value={style.color}
                onChange={(e) =>
                  setStyle((s) => ({
                    ...s,
                    color: e.target.value,
                    borderColor: e.target.value,
                  }))
                }
              />
            </label>
            <label>
              Grosor
              <input
                aria-label="Grosor de figura"
                type="number"
                min=".5"
                max="12"
                step=".5"
                value={style.width}
                onChange={(e) =>
                  setStyle((s) => ({ ...s, width: Number(e.target.value) }))
                }
              />
            </label>
          </div>
        </details>
      </ToolbarPortal>
      <ToolbarPortal id="left-panel-controls">
        <button
          aria-label="Capas"
          title="Ver y organizar capas"
          aria-pressed={layersOpen}
          aria-expanded={layersOpen}
          onClick={() => setLayersOpen((open) => !open)}
        >
          <Layers3 size={17} />
        </button>
      </ToolbarPortal>
      {layersOpen && (
        <LayersPanel
          key={p.filename}
          annotations={p.annotations}
          selectedIds={selectedRows.map((a) => a.id)}
          busy={busy}
          error={layerError}
          onClose={() => setLayersOpen(false)}
          onSelect={selectLayer}
          onChange={changeLayer}
        />
      )}
      {overlays}
      {p.mode && !draft && (
        <div className="drawing-hint" role="status">
          {p.mode === "text"
            ? "Arrastra para crear un cuadro de texto."
            : `Arrastra para dibujar: ${kinds.find(([kind]) => kind === p.mode)?.[1]}.`}
          <button onClick={() => p.onMode(null)}>Cancelar</button>
        </div>
      )}
      {groupRows.length > 1 && (
        <aside
          className="draw-properties group-properties"
          aria-label="Selección múltiple"
        >
          <header>
            <strong>
              {isPersistentGroup
                ? `${groupRows[0].groupName || "Grupo"} · ${groupRows.length} elementos`
                : `${groupRows.length} elementos seleccionados`}
            </strong>
            <button
              aria-label="Cancelar selección"
              onClick={() => selectRows([])}
            >
              <X size={16} />
            </button>
          </header>
          <p className="selection-summary">
            {isPersistentGroup ? "Arrastra las esquinas para cambiar el tamaño." : "Usa la barra sobre la selección para organizar los objetos."}
          </p>
          {error && <p role="alert">{error}</p>}
          {selectionLocked && <p className="annotation-lock-status" role="status">Selección bloqueada. Desbloquea desde la barra de acciones.</p>}
          {!groupRows.some(a => !isAnnotationHidden(a)) && selectionActions()}
          {orderControls(busy || selectionLocked)}
          <details className="annotation-details">
            <summary>Ayuda y atajos</summary>
            <p>Ctrl+clic agrega o quita objetos. Ctrl+C copia, Ctrl+V pega y Ctrl+D duplica. Supr elimina; Esc cancela la selección.</p>
            {hasPersistentGroups && <p>Desagrupa desde la barra de acciones para editar cada elemento.</p>}
          </details>
        </aside>
      )}
      {draft && !["highlight", "underline"].includes(draft.kind) && groupRows.length < 2 && !drawing.current && (
        <aside
          className="draw-properties"
          aria-label="Propiedades de anotación"
        >
          <header>
            <strong>
              {draft.name ||
                (draft.kind === "text"
                  ? "Cuadro de texto"
                  : "Estilo de figura")}
            </strong>
            <button
              aria-label="Cerrar propiedades"
              onClick={() => { finishSelection(); setDraft(null); }}
            >
              <X size={16} />
            </button>
          </header>
          {isAnnotationHidden(draft) && (<button
            className="annotation-lock-button"
            aria-label={
              isLocked(draft) ? "Desbloquear elemento" : "Bloquear elemento"
            }
            title={
              known.current.has(draft.id)
                ? "Cambiar el bloqueo"
                : "Aplica la anotación antes de bloquearla"
            }
            disabled={busy || !known.current.has(draft.id)}
            onClick={() => void changeLock(!isLocked(draft))}
          >
            {isLocked(draft) ? <LockOpen size={16} /> : <Lock size={16} />}
            {isLocked(draft) ? "Desbloquear" : "Bloquear"}
          </button>)}
          {isLocked(draft) && (
            <p className="annotation-lock-status" role="status">
              Elemento bloqueado. Puedes seleccionarlo y copiarlo. Desbloquéalo
              para mover, editar o borrar.
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          <fieldset
            className="annotation-edit-fields"
            disabled={busy || isLocked(draft)}
          >
            {orderControls(
              busy || isLocked(draft) || !known.current.has(draft.id),
            )}
            {draft.kind === "text" && (
              <>
                <label>
                  Texto
                  <textarea
                    aria-label="Texto de anotación"
                    rows={3}
                    value={draft.text}
                    onChange={(e) => update({ text: e.target.value })}
                  />
                </label>
                <div className="pro-grid">
                  <label>
                    Tipografía
                    <select
                      aria-label="Tipografía de anotación"
                      value={draft.fontFamily}
                      onChange={(e) =>
                        update({
                          fontFamily: e.target
                            .value as DrawingAnnotation["fontFamily"],
                        })
                      }
                    >
                      <option value="sans">Helvetica</option>
                      <option value="serif">Times</option>
                      <option value="mono">Courier</option>
                    </select>
                  </label>
                  <label>
                    Tamaño
                    <input
                      aria-label="Tamaño de anotación"
                      type="number"
                      min="6"
                      max="96"
                      value={draft.fontSize}
                      onChange={(e) =>
                        update({ fontSize: Number(e.target.value) })
                      }
                    />
                  </label>
                </div>
                <label className="border-toggle">
                  <input
                    aria-label="Mostrar borde de texto"
                    type="checkbox"
                    checked={draft.border}
                    onChange={(e) => update({ border: e.target.checked })}
                  />{" "}
                  Mostrar borde
                </label>
              </>
            )}
            <label>
              {draft.kind === "text" ? "Color del texto" : "Color de línea"}
              <input
                aria-label="Color de anotación"
                type="color"
                value={draft.color}
                onChange={(e) => {
                  update({ color: e.target.value });
                  setStyle((s) => ({ ...s, color: e.target.value }));
                }}
              />
            </label>
            {(draft.kind !== "text" || draft.border) && (
              <>
                <div className="pro-grid">
                  <label>
                    Grosor
                    <input
                      aria-label="Grosor de línea"
                      type="number"
                      min=".5"
                      max="12"
                      step=".5"
                      value={draft.width}
                      onChange={(e) =>
                        update({ width: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    Tipo de línea
                    <select
                      aria-label="Tipo de línea"
                      value={draft.lineStyle}
                      onChange={(e) =>
                        update({
                          lineStyle: e.target
                            .value as DrawingAnnotation["lineStyle"],
                        })
                      }
                    >
                      <option value="solid">Continua</option>
                      <option value="dashed">Discontinua</option>
                      <option value="dotted">Punteada</option>
                    </select>
                  </label>
                </div>
                {draft.kind === "text" && (
                  <label>
                    Color del borde
                    <input
                      aria-label="Color del borde"
                      type="color"
                      value={draft.borderColor}
                      onChange={(e) => update({ borderColor: e.target.value })}
                    />
                  </label>
                )}
              </>
            )}
            <details className="annotation-details">
              <summary>Ayuda y atajos</summary>
              <p>
              Se guarda como anotación editable dentro del PDF. Pulsa la figura
              o el texto para volver a editarlo. Arrastra para mover; usa los
              tiradores para cambiar el tamaño. Supr elimina la selección y Esc
              la cancela. Ctrl+C copia, Ctrl+V pega y Ctrl+D duplica. Los
              movimientos se guardan al soltar. Las figuras se crean automáticamente.
              Haz doble clic en un cuadro de texto para escribir sobre la página;
              clic fuera guarda y Esc cancela la edición.
              </p>
            </details>
            <button
              className="draw-apply"
              disabled={busy || (draft.kind === "text" && !draft.text.trim())}
              onClick={() => void commit(draft, false, false, draft.kind === "text")}
            >
              Aplicar anotación
            </button>
            {known.current.has(draft.id) && isAnnotationHidden(draft) && (
              <button
                className="draw-delete"
                disabled={busy}
                onClick={() => void commit(draft, true)}
              >
                <Trash2 size={14} /> Eliminar anotación
              </button>
            )}
            {draft.groupId && (
              <button
                disabled={busy}
                onClick={() =>
                  void commit({ ...draft, groupId: undefined }, false, true)
                }
              >
                <Ungroup size={14} />
                Desagrupar
              </button>
            )}
          </fieldset>
        </aside>
      )}
    </>
  );
}
