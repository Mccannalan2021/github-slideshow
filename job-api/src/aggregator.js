// Searches every configured job source at once, keeps only Alberta jobs, normalizes them into one
// shape, removes duplicates that appear on several boards, then filters, sorts and pages them.
const { findCity, isAlberta, lookupCity, lookupRegion } = require('./alberta');
const { normalizeSalary } = require('./salary');
const { scoreMatch } = require('./match');

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
    remote: /remote|work from home|wfh|telecommut/i.test(`${raw.title} ${raw.location} ${raw.type}`),
    type: normalizeType(raw.type),
    category: raw.category || '',
    salary: raw.salary || formatSalary(raw.salaryMin, raw.salaryMax),
    salaryMin,
    salaryMax,
    postedAt: toIsoDate(raw.postedAt),
    description: raw.description || '',
    url: raw.url || '',
    contactName: raw.contactName || '',
    skills: raw.skills || [],
    alsoListedOn: [],
  };
}

function dedupe(jobs) {
  const byKey = new Map();
  for (const job of jobs) {
    const key = `${norm(job.title)}|${norm(job.company)}|${norm(job.city || job.location)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, job);
      continue;
    }
    // Keep the listing with more detail; remember where else it is posted.
    const [keep, drop] = job.description.length > existing.description.length ? [job, existing] : [existing, job];
    keep.alsoListedOn = [...keep.alsoListedOn, ...drop.alsoListedOn, { id: drop.id, source: drop.source, url: drop.url }];
    if (!keep.salaryMin && drop.salaryMin) Object.assign(keep, { salary: drop.salary, salaryMin: drop.salaryMin, salaryMax: drop.salaryMax });
    byKey.set(key, keep);
  }
  return [...byKey.values()];
}

function parseFilters(q) {
  const get = (k) => (typeof q.get === 'function' ? q.get(k) : q[k]) ?? undefined;
  const f = {
    q: (get('q') || '').trim(),
    city: get('city') || '',
    region: get('region') || '',
    type: get('type') || '',
    remote: get('remote') || '',
    minSalary: get('minSalary') ? Number(get('minSalary')) : null,
    postedWithin: get('postedWithin') ? Number(get('postedWithin')) : null,
    sources: get('sources') ? String(get('sources')).split(',').map((s) => s.trim()).filter(Boolean) : [],
    sort: get('sort') || 'relevance',
    page: Math.max(Number(get('page')) || 1, 1),
    limit: Math.min(Math.max(Number(get('limit')) || 20, 1), 100),
  };

  if (f.city) {
    const city = lookupCity(f.city);
    if (!city) throw new BadRequest(`Unknown Alberta city "${f.city}". See GET /alberta/cities`);
    f.city = city.name;
  }
  if (f.region) {
    const region = lookupRegion(f.region);
    if (!region) throw new BadRequest(`Unknown Alberta region "${f.region}". See GET /alberta/cities`);
    f.region = region;
  }
  if (f.type && !JOB_TYPES.includes(f.type)) throw new BadRequest(`type must be one of: ${JOB_TYPES.join(', ')}`);
  if (f.remote && !['true', 'false'].includes(String(f.remote))) throw new BadRequest('remote must be true or false');
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
    (f.minSalary === null || (j.salaryMax !== null && j.salaryMax >= f.minSalary)) &&
    (f.postedWithin === null || (j.postedAt && now - Date.parse(j.postedAt) <= f.postedWithin * 86_400_000)));
}

function sortJobs(jobs, sort, hasResume) {
  const byDate = (a, b) => (b.postedAt || '').localeCompare(a.postedAt || '');
  const bySalary = (a, b) => (b.salaryMax ?? -1) - (a.salaryMax ?? -1) || byDate(a, b);
  const byMatch = (a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0) || byDate(a, b);
  const cmp = { date: byDate, salary: bySalary, match: byMatch, relevance: hasResume ? byMatch : byDate }[sort];
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
    salary: {
      jobsWithSalary: paid.length,
      medianMin: median(paid.map((j) => j.salaryMin)),
      medianMax: median(paid.map((j) => j.salaryMax)),
    },
  };
}

function createAggregator({ providers, store, cacheTtlMs = 10 * 60_000, perSourceLimit = 50, maxIndex = 5000 }) {
  if (!providers.length) throw new Error('At least one job source must be configured');
  const cache = new Map();
  const index = new Map((store?.getJobIndex?.() || []).map((j) => [j.id, j]));

  function remember(jobs) {
    for (const j of jobs) {
      index.delete(j.id);
      index.set(j.id, j);
    }
    while (index.size > maxIndex) index.delete(index.keys().next().value);
    store?.saveJobIndex?.([...index.values()]);
  }

  async function fetchSource(provider, q, location) {
    const key = `${provider.name}|${q}|${location}`;
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return { ...hit.value, cached: true };
    const result = await provider.searchJobs({ query: q, location, limit: perSourceLimit, page: 1 });
    const value = {
      total: result.total ?? result.jobs.length,
      jobs: result.jobs.map((j) => normalizeJob(j, provider.name)),
    };
    cache.set(key, { value, expires: Date.now() + cacheTtlMs });
    return { ...value, cached: false };
  }

  async function search(filters, resume = null) {
    const f = parseFilters(filters);
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
    if (resume) jobs = jobs.map((j) => ({ ...j, match: scoreMatch(resume, j) }));
    jobs = sortJobs(jobs, f.sort, Boolean(resume));

    const start = (f.page - 1) * f.limit;
    return {
      total: jobs.length,
      page: f.page,
      limit: f.limit,
      pages: Math.ceil(jobs.length / f.limit),
      filters: { ...f, page: undefined, limit: undefined },
      removed: { outsideAlberta: all.length - alberta.length, duplicates: alberta.length - unique.length },
      sources,
      facets: facets(jobs),
      jobs: jobs.slice(start, start + f.limit),
    };
  }

  async function getJob(id) {
    if (index.has(id)) return index.get(id);
    const [source, ...rest] = String(id).split(':');
    const provider = providers.find((p) => p.name === source);
    if (!provider?.getJob || !rest.length) return null;
    const raw = await provider.getJob(rest.join(':'));
    if (!raw) return null;
    const job = normalizeJob(raw, source);
    remember([job]);
    return job;
  }

  return { name: 'alberta', sources: providers.map((p) => p.name), search, getJob, parseFilters };
}

module.exports = { createAggregator, parseFilters, normalizeJob, dedupe, JOB_TYPES, SORTS, BadRequest };
