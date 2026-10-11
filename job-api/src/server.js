const path = require('node:path');
const fs = require('node:fs');
const { createApp } = require('./app');
const { createStore } = require('./store');
const { createAggregator } = require('./aggregator');
const { createMockProvider } = require('./providers/mock');
const { createIndeedProvider } = require('./providers/indeed');
const { createAdzunaProvider } = require('./providers/adzuna');
const { createJoobleProvider } = require('./providers/jooble');
const { createJobBankProvider } = require('./providers/jobbank');
const { createFileProvider } = require('./providers/file');

// Load .env without extra dependencies (real env vars win).
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = process.env;

// Every source with credentials is turned on. Falls back to sample data when none are set.
function buildProviders() {
  const providers = [];
  if (env.ADZUNA_APP_ID) providers.push(createAdzunaProvider({ appId: env.ADZUNA_APP_ID, appKey: env.ADZUNA_APP_KEY }));
  if (env.JOOBLE_API_KEY) providers.push(createJoobleProvider({ apiKey: env.JOOBLE_API_KEY }));
  if (env.INDEED_CLIENT_ID) {
    providers.push(createIndeedProvider({
      clientId: env.INDEED_CLIENT_ID,
      clientSecret: env.INDEED_CLIENT_SECRET,
      scope: env.INDEED_SCOPE,
      tokenUrl: env.INDEED_TOKEN_URL || 'https://apis.indeed.com/oauth/v2/tokens',
      graphqlUrl: env.INDEED_GRAPHQL_URL || 'https://apis.indeed.com/graphql',
    }));
  }
  if (env.JOBBANK_CSV) {
    const jobbank = createJobBankProvider({ csvPath: path.resolve(env.JOBBANK_CSV) });
    console.log(`Job Bank: loaded ${jobbank.size} Alberta postings`);
    providers.push(jobbank);
  }
  // Job snapshots: every .json file in sources/ plus any listed in JOBS_FILES.
  const sourcesDir = path.join(__dirname, '..', 'sources');
  const files = [
    ...(fs.existsSync(sourcesDir) ? fs.readdirSync(sourcesDir).filter((f) => f.endsWith('.json')).map((f) => path.join(sourcesDir, f)) : []),
    ...(env.JOBS_FILES ? env.JOBS_FILES.split(',').map((f) => path.resolve(f.trim())) : []),
  ];
  for (const file of files) {
    const snapshot = createFileProvider({ file });
    if (providers.some((p) => p.name === snapshot.name)) {
      console.log(`Skipping ${path.basename(file)}: live ${snapshot.name} source is configured`);
      continue;
    }
    console.log(`${snapshot.name}: loaded ${snapshot.size} jobs from ${path.basename(file)} (fetched ${snapshot.fetchedAt || 'unknown'})`);
    providers.push(snapshot);
  }
  if (!providers.length || env.INCLUDE_SAMPLE_JOBS === 'true') providers.push(createMockProvider({ name: 'sample' }));
  return providers;
}

const store = createStore(path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data')));
const jobs = createAggregator({
  providers: buildProviders(),
  store,
  cacheTtlMs: (Number(env.CACHE_TTL_SECONDS) || 600) * 1000,
  perSourceLimit: Number(env.PER_SOURCE_LIMIT) || 50,
  homeCity: env.HOME_CITY || '',
});
const port = Number(env.PORT) || 3000;

if (!env.API_KEY) console.warn('API_KEY is not set: the API is open to anyone who can reach it.');

createApp({ store, jobs, apiKey: env.API_KEY }).listen(port, () => {
  console.log(`Alberta Jobs API on http://localhost:${port} (sources: ${jobs.sources.join(', ')}${jobs.homeCity ? `; home city: ${jobs.homeCity}` : ''})`);
});
