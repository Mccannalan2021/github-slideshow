# Job API

A small backend for your job app. It lets you:

- **Save your resume** (structured JSON or pasted plain text)
- **Search Indeed jobs**, ranked by how well each one matches your resume
- **Generate quick replies**: an application note, a reply to an employer's message, or a follow-up
- **Track applications** (saved, applied, interviewing, offer, rejected, withdrawn)

It has no dependencies. You only need Node.js 18 or newer.

## Run it

```bash
cd job-api
cp .env.example .env      # then edit API_KEY
npm start                 # http://localhost:3000
npm test
```

`JOB_PROVIDER=mock` (the default) serves sample jobs so you can build your app before you
have Indeed access.

## Connecting to Indeed

Indeed shut down its old public job-search API. To get real Indeed jobs you need partner access:

1. Create an app at <https://developer.indeed.com> and apply for job-data access.
2. Once approved, put your credentials in `.env`:
   ```
   JOB_PROVIDER=indeed
   INDEED_CLIENT_ID=...
   INDEED_CLIENT_SECRET=...
   INDEED_SCOPE=...        # the scope Indeed grants you
   ```
3. Check the GraphQL schema in your Indeed developer account. If its field names differ from the
   query in `src/providers/indeed.js` (`QUERIES` and `toJob`), update them there. That is the only
   file that talks to Indeed.

Indeed does not let third-party apps submit applications on your behalf. Each job comes with a
`url` (and quick replies include `applyUrl`), so your app can open the Indeed page and paste in
the message this API generated. Then record it with `POST /applications`.

## Authentication

Every request except `GET /health` must send the header `x-api-key: <API_KEY>`.

## Endpoints

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/health` | Status and active provider |
| PUT | `/resume` | Save your resume |
| GET | `/resume` | Get your saved resume |
| GET | `/jobs?q=&location=&limit=&page=&cursor=` | Search jobs, best matches first |
| GET | `/jobs/:id` | Job details |
| GET | `/jobs/:id/match` | Match score, matched skills and missing skills |
| POST | `/jobs/:id/quick-reply` | Generate a message for this job |
| GET | `/applications?status=` | List tracked applications |
| POST | `/applications` | Track a job (`jobId`, optional `status`, `message`, `notes`) |
| PATCH | `/applications/:id` | Update `status`, `message` or `notes` |

### Save a resume

Structured:

```bash
curl -X PUT localhost:3000/resume -H "x-api-key: $API_KEY" -H 'content-type: application/json' -d '{
  "name": "Jordan Smith",
  "email": "jordan@example.com",
  "phone": "(555) 123-4567",
  "headline": "Customer Service Representative",
  "skills": ["customer service", "data entry", "microsoft office"],
  "experience": [{ "title": "Call Center Agent", "company": "Acme", "start": "2023", "end": "2026" }]
}'
```

Or paste plain text, and the API pulls out your name, email, phone and skills:

```bash
curl -X PUT localhost:3000/resume -H "x-api-key: $API_KEY" -H 'content-type: application/json' \
  -d '{"text": "Jordan Smith\njordan@example.com\n..."}'
```

### Quick replies

```bash
# Note to send with an application
curl -X POST localhost:3000/jobs/mock-2/quick-reply -H "x-api-key: $API_KEY" \
  -H 'content-type: application/json' -d '{"type": "apply", "tone": "friendly"}'

# Answer an employer's message
curl -X POST localhost:3000/jobs/mock-2/quick-reply -H "x-api-key: $API_KEY" \
  -H 'content-type: application/json' -d '{
    "type": "reply",
    "employerMessage": "Are you available for a phone interview this week?",
    "availability": "Tuesday or Thursday after 1pm"
  }'
```

- `type`: `apply`, `reply` or `followup`
- `tone`: `professional` (default), `friendly` or `brief`
- `employerMessage`: required for `reply`. The API recognizes interview requests, "still
  interested?", salary questions, start-date questions and rejections, and answers each one.
- `availability`: optional, used in interview and start-date replies

Response:

```json
{
  "jobId": "mock-2",
  "applyUrl": "https://www.indeed.com/viewjob?jk=mock-2",
  "type": "reply",
  "intent": "interview",
  "subject": "Re: Customer Service Representative",
  "message": "Hello James,\n\nThank you for reaching out ..."
}
```

## Data

Your resume and applications are saved as JSON in `DATA_DIR` (default `./data`). Those files are
git-ignored, so your personal details are not committed.
