// Jooble job search API (free key at https://jooble.org/api/about).
const { fetchJson } = require('./http');

function createJoobleProvider({ apiKey, baseUrl = 'https://jooble.org/api' }, fetchImpl = fetch) {
  if (!apiKey) throw new Error('Jooble needs JOOBLE_API_KEY');

  return {
    name: 'jooble',
    async searchJobs({ query = '', location = 'Alberta', limit = 50, page = 1 }) {
      const data = await fetchJson(fetchImpl, `${baseUrl}/${apiKey}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keywords: query, location, page: String(page), ResultOnPage: String(limit) }),
      }, { label: 'Jooble' });
      return {
        total: data.totalCount || 0,
        jobs: (data.jobs || []).map((j) => ({
          id: String(j.id),
          title: stripTags(j.title),
          company: j.company || '',
          location: j.location || '',
          description: stripTags(j.snippet),
          url: j.link,
          postedAt: j.updated || '',
          salary: j.salary || '',
          type: j.type || '',
        })),
      };
    },
  };
}

const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();

module.exports = { createJoobleProvider };
