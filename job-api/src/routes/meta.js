// Status, sources, Alberta places, and the settings an app needs to build its screens.
const fs = require('node:fs');
const path = require('node:path');
const { REGIONS } = require('../alberta');
const { JOB_TYPES, SORTS } = require('../aggregator');

module.exports = ({ jobs, config, html }) => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'page.html'), 'utf8');

  return [
    { method: 'GET', path: '/', public: true, handler: async () => html(page) },
    {
      method: 'GET',
      path: '/health',
      public: true,
      handler: async () => ({ ok: true, sources: jobs.sources, homeCity: jobs.homeCity || null }),
    },
    { method: 'GET', path: '/sources', handler: async () => jobs.sourceDetails() },
    {
      method: 'GET',
      path: '/alberta/cities',
      handler: async () => ({
        regions: Object.entries(REGIONS).map(([name, cities]) => ({ name, cities })),
        jobTypes: JOB_TYPES,
        sorts: SORTS,
      }),
    },
    // Everything a client app needs to draw its UI: swipe directions, pile names, tones, statuses.
    {
      method: 'GET',
      path: '/settings',
      handler: async () => ({
        homeCity: jobs.homeCity || null,
        swipes: Object.entries(config.piles).map(([direction, pile]) => ({ direction, pile })),
        cardFields: config.deck.cardFields,
        deckSize: config.deck.size,
        tones: Object.keys(config.replies.tones),
        applicationStatuses: config.applicationStatuses,
      }),
    },
  ];
};
