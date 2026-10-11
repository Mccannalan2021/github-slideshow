// Search, job details, CSV export, market insights and quick replies.
const { scoreMatch } = require('../match');
const { buildReply } = require('../quickReply');
const { toCsv } = require('../http');

module.exports = ({ store, jobs, config, requireJob, requireResume, HttpError, file }) => [
  {
    method: 'GET',
    path: '/jobs',
    handler: async ({ query }) => jobs.search(query, query.get('match') === 'false' ? null : store.getResume()),
  },
  {
    method: 'GET',
    path: '/jobs.csv',
    handler: async ({ query }) => {
      query.set('limit', 'all');
      const { jobs: list } = await jobs.search(query, store.getResume());
      return file(toCsv(list, config.csvColumns), { filename: 'alberta-jobs.csv', type: 'text/csv; charset=utf-8' });
    },
  },
  {
    method: 'GET',
    path: '/insights',
    handler: async ({ query }) => {
      const { total, facets, sources, filters } = await jobs.search(query);
      return { total, filters, sources, ...facets };
    },
  },
  { method: 'GET', path: '/jobs/:id', handler: async ({ params }) => requireJob(params.id) },
  {
    method: 'GET',
    path: '/jobs/:id/match',
    handler: async ({ params }) => scoreMatch(requireResume(), await requireJob(params.id)),
  },
  {
    method: 'POST',
    path: '/jobs/:id/quick-reply',
    handler: async ({ params, body }) => {
      const resume = requireResume();
      const job = await requireJob(params.id);
      if (body.type === 'reply' && !body.employerMessage) {
        throw new HttpError(400, 'type "reply" needs the employerMessage you are answering');
      }
      try {
        const reply = buildReply({ resume, job, ...body, tones: config.replies.tones, defaultTone: config.replies.defaultTone });
        const to = job.applyEmail;
        const mailto = to
          ? `mailto:${to}?subject=${encodeURIComponent(reply.subject)}&body=${encodeURIComponent(reply.message)}`
          : null;
        return { jobId: job.id, applyUrl: job.url, applyEmail: to || null, mailto, ...reply };
      } catch (e) {
        throw new HttpError(400, e.message);
      }
    },
  },
];
