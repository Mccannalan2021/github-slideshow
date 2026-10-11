const path = require('node:path');
const fs = require('node:fs');
const { createApp } = require('./app');
const { createStore } = require('./store');
const { createAggregator } = require('./aggregator');
const { loadConfig } = require('./config');
const { createMockProvider } = require('./providers/mock');
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

// Every file in src/providers/ that exports fromEnv(env) is a job source. It turns itself on when
// its settings are in .env. To add a source, add a file there; see CUSTOMIZING.md.
function buildProviders() {
  const providers = [];
  const dir = path.join(__dirname, 'providers');
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
    const mod = require(path.join(dir, name));
    if (typeof mod.fromEnv !== 'function') continue;
    const provider = mod.fromEnv(env);
    if (provider) providers.push(provider);
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

const config = loadConfig({ env });
const store = createStore(path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data')));
const jobs = createAggregator({
  providers: buildProviders(),
  store,
  cacheTtlMs: config.search.cacheSeconds * 1000,
  perSourceLimit: config.search.perSourceLimit,
  homeCity: config.homeCity,
});
const port = Number(env.PORT) || 3000;

if (!env.API_KEY) console.warn('API_KEY is not set: the API is open to anyone who can reach it.');

createApp({ store, jobs, config, apiKey: env.API_KEY }).listen(port, () => {
  console.log(`Alberta Jobs API on http://localhost:${port} (sources: ${jobs.sources.join(', ')}${jobs.homeCity ? `; home city: ${jobs.homeCity}` : ''})`);
});
