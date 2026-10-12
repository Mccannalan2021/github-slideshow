const path = require('node:path');
const { createApp } = require('./app');
const { createStore } = require('./store');
const { createAggregator } = require('./aggregator');
const { loadConfig } = require('./config');
const { buildProviders } = require('./sources');
const { effectiveEnv } = require('./keys');
const gmailModule = require('./gmail');
const { loadEnvFile } = require('./env');

// Load .env without extra dependencies (real env vars win).
loadEnvFile(path.join(__dirname, '..', '.env'));

const env = process.env;

const config = loadConfig({ env });
const store = createStore(path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data')));
// Keys entered in the app's settings win over .env.
const launchEnv = effectiveEnv(env, store.getKeys());
const jobs = createAggregator({
  providers: buildProviders(launchEnv),
  store,
  cacheTtlMs: config.search.cacheSeconds * 1000,
  perSourceLimit: config.search.perSourceLimit,
  defaultLimit: config.search.defaultLimit,
  maxLimit: config.search.maxLimit,
  homeCity: config.homeCity,
});
const port = Number(env.PORT) || 3000;

if (env.API_KEY === 'change-me') {
  console.error('API_KEY is still the placeholder "change-me" from .env.example. Run npm run setup to generate a real key.');
  process.exit(1);
}
if (!env.API_KEY) console.warn('API_KEY is not set: the API is open to anyone who can reach it.');

const gmail = gmailModule.fromEnv(env);
console.log(gmail ? `Gmail: sending as ${gmail.from}` : 'Gmail: not connected (run npm run gmail to send applications by email)');

createApp({ store, jobs, config, gmail, apiKey: env.API_KEY, env, sourceBuilder: buildProviders }).listen(port, () => {
  console.log(`mccannfam on http://localhost:${port} (sources: ${jobs.sources.join(', ')}${jobs.homeCity ? `; home city: ${jobs.homeCity}` : ''})`);
});
