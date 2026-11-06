/**
 * The workbench HTTP contract, as data.
 *
 * The browser client is a plain static app that only speaks this REST API, so a
 * different frontend (or another model) can be rebuilt against `docs/API.md`
 * without touching the server. Keep this list and that document in sync.
 */
export const API_VERSION = 'v1';
export const SERVER_NAME = 'kjsftb-workbench';
export const SERVER_VERSION = '0.2.0';

/** Every endpoint the server answers, with method, path and a short shape. */
export const ENDPOINTS = [
  { method: 'GET', path: '/api/v1/version', summary: 'API and server version, feature flags.' },
  { method: 'GET', path: '/api/v1/state', summary: 'Pack detection, index stats, quest summary, settings.' },
  { method: 'POST', path: '/api/v1/open', body: { dir: 'absolute or relative pack directory' }, summary: 'Open a pack and reset indexes.' },
  { method: 'GET', path: '/api/v1/items', query: ['q', 'mod', 'limit', 'offset', 'withIcon'], summary: 'Search indexed items.' },
  { method: 'GET', path: '/api/v1/icon', query: ['jar', 'entry'], summary: 'PNG icon bytes from a mod jar.' },
  { method: 'GET', path: '/api/v1/icon-by-id', query: ['id'], summary: 'PNG icon bytes for an item id.' },
  { method: 'GET', path: '/api/v1/recipes', query: ['output', 'input', 'q', 'type', 'limit', 'offset'], summary: 'Recipe pages.' },
  { method: 'GET', path: '/api/v1/recipe/<id>', summary: 'One normalized recipe.' },
  { method: 'GET', path: '/api/v1/quests', summary: 'FTB Quests chapters and quests, titles merged from lang.' },
  { method: 'GET', path: '/api/v1/lint', summary: 'KubeJS lint report for the pack.' },
  { method: 'GET', path: '/api/v1/edits', summary: 'The workbench edit log.' },
  { method: 'POST', path: '/api/v1/edit', body: { op: 'remove | add | drop | clear', id: 'recipe id for remove', spec: 'recipe spec for add', index: 'log index for drop' }, summary: 'Record an edit and regenerate the script.' },
  { method: 'GET', path: '/api/v1/background', summary: 'Current background image bytes.' },
  { method: 'POST', path: '/api/v1/background', body: { type: 'image/png', data: 'dataURL' }, summary: 'Upload or clear the background.' },
  { method: 'GET', path: '/api/v1/settings', summary: 'Workbench settings.' },
  { method: 'POST', path: '/api/v1/settings', body: { clientJar: 'path', background: 'bool' }, summary: 'Save workbench settings.' },
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
