const http = require('node:http');
const crypto = require('node:crypto');
const { normalizeResume } = require('./resume');
const { scoreMatch } = require('./match');
const { buildReply } = require('./quickReply');
const { REGIONS } = require('./alberta');
const { JOB_TYPES, SORTS } = require('./aggregator');

const PAGE = require('node:fs').readFileSync(require('node:path').join(__dirname, 'page.html'), 'utf8');

const SWIPES = ['right', 'left', 'super'];

// Compact card for swipe-style apps, with a ready-to-send message when a resume is saved.
function toCard(job, resume) {
  const card = {
    id: job.id,
    title: job.title,
    company: job.company,
    location: job.location,
    city: job.city,
    proximity: job.proximity || null,
    type: job.type,
    salary: job.salary,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    remote: job.remote,
    postedAt: job.postedAt,
    summary: (job.description || '').slice(0, 280),
    source: job.source,
    url: job.url,
    applyMethod: job.applyMethod,
    applyEmail: job.applyEmail || null,
    applyPhone: job.applyPhone || null,
    match: job.match || null,
    reply: null,
  };
  if (resume) {
    const reply = buildReply({ resume, job, type: 'apply' });
    card.reply = {
      subject: reply.subject,
      message: reply.message,
      mailto: job.applyEmail
        ? `mailto:${job.applyEmail}?subject=${encodeURIComponent(reply.subject)}&body=${encodeURIComponent(reply.message)}`
        : null,
    };
  }
  return card;
}

const APP_STATUSES = ['saved', 'applied', 'interviewing', 'offer', 'rejected', 'withdrawn'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const CSV_COLUMNS = ['title', 'company', 'city', 'region', 'location', 'type', 'salary', 'salaryMin', 'salaryMax',
  'postedAt', 'applyMethod', 'applyEmail', 'applyPhone', 'url', 'source', 'id', 'proximity'];

function toCsv(list) {
  const cell = (v) => {
    const s = Array.isArray(v) ? v.join('; ') : v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [CSV_COLUMNS.join(','), ...list.map((j) => CSV_COLUMNS.map((c) => cell(j[c])).join(','))].join('\n');
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
    ['GET', '/health', async () => ({ ok: true, sources: jobs.sources, homeCity: jobs.homeCity || null })],
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
    ['GET', '/jobs.csv', async ({ query }) => {
      query.set('limit', 'all');
      const { jobs: list } = await jobs.search(query, store.getResume());
      return { csv: toCsv(list), filename: 'alberta-jobs.csv' };
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
        const reply = buildReply({ resume, job, ...body });
        const to = job.applyEmail;
        const mailto = to
          ? `mailto:${to}?subject=${encodeURIComponent(reply.subject)}&body=${encodeURIComponent(reply.message)}`
          : null;
        return { jobId: job.id, applyUrl: job.url, applyEmail: to || null, mailto, ...reply };
      } catch (e) {
        throw new HttpError(400, e.message);
      }
    }],

    // Swipe deck: next jobs you haven't swiped on, best first.
    ['GET', '/deck', async ({ query }) => {
      const size = Math.min(Math.max(Number(query.get('limit')) || 10, 1), 50);
      query.set('limit', 'all');
      query.delete('page');
      const resume = store.getResume();
      const result = await jobs.search(query, resume);
      const swiped = new Set(store.listSwipes().map((s) => s.jobId));
      const unseen = result.jobs.filter((j) => !swiped.has(j.id));
      return {
        remaining: unseen.length,
        hasResume: Boolean(resume),
        sources: result.sources,
        cards: unseen.slice(0, size).map((j) => toCard(j, resume)),
      };
    }],
    ['POST', '/swipes', async ({ body }) => {
      if (!SWIPES.includes(body.direction)) throw new HttpError(400, `direction must be one of: ${SWIPES.join(', ')}`);
      if (!body.jobId) throw new HttpError(400, 'jobId is required');
      if (store.listSwipes().some((s) => s.jobId === body.jobId)) throw new HttpError(409, 'Already swiped on this job');
      const job = await requireJob(body.jobId);

      if (body.direction === 'left') {
        store.addSwipe({ jobId: job.id, direction: 'left' });
        return [201, { direction: 'left', jobId: job.id }];
      }

      const resume = store.getResume();
      const card = toCard(job, resume);
      const message = body.message || card.reply?.message || '';
      const application = store.addApplication({
        jobId: job.id,
        title: job.title,
        company: job.company,
        url: job.url,
        applyEmail: job.applyEmail || '',
        status: 'applied',
        starred: body.direction === 'super',
        message,
        notes: '',
      });
      store.addSwipe({ jobId: job.id, direction: body.direction, applicationId: application.id });
      // Tell the app how to finish applying: open the email, or open the posting.
      const next = card.reply?.mailto
        ? { action: 'email', mailto: card.reply.mailto, to: job.applyEmail }
        : { action: 'open', url: job.url };
      return [201, { direction: body.direction, jobId: job.id, application, next, reply: card.reply }];
    }],
    ['POST', '/swipes/undo', async () => {
      const last = store.popSwipe();
      if (!last) throw new HttpError(404, 'Nothing to undo');
      if (last.applicationId) store.deleteApplication(last.applicationId);
      return { undone: last };
    }],
    ['GET', '/swipes/stats', async () => {
      const all = store.listSwipes();
      const today = new Date().toISOString().slice(0, 10);
      const count = (d) => all.filter((s) => s.direction === d).length;
      return {
        total: all.length,
        right: count('right'),
        super: count('super'),
        left: count('left'),
        today: all.filter((s) => s.at.startsWith(today)).length,
        appliedToday: all.filter((s) => s.at.startsWith(today) && s.direction !== 'left').length,
      };
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

      if (req.method === 'GET' && pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(PAGE);
      }

      if (apiKey && pathname !== '/health' && !safeEqual(req.headers['x-api-key'] || '', apiKey)) {
        throw new HttpError(401, 'Missing or invalid x-api-key header');
      }

      const found = match(req.method, pathname);
      if (!found) throw new HttpError(404, `No route for ${req.method} ${pathname}`);

      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJson(req) : {};
      const result = await found.handler({ params: found.params, query: url.searchParams, body });
      if (Array.isArray(result) && typeof result[0] === 'number') return send(res, result[0], result[1]);
      if (result && typeof result.csv === 'string') {
        res.writeHead(200, {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="${result.filename}"`,
          'access-control-allow-origin': '*',
        });
        return res.end(result.csv);
      }
      send(res, 200, result);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      send(res, status, { error: status === 500 ? 'Internal server error' : err.message, ...(err.detail ? { detail: err.detail } : {}) });
    }
  });
}

module.exports = { createApp, APP_STATUSES };
