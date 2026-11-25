import { useEffect, useRef } from "react";
import {
  Home,
  Save,
  FolderOpen,
  Sun,
  Moon,
  PanelLeft,
  ChevronDown,
  ArrowLeft,
} from "lucide-react";
import type { PdfDocument, ViewMode } from "../types";
interface HeaderProps {
  activeDoc: PdfDocument | null;
  onCloseDoc: (id: string) => void;
  onUploadClick: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExportText: () => void;
  onExportCompressed: () => void;
  onPrint: () => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  saveStatusMessage?: string | null;
  onOpenDashboard: () => void;
  viewMode: ViewMode;
  onRead: () => void;
  pagesOpen: boolean;
  onTogglePages: () => void;
}
export function Header(p: HeaderProps) {
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      bar.current?.querySelectorAll("details[open]").forEach((detail) => {
        if (!detail.contains(event.target as Node))
          detail.removeAttribute("open");
      });
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape")
        bar.current
          ?.querySelectorAll("details[open]")
          .forEach((detail) => detail.removeAttribute("open"));
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", escape);
    };
  }, []);
  const closeMenu = (event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest("button"))
      (event.currentTarget as HTMLElement)
        .closest("details")
        ?.removeAttribute("open");
  };
  return (
    <header ref={bar} className="workspace-bar" aria-label="Barra principal">
      <details className="workspace-menu">
        <summary aria-label="Inicio">
          <Home size={15} /> Inicio <ChevronDown size={12} />
        </summary>
        <div className="workspace-dropdown" onClick={closeMenu}>
          <button onClick={p.onOpenDashboard}>Ir al inicio</button>
          <hr />
          <button onClick={p.onUploadClick}>
            <FolderOpen size={15} /> Abrir PDF <kbd>Ctrl+O</kbd>
          </button>
          {p.activeDoc && (
            <>
              <button onClick={p.onSaveAs}>
                Guardar como… <kbd>Ctrl+Shift+S</kbd>
              </button>
              <button onClick={p.onPrint}>
                Imprimir <kbd>Ctrl+P</kbd>
              </button>
              <hr />
              <button onClick={p.onExportText}>Exportar texto</button>
              <button onClick={p.onExportCompressed}>
                Exportar comprimido
              </button>
              <hr />
              <button onClick={() => p.onCloseDoc(p.activeDoc!.id)}>
                Cerrar documento
              </button>
            </>
          )}
          {window.electronAPI?.checkUpdates && (
            <>
              <hr />
              <button onClick={() => void window.electronAPI?.checkUpdates()}>
                Buscar actualizaciones…
              </button>
            </>
          )}
        </div>
      </details>
      {p.activeDoc && p.viewMode !== "dashboard" && (
        <>
          <button aria-label="Mostrar páginas"
            title={p.pagesOpen ? "Ocultar páginas" : "Mostrar páginas"}
            aria-pressed={p.pagesOpen} aria-expanded={p.pagesOpen}
            aria-controls="document-pages" onClick={p.onTogglePages}>
            <PanelLeft size={17} />
          </button>
          <div id="left-panel-controls" className="reader-controls" />
        </>
      )}
      <div id="history-controls" className="reader-controls" />
      {p.activeDoc && (
        <>
          {p.viewMode !== "dashboard" && (
            <>
              <span className="bar-divider" />
              <div id="reader-controls" className="reader-controls" />
              {p.viewMode !== "viewer" && (
                <button className="return-reading" onClick={p.onRead}>
                  <ArrowLeft size={15} /> Volver a lectura
                </button>
              )}
              <div id="pro-controls" className="reader-controls" />
            </>
          )}
          <div className="bar-spacer" />
          <button
            className="save-button"
            title="Guardar cambios (Ctrl+S)"
            aria-label="Guardar cambios"
            onClick={p.onSave}
          >
            <Save size={17} />
            <span className="tool-label">Guardar</span>
          </button>
        </>
      )}
      {!p.activeDoc && <div className="bar-spacer" />}
      {p.activeDoc && p.viewMode === "viewer" && (
        <div id="reading-controls" className="reading-controls" />
      )}
      <button
        aria-label="Cambiar tema"
        title={
          p.theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"
        }
        onClick={p.onToggleTheme}
      >
        {p.theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
      </button>
      {p.saveStatusMessage && (
        <div className="workspace-toast" role="status">
          {p.saveStatusMessage}
        </div>
      )}
    </header>
  );
}
