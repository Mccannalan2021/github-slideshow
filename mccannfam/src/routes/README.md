# Routes

Every `.js` file in this folder is loaded automatically. Each one exports a function that receives
the shared context and returns a list of routes:

```js
module.exports = ({ store, jobs, config, gmail, env, toCard, requireJob, requireResume, HttpError, created }) => [
  {
    method: 'GET',
    path: '/hello/:name',          // :name shows up in params
    handler: async ({ params, query, body }) => ({ hello: params.name }),
  },
];
```

- Return plain data and it is sent as JSON. Return `created(data)` for a 201.
- Throw `new HttpError(400, 'message')` for errors.
- Add `public: true` to a route to skip the API key check.
- Add `maxBody: 15_000_000` to accept bodies bigger than the default 1 MB (e.g. file uploads).
- `gmail` is in the context when Gmail is connected (otherwise `null`).
- Exact paths win over `:param` paths, so `/swipes/undo` is matched before `/swipes/:jobId`.
