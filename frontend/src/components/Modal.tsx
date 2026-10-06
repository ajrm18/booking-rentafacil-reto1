import { useEffect, useId, useRef } from 'react';

interface Props {
  titulo: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Bloquea Escape y el clic fuera (p. ej. mientras se guarda). */
  bloqueado?: boolean;
  ancho?: number;
}

const FOCUSABLES = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Ventana modal accesible: role="dialog", foco inicial en el primer campo, focus trap con Tab,
 * Escape cierra y al cerrar el foco vuelve al elemento que la abrió.
 */
export default function Modal({ titulo, onClose, children, bloqueado, ancho = 520 }: Props) {
  const uid = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    const primero = ref.current?.querySelector<HTMLElement>('input, select, textarea') ?? ref.current?.querySelector<HTMLElement>(FOCUSABLES);
    primero?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; previo?.focus?.(); };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); if (!bloqueado) onClose(); return; }
    if (e.key !== 'Tab' || !ref.current) return;
    const els = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLES));
    if (els.length === 0) { e.preventDefault(); return; }
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && (document.activeElement === first || !ref.current.contains(document.activeElement))) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !bloqueado) onClose(); }}>
      <div ref={ref} className="modal-dialog card" role="dialog" aria-modal="true" aria-labelledby={`${uid}-t`}
        style={{ maxWidth: ancho }} onKeyDown={onKeyDown}>
        <div className="card-body">
          <h2 id={`${uid}-t`} style={{ marginTop: 0, fontSize: '1.3rem' }}>{titulo}</h2>
          {children}
        </div>
      </div>
      <style>{`
        .modal-backdrop {
          position: fixed; inset: 0; z-index: 50; background: rgba(11, 13, 16, 0.7);
          display: flex; align-items: center; justify-content: center; padding: 1rem; overflow-y: auto;
        }
        .modal-dialog { width: 100%; box-shadow: var(--shadow-lg); margin: auto; }
        @media (max-width: 640px) {
          .modal-backdrop { padding: 0.5rem; }
          .modal-dialog { width: 95%; max-width: none !important; }
        }
      `}</style>
    </div>
  );
}
