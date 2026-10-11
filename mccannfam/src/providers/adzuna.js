// Adzuna job search API (free developer key at https://developer.adzuna.com).
// Adzuna aggregates postings from many Canadian job boards and employer sites.
const { fetchJson } = require('./http');

const TYPE = { full_time: 'full-time', part_time: 'part-time', contract: 'contract', permanent: '' };

function createAdzunaProvider({ appId, appKey, country = 'ca', baseUrl = 'https://api.adzuna.com/v1/api' }, fetchImpl = fetch) {
  if (!appId || !appKey) throw new Error('Adzuna needs ADZUNA_APP_ID and ADZUNA_APP_KEY');

  return {
    name: 'adzuna',
    async searchJobs({ query = '', location = 'Alberta', limit = 50, page = 1 }) {
      const params = new URLSearchParams({
        app_id: appId, app_key: appKey, results_per_page: String(limit), where: location, 'content-type': 'application/json',
      });
      if (query) params.set('what', query);
      const data = await fetchJson(fetchImpl, `${baseUrl}/jobs/${country}/search/${page}?${params}`, {}, { label: 'Adzuna' });
      return {
        total: data.count || 0,
        jobs: (data.results || []).map((j) => ({
          id: String(j.id),
          title: stripTags(j.title),
          company: j.company?.display_name || '',
          location: locationOf(j.location),
          description: stripTags(j.description),
          url: j.redirect_url,
          postedAt: j.created || '',
          salaryMin: j.salary_min,
          salaryMax: j.salary_max,
          salaryPeriod: 'year',
          type: TYPE[j.contract_time] || TYPE[j.contract_type] || '',
          category: j.category?.label || '',
        })),
      };
    },
  };
}

// area is like ["Canada", "Alberta", "Calgary"]; turn it into "Calgary, Alberta".
function locationOf(loc = {}) {
  const area = loc.area || [];
  return area.length > 1 ? area.slice(1).reverse().join(', ') : loc.display_name || '';
}

const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, '').trim();

// Turned on when ADZUNA_APP_ID is set in .env.
function fromEnv(env) {
  return env.ADZUNA_APP_ID ? createAdzunaProvider({ appId: env.ADZUNA_APP_ID, appKey: env.ADZUNA_APP_KEY }) : null;
}

module.exports = { fromEnv, createAdzunaProvider };
