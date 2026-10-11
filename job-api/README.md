# Alberta Jobs API

One API for jobs across Alberta. It searches every job source you connect at the same time,
keeps only Alberta postings, merges duplicates that appear on several boards, and returns them in
one consistent format. On top of that it:

- **Matches jobs to your resume** and ranks the best fits first
- **Converts every salary to annual CAD**, so you can filter and sort by pay
- **Knows Alberta**: 100+ communities grouped into the 8 economic regions (Calgary, Edmonton,
  Red Deer, Lethbridge–Medicine Hat, Banff–Jasper–Rocky Mountain House, Camrose–Drumheller,
  Wood Buffalo–Cold Lake, Athabasca–Grande Prairie–Peace River)
- **Shows market insights**: jobs by city, region, type, category and employer, plus median pay
- **Puts your home city first**: with `HOME_CITY=Red Deer` (the default), Red Deer jobs come first,
  then Sylvan Lake, Lacombe, Blackfalds, Innisfail and the rest of the Red Deer region
- **Saves searches** and flags jobs that are new since you last checked
- **Writes quick replies** to apply, answer an employer, or follow up
- **Tracks your applications**

It has no dependencies. You only need Node.js 18 or newer.

## Run it

```bash
cd job-api
npm run setup             # creates .env, generates your API key, asks for job source keys, runs tests
npm start                 # http://localhost:3000
```

`npm run setup` works on Mac, Linux and Windows. Press Enter to skip any source you don't have
yet, and re-run it any time to add more. Options:

| Command | What it does |
| --- | --- |
| `npm run setup -- --start` | Start the server when setup finishes |
| `npm run setup -- --yes` | No questions; reads source keys from environment variables (e.g. `ADZUNA_APP_ID=... npm run setup -- --yes`) |
| `npm run setup -- --new-key` | Replace your API key with a new one |

You can also do it by hand: `cp .env.example .env`, edit it, then `npm test` and `npm start`.

With no sources configured, it serves sample Alberta jobs so you can build your app right away.

## Job sources

Every source you configure in `.env` is turned on. If one source is down, the others still answer,
and the response's `sources` list shows which one failed.

