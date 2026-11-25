import { useEffect, useRef, useState } from "react";
import {
  Undo2,
  Redo2,
  ScanText,
  ListChecks,
  X,
  Files,
  Wrench,
  ChevronDown,
} from "lucide-react";
import { ToolbarPortal } from "./ToolbarPortal";
import { awaitAnnotationWrites, writeAnnotation } from "../api/client";
import type { PdfDocument, ToolType } from "../types";
type Field = {
  name: string;
  type: string;
  value: string | string[] | boolean | null;
  options: string[];
  readOnly: boolean;
  multiline: boolean;
};
async function api(url: string, data?: unknown) {
  const res = await fetch(
    url,
    data
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      : undefined,
  );
  const body = await res.json();
  if (!res.ok)
    throw new Error(body.error || "No se pudo completar la operación");
  return body;
}
function parsePages(value: string, total: number) {
  const pages = new Set<number>();
  for (const part of value.split(",")) {
    const match = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!match) throw new Error("Usa páginas como 1-3, 5");
    const a = Number(match[1]),
      b = Number(match[2] || a);
    if (a < 1 || b < a || b > total || b - a >= 20)
      throw new Error("Selecciona hasta 20 páginas válidas.");
    for (let i = a; i <= b; i++) pages.add(i);
  }
  if (pages.size > 20) throw new Error("Procesa hasta 20 páginas por lote.");
  return [...pages];
}
export function ProTools({
  document: doc,
  currentPage,
  onUpdated,
  onNavigate,
}: {
  document: PdfDocument;
  currentPage: number;
  onUpdated: (pages?: number) => void;
  onNavigate: (mode: "viewer" | "editor" | "organize" | "tools", tool?: ToolType) => void;
}) {
  const [panel, setPanel] = useState<"ocr" | "forms" | "layout" | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [history, setHistory] = useState({ undo: 0, redo: 0, limited: false });
  useEffect(() => {
    const open = (event: Event) => {
      const tool = (event as CustomEvent).detail;
      if (["ocr", "forms", "layout"].includes(tool)) {
        setPanel(tool);
        setRange(String(currentPage));
        setMessage("");
      }
    };
    window.addEventListener("magicpdf:tool", open);
    return () => window.removeEventListener("magicpdf:tool", open);
  }, [currentPage]);
  const [range, setRange] = useState(String(currentPage)),
    [language, setLanguage] = useState("spa+eng");
  const [fields, setFields] = useState<Field[]>([]),
    [values, setValues] = useState<Record<string, unknown>>({});
  const [layout, setLayout] = useState({
    text: "",
    x: 50,
    y: 100,
    width: 300,
    height: 120,
    size: 16,
    font: "sans",
    align: "left",
    color: "#222226",
  });
  const busyRef = useRef(false);
  const refresh = () =>
    api(`/api/history/${encodeURIComponent(doc.filename)}`)
      .then(setHistory)
      .catch(() => {});
  useEffect(() => {
    void refresh();
  }, [doc.filename, doc.revision,doc.annotationRevision]);
  useEffect(() => {
    if (panel !== "forms") return;
    let active = true;
    setMessage("Cargando campos…");
    api(`/api/forms/${encodeURIComponent(doc.filename)}`)
      .then((data) => {
        if (active) {
          setFields(data.fields);
          setValues(
            Object.fromEntries(
              data.fields
                .filter((f: Field) => f.type !== "unsupported" && !f.readOnly)
                .map((f: Field) => [f.name, f.value]),
            ),
          );
          setMessage(
            data.fields.length ? "" : "Este PDF no contiene campos AcroForm.",
          );
        }
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
    };
  }, [panel, doc.filename, doc.revision]);
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage("");
    try {
      await action();
      await refresh();
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "No se pudo completar la operación",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const restore = (direction: "undo" | "redo") =>
    run(async () => {
      const pending: Promise<unknown>[] = [];
      window.dispatchEvent(new CustomEvent("magicpdf-flush-annotations", {
        detail: { waitUntil: (promise: Promise<unknown>) => pending.push(promise) },
      }));
      await Promise.all(pending);
      await awaitAnnotationWrites(doc.filename);
      const available = await api(`/api/history/${encodeURIComponent(doc.filename)}`);
      if (!available[direction]) { setHistory(available); return; }
      const result = await writeAnnotation(`/api/history/${direction}`, {
        filename: doc.filename,
      });
      onUpdated(result.info.pages);
      setMessage(
        direction === "undo"
          ? "Cambio deshecho. Ctrl+S para guardar."
          : "Cambio rehecho. Ctrl+S para guardar.",
      );
    });
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement;
      if (target.closest("input,textarea,select,[contenteditable=true]"))
        return;
      if (e.key.toLowerCase() === "z" || e.key.toLowerCase() === "y") {
        e.preventDefault();
        void restoreRef.current(
          e.shiftKey || e.key.toLowerCase() === "y" ? "redo" : "undo",
        );
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const ocr = () =>
    run(async () => {
      const pages = parsePages(range, doc.pages);
      const timer = setInterval(() => {
        void api(`/api/ocr-status/${encodeURIComponent(doc.filename)}`)
          .then((data) => {
            if (data.message) setMessage(data.message);
          })
          .catch(() => {});
      }, 1500);
      try {
        const data = await api("/api/ocr", {
          filename: doc.filename,
          pages,
          language,
        });
        onUpdated();
        setMessage(
          data.results
            .map(
              (r: { page: number; text: string; confidence: number }) =>
                `Página ${r.page} · ${Math.round(r.confidence)}%\n${r.text}`,
            )
            .join("\n\n") +
            "\nCtrl+S para guardar el PDF con texto seleccionable.",
        );
      } finally {
        clearInterval(timer);
      }
    });
  return (
    <>
      <ToolbarPortal id="history-controls">
        <button aria-label="Deshacer" title="Deshacer (Ctrl+Z)"
          disabled={busy || !history.undo} onClick={() => void restore("undo")}>
          <Undo2 size={17} />
        </button>
        <button aria-label="Rehacer" title="Rehacer (Ctrl+Shift+Z / Ctrl+Y)"
          disabled={busy || !history.redo} onClick={() => void restore("redo")}>
          <Redo2 size={17} />
        </button>
      </ToolbarPortal>
      <ToolbarPortal id="pro-controls">
        <details className="workspace-menu">
          <summary aria-label="Organizar" title="Organizar, unir y dividir páginas">
            <Files size={17} /><span className="menu-label">Organizar</span><ChevronDown size={10} />
          </summary>
          <div className="workspace-dropdown" onClick={event => {
            if ((event.target as HTMLElement).closest("button")) event.currentTarget.closest("details")?.removeAttribute("open");
          }}>
            <button onClick={() => { setPanel(null); onNavigate("organize"); }}>Organizar páginas</button>
            <button onClick={() => { setPanel(null); onNavigate("tools", "merge"); }}>Unir PDF</button>
            <button onClick={() => { setPanel(null); onNavigate("tools", "split"); }}>Dividir PDF</button>
          </div>
        </details>
        <details className="workspace-menu menu-right">
          <summary aria-label="Herramientas" title="Herramientas del documento">
            <Wrench size={17} /><span className="menu-label">Herramientas</span><ChevronDown size={10} />
          </summary>
          <div
            className="workspace-dropdown"
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("button"))
                event.currentTarget.closest("details")?.removeAttribute("open");
            }}
          >
            <button
              aria-pressed={panel === "ocr"}
              disabled={busy}
              onClick={() => {
                setPanel(panel === "ocr" ? null : "ocr");
                setRange(String(currentPage));
                setMessage("");
              }}
            >
              <ScanText size={15} /> OCR local
            </button>
            <button
              aria-pressed={panel === "forms"}
              disabled={busy}
              onClick={() => setPanel(panel === "forms" ? null : "forms")}
            >
              <ListChecks size={15} /> Formulario
            </button>
            <hr />
            <button onClick={() => { setPanel(null); onNavigate("tools", "compress"); }}>Comprimir PDF</button>
            <button onClick={() => { setPanel(null); onNavigate("tools", "sign"); }}>Firmar documento</button>
            <button onClick={() => { setPanel(null); onNavigate("tools", "watermark"); }}>Marca de agua</button>
            <button onClick={() => { setPanel(null); onNavigate("tools", "protect"); }}>Proteger con contraseña</button>
            <button onClick={() => { setPanel(null); onNavigate("tools", "redact"); }}>Censurar área</button>
            <span className="pro-session">
              {history.limited
                ? "Historial no disponible: PDF mayor a 64 MiB"
                : "Historial de sesión · hasta 20 cambios"}
            </span>
          </div>
        </details>
      </ToolbarPortal>
      {message && !panel && (
        <div className="pro-message" role="status">
          {message}
          <button aria-label="Cerrar mensaje" onClick={() => setMessage("")}>
            <X size={14} />
          </button>
        </div>
      )}
      {panel && (
        <aside
          className="pro-inspector"
          aria-label={
            panel === "ocr"
              ? "Reconocimiento de texto"
              : panel === "forms"
                ? "Editar formulario"
                : "Maquetación de texto"
          }
        >
          <header>
            <div>
              <span>MAGICPDF PRO LITE</span>
              <h2>
                {panel === "ocr"
                  ? "Reconocer texto"
                  : panel === "forms"
                    ? "Editar formulario"
                    : "Cuadro de texto"}
              </h2>
            </div>
            <button
              aria-label="Cerrar panel"
              disabled={busy}
              onClick={() => setPanel(null)}
            >
              <X size={18} />
            </button>
          </header>
          {panel === "ocr" && (
            <>
              <p>
                Convierte escaneos en texto seleccionable y buscable. Español e
                inglés incluidos, sin enviar archivos a la nube. Se omiten las
                páginas que ya contienen texto.
              </p>
              <label>
                Páginas (hasta 20 por lote)
                <input
                  value={range}
                  onChange={(e) => setRange(e.target.value)}
                  placeholder="1-3, 5"
                />
              </label>
              <label>
                Idioma
                <select
                  aria-label="Idioma"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                >
                  <option value="spa+eng">Español + inglés</option>
                  <option value="spa">Español</option>
                  <option value="eng">Inglés</option>
                </select>
              </label>
              <button className="pro-primary" disabled={busy} onClick={ocr}>
                {busy ? "Reconociendo…" : "Reconocer páginas"}
              </button>
              <p>
                Revisa el resultado: la calidad depende del escaneo. El OCR
                agrega una capa invisible de texto; conserva la imagen original.
              </p>
            </>
          )}
          {panel === "forms" && (
            <>
              <p>
                Completa los campos del documento y aplica los cambios. Los
                campos permanecen editables en otros lectores compatibles.
              </p>
              {fields.map((field) => (
                <label key={field.name}>
                  {field.name}
                  {field.readOnly ? " · solo lectura" : ""}
                  {field.type === "checkbox" ? (
                    <input
                      type="checkbox"
                      disabled={field.readOnly || busy}
                      checked={Boolean(values[field.name] ?? field.value)}
                      onChange={(e) =>
                        setValues((v) => ({
                          ...v,
                          [field.name]: e.target.checked,
                        }))
                      }
                    />
                  ) : ["dropdown", "list", "radio"].includes(field.type) ? (
                    <select
                      aria-label={field.name}
                      disabled={field.readOnly || busy}
                      multiple={field.type === "list"}
                      value={
                        field.type === "list"
                          ? ((values[field.name] ?? field.value) as string[])
                          : Array.isArray(values[field.name] ?? field.value)
                            ? (
                                (values[field.name] ?? field.value) as string[]
                              )[0] || ""
                            : String(values[field.name] ?? field.value ?? "")
                      }
                      onChange={(e) =>
                        setValues((v) => ({
                          ...v,
                          [field.name]:
                            field.type === "list"
                              ? Array.from(
                                  e.target.selectedOptions,
                                  (o) => o.value,
                                )
                              : e.target.value,
                        }))
                      }
                    >
                      {field.type !== "list" && (
                        <option value="">Sin seleccionar</option>
                      )}
                      {field.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : field.type === "text" ? (
                    field.multiline ? (
                      <textarea
                        disabled={field.readOnly || busy}
                        value={String(values[field.name] ?? field.value ?? "")}
                        onChange={(e) =>
                          setValues((v) => ({
                            ...v,
                            [field.name]: e.target.value,
                          }))
                        }
                      />
                    ) : (
                      <input
                        disabled={field.readOnly || busy}
                        value={String(values[field.name] ?? field.value ?? "")}
                        onChange={(e) =>
                          setValues((v) => ({
                            ...v,
                            [field.name]: e.target.value,
                          }))
                        }
                      />
                    )
                  ) : (
                    <span>Campo no compatible</span>
                  )}
                </label>
              ))}
              <button
                className="pro-primary"
                disabled={busy || !Object.keys(values).length}
                onClick={() =>
                  void run(async () => {
                    await api("/api/forms", { filename: doc.filename, values });
                    onUpdated();
                    setMessage(
                      "Formulario aplicado. Ctrl+S para guardar en disco.",
                    );
                  })
                }
              >
                Aplicar formulario
              </button>
            </>
          )}
          {panel === "layout" && (
            <>
              <p>
                Página {currentPage}. Posición en puntos desde la esquina
                superior izquierda de la página sin girar. El cuadro agrega
                contenido sin desplazar los elementos existentes.
              </p>
              <label>
                Contenido
                <textarea
                  rows={5}
                  value={layout.text}
                  onChange={(e) =>
                    setLayout((v) => ({ ...v, text: e.target.value }))
                  }
                />
              </label>
              <div className="pro-grid">
                {(["x", "y", "width", "height", "size"] as const).map((key) => (
                  <label key={key}>
                    {
                      {
                        x: "Izquierda",
                        y: "Arriba",
                        width: "Ancho",
                        height: "Alto",
                        size: "Tamaño de letra",
                      }[key]
                    }
                    <input
                      type="number"
                      min={key === "x" || key === "y" ? 0 : 1}
                      value={layout[key]}
                      onChange={(e) =>
                        setLayout((v) => ({
                          ...v,
                          [key]: Number(e.target.value),
                        }))
                      }
                    />
                  </label>
                ))}
                <label>
                  Tipografía
                  <select
                    aria-label="Tipografía"
                    value={layout.font}
                    onChange={(e) =>
                      setLayout((v) => ({ ...v, font: e.target.value }))
                    }
                  >
                    <option value="sans">Helvetica</option>
                    <option value="serif">Times</option>
                    <option value="mono">Courier</option>
                  </select>
                </label>
                <label>
                  Alineación
                  <select
                    aria-label="Alineación"
                    value={layout.align}
                    onChange={(e) =>
                      setLayout((v) => ({ ...v, align: e.target.value }))
                    }
                  >
                    <option value="left">Izquierda</option>
                    <option value="center">Centro</option>
                    <option value="right">Derecha</option>
                  </select>
                </label>
                <label>
                  Color
                  <input
                    type="color"
                    value={layout.color}
                    onChange={(e) =>
                      setLayout((v) => ({ ...v, color: e.target.value }))
                    }
                  />
                </label>
              </div>
              <button
                className="pro-primary"
                disabled={busy || !layout.text.trim()}
                onClick={() =>
                  void run(async () => {
                    await api("/api/layout", {
                      filename: doc.filename,
                      page: currentPage,
                      ...layout,
                    });
                    onUpdated();
                    setMessage(
                      "Cuadro incorporado al PDF. Puedes deshacerlo o guardar con Ctrl+S.",
                    );
                  })
                }
              >
                Insertar cuadro
              </button>
            </>
          )}
          {message && (
            <pre className="pro-result" role="status">
              {message}
            </pre>
          )}
        </aside>
      )}
    </>
  );
}
