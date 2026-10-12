// Builds the list of job sources from a set of settings (environment variables plus any keys
// entered in the app's settings). Called at launch and again whenever keys change.
const path = require('node:path');
const fs = require('node:fs');
const { createFileProvider } = require('./providers/file');
const { createMockProvider } = require('./providers/mock');

// Every file in src/providers/ that exports fromEnv(env) is a job source. It turns itself on when
// its settings are present. To add a source, add a file there; see CUSTOMIZING.md.
function buildProviders(env) {
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

module.exports = { buildProviders };
