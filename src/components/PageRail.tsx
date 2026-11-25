import { getPageImageUrl } from "../api/client";
import type { PdfDocument } from "../types";
export function PageRail({
  document: doc,
  currentPage,
  onPageChange,
}: {
  document: PdfDocument;
  currentPage: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <aside id="document-pages" className="page-rail" aria-label="Páginas del documento">
      <div className="page-rail-heading">
        Páginas <span>{doc.pages}</span>
      </div>
      <div className="page-rail-list">
        {Array.from({ length: doc.pages }, (_, i) => i + 1).map((page) => (
          <button
            key={page}
            aria-label={`Ir a página ${page}`}
            aria-current={page === currentPage ? "page" : undefined}
            onClick={() => onPageChange(page)}
          >
            <img
              loading="lazy"
              src={getPageImageUrl(doc.filename, page, 60)}
              alt=""
            />
            <span>{page}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
