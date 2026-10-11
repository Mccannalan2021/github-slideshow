# mccannfam

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
cd mccannfam
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

## Add it to your web app

### 1. Run the API online

Your web app needs the API at a public address. The repo is ready for
[Render](https://render.com): **New > Blueprint**, pick this repo, and it uses `render.yaml`
(Docker, 1 GB disk for your data, a generated `API_KEY`). Then set in the Render dashboard:

- `ALLOWED_ORIGINS`: your web app's address, e.g. `https://myjobsapp.com` (add
  `http://localhost:5173` while developing). Other sites' browsers are blocked.
- Any job source keys and the `GMAIL_*` values (copy them from your local `.env` after
  `npm run gmail`).

Any host that runs Docker works too (Railway, Fly.io, a VPS):
`docker build -t mccannfam . && docker run -p 3000:3000 -v jobs-data:/data -e API_KEY=... mccannfam`.
Mount `/data` so your resume, piles and applications survive restarts.

### 2. Use the client in your app

Copy `client/mccannfam.js` (and `client/mccannfam.d.ts` for TypeScript) into your app:

```js
import { createMccannfamApi } from './mccannfam.js';

const api = createMccannfamApi({
  baseUrl: import.meta.env.VITE_JOBS_API_URL,   // e.g. https://mccannfam.onrender.com
  apiKey: import.meta.env.VITE_JOBS_API_KEY,
});

const { cards, remaining } = await api.deck({ near: 'Red Deer' });
await api.swipe(cards[0].id, 'right');            // -> "liked" pile
const liked = await api.pile('liked', { applied: false });
const { applyUrl } = await api.applyFromPile(liked[0].jobId);
window.open(applyUrl, '_blank');
```

A swipe card in React:

```jsx
function SwipeDeck() {
  const [cards, setCards] = useState([]);
  useEffect(() => { api.deck({ near: 'Red Deer' }).then((d) => setCards(d.cards)); }, []);
  const card = cards[0];
  if (!card) return <p>No more jobs. Check back after the next "get jobs".</p>;

  const swipe = async (direction) => {
    await api.swipe(card.id, direction);
    setCards((rest) => rest.slice(1));
    if (cards.length < 3) api.deck({ near: 'Red Deer' }).then((d) => setCards(d.cards));
  };

  return (
    <div className="card">
      <h2>{card.title}</h2>
      <p>{card.company} · {card.location} {card.salary && `· ${card.salary}`}</p>
      <p>{card.summary}</p>
      <button onClick={() => swipe('left')}>Pass</button>
      <button onClick={() => swipe('super')}>Super</button>
      <button onClick={() => swipe('right')}>Like</button>
    </div>
  );
}
```

Every endpoint has a method: `searchJobs`, `deck`, `swipe`, `undoSwipe`, `piles`, `pile`,
`moveToPile`, `removeFromPile`, `applyFromPile`, `getResume`, `saveResume`, `uploadResumeFile`
(takes a `File` from an `<input type="file">`), `emailJob`, `previewEmail`, `applications`,
`quickReply`, `downloadCsv` and more. Errors throw `MccannfamApiError` with `.status` and `.message`.
Draw your swipe buttons from `api.settings()` so new piles in `config.json` appear automatically.

Not using JavaScript? `GET /openapi.json` describes every endpoint (OpenAPI 3.1). Import it into
Postman or Swagger, or generate a client for your language.

### About the API key in a web app

A key in browser code can be seen by anyone who opens your site's source. That's fine for a
personal app only you use, together with `ALLOWED_ORIGINS`. If other people will use your app, call
this API from your web app's own server (keep `API_KEY` there) instead of from the browser.

## Getting fresh jobs

In a Claude Code session on this repo, just say **"get jobs"**. The `get-jobs` skill
(`.claude/skills/get-jobs/`) runs every search in `pull-plan.json` through the job sites Claude
can reach (ZipRecruiter and Indeed), saves the results, imports them with `npm run import`, and
commits the updated `sources/*.json`. Edit `pull-plan.json` to change which towns, keywords and job
types it searches.

You can also import results you saved yourself: put them in `raw/indeed/` or `raw/ziprecruiter/`
and run `npm run import`.

## Changing it

Settings like your home city, swipe piles, card fields and reply wording are in `config.json`.
New endpoints and job sources are single files that load automatically. See
[CUSTOMIZING.md](CUSTOMIZING.md) for step-by-step recipes.

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
| GET | `/openapi.json` | OpenAPI 3.1 description of every endpoint (no key needed) |
| GET | `/settings` | Current piles, card fields, tones and statuses, so your app can draw its UI from them |
| GET | `/alberta/cities` | Regions, cities, job types and sort options for your app's filters |
| GET | `/jobs` | Search Alberta jobs (filters below) |
| GET | `/jobs/:id` | One job |
| GET | `/jobs/:id/match` | How well the job fits your resume |
| POST | `/jobs/:id/quick-reply` | Write a message for this job |
| GET | `/deck?limit=10` | Swipe deck: next jobs you haven't swiped, each with its apply link and a ready message (takes the `/jobs` filters) |
| POST | `/swipes` | Swipe a job into a pile: `{"jobId": "...", "direction": "right" \| "left" \| "super"}` |
| GET | `/piles`, `/piles/:pile` | Your liked, superliked and passed jobs (see Swipe apps below) |
| GET | `/jobs.csv` | Every job matching the filters as a spreadsheet, with apply emails and phones |
| GET | `/` | Web page to search, filter by "has apply email", write replies and download CSV |
| PUT / GET | `/resume/file` | Upload (base64) or check the resume file attached to emails |
| POST | `/jobs/:id/email` | Email an application from your Gmail, resume attached (`preview: true` to just see it) |
| GET | `/email/status`, `/email/sent` | Gmail connection, today's count, and sent emails |
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
| `hasEmail` | `true` | Only jobs you can apply to by email |
| `minSalary` | `60000` | Minimum annual pay in CAD (jobs with no posted pay are left out) |
| `postedWithin` | `7` | Posted in the last N days |
| `sources` | `adzuna,jobbank` | Only search these sources |
| `sort` | `salary` | `relevance` (default: best resume match, else newest), `date`, `salary`, `match` |
| `page`, `limit` | `2`, `20` | Paging (limit up to 100, or `all`) |
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

