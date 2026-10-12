// Job source keys you can enter yourself in the app's settings (instead of editing .env).
// Keys saved there live in data/keys.json (readable only by you) and win over the same names in .env.
// To let a new job source take keys here, add it to KEY_SOURCES.
const fs = require('node:fs');
const path = require('node:path');

const KEY_SOURCES = [
  {
    id: 'adzuna',
    name: 'Adzuna',
    url: 'https://developer.adzuna.com',
    fields: [
      { key: 'ADZUNA_APP_ID', label: 'App ID', secret: false, required: true },
      { key: 'ADZUNA_APP_KEY', label: 'App key', secret: true, required: true },
    ],
  },
  {
    id: 'jooble',
    name: 'Jooble',
    url: 'https://jooble.org/api/about',
    fields: [{ key: 'JOOBLE_API_KEY', label: 'API key', secret: true, required: true }],
  },
  {
    id: 'jobbank',
    name: 'Job Bank CSV',
    url: 'https://open.canada.ca/data/en/dataset/ea639e28-c0fc-48bf-b5dd-b8899bd43072',
    fields: [{ key: 'JOBBANK_CSV', label: 'CSV file or folder path', secret: false, required: true, path: true }],
  },
  {
    id: 'indeed',
    name: 'Indeed (partners only)',
    url: 'https://developer.indeed.com',
    fields: [
      { key: 'INDEED_CLIENT_ID', label: 'Client ID', secret: false, required: true },
      { key: 'INDEED_CLIENT_SECRET', label: 'Client secret', secret: true, required: true },
      { key: 'INDEED_SCOPE', label: 'Scope', secret: false, required: false },
    ],
  },
];

const ALL_KEYS = new Set(KEY_SOURCES.flatMap((s) => s.fields.map((f) => f.key)));
const MAX_LENGTH = 500;

class KeyError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

// Checks what the caller sent: only known keys, only text, one line. "" (or null) removes a key.
function cleanValues(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new KeyError('Send { "values": { "ADZUNA_APP_ID": "..." } }');
  const clean = {};
  for (const [key, value] of Object.entries(input)) {
    if (!ALL_KEYS.has(key)) throw new KeyError(`Unknown setting "${key}". Known settings: ${[...ALL_KEYS].join(', ')}`);
    if (value !== null && typeof value !== 'string') throw new KeyError(`${key} must be text`);
    const text = (value || '').trim();
    if (text.length > MAX_LENGTH) throw new KeyError(`${key} is too long`);
    if (/[\r\n]/.test(text)) throw new KeyError(`${key} must be a single line`);
    clean[key] = text;
  }
  return clean;
}

function mergeKeys(stored, updates) {
  const next = { ...stored };
  for (const [key, value] of Object.entries(updates)) {
    if (value === '') delete next[key];
    else next[key] = value;
  }
  return next;
}

// Saved keys win over .env / environment variables.
const effectiveEnv = (env, stored) => ({ ...env, ...stored });

// A source is switched on only when all of its required keys are there; half a key set is an error.
function checkComplete(env) {
  for (const source of KEY_SOURCES) {
    const set = source.fields.filter((f) => env[f.key]);
    const missing = source.fields.filter((f) => f.required && !env[f.key]);
    if (set.length && missing.length) {
      throw new KeyError(`${source.name} also needs: ${missing.map((f) => f.label).join(', ')}`);
    }
  }
}

function checkPaths(env, updates) {
  for (const source of KEY_SOURCES) {
    for (const f of source.fields) {
      if (f.path && updates[f.key] && !fs.existsSync(path.resolve(updates[f.key]))) {
        throw new KeyError(`${f.label}: file or folder not found: ${updates[f.key]}`);
      }
    }
  }
}

const mask = (value) => (value.length > 8 ? `••••${value.slice(-4)}` : '••••');

// What the settings screen shows. Secret values are never sent back, only whether they are set.
function describe(env, stored) {
  const eff = effectiveEnv(env, stored);
  return KEY_SOURCES.map((s) => ({
    id: s.id,
    name: s.name,
    url: s.url,
    configured: s.fields.filter((f) => f.required).every((f) => eff[f.key]),
    fields: s.fields.map((f) => ({
      key: f.key,
      label: f.label,
      secret: f.secret,
      required: f.required,
      set: Boolean(eff[f.key]),
      from: stored[f.key] ? 'settings' : env[f.key] ? 'env' : null,
      ...(eff[f.key] ? (f.secret ? { preview: mask(eff[f.key]) } : { value: eff[f.key] }) : {}),
    })),
  }));
}

// Error text from a source must not echo a key back to the browser.
function redact(message, env) {
  let text = String(message);
  for (const source of KEY_SOURCES) {
    for (const f of source.fields) if (f.secret && env[f.key]) text = text.split(env[f.key]).join('[hidden]');
  }
  return text;
}

module.exports = { KEY_SOURCES, KeyError, cleanValues, mergeKeys, effectiveEnv, checkComplete, checkPaths, describe, redact };
