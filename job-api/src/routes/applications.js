// Application tracker. Statuses come from "applicationStatuses" in config.json.
module.exports = ({ store, config, requireJob, HttpError, created }) => {
  const statuses = config.applicationStatuses;
  const checkStatus = (status) => {
    if (status && !statuses.includes(status)) throw new HttpError(400, `status must be one of: ${statuses.join(', ')}`);
  };

  return [
    {
      method: 'GET',
      path: '/applications',
      handler: async ({ query }) => {
        const status = query.get('status');
        const apps = store.listApplications();
        return status ? apps.filter((a) => a.status === status) : apps;
      },
    },
    {
      method: 'POST',
      path: '/applications',
      handler: async ({ body }) => {
        if (!body.jobId) throw new HttpError(400, 'jobId is required');
        checkStatus(body.status);
        const job = await requireJob(body.jobId);
        return created(store.addApplication({
          jobId: job.id,
          title: job.title,
          company: job.company,
          url: job.url,
          status: body.status || statuses[0],
          message: body.message || '',
          notes: body.notes || '',
        }));
      },
    },
    {
      method: 'PATCH',
      path: '/applications/:id',
      handler: async ({ params, body }) => {
        checkStatus(body.status);
        const changes = {};
        for (const k of ['status', 'message', 'notes']) if (body[k] !== undefined) changes[k] = body[k];
        const updated = store.updateApplication(params.id, changes);
        if (!updated) throw new HttpError(404, `Application ${params.id} not found`);
        return updated;
      },
    },
  ];
};
