import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'rf_theme';

function guardado(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch { return null; }
}

function delSistema(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function aplicar(t: Theme) {
  document.documentElement.setAttribute('data-theme', t);
}

/**
 * Tema claro/oscuro. Sin eleccion explicita sigue al sistema operativo;
 * al alternar se guarda la preferencia en localStorage.
 * index.html aplica el tema antes de que React cargue (evita parpadeo).
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => guardado() ?? delSistema());

  useEffect(() => { aplicar(theme); }, [theme]);

  // Mientras el usuario no elija, seguir los cambios del sistema
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = () => { if (!guardado()) setTheme(mq.matches ? 'dark' : 'light'); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(STORAGE_KEY, next); } catch { /* almacenamiento no disponible */ }
      return next;
    });
  }, []);

  return { theme, toggle };
}