| Source | What it covers | How to get access |
| --- | --- | --- |
| **Adzuna** | Combines postings from many Canadian job boards and employer sites | Free key at <https://developer.adzuna.com> → `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` |
| **Jooble** | Another large aggregator of Canadian boards | Free key at <https://jooble.org/api/about> → `JOOBLE_API_KEY` |
| **Job Bank** | Government of Canada postings, including many Alberta employers | Download the monthly CSV from [Open Canada](https://open.canada.ca/data/en/dataset/ea639e28-c0fc-48bf-b5dd-b8899bd43072) → `JOBBANK_CSV=path/to/file-or-folder` |
| **Indeed** | Indeed postings | Partner approval at <https://developer.indeed.com> → `INDEED_CLIENT_ID`, `INDEED_CLIENT_SECRET`, `INDEED_SCOPE` |

Things to know:

- No single API has every job in Alberta. Adzuna plus Jooble plus Job Bank is the widest
  coverage you can get for free.
- Job Bank has no live public API. The open data CSV comes out monthly, so its jobs can be a few
  weeks old. The importer finds columns by header name and only loads Alberta rows.
- Indeed retired its public search API. Its partner GraphQL query lives in
  `src/providers/indeed.js` and may need its field names adjusted to the schema Indeed gives you.
- Free API keys have rate limits. Each source's results are cached for 10 minutes
  (`CACHE_TTL_SECONDS`) to stay inside them.
- None of these sources let third-party apps apply for you. Every job has a `url` to the original
  posting; open it, paste in your quick reply, then log it with `POST /applications`.

## Authentication

Every request except `GET /health` must send the header `x-api-key: <API_KEY>`.

## Endpoints

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/health` | Status and active sources |
| GET | `/alberta/cities` | Regions, cities, job types and sort options for your app's filters |
| GET | `/jobs` | Search Alberta jobs (filters below) |
| GET | `/jobs/:id` | One job |
| GET | `/jobs/:id/match` | How well the job fits your resume |
| POST | `/jobs/:id/quick-reply` | Write a message for this job |
| GET | `/insights` | Job market numbers for a search (same filters as `/jobs`) |
| PUT / GET | `/resume` | Save or read your resume |
| GET / POST | `/searches` | List or create saved searches |
| GET | `/searches/:id/run?onlyNew=true` | Run a saved search; marks jobs you haven't seen with `isNew` |
| DELETE | `/searches/:id` | Delete a saved search |
| GET / POST | `/applications` | List or track applications |
| PATCH | `/applications/:id` | Update an application's `status`, `message` or `notes` |

### Search filters (`GET /jobs`, `GET /insights`)

| Parameter | Example | Meaning |
| --- | --- | --- |
| `q` | `welder` | Keywords |
| `city` | `Red Deer` | Any city from `/alberta/cities` |
| `region` | `Edmonton` | One of the 8 economic regions |
| `near` | `Red Deer` | List jobs in this city first, then its region, then the rest of Alberta. Defaults to `HOME_CITY` in `.env` (Red Deer). Each job gets `proximity`: `city`, `region` or `alberta` |
| `type` | `full-time` | `full-time`, `part-time`, `contract`, `temporary`, `seasonal`, `casual` |
| `remote` | `true` | `true` for remote only, `false` to hide remote jobs |
| `minSalary` | `60000` | Minimum annual pay in CAD (jobs with no posted pay are left out) |
| `postedWithin` | `7` | Posted in the last N days |
| `sources` | `adzuna,jobbank` | Only search these sources |
| `sort` | `salary` | `relevance` (default: best resume match, else newest), `date`, `salary`, `match` |
| `page`, `limit` | `2`, `20` | Paging (limit up to 100) |
| `match` | `false` | Skip resume matching |

Example:

```bash
curl "localhost:3000/jobs?q=driver&region=Athabasca&minSalary=70000&sort=salary" -H "x-api-key: $API_KEY"
```

Each job looks like this:

```json
{
  "id": "adzuna:4417893",
  "source": "adzuna",
  "title": "Class 1 Truck Driver",
  "company": "Peace Country Hauling",
  "location": "Grande Prairie, Alberta",
  "city": "Grande Prairie",
  "region": "Athabasca–Grande Prairie–Peace River",
  "remote": false,
  "type": "full-time",
  "category": "Logistics & Warehouse Jobs",
  "salary": "$90,000 - $110,000 a year",
  "salaryMin": 90000,
  "salaryMax": 110000,
  "postedAt": "2026-10-04T00:00:00.000Z",
  "url": "https://...",
  "alsoListedOn": [{ "id": "jooble:-81234", "source": "jooble", "url": "https://..." }],
  "match": { "score": 72, "matchedSkills": ["driving", "cdl"], "missingSkills": [], "titleMatch": true }
}
```

The response also includes `total`, `pages`, `sources` (status of each source), `removed`
(how many non-Alberta jobs and duplicates were dropped) and `facets` (counts by city, region,
type, category, company and source, plus median salary).

### Saved searches

```bash
curl -X POST localhost:3000/searches -H "x-api-key: $API_KEY" -H 'content-type: application/json' \
  -d '{"name": "Calgary admin jobs", "filters": {"q": "admin", "city": "Calgary", "postedWithin": 7}}'

# Later: only the jobs you haven't seen yet
curl "localhost:3000/searches/<id>/run?onlyNew=true" -H "x-api-key: $API_KEY"
```

### Resume

```bash
curl -X PUT localhost:3000/resume -H "x-api-key: $API_KEY" -H 'content-type: application/json' -d '{
  "name": "Jordan Smith",
  "email": "jordan@example.com",
  "phone": "(587) 555-0123",
  "headline": "Customer Service Representative",
  "skills": ["customer service", "data entry", "microsoft office"],
  "experience": [{ "title": "Call Center Agent", "company": "Acme", "start": "2023", "end": "2026" }]
}'
```

You can also send `{"text": "..."}` with a pasted resume. Name, email, phone and skills are pulled out of it.

### Quick replies

```bash
curl -X POST "localhost:3000/jobs/adzuna:4417893/quick-reply" -H "x-api-key: $API_KEY" \
  -H 'content-type: application/json' -d '{
    "type": "reply",
    "employerMessage": "Are you available for a phone interview this week?",
    "availability": "Tuesday or Thursday after 1pm"
  }'
```

- `type`: `apply`, `reply` or `followup`
- `tone`: `professional` (default), `friendly` or `brief`
- `employerMessage`: required for `reply`. Recognizes interview requests, "still interested?",
  salary questions, start-date questions and rejections.
- `availability`: optional, used in interview and start-date replies

## Data

Your resume, applications, saved searches and recently seen jobs are saved as JSON in `DATA_DIR`
(default `./data`). Those files are git-ignored.

## Project layout

```
src/
  server.js          reads .env, turns on configured sources, starts the server
  app.js             HTTP routes
  aggregator.js      searches all sources, Alberta filter, dedupe, filters, sorting, facets, cache
  alberta.js         Alberta cities and economic regions
  salary.js          salary text → annual CAD
  match.js           resume ↔ job scoring
  quickReply.js      message writer
  resume.js          resume parsing
  store.js           JSON file storage
  providers/         adzuna, jooble, jobbank, indeed, mock (sample jobs)
scripts/
  setup.js           one-step setup (npm run setup)
```
