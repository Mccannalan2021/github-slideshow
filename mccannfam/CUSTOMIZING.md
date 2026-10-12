# Changing the API

Most changes are a one-line edit in `config.json`. Restart the server (`npm start`) after any
change. If you make a typo, the server stops at startup and tells you exactly what's wrong.

| I want to... | Change |
| --- | --- |
| Change my home city | `config.json` → `"homeCity"` |
| Rename a pile, or add/remove one | `config.json` → `"piles"` |
| Choose what's on each swipe card | `config.json` → `"deck.cardFields"` |
| Change how many cards come at once | `config.json` → `"deck.size"` |
| Change the wording of replies | `config.json` → `"replies"` |
| Change application statuses | `config.json` → `"applicationStatuses"` |
| Change the CSV export columns | `config.json` → `"csvColumns"` |
| Change the daily email limit, or stop attaching the resume | `config.json` → `"email"` |
| Change which jobs "get jobs" searches for | `pull-plan.json` |
| Allow your web app's address | `config.json` → `"allowedOrigins"` (or `ALLOWED_ORIGINS` in `.env`) |
| Add an endpoint | New file in `src/routes/` |
| Add a job source | New file in `src/providers/` |
| Add a town or city | `src/alberta.js` → `REGIONS` |

Your app can call `GET /settings` to read the current piles, card fields, tones and statuses, so
it can draw its buttons from the API instead of hard-coding them. Then a config change shows up
in the app with no app update.

## Recipes

### Add a "maybe" pile on swipe down

```json
"piles": {
  "right": "liked",
  "super": "superliked",
  "left": "passed",
  "down": "maybe"
}
```

Now `POST /swipes {"direction": "down"}` works, `GET /piles/maybe` lists them, and `/piles` and
`/swipes/stats` include it. The key is what your app sends; the value is the pile's name.
Removing a line removes that swipe.

### Show the full description on cards

Add `"description"` to `deck.cardFields` (always keep `"id"`: your app needs it to swipe). Allowed fields:
`id, title, company, location, city, region, proximity, type, category, salary, salaryMin,
salaryMax, remote, postedAt, summary, description, source, applyUrl, applyMethod, applyEmail,
applyPhone, match, reply, alsoListedOn`.

### Make replies sound more casual

```json
"replies": {
  "defaultTone": "casual",
  "tones": {
    "casual": { "greeting": "Hey", "closing": "Cheers" },
    "professional": { "greeting": "Hello", "closing": "Best regards" }
  }
}
```

The body of each message is in `src/quickReply.js` if you want to change the sentences themselves.

### Add an endpoint

Create `src/routes/anything.js`:

```js
module.exports = ({ store, jobs, config }) => [
  {
    method: 'GET',
    path: '/piles/liked/count',
    handler: async () => ({ count: store.listSwipes().filter((s) => s.direction === 'right').length }),
  },
];
```

It loads automatically. See `src/routes/README.md` for everything a route can use.

### Add a job source

Create `src/providers/mysource.js`:

```js
function createMySource({ apiKey }) {
  return {
    name: 'mysource',
    async searchJobs({ query, location, limit }) {
      const res = await fetch(`https://api.example.com/jobs?q=${encodeURIComponent(query)}&where=${encodeURIComponent(location)}&key=${apiKey}`);
      const data = await res.json();
      return {
        total: data.total,
        jobs: data.results.map((j) => ({
          id: j.id, title: j.title, company: j.company, location: j.location,
          description: j.description, url: j.applyUrl, postedAt: j.date, salary: j.pay, type: j.type,
        })),
      };
    },
  };
}

// Turned on when MYSOURCE_KEY is in .env.
function fromEnv(env) {
  return env.MYSOURCE_KEY ? createMySource({ apiKey: env.MYSOURCE_KEY }) : null;
}

module.exports = { fromEnv };
```

The rest is automatic: the Alberta filter, removing duplicates, salary conversion, city and region
tagging, resume matching, cards and piles all work for the new source.

### Load jobs from a file

Put a JSON file in `sources/`:

```json
{ "source": "myexport", "fetchedAt": "2026-10-11", "jobs": [
  { "id": "1", "title": "Welder", "company": "Steelco", "location": "Red Deer, AB", "url": "https://..." }
] }
```

## How it fits together

```
config.json          settings (no code)
src/server.js        reads .env and config.json, finds sources, starts the server
src/app.js           loads every file in src/routes/ and handles requests
src/routes/          one file per feature: jobs, deck (swipes and piles), resume, applications...
src/providers/       one file per job source
src/aggregator.js    searches all sources, keeps Alberta jobs, removes duplicates, filters and sorts
src/cards.js         builds swipe cards from deck.cardFields
src/quickReply.js    writes messages
src/store.js         saves your data as JSON files in data/
src/openapi.js       the /openapi.json description (update it when you add a route)
client/              JavaScript client and TypeScript types for your web app
```

When you add a route, add it to `src/openapi.js` too; a test fails if a route is missing from the
spec, so it can't be forgotten.
