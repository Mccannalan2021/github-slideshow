// Saved searches ("job alerts") that flag jobs you haven't seen yet.
module.exports = ({ store, jobs, HttpError, created }) => [
  { method: 'GET', path: '/searches', handler: async () => store.listSearches().map(({ seenIds, ...rest }) => rest) },
  {
    method: 'POST',
    path: '/searches',
    handler: async ({ body }) => {
      if (!body.name) throw new HttpError(400, 'name is required');
      const filters = jobs.parseFilters(body.filters || {});
      const { seenIds, ...saved } = store.addSearch({ name: body.name, filters: { ...filters, page: undefined, limit: undefined } });
      return created(saved);
    },
  },
  {
    method: 'GET',
    path: '/searches/:id/run',
    handler: async ({ params, query }) => {
      const saved = store.getSearch(params.id);
      if (!saved) throw new HttpError(404, `Saved search ${params.id} not found`);
      const result = await jobs.search({ ...saved.filters, page: query.get('page'), limit: query.get('limit') || 50 }, store.getResume());
      const seen = new Set(saved.seenIds);
      result.jobs = result.jobs.map((j) => ({ ...j, isNew: !seen.has(j.id) }));
      result.newCount = result.jobs.filter((j) => j.isNew).length;
      const seenIds = [...new Set([...saved.seenIds, ...result.jobs.map((j) => j.id)])].slice(-5000);
      const ranAt = new Date().toISOString();
      store.updateSearch(saved.id, { seenIds, lastRunAt: ranAt });
      if (query.get('onlyNew') === 'true') result.jobs = result.jobs.filter((j) => j.isNew);
      return { search: { id: saved.id, name: saved.name, lastRunAt: ranAt, previousRunAt: saved.lastRunAt }, ...result };
    },
  },
  {
    method: 'DELETE',
    path: '/searches/:id',
    handler: async ({ params }) => {
      if (!store.deleteSearch(params.id)) throw new HttpError(404, `Saved search ${params.id} not found`);
      return { deleted: true };
    },
  },
];
