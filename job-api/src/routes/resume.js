const { normalizeResume } = require('../resume');

module.exports = ({ store, requireResume, HttpError }) => [
  { method: 'GET', path: '/resume', handler: async () => requireResume() },
  {
    method: 'PUT',
    path: '/resume',
    handler: async ({ body }) => {
      try {
        return store.saveResume(normalizeResume(body));
      } catch (e) {
        throw new HttpError(400, e.message);
      }
    },
  },
];
