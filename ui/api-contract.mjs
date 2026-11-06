/**
 * The workbench HTTP contract, as data.
 *
 * The browser client is a plain static app that only speaks this REST API, so a
 * different frontend (or another model) can be rebuilt against `docs/API.md`
 * without touching the server. Keep this list and that document in sync.
 */
export const API_VERSION = 'v1';
export const SERVER_NAME = 'mmsc-workbench';
export const SERVER_VERSION = '0.3.0';

/** Every endpoint the server answers, with method, path and a short shape. */
export const ENDPOINTS = [
  { method: 'GET', path: '/api/v1/version', summary: 'API and server version, feature flags.' },
  { method: 'GET', path: '/api/v1/state', summary: 'Active pack, detection, index stats, stations, quest summary, settings, pack library.' },
  { method: 'GET', path: '/api/v1/packs', summary: 'Saved pack library plus the active pack.' },
  { method: 'POST', path: '/api/v1/packs', body: { op: 'add | select | remove | rename', dir: 'absolute pack directory', name: 'display name for rename' }, summary: 'Add, switch, rename or forget a pack; switching reuses the cached index.' },
  { method: 'POST', path: '/api/v1/refresh', body: { scope: 'all | items | recipes | quests' }, summary: 'Force a rebuild of the selected index, bypassing caches.' },
  { method: 'POST', path: '/api/v1/open', body: { dir: 'pack directory' }, summary: 'Legacy alias for packs/select.' },
  { method: 'GET', path: '/api/v1/items', query: ['q', 'mod', 'limit', 'offset', 'withIcon'], summary: 'Search indexed items.' },
  { method: 'GET', path: '/api/v1/icon', query: ['jar', 'entry'], summary: 'PNG icon bytes from a mod jar.' },
  { method: 'GET', path: '/api/v1/icon-by-id', query: ['id'], summary: 'PNG icon bytes for an item id.' },
  { method: 'GET', path: '/api/v1/recipes', query: ['output', 'input', 'q', 'type', 'station', 'limit', 'offset'], summary: 'Recipe pages, optionally filtered by crafting station.' },
  { method: 'GET', path: '/api/v1/recipe/<id>', summary: 'One normalized recipe.' },
  { method: 'GET', path: '/api/v1/quests', summary: 'FTB Quests chapters and quests, titles merged from lang.' },
  { method: 'GET', path: '/api/v1/lint', summary: 'KubeJS lint report for the pack.' },
  { method: 'GET', path: '/api/v1/edits', summary: 'The workbench edit log.' },
  { method: 'POST', path: '/api/v1/edit', body: { op: 'remove | add | drop | clear', id: 'recipe id for remove', spec: 'recipe spec for add', index: 'log index for drop' }, summary: 'Record an edit and regenerate the script.' },
  { method: 'GET', path: '/api/v1/background', summary: 'Quest-page background image bytes.' },
  { method: 'POST', path: '/api/v1/background', body: { type: 'image/png', data: 'dataURL' }, summary: 'Upload or clear the quest background.' },
  { method: 'GET', path: '/api/v1/settings', summary: 'Workbench settings for the active pack.' },
  { method: 'POST', path: '/api/v1/settings', body: { clientJar: 'path' }, summary: 'Save per-pack workbench settings.' },
];

/**
 * Map unversioned or versioned API paths onto the canonical `/api/...` form the
 * request handler switches on, so both remain valid.
 * @param {string} path Request pathname.
 * @returns {string} Canonical path.
 */
export function canonicalPath(path) {
  const prefixed = `/api/${API_VERSION}/`;
  if (path.startsWith(prefixed)) return `/api/${path.slice(prefixed.length)}`;
  return path;
}

/** Describe the API for `GET /api/v1/version`. */
export function describeApi() {
  return { name: SERVER_NAME, version: SERVER_VERSION, apiVersion: API_VERSION, endpoints: ENDPOINTS };
}
