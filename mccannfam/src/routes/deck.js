// Swipe deck and piles. Swiping only sorts a job into a pile; you deal with piles afterwards.
// Swipe directions and pile names come from "piles" in config.json, e.g. {"right": "liked"}.
module.exports = ({ store, jobs, config, toCard, requireJob, HttpError, created }) => {
  const PILE_OF = config.piles;
  const DIR_OF = Object.fromEntries(Object.entries(PILE_OF).map(([dir, pile]) => [pile, dir]));
  const directions = Object.keys(PILE_OF);

  function checkDirection(direction) {
    if (!PILE_OF[direction]) throw new HttpError(400, `direction must be one of: ${directions.join(', ')}`);
  }
  function findSwipe(jobId) {
    const swipe = store.listSwipes().find((x) => x.jobId === jobId);
    if (!swipe) throw new HttpError(404, 'You have not swiped on this job');
    return swipe;
  }
  const withPile = (swipe) => ({ ...swipe, pile: PILE_OF[swipe.direction] });

  return [
    // Next jobs you haven't swiped on, best first. Takes every /jobs filter.
    {
      method: 'GET',
      path: '/deck',
      handler: async ({ query }) => {
        const size = Math.min(Math.max(Number(query.get('limit')) || config.deck.size, 1), config.deck.maxSize);
        query.set('limit', 'all');
        query.delete('page');
        const resume = store.getResume();
        const result = await jobs.search(query, resume);
        const swiped = new Set(store.listSwipes().map((x) => x.jobId));
        const unseen = result.jobs.filter((j) => !swiped.has(j.id));
        return {
          remaining: unseen.length,
          hasResume: Boolean(resume),
          sources: result.sources,
          cards: unseen.slice(0, size).map((j) => toCard(j, resume)),
        };
      },
    },
    {
      method: 'POST',
      path: '/swipes',
      handler: async ({ body }) => {
        checkDirection(body.direction);
        if (!body.jobId) throw new HttpError(400, 'jobId is required');
        if (store.listSwipes().some((x) => x.jobId === body.jobId)) throw new HttpError(409, 'Already swiped on this job');
        const job = await requireJob(body.jobId);
        // Keep a copy of the card so piles still show the job after it leaves the source.
        return created(withPile(store.addSwipe({ jobId: job.id, direction: body.direction, card: toCard(job, store.getResume()) })));
      },
    },
    {
      method: 'POST',
      path: '/swipes/undo',
      handler: async () => {
        const last = store.popSwipe();
        if (!last) throw new HttpError(404, 'Nothing to undo');
        if (last.applicationId) store.deleteApplication(last.applicationId);
        return { undone: { jobId: last.jobId, direction: last.direction, pile: PILE_OF[last.direction] } };
      },
    },
    {
      method: 'GET',
      path: '/swipes/stats',
      handler: async () => {
        const all = store.listSwipes();
        const today = new Date().toISOString().slice(0, 10);
        return {
          total: all.length,
          ...Object.fromEntries(Object.entries(PILE_OF).map(([dir, pile]) => [pile, all.filter((x) => x.direction === dir).length])),
          applied: all.filter((x) => x.appliedAt).length,
          swipedToday: all.filter((x) => x.at.startsWith(today)).length,
        };
      },
    },
    // Move a job to another pile: { "direction": "super" }.
    {
      method: 'PATCH',
      path: '/swipes/:jobId',
      handler: async ({ params, body }) => {
        checkDirection(body.direction);
        findSwipe(params.jobId);
        return withPile(store.updateSwipe(params.jobId, { direction: body.direction }));
      },
    },
    // Take a job out of its pile; it goes back into the deck.
    {
      method: 'DELETE',
      path: '/swipes/:jobId',
      handler: async ({ params }) => {
        findSwipe(params.jobId);
        store.removeSwipe(params.jobId);
        return { removed: params.jobId };
      },
    },
    // Apply to a job from a pile: logs it in /applications and returns the apply link and message.
    {
      method: 'POST',
      path: '/swipes/:jobId/apply',
      handler: async ({ params, body }) => {
        const swipe = findSwipe(params.jobId);
        if (swipe.appliedAt) throw new HttpError(409, 'Already applied to this job');
        const { card } = swipe;
        const application = store.addApplication({
          jobId: swipe.jobId,
          title: card.title,
          company: card.company,
          url: card.applyUrl,
          pile: PILE_OF[swipe.direction],
          status: 'applied',
          message: body.message || card.reply?.message || '',
          notes: body.notes || '',
        });
        store.updateSwipe(swipe.jobId, { appliedAt: application.createdAt, applicationId: application.id });
        return created({ applyUrl: card.applyUrl, message: application.message, application });
      },
    },
    {
      method: 'GET',
      path: '/piles',
      handler: async () => {
        const all = store.listSwipes();
        return Object.fromEntries(Object.entries(PILE_OF).map(([dir, pile]) => [pile, all.filter((x) => x.direction === dir).length]));
      },
    },
    {
      method: 'GET',
      path: '/piles/:pile',
      handler: async ({ params, query }) => {
        const dir = DIR_OF[params.pile];
        if (!dir) throw new HttpError(404, `Pile must be one of: ${Object.keys(DIR_OF).join(', ')}`);
        let list = store.listSwipes().filter((x) => x.direction === dir);
        if (query.get('applied') === 'true') list = list.filter((x) => x.appliedAt);
        if (query.get('applied') === 'false') list = list.filter((x) => !x.appliedAt);
        return list.reverse().map(({ card, ...rest }) => ({ ...card, ...rest, pile: params.pile }));
      },
    },
  ];
};
