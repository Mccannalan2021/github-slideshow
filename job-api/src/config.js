// Loads config.json (all the settings you'd want to change) and checks it, so a typo gives a clear
// message at startup instead of strange behaviour later. Environment variables still hold secrets
// and can override a few settings (HOME_CITY, CACHE_TTL_SECONDS, PER_SOURCE_LIMIT).
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_FILE = path.join(__dirname, '..', 'config.json');
const CARD_FIELDS = [
  'id', 'title', 'company', 'location', 'city', 'region', 'proximity', 'type', 'category', 'salary', 'salaryMin',
  'salaryMax', 'remote', 'postedAt', 'summary', 'description', 'source', 'applyUrl', 'applyMethod', 'applyEmail',
  'applyPhone', 'match', 'reply', 'alsoListedOn',
];

function fail(message) {
  throw new Error(`config.json: ${message}`);
}

function validate(c) {
  if (!c.piles || typeof c.piles !== 'object' || !Object.keys(c.piles).length) fail('"piles" needs at least one entry, e.g. {"right": "liked"}');
  const names = Object.values(c.piles);
  if (new Set(names).size !== names.length) fail('every pile needs its own name');
  for (const [dir, pile] of Object.entries(c.piles)) {
    if (!/^[a-z][a-z0-9-]*$/.test(dir) || !/^[a-z][a-z0-9-]*$/.test(pile)) fail(`pile "${dir}": "${pile}" must be lowercase letters, numbers or dashes`);
  }
  const bad = (c.deck.cardFields || []).filter((f) => !CARD_FIELDS.includes(f));
  if (bad.length) fail(`unknown deck.cardFields: ${bad.join(', ')}. Allowed: ${CARD_FIELDS.join(', ')}`);
  if (!Array.isArray(c.applicationStatuses) || !c.applicationStatuses.includes('applied')) fail('"applicationStatuses" must be a list that includes "applied"');
  if (!c.replies.tones[c.replies.defaultTone]) fail(`replies.defaultTone "${c.replies.defaultTone}" is not one of replies.tones`);
  for (const [name, t] of Object.entries(c.replies.tones)) {
    if (!t.greeting || !t.closing) fail(`replies.tones.${name} needs "greeting" and "closing"`);
  }
  return c;
}

// Lists you define as a whole: an override replaces them instead of adding to them.
const REPLACE = new Set(['piles', 'tones']);

// Deep-merges user settings over the defaults in config.json.
function merge(base, extra) {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return extra === undefined ? base : extra;
  const out = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    const nested = v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object';
    out[k] = nested && !REPLACE.has(k) ? merge(base[k], v) : v;
  }
  return out;
}

function loadConfig({ file = DEFAULT_FILE, overrides = {}, env = {} } = {}) {
  let fromFile;
  try {
    fromFile = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`Could not read ${path.basename(file)}: ${e.message}`);
  }
  const config = merge(fromFile, overrides);
  if (env.HOME_CITY) config.homeCity = env.HOME_CITY;
  if (env.CACHE_TTL_SECONDS) config.search.cacheSeconds = Number(env.CACHE_TTL_SECONDS);
  if (env.PER_SOURCE_LIMIT) config.search.perSourceLimit = Number(env.PER_SOURCE_LIMIT);
  return validate(config);
}

module.exports = { loadConfig, CARD_FIELDS };
