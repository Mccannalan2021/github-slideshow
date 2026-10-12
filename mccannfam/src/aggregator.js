// Searches every configured job source at once, keeps only Alberta jobs, normalizes them into one
// shape, removes duplicates that appear on several boards, then filters, sorts and pages them.
const { findCity, isAlberta, lookupCity, lookupRegion } = require('./alberta');
const { normalizeSalary } = require('./salary');
const { scoreMatch } = require('./match');
const { applyInfo } = require('./contacts');

const JOB_TYPES = ['full-time', 'part-time', 'contract', 'temporary', 'seasonal', 'casual'];
const SORTS = ['relevance', 'date', 'salary', 'match'];

class BadRequest extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function normalizeType(text) {
  const t = String(text || '').toLowerCase();
  if (/part[\s_-]?time/.test(t)) return 'part-time';
  if (/full[\s_-]?time|permanent/.test(t)) return 'full-time';
  if (/season/.test(t)) return 'seasonal';
  if (/casual/.test(t)) return 'casual';
  if (/temp/.test(t)) return 'temporary';
  if (/contract|term/.test(t)) return 'contract';
  return '';
}

function toIsoDate(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function formatSalary(min, max) {
  if (!min) return '';
  const f = (n) => `$${Math.round(n).toLocaleString('en-CA')}`;
  return min === max ? `${f(min)} a year` : `${f(min)} - ${f(max)} a year`;
}

function normalizeJob(raw, source) {
  const city = findCity(raw.location);
  const { salaryMin, salaryMax } = normalizeSalary({
    text: raw.salary, min: raw.salaryMin, max: raw.salaryMax, period: raw.salaryPeriod,
  });
  return {
    id: `${source}:${raw.id}`,
    source,
    sourceId: String(raw.id),
    title: raw.title || '',
    company: raw.company || '',
    location: raw.location || '',
    city: city?.name || '',
    region: city?.region || '',
    remote: raw.remote === true || /remote|work from home|wfh|telecommut/i.test(`${raw.title} ${raw.location} ${raw.type}`),
    type: normalizeType(raw.type),
    category: raw.category || '',
    // Format from the annual figures: raw min/max may be hourly, or only one of them may be set.
    salary: raw.salary || formatSalary(salaryMin, salaryMax),
    salaryMin,
    salaryMax,
    postedAt: toIsoDate(raw.postedAt),
    description: raw.description || '',
    url: raw.url || '',
    ...applyInfo(raw),
    contactName: raw.contactName || '',
    skills: raw.skills || [],
    alsoListedOn: [],
  };
}

function dedupe(jobs) {
  const byKey = new Map();
  for (const job of jobs) {
    // Without an employer and a place there's no safe way to tell two postings apart, so keep both.
    const company = norm(job.company);
    const place = norm(job.city || job.location);
    const key = company && place ? `${norm(job.title)}|${company}|${place}` : `id|${job.id}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, job);
      continue;
    }
    // Keep the listing with more detail; remember where else it is posted.
    const [keep, drop] = job.description.length > existing.description.length ? [job, existing] : [existing, job];
    keep.alsoListedOn = [...keep.alsoListedOn, ...drop.alsoListedOn, { id: drop.id, source: drop.source, url: drop.url }];
    if (!keep.salaryMin && drop.salaryMin) Object.assign(keep, { salary: drop.salary, salaryMin: drop.salaryMin, salaryMax: drop.salaryMax });
    // Keep contact details whichever copy had them.
    if (!keep.applyEmail && drop.applyEmail) Object.assign(keep, { applyEmail: drop.applyEmail, applyEmails: drop.applyEmails, applyMethod: 'email' });
    if (!keep.applyPhone && drop.applyPhone) keep.applyPhone = drop.applyPhone;
    if ((!keep.applyMethod || keep.applyMethod === 'website') && drop.applyMethod && drop.applyMethod !== 'website') keep.applyMethod = drop.applyMethod;
    byKey.set(key, keep);
  }
  return [...byKey.values()];
}

// Turns a filter value into a string, keeping false (saved searches store real booleans).
const text = (v) => (v === undefined || v === null ? '' : String(v));

function parseFilters(q, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const get = (k) => (typeof q.get === 'function' ? q.get(k) : q[k]) ?? undefined;
  const f = {
    q: (get('q') || '').trim(),
    city: text(get('city')),
    near: text(get('near')),
    region: text(get('region')),
    type: text(get('type')),
    remote: text(get('remote')),
    hasEmail: text(get('hasEmail')),
    minSalary: get('minSalary') ? Number(get('minSalary')) : null,
    postedWithin: get('postedWithin') ? Number(get('postedWithin')) : null,
    sources: get('sources') ? String(get('sources')).split(',').map((s) => s.trim()).filter(Boolean) : [],
    sort: get('sort') || 'relevance',
    page: Math.max(Number(get('page')) || 1, 1),
    limit: get('limit') === 'all' ? Infinity : Math.min(Math.max(Number(get('limit')) || defaultLimit, 1), maxLimit),
  };

  if (f.city) {
    const city = lookupCity(f.city);
    if (!city) throw new BadRequest(`Unknown Alberta city "${f.city}". See GET /alberta/cities`);
    f.city = city.name;
  }
  if (f.near) {
    const near = lookupCity(f.near);
    if (!near) throw new BadRequest(`Unknown Alberta city "${f.near}" for near. See GET /alberta/cities`);
    f.near = near.name;
  }
  if (f.region) {
    const region = lookupRegion(f.region);
    if (!region) throw new BadRequest(`Unknown Alberta region "${f.region}". See GET /alberta/cities`);
    f.region = region;
  }
  if (f.type && !JOB_TYPES.includes(f.type)) throw new BadRequest(`type must be one of: ${JOB_TYPES.join(', ')}`);
  if (f.remote && !['true', 'false'].includes(String(f.remote))) throw new BadRequest('remote must be true or false');
  if (f.hasEmail && !['true', 'false'].includes(String(f.hasEmail))) throw new BadRequest('hasEmail must be true or false');
  if (!SORTS.includes(f.sort)) throw new BadRequest(`sort must be one of: ${SORTS.join(', ')}`);
  if (Number.isNaN(f.minSalary)) throw new BadRequest('minSalary must be a number (annual CAD)');
  if (Number.isNaN(f.postedWithin)) throw new BadRequest('postedWithin must be a number of days');
  return f;
}

function applyFilters(jobs, f, now = Date.now()) {
  return jobs.filter((j) =>
    (!f.city || j.city === f.city) &&
    (!f.region || j.region === f.region) &&
    (!f.type || j.type === f.type) &&
    (f.remote === '' || String(j.remote) === String(f.remote)) &&
    (f.hasEmail === '' || String(Boolean(j.applyEmail)) === String(f.hasEmail)) &&
    (f.minSalary === null || (j.salaryMax !== null && j.salaryMax >= f.minSalary)) &&
    (f.postedWithin === null || (j.postedAt && now - Date.parse(j.postedAt) <= f.postedWithin * 86_400_000)));
}

// 0 = in the home city, 1 = same economic region, 2 = elsewhere in Alberta.
const PROXIMITY = ['city', 'region', 'alberta'];
function proximityOf(job, near) {
  if (!near) return null;
  if (job.city === near.name) return 0;
  return job.region === near.region ? 1 : 2;
}

function sortJobs(jobs, sort, hasResume) {
  const byDate = (a, b) => (b.postedAt || '').localeCompare(a.postedAt || '');
  const bySalary = (a, b) => (b.salaryMax ?? -1) - (a.salaryMax ?? -1) || byDate(a, b);
  const byMatch = (a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0) || byDate(a, b);
  const base = hasResume ? byMatch : byDate;
  // Relevance puts jobs closest to the home city first.
  const byRelevance = (a, b) => (a.proximityRank ?? 0) - (b.proximityRank ?? 0) || base(a, b);
  const cmp = { date: byDate, salary: bySalary, match: byMatch, relevance: byRelevance }[sort];
  return [...jobs].sort(cmp);
}

function countBy(jobs, key, top) {
  const counts = {};
  for (const j of jobs) if (j[key]) counts[j[key]] = (counts[j[key]] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([value, count]) => ({ value, count }));
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
}

function facets(jobs) {
  const paid = jobs.filter((j) => j.salaryMin);
  return {
    cities: countBy(jobs, 'city', 20),
    regions: countBy(jobs, 'region'),
    types: countBy(jobs, 'type'),
    categories: countBy(jobs, 'category', 15),
    companies: countBy(jobs, 'company', 15),
    sources: countBy(jobs, 'source'),
    remote: jobs.filter((j) => j.remote).length,
    withApplyEmail: jobs.filter((j) => j.applyEmail).length,
    applyMethods: countBy(jobs, 'applyMethod'),
    salary: {
      jobsWithSalary: paid.length,
      medianMin: median(paid.map((j) => j.salaryMin)),
      medianMax: median(paid.map((j) => j.salaryMax)),
    },
  };
}

function createAggregator({
  providers: initialProviders, store, cacheTtlMs = 10 * 60_000, perSourceLimit = 50, maxIndex = 5000, homeCity = '', defaultLimit = 20, maxLimit = 100,
}) {
  const home = homeCity ? lookupCity(homeCity) : null;
  if (homeCity && !home) throw new Error(`HOME_CITY "${homeCity}" is not a known Alberta city`);
  if (!initialProviders.length) throw new Error('At least one job source must be configured');
  let providers = initialProviders;
  const cache = new Map();

  // Switches to a new set of sources (when keys are changed in settings) without a restart.
  function setProviders(next) {
    if (!next.length) throw new Error('At least one job source must be configured');
    providers = next;
    cache.clear();
  }
  // The index is only a cache of seen jobs: if its file is damaged, start fresh instead of failing.
  let saved = [];
  try {
    saved = store?.getJobIndex?.() || [];
  } catch (err) {
    console.warn(`Ignoring the saved job index: ${err.message}`);
  }
  const index = new Map(saved.map((j) => [j.id, j]));

  // Only writes the index file when a job id is added, so repeat searches don't rewrite it.
  function remember(jobs) {
    let added = false;
    for (const j of jobs) {
      if (!index.delete(j.id)) added = true;
      index.set(j.id, j);
    }
    while (index.size > maxIndex) index.delete(index.keys().next().value);
    if (added) store?.saveJobIndex?.([...index.values()]);
  }
  const parse = (q) => parseFilters(q, { defaultLimit, maxLimit });

  async function fetchSource(provider, q, location) {
    const key = `${provider.name}|${q}|${location}`;
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return { ...hit.value, cached: true };
    const result = await provider.searchJobs({ query: q, location, limit: provider.local ? Infinity : perSourceLimit, page: 1 });
    const value = {
      total: result.total ?? result.jobs.length,
      jobs: result.jobs.map((j) => normalizeJob(j, provider.name)),
    };
    cache.set(key, { value, expires: Date.now() + cacheTtlMs });
    return { ...value, cached: false };
  }

  async function search(filters, resume = null) {
    const f = parse(filters);
    const selected = f.sources.length ? providers.filter((p) => f.sources.includes(p.name)) : providers;
    if (!selected.length) throw new BadRequest(`sources must be any of: ${providers.map((p) => p.name).join(', ')}`);
    const location = f.city ? `${f.city}, Alberta` : 'Alberta';

    const settled = await Promise.allSettled(selected.map((p) => fetchSource(p, f.q, location)));
    const sources = settled.map((r, i) => (r.status === 'fulfilled'
      ? { name: selected[i].name, ok: true, fetched: r.value.jobs.length, totalAvailable: r.value.total, cached: r.value.cached }
      : { name: selected[i].name, ok: false, error: r.reason.message }));
    if (sources.every((s) => !s.ok)) {
      const err = new Error(`All job sources failed: ${sources.map((s) => `${s.name}: ${s.error}`).join('; ')}`);
      err.status = 502;
      throw err;
    }

    const all = settled.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value.jobs);
    const alberta = all.filter((j) => isAlberta(j.location));
    const unique = dedupe(alberta.map((j) => ({ ...j, alsoListedOn: [] })));
    remember(unique);

    let jobs = applyFilters(unique, f);
    const near = f.near ? lookupCity(f.near) : home;
    if (near) {
      jobs = jobs.map((j) => {
        const rank = proximityOf(j, near);
        return { ...j, proximity: PROXIMITY[rank], proximityRank: rank };
      });
    }
    if (resume) jobs = jobs.map((j) => ({ ...j, match: scoreMatch(resume, j) }));
    jobs = sortJobs(jobs, f.sort, Boolean(resume));

    const start = (f.page - 1) * f.limit;
    const pageJobs = f.limit === Infinity ? jobs : jobs.slice(start, start + f.limit);
    return {
      total: jobs.length,
      page: f.page,
      limit: f.limit === Infinity ? 'all' : f.limit,
      pages: f.limit === Infinity ? 1 : Math.ceil(jobs.length / f.limit),
      filters: { ...f, near: near?.name || '', page: undefined, limit: undefined },
      removed: { outsideAlberta: all.length - alberta.length, duplicates: alberta.length - unique.length },
      sources,
      facets: facets(jobs),
      jobs: pageJobs.map(({ proximityRank, ...j }) => j),
    };
  }

  async function getJob(id) {
    if (index.has(id)) return index.get(id);
    const [source, ...rest] = String(id).split(':');
    const provider = providers.find((p) => p.name === source);
    if (!provider?.getJob || !rest.length) return null;
    const raw = await provider.getJob(rest.join(':'));
    // Same Alberta-only rule as searches.
    if (!raw || !isAlberta(raw.location)) return null;
    const job = normalizeJob(raw, source);
    remember([job]);
    return job;
  }

  const sourceDetails = () => providers.map((p) => ({
    name: p.name,
    kind: p.local ? 'file' : 'live',
    ...(p.size !== undefined ? { jobs: p.size } : {}),
    ...(p.fetchedAt ? { fetchedAt: p.fetchedAt } : {}),
  }));

  return {
    name: 'alberta',
    homeCity: home?.name || '',
    get sources() { return providers.map((p) => p.name); },
    sourceDetails,
    setProviders,
    search,
    getJob,
    parseFilters: parse,
  };
}

module.exports = { createAggregator, parseFilters, normalizeJob, dedupe, JOB_TYPES, SORTS, BadRequest };
