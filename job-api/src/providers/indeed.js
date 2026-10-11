// Indeed partner API client.
//
// Indeed retired its old public job-search (Publisher) API. Access now goes through the partner
// APIs at https://docs.indeed.com: register an app, get approved for the job-data scope you need,
// and authenticate with OAuth 2.0 client credentials. Requests then go to a GraphQL endpoint.
//
// The GraphQL query and field mapping below live in one place (QUERIES / toJob) so you can match
// them to the exact schema Indeed grants your app. Check the schema explorer in your Indeed
// developer account and adjust field names there if they differ.

const QUERIES = {
  search: `
    query JobSearch($what: String, $where: String, $first: Int, $after: String) {
      jobSearch(what: $what, location: { where: $where }, limit: $first, cursor: $after) {
        pageInfo { nextCursor }
        results {
          job {
            key
            title
            description { text }
            employer { name }
            location { formatted { long } }
            compensation { formattedText }
            datePublished
            url
          }
        }
      }
    }`,
  job: `
    query JobData($key: ID!) {
      jobData(jobKeys: [$key]) {
        results {
          job {
            key
            title
            description { text }
            employer { name }
            location { formatted { long } }
            compensation { formattedText }
            datePublished
            url
          }
        }
      }
    }`,
};

function toJob(j) {
  return {
    id: j.key,
    title: j.title,
    company: j.employer?.name || '',
    location: j.location?.formatted?.long || '',
    salary: j.compensation?.formattedText || '',
    postedAt: j.datePublished || '',
    description: j.description?.text || '',
    url: j.url || `https://www.indeed.com/viewjob?jk=${j.key}`,
    skills: [],
    source: 'indeed',
  };
}

function createIndeedProvider(config, fetchImpl = fetch) {
  const { clientId, clientSecret, scope, tokenUrl, graphqlUrl } = config;
  if (!clientId || !clientSecret) {
    throw new Error('JOB_PROVIDER=indeed needs INDEED_CLIENT_ID and INDEED_CLIENT_SECRET');
  }

  let token = null;
  let tokenExpiresAt = 0;

  async function getToken() {
    if (token && Date.now() < tokenExpiresAt - 60_000) return token;
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret });
    if (scope) body.set('scope', scope);
    const res = await fetchImpl(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
    });
    if (!res.ok) throw upstreamError(`Indeed auth failed (${res.status})`, await res.text());
    const data = await res.json();
    token = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
    return token;
  }

  async function graphql(query, variables) {
    const res = await fetchImpl(graphqlUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${await getToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.errors?.length) {
      throw upstreamError(`Indeed request failed (${res.status})`, JSON.stringify(data.errors || data));
    }
    return data.data;
  }

  return {
    name: 'indeed',
    async searchJobs({ query = '', location = '', limit = 20, cursor }) {
      const data = await graphql(QUERIES.search, { what: query, where: location, first: limit, after: cursor });
      const results = data.jobSearch?.results || [];
      return {
        nextCursor: data.jobSearch?.pageInfo?.nextCursor || null,
        jobs: results.map((r) => toJob(r.job)),
      };
    },
    async getJob(id) {
      const data = await graphql(QUERIES.job, { key: id });
      const job = data.jobData?.results?.[0]?.job;
      return job ? toJob(job) : null;
    },
  };
}

function upstreamError(message, detail) {
  const err = new Error(message);
  err.status = 502;
  err.detail = detail?.slice(0, 500);
  return err;
}

module.exports = { createIndeedProvider, toJob, QUERIES };
