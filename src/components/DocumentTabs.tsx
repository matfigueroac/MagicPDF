import { useEffect, useLayoutEffect, useRef } from "react";
import { FileText, Plus, X } from "lucide-react";
import type { PdfDocument } from "../types";

interface DocumentTabsProps {
  documents: PdfDocument[];
  activeDoc: PdfDocument | null;
  onSelectDoc: (doc: PdfDocument) => void;
  onCloseDoc: (id: string) => Promise<void>;
  onOpen: () => void;
}

export function DocumentTabs(p: DocumentTabsProps) {
  const appVersion = window.electronAPI?.appVersion ?? __APP_VERSION__;
  const tabs = useRef<HTMLDivElement>(null);
  const closingButton = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (!closingButton.current || closingButton.current.isConnected) return;
    closingButton.current = null;
    const target = tabs.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
      ?? tabs.current?.parentElement?.querySelector<HTMLButtonElement>(".new-document-tab");
    target?.focus();
  }, [p.documents]);
  useEffect(() => {
    tabs.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [p.activeDoc?.id]);

  const closeTab = async (id: string, button: HTMLButtonElement) => {
    closingButton.current = button;
    await p.onCloseDoc(id);
  };

  return (
    <div
      className={`document-titlebar${window.electronAPI ? " desktop-titlebar" : ""}`}
    >
      <span className="titlebar-brand" title={`MagicPDF Pro Lite ${appVersion}`}>
        MagicPDF <span className="titlebar-version">{appVersion}</span>
      </span>
      <div
        ref={tabs}
        className="document-tabs"
        role="tablist"
        aria-label="PDF abiertos"
      >
        {p.documents.map((doc, index) => (
          <div
            className="document-tab"
            key={doc.id}
            role="presentation"
            data-active={doc.id === p.activeDoc?.id}
          >
            <button
              type="button"
              role="tab"
              aria-selected={doc.id === p.activeDoc?.id}
              tabIndex={doc.id === p.activeDoc?.id ? 0 : -1}
              title={doc.name}
              onClick={() => p.onSelectDoc(doc)}
              onKeyDown={(event) => {
                let next = index;
                if (event.key === "ArrowRight")
                  next = (index + 1) % p.documents.length;
                else if (event.key === "ArrowLeft")
                  next = (index - 1 + p.documents.length) % p.documents.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = p.documents.length - 1;
                else return;
                event.preventDefault();
                p.onSelectDoc(p.documents[next]);
                tabs.current
                  ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                  [next]?.focus();
              }}
            >
              <FileText size={14} aria-hidden="true" />
              <span>{doc.name}</span>
            </button>
            <button
              type="button"
              className="close-document-tab"
              aria-label={`Cerrar ${doc.name}`}
              title={`Cerrar ${doc.name}`}
              onClick={(event) => {
                void closeTab(doc.id, event.currentTarget);
              }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="new-document-tab"
        onClick={p.onOpen}
        aria-label="Abrir PDF"
        title="Abrir PDF (Ctrl+O)"
      >
        <Plus size={18} aria-hidden="true" />
      </button>
      <div className="titlebar-drag-space" />
    </div>
  );
}
