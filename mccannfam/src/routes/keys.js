// Job source keys entered in the app's settings. They are saved in data/keys.json and take effect
// straight away, with no restart. Keys are never sent back: only whether each one is set.
const keys = require('../keys');

const isLoopback = (address) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);

module.exports = ({ store, jobs, env, authEnabled, sourceBuilder, HttpError }) => {
  // Without an API_KEY the whole API is open, so only this computer may change the keys.
  function mayChange(req) {
    if (authEnabled || isLoopback(req.socket?.remoteAddress)) return;
    throw new HttpError(403, 'Set API_KEY in .env before changing keys from another device');
  }

  const view = () => ({
    sources: keys.describe(env, store.getKeys()),
    active: jobs.sourceDetails(),
    canApplyNow: Boolean(sourceBuilder),
  });

  // Checks the new keys build working sources, then saves them and switches the sources over.
  function apply(next) {
    const eff = keys.effectiveEnv(env, next);
    keys.checkComplete(eff);
    let providers = null;
    if (sourceBuilder) {
      try {
        providers = sourceBuilder(eff);
      } catch (err) {
        throw new HttpError(400, `Could not use these keys: ${keys.redact(err.message, eff)}`);
      }
    }
    store.saveKeys(next);
    if (providers) jobs.setProviders(providers);
  }

  return [
    { method: 'GET', path: '/settings/keys', handler: async () => view() },
    // Body: { "values": { "ADZUNA_APP_ID": "...", "ADZUNA_APP_KEY": "..." } }. "" removes a key.
    {
      method: 'PUT',
      path: '/settings/keys',
      handler: async ({ req, body }) => {
        mayChange(req);
        const updates = keys.cleanValues(body.values);
        keys.checkPaths(env, updates);
        apply(keys.mergeKeys(store.getKeys(), updates));
        return view();
      },
    },
    // Remove every key you saved for one source (e.g. "adzuna"). Keys in .env stay.
    {
      method: 'DELETE',
      path: '/settings/keys/:source',
      handler: async ({ req, params }) => {
        mayChange(req);
        const source = keys.KEY_SOURCES.find((s) => s.id === params.source);
        if (!source) throw new HttpError(404, `Source must be one of: ${keys.KEY_SOURCES.map((s) => s.id).join(', ')}`);
        apply(keys.mergeKeys(store.getKeys(), Object.fromEntries(source.fields.map((f) => [f.key, '']))));
        return view();
      },
    },
  ];
};

module.exports.isLoopback = isLoopback;
