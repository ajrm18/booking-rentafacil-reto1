/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_AFFILIATE_ID?: string;
  /** Base de /api/v2; por defecto VITE_API_URL con /api/v1 -> /api/v2. */
  readonly VITE_API_V2_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
