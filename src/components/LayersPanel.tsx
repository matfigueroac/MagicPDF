import { useState } from "react";
import {
  X,
  Eye,
  EyeOff,
  Pencil,
  ChevronRight,
  ChevronDown,
  Group,
  Type,
  Shapes,
  Lock,
} from "lucide-react";
import type { DrawingAnnotation } from "../types/annotations";
import {
  isAnnotationHidden,
  layerLabel,
  type LayerScope,
  type LayerPatch,
} from "../api/annotationLayers";

type Props = {
  annotations: DrawingAnnotation[];
  selectedIds: string[];
  busy: boolean;
  error: string;
  onClose: () => void;
  onSelect: (rows: DrawingAnnotation[], additive: boolean) => void;
  onChange: (
    scope: LayerScope,
    id: string,
    patch: LayerPatch,
  ) => Promise<boolean>;
};
export function LayersPanel(p: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [rename, setRename] = useState<{ key: string; value: string } | null>(
    null,
  );
  const editable = p.annotations.filter(
    (a) => !["highlight", "underline"].includes(a.kind),
  );
  const pages = [...new Set(editable.map((a) => a.page))].sort((a, b) => a - b);
  const locked = (a: DrawingAnnotation) =>
    !!a.locked ||
    !!(a.groupId && editable.some((b) => b.groupId === a.groupId && b.locked));
  const row = (
    scope: LayerScope,
    id: string,
    items: DrawingAnnotation[],
    key: string,
    child = false,
  ) => {
    const a = items[0],
      isGroup = scope === "group";
    const label = isGroup
      ? a.groupName || `Grupo (${items.length})`
      : layerLabel(a);
    const ownHidden = isGroup ? !!a.groupHidden : !!a.hidden,
      hidden = isGroup ? !!a.groupHidden : isAnnotationHidden(a);
    const isLocked = items.some(locked),
      selected = items.every((a) => p.selectedIds.includes(a.id));
    const open = expanded.has(key);
    return (
      <div key={key} className={`layer-node ${child ? "layer-child" : ""}`}>
        <div
          className="layer-row"
          data-layer-scope={scope}
          data-layer-id={id}
          data-layer-hidden={hidden || undefined}
          data-layer-selected={selected || undefined}
        >
          {isGroup ? (
            <button
              className="layer-expand"
              aria-label={`${open ? "Contraer" : "Expandir"} grupo ${label}`}
              aria-expanded={open}
              onClick={() =>
                setExpanded((before) => {
                  const next = new Set(before);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                })
              }
            >
              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          ) : (
            <span className="layer-indent" />
          )}
          {rename?.key === key ? (
            <form
              className="layer-rename"
              onSubmit={async (event) => {
                event.preventDefault();
                if (await p.onChange(scope, id, { name: rename.value }))
                  setRename(null);
              }}
            >
              <input
                autoFocus
                aria-label="Nombre de la capa"
                maxLength={80}
                value={rename.value}
                disabled={p.busy}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) =>
                  setRename({ key, value: event.target.value })
                }
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    setRename(null);
                  }
                }}
              />
            </form>
          ) : (
            <button
              className="layer-select"
              title={label}
              aria-label={`Seleccionar ${label}`}
              aria-pressed={selected}
              disabled={p.busy}
              onClick={(event) =>
                p.onSelect(items, event.ctrlKey || event.metaKey)
              }
              onDoubleClick={() => {
                if (!isLocked)
                  setRename({
                    key,
                    value: isGroup ? a.groupName || "" : a.name || "",
                  });
              }}
            >
              {isGroup ? (
                <Group size={14} />
              ) : a.kind === "text" ? (
                <Type size={14} />
              ) : (
                <Shapes size={14} />
              )}
              <span>{label}</span>
              {isLocked && (
                <Lock className="layer-lock" size={11} aria-label="Bloqueado" />
              )}
            </button>
          )}
          <button
            className="layer-visibility"
            aria-label={`${ownHidden ? "Mostrar" : "Ocultar"} ${isGroup ? "grupo" : "capa"} ${label}`}
            aria-pressed={!ownHidden}
            title={
              !isGroup && a.groupHidden
                ? "Oculta por el grupo; muestra el grupo para verla"
                : ownHidden
                  ? "Mostrar"
                  : "Ocultar"
            }
            disabled={p.busy}
            onClick={() => void p.onChange(scope, id, { hidden: !ownHidden })}
          >
            {ownHidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button
            className="layer-edit-name"
            aria-label={`Renombrar ${label}`}
            title={isLocked ? "Desbloquea para renombrar" : "Renombrar"}
            disabled={p.busy || isLocked}
            onClick={() =>
              setRename({
                key,
                value: isGroup ? a.groupName || "" : a.name || "",
              })
            }
          >
            <Pencil size={13} />
          </button>
        </div>
        {isGroup &&
          open &&
          [...items]
            .reverse()
            .map((member) =>
              row("item", member.id, [member], `${key}:${member.id}`, true),
            )}
      </div>
    );
  };
  return (
    <aside className="layers-panel" aria-label="Panel de capas">
      <header>
        <div>
          <strong>Capas</strong>
          <small>{editable.length} objetos · frente arriba</small>
        </div>
        <button aria-label="Cerrar panel de capas" onClick={p.onClose}>
          <X size={16} />
        </button>
      </header>
      <p className="layers-help">
        Clic selecciona · Ctrl+clic agrega. Usa el ojo para mostrar u ocultar.
        Intro guarda el nombre; Esc cancela.
      </p>
      {p.error && (
        <p className="layers-error" role="alert">
          {p.error}
        </p>
      )}
      <div className="layers-list">
        {!editable.length && (
          <p className="layers-empty">
            Todavía no hay cuadros de texto ni figuras.
          </p>
        )}
        {pages.map((page) => {
          const units = new Map<
            string,
            {
              scope: LayerScope;
              id: string;
              items: DrawingAnnotation[];
              rank: number;
            }
          >();
          editable.forEach((a, index) => {
            if (a.page !== page) return;
            const key = a.groupId ? `group:${a.groupId}` : `item:${a.id}`,
              unit = units.get(key) || {
                scope: a.groupId ? "group" : "item",
                id: a.groupId || a.id,
                items: [],
                rank: index,
              };
            unit.items.push(a);
            unit.rank = index;
            units.set(key, unit);
          });
          return (
            <section
              className="layers-page"
              key={page}
              aria-label={`Capas de página ${page}`}
            >
              <h3>Página {page}</h3>
              {[...units.values()]
                .sort((a, b) => b.rank - a.rank)
                .map((unit) =>
                  row(
                    unit.scope,
                    unit.id,
                    unit.items,
                    `${page}:${unit.scope}:${unit.id}`,
                  ),
                )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
