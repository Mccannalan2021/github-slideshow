const path = require('node:path');
const fs = require('node:fs');
const { createApp } = require('./app');
const { createStore } = require('./store');
const { createMockProvider } = require('./providers/mock');
const { createIndeedProvider } = require('./providers/indeed');

// Load .env without extra dependencies (real env vars win).
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = process.env;
const provider = env.JOB_PROVIDER === 'indeed'
  ? createIndeedProvider({
      clientId: env.INDEED_CLIENT_ID,
      clientSecret: env.INDEED_CLIENT_SECRET,
      scope: env.INDEED_SCOPE,
      tokenUrl: env.INDEED_TOKEN_URL || 'https://apis.indeed.com/oauth/v2/tokens',
      graphqlUrl: env.INDEED_GRAPHQL_URL || 'https://apis.indeed.com/graphql',
    })
  : createMockProvider();

const store = createStore(path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data')));
const port = Number(env.PORT) || 3000;

if (!env.API_KEY) console.warn('API_KEY is not set: the API is open to anyone who can reach it.');

createApp({ store, provider, apiKey: env.API_KEY }).listen(port, () => {
  console.log(`Job API listening on http://localhost:${port} (provider: ${provider.name})`);
});
