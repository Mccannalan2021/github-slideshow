// mccannfam client for web apps (works in browsers, React/Vue/Svelte/Next, and Node 18+).
// Copy this file into your app, or import it from mccannfam/client/.
//
//   import { createMccannfamApi } from './mccannfam.js';
//   const api = createMccannfamApi({ baseUrl: 'https://mccannfam.onrender.com', apiKey: '...' });
//   const { cards } = await api.deck({ near: 'Red Deer' });
//   await api.swipe(cards[0].id, 'right');
//
// Every method returns a Promise with the JSON response. Errors throw a MccannfamApiError with
// .status and .message from the API (e.g. 409 "Already swiped on this job").

export class MccannfamApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = 'MccannfamApiError';
    this.status = status;
    this.body = body;
  }
}

// Turns { near: 'Red Deer', hasEmail: true, sources: ['indeed'] } into a query string.
function queryString(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    q.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

const enc = encodeURIComponent;

async function toBase64(file) {
  // Browser File/Blob
  if (typeof Blob !== 'undefined' && file instanceof Blob) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }
  // Node Buffer / Uint8Array
  if (typeof Buffer !== 'undefined' && (Buffer.isBuffer(file) || file instanceof Uint8Array)) return Buffer.from(file).toString('base64');
  throw new TypeError('file must be a File, Blob, Buffer or Uint8Array');
}

export function createMccannfamApi({ baseUrl, apiKey, fetch: fetchImpl = globalThis.fetch.bind(globalThis) } = {}) {
  if (!baseUrl) throw new TypeError('baseUrl is required, e.g. "http://localhost:3000"');
  const root = baseUrl.replace(/\/+$/, '');

  async function raw(method, path, body) {
    const res = await fetchImpl(root + path, {
      method,
      headers: { ...(apiKey ? { 'x-api-key': apiKey } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new MccannfamApiError(res.status, data.error || `Request failed (${res.status})`, data);
    }
    return res;
  }
  const call = async (method, path, body) => {
    const res = await raw(method, path, body);
    return res.status === 204 ? null : res.json();
  };

  return {
    // --- Status & settings ---
    health: () => call('GET', '/health'),
    /** Swipe directions/piles, card fields, tones and statuses: draw your UI from these. */
    settings: () => call('GET', '/settings'),
    sources: () => call('GET', '/sources'),
    /** Which job source keys are set (never the keys themselves). */
    keys: () => call('GET', '/settings/keys'),
    /** Enter your own keys, e.g. { ADZUNA_APP_ID: '...', ADZUNA_APP_KEY: '...' }. '' removes a key. Applies straight away. */
    saveKeys: (values) => call('PUT', '/settings/keys', { values }),
    /** Remove the keys you saved for one source: 'adzuna' | 'jooble' | 'jobbank' | 'indeed'. */
    removeKeys: (source) => call('DELETE', `/settings/keys/${enc(source)}`),
    cities: () => call('GET', '/alberta/cities'),

    // --- Jobs ---
    /** filters: q, city, region, near, type, remote, hasEmail, minSalary, postedWithin, sources, sort, page, limit, match */
    searchJobs: (filters) => call('GET', `/jobs${queryString(filters)}`),
    getJob: (jobId) => call('GET', `/jobs/${enc(jobId)}`),
    matchJob: (jobId) => call('GET', `/jobs/${enc(jobId)}/match`),
    /** options: type ('apply' | 'reply' | 'followup'), tone, employerMessage, availability */
    quickReply: (jobId, options = {}) => call('POST', `/jobs/${enc(jobId)}/quick-reply`, options),
    insights: (filters) => call('GET', `/insights${queryString(filters)}`),
    /** Returns a Blob (browser) or Response body you can save as mccannfam-jobs.csv. */
    downloadCsv: async (filters) => (await raw('GET', `/jobs.csv${queryString(filters)}`)).blob(),

    // --- Swipe deck & piles ---
    /** Next unswiped cards, best first. Takes the same filters as searchJobs plus limit. */
    deck: (filters) => call('GET', `/deck${queryString(filters)}`),
    /** direction: one of the directions from settings().swipes, by default 'right' | 'super' | 'left' */
    swipe: (jobId, direction) => call('POST', '/swipes', { jobId, direction }),
    undoSwipe: () => call('POST', '/swipes/undo'),
    swipeStats: () => call('GET', '/swipes/stats'),
    piles: () => call('GET', '/piles'),
    /** pile: 'liked' | 'superliked' | 'passed' (or your own); options.applied: true | false */
    pile: (name, { applied } = {}) => call('GET', `/piles/${enc(name)}${queryString({ applied })}`),
    moveToPile: (jobId, direction) => call('PATCH', `/swipes/${enc(jobId)}`, { direction }),
    removeFromPile: (jobId) => call('DELETE', `/swipes/${enc(jobId)}`),
    /** Marks a piled job applied and returns { applyUrl, message }: open applyUrl in a new tab. */
    applyFromPile: (jobId, { message, notes } = {}) => call('POST', `/swipes/${enc(jobId)}/apply`, { message, notes }),

    // --- Resume ---
    getResume: () => call('GET', '/resume'),
    saveResume: (resume) => call('PUT', '/resume', resume),
    /** file: a File from <input type="file"> (or a Buffer in Node). PDF, DOC or DOCX. */
    uploadResumeFile: async (file, filename = file?.name) => call('PUT', '/resume/file', { filename, contentBase64: await toBase64(file) }),
    getResumeFile: () => call('GET', '/resume/file'),

    // --- Email (Gmail) ---
    emailStatus: () => call('GET', '/email/status'),
    sentEmails: () => call('GET', '/email/sent'),
    /** options: to, subject, message, tone, attachResume, preview (true = don't send) */
    emailJob: (jobId, options = {}) => call('POST', `/jobs/${enc(jobId)}/email`, options),
    previewEmail: (jobId, options = {}) => call('POST', `/jobs/${enc(jobId)}/email`, { ...options, preview: true }),

    // --- Applications ---
    applications: (status) => call('GET', `/applications${queryString({ status })}`),
    addApplication: (application) => call('POST', '/applications', application),
    updateApplication: (id, changes) => call('PATCH', `/applications/${enc(id)}`, changes),

    // --- Saved searches ---
    savedSearches: () => call('GET', '/searches'),
    saveSearch: (name, filters) => call('POST', '/searches', { name, filters }),
    runSavedSearch: (id, { onlyNew, page, limit } = {}) => call('GET', `/searches/${enc(id)}/run${queryString({ onlyNew, page, limit })}`),
    deleteSavedSearch: (id) => call('DELETE', `/searches/${enc(id)}`),

    /** Call any endpoint directly, e.g. one you added in src/routes/. */
    request: call,
  };
}
