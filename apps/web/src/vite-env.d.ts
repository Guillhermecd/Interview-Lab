/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Base of the API calls; defaults to "/api" (same origin).
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
