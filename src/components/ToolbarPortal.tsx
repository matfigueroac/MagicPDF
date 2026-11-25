import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
export function ToolbarPortal({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const found = document.getElementById(id);
    if (found) {
      setTarget(found);
      return;
    }
    const observer = new MutationObserver(() => {
      const node = document.getElementById(id);
      if (node) {
        setTarget(node);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [id]);
  return target ? createPortal(children, target) : null;
}