### Swipe apps

`/deck`, `/swipes` and `/piles` are built for a Tinder-style app. Swiping only sorts jobs into
piles; you deal with each pile afterwards.

| Swipe | Pile |
| --- | --- |
| `right` | `liked` |
| `super` | `superliked` |
| `left` | `passed` |

```bash
# 1. Get cards (any /jobs filter works: near, city, type, minSalary...)
curl "localhost:3000/deck?limit=10&near=Red%20Deer" -H "x-api-key: $API_KEY"

# 2. Swipe
curl -X POST localhost:3000/swipes -H "x-api-key: $API_KEY" -H 'content-type: application/json' \
  -d '{"jobId": "indeed:aakydyk4rdyb", "direction": "right"}'

# 3. Later: go through a pile
curl "localhost:3000/piles/liked?applied=false" -H "x-api-key: $API_KEY"

# 4. Apply to one: returns the apply link and your ready message, and logs it in /applications
curl -X POST "localhost:3000/swipes/indeed:aakydyk4rdyb/apply" -H "x-api-key: $API_KEY"
```

Each card has the job basics, `match`, `applyUrl` (the job's apply link) and a `reply` with a
ready-written `subject` and `message`. `remaining` says how many unswiped jobs are left. Swiped
jobs never show up in the deck again.

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/piles` | How many jobs are in each pile |
| GET | `/piles/:pile?applied=true\|false` | Jobs in `liked`, `superliked` or `passed`, newest first |
| PATCH | `/swipes/:jobId` | Move a job to another pile: `{"direction": "super"}` |
| DELETE | `/swipes/:jobId` | Take a job out of its pile and put it back in the deck |
| POST | `/swipes/:jobId/apply` | Mark it applied; returns `applyUrl` and `message` |
| POST | `/swipes/undo` | Undo the last swipe |
| GET | `/swipes/stats` | Counts per pile, applied, and swiped today |

### Apply emails

Every job has `applyEmail`, `applyEmails`, `applyPhone` and `applyMethod` (`email`, `in-person`,
`phone` or `website`), taken from the source's own fields or found in the posting text.
Filter with `hasEmail=true`. Most Indeed and aggregator listings use an online apply form instead
of an email; Job Bank postings and small local employers list emails far more often.

### Saved searches

```bash
curl -X POST localhost:3000/searches -H "x-api-key: $API_KEY" -H 'content-type: application/json' \
  -d '{"name": "Calgary admin jobs", "filters": {"q": "admin", "city": "Calgary", "postedWithin": 7}}'

# Later: only the jobs you haven't seen yet
curl "localhost:3000/searches/<id>/run?onlyNew=true" -H "x-api-key: $API_KEY"
```

### Resume

The easiest way is to answer questions:

```bash
npm run resume
```

It asks about you, your skills, each job you've had, education, certifications and licences,
availability and references, then saves it and shows a preview. Run it again any time: your saved
answers show in [brackets] and Enter keeps them. It also asks for your PDF or Word resume file,
which gets attached when you apply by email.

Or send it from your app:

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

Upload the resume file from your app as base64:

```bash
curl -X PUT localhost:3000/resume/file -H "x-api-key: $API_KEY" -H 'content-type: application/json' \
  -d '{"filename": "Jordan Smith Resume.pdf", "contentBase64": "JVBERi0xLjQ..."}'
```

### Sending applications from Gmail

Connect your Gmail once:

```bash
npm run gmail
```

It walks you through creating a free Google OAuth client and signing in, then saves the access
to `.env` and can send you a test email. The API only gets permission to **send** mail as you;
it can't read your inbox. Restart the server afterwards.

Then from your app:

```bash
# See the email first (nothing is sent)
curl -X POST "localhost:3000/jobs/<jobId>/email" -H "x-api-key: $API_KEY" -H 'content-type: application/json' \
  -d '{"preview": true}'

# Send it
curl -X POST "localhost:3000/jobs/<jobId>/email" -H "x-api-key: $API_KEY" -H 'content-type: application/json' \
  -d '{"to": "hiring@company.ca"}'
```

- The message is written from your resume (or send your own `subject` and `message`, and `tone`).
- Your resume file is attached (`attachResume: false` to skip).
- `to` is needed unless the posting lists an email.
- Sending records the application, and marks the job applied in your piles if you swiped it.
- To protect your Gmail from spam flags, sending stops after `email.dailyLimit` (40) a day; change
  it in `config.json`.
- `GET /email/status` shows whether Gmail is connected and how many were sent today;
  `GET /email/sent` lists what was sent.

While your Google app is in "Testing" mode, Google expires the access after 7 days; run
`npm run gmail` again, or publish the app on Google's OAuth consent screen so it lasts.

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

See the diagram at the end of [CUSTOMIZING.md](CUSTOMIZING.md).
