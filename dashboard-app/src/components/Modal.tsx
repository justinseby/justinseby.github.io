import { useEffect, useRef, type ReactNode } from "react";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    // showModal() focuses the close button; start in the first field instead.
    dialog?.querySelector<HTMLElement>("input, select")?.focus();
  }, []);
  return (
    <dialog ref={ref} className="modal" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="modal-body">
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon" aria-label="Close" onClick={onClose}>×</button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
