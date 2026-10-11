const http = require('node:http');
const crypto = require('node:crypto');
const { normalizeResume } = require('./resume');
const { scoreMatch } = require('./match');
const { buildReply } = require('./quickReply');
const { REGIONS } = require('./alberta');
const { JOB_TYPES, SORTS } = require('./aggregator');

const APP_STATUSES = ['saved', 'applied', 'interviewing', 'offer', 'rejected', 'withdrawn'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, x-api-key',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new HttpError(413, 'Request body too large');
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Body must be valid JSON');
  }
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function createApp({ store, jobs, apiKey }) {
  function requireResume() {
    const resume = store.getResume();
    if (!resume) throw new HttpError(409, 'Upload your resume first with PUT /resume');
    return resume;
  }

  async function requireJob(id) {
    const job = await jobs.getJob(id);
    if (!job) throw new HttpError(404, `Job ${id} not found`);
    return job;
  }

  // [method, pattern, handler]. Patterns use :params.
  const routes = [
    ['GET', '/health', async () => ({ ok: true, sources: jobs.sources })],
    ['GET', '/sources', async () => (jobs.sourceDetails ? jobs.sourceDetails() : jobs.sources)],
    ['GET', '/alberta/cities', async () => ({
      regions: Object.entries(REGIONS).map(([name, cities]) => ({ name, cities })),
      jobTypes: JOB_TYPES,
      sorts: SORTS,
    })],

    ['GET', '/resume', async () => requireResume()],
    ['PUT', '/resume', async ({ body }) => {
      try {
        return store.saveResume(normalizeResume(body));
      } catch (e) {
        throw new HttpError(400, e.message);
      }
    }],

    ['GET', '/jobs', async ({ query }) => {
      const resume = query.get('match') === 'false' ? null : store.getResume();
      return jobs.search(query, resume);
    }],
    ['GET', '/insights', async ({ query }) => {
      const { total, facets, sources, filters } = await jobs.search(query);
      return { total, filters, sources, ...facets };
    }],
    ['GET', '/jobs/:id', async ({ params }) => requireJob(params.id)],
    ['GET', '/jobs/:id/match', async ({ params }) => scoreMatch(requireResume(), await requireJob(params.id))],
    ['POST', '/jobs/:id/quick-reply', async ({ params, body }) => {
      const resume = requireResume();
      const job = await requireJob(params.id);
      if (body.type === 'reply' && !body.employerMessage) {
        throw new HttpError(400, 'type "reply" needs the employerMessage you are answering');
      }
      try {
        return { jobId: job.id, applyUrl: job.url, ...buildReply({ resume, job, ...body }) };
      } catch (e) {
        throw new HttpError(400, e.message);
      }
    }],

    ['GET', '/searches', async () => store.listSearches().map(({ seenIds, ...rest }) => rest)],
    ['POST', '/searches', async ({ body }) => {
      if (!body.name) throw new HttpError(400, 'name is required');
      const filters = jobs.parseFilters(body.filters || {});
      const { seenIds, ...created } = store.addSearch({ name: body.name, filters: { ...filters, page: undefined, limit: undefined } });
      return [201, created];
    }],
    ['GET', '/searches/:id/run', async ({ params, query }) => {
      const saved = store.getSearch(params.id);
      if (!saved) throw new HttpError(404, `Saved search ${params.id} not found`);
      const result = await jobs.search({ ...saved.filters, page: query.get('page'), limit: query.get('limit') || 50 }, store.getResume());
      const seen = new Set(saved.seenIds);
      result.jobs = result.jobs.map((j) => ({ ...j, isNew: !seen.has(j.id) }));
      result.newCount = result.jobs.filter((j) => j.isNew).length;
      const seenIds = [...new Set([...saved.seenIds, ...result.jobs.map((j) => j.id)])].slice(-5000);
      store.updateSearch(saved.id, { seenIds, lastRunAt: new Date().toISOString() });
      if (query.get('onlyNew') === 'true') result.jobs = result.jobs.filter((j) => j.isNew);
      return { search: { id: saved.id, name: saved.name, lastRunAt: saved.lastRunAt }, ...result };
    }],
    ['DELETE', '/searches/:id', async ({ params }) => {
      if (!store.deleteSearch(params.id)) throw new HttpError(404, `Saved search ${params.id} not found`);
      return { deleted: true };
    }],

    ['GET', '/applications', async ({ query }) => {
      const status = query.get('status');
      const apps = store.listApplications();
      return status ? apps.filter((a) => a.status === status) : apps;
    }],
    ['POST', '/applications', async ({ body }) => {
      if (!body.jobId) throw new HttpError(400, 'jobId is required');
      if (body.status && !APP_STATUSES.includes(body.status)) {
        throw new HttpError(400, `status must be one of: ${APP_STATUSES.join(', ')}`);
      }
      const job = await requireJob(body.jobId);
      return [201, store.addApplication({
        jobId: job.id,
        title: job.title,
        company: job.company,
        url: job.url,
        status: body.status || 'saved',
        message: body.message || '',
        notes: body.notes || '',
      })];
    }],
    ['PATCH', '/applications/:id', async ({ params, body }) => {
      if (body.status && !APP_STATUSES.includes(body.status)) {
        throw new HttpError(400, `status must be one of: ${APP_STATUSES.join(', ')}`);
      }
      const changes = {};
      for (const k of ['status', 'message', 'notes']) if (body[k] !== undefined) changes[k] = body[k];
      const updated = store.updateApplication(params.id, changes);
      if (!updated) throw new HttpError(404, `Application ${params.id} not found`);
      return updated;
    }],
  ];

  function match(method, pathname) {
    for (const [m, pattern, handler] of routes) {
      if (m !== method) continue;
      const pp = pattern.split('/');
      const ap = pathname.split('/');
      if (pp.length !== ap.length) continue;
      const params = {};
      if (pp.every((seg, i) => (seg.startsWith(':') ? (params[seg.slice(1)] = decodeURIComponent(ap[i])) : seg === ap[i]))) {
        return { handler, params };
      }
    }
    return null;
  }

  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return send(res, 204);
      const url = new URL(req.url, 'http://localhost');
      const pathname = url.pathname.replace(/\/+$/, '') || '/';

      if (apiKey && pathname !== '/health' && !safeEqual(req.headers['x-api-key'] || '', apiKey)) {
        throw new HttpError(401, 'Missing or invalid x-api-key header');
      }

      const found = match(req.method, pathname);
      if (!found) throw new HttpError(404, `No route for ${req.method} ${pathname}`);

      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJson(req) : {};
      const result = await found.handler({ params: found.params, query: url.searchParams, body });
      if (Array.isArray(result) && typeof result[0] === 'number') return send(res, result[0], result[1]);
      send(res, 200, result);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      send(res, status, { error: status === 500 ? 'Internal server error' : err.message, ...(err.detail ? { detail: err.detail } : {}) });
    }
  });
}

module.exports = { createApp, APP_STATUSES };
