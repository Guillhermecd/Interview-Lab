// Role names are fixed because the migrations create and grant them by name.
export const READONLY_ROLE = 'app_readonly';
export const APP_ROLE = 'app_rw';
// Writes products and stock movements, and nothing else (D-56).
export const CATALOG_ROLE = 'app_catalog_rw';
