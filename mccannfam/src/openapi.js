// OpenAPI 3.1 description of the API, served at GET /openapi.json (import it into Postman,
// Swagger UI, Insomnia, or a code generator). Built from config so piles and fields stay in sync.
const { JOB_TYPES, SORTS } = require('./aggregator');

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema, description = 'OK') => ({ description, content: { 'application/json': { schema } } });
const body = (schema, required = true) => ({ required, content: { 'application/json': { schema } } });
const pathParam = (name, description) => ({ name, in: 'path', required: true, schema: { type: 'string' }, description });
const q = (name, schema, description) => ({ name, in: 'query', schema, description });
const obj = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });
const str = { type: 'string' };
const num = { type: 'number' };
const bool = { type: 'boolean' };
const arr = (items) => ({ type: 'array', items });
const errors = {
  400: json(ref('Error'), 'Invalid input'),
  401: json(ref('Error'), 'Missing or wrong x-api-key'),
  404: json(ref('Error'), 'Not found'),
};

function buildOpenApi(config) {
  const directions = Object.keys(config.piles);
  const piles = Object.values(config.piles);
  const filters = [
    q('q', str, 'Keywords'),
    q('city', str, 'Alberta city (see /alberta/cities)'),
    q('region', str, 'Alberta economic region'),
    q('near', str, `List this city first, then its region (default: ${config.homeCity || 'none'})`),
    q('type', { type: 'string', enum: JOB_TYPES }),
    q('remote', bool),
    q('hasEmail', bool, 'Only jobs with an apply email'),
    q('minSalary', num, 'Minimum annual pay in CAD'),
    q('postedWithin', num, 'Posted in the last N days'),
    q('sources', str, 'Comma-separated source names'),
    q('sort', { type: 'string', enum: SORTS }),
    q('page', { type: 'integer', minimum: 1 }),
    q('limit', { oneOf: [{ type: 'integer', minimum: 1, maximum: config.search.maxLimit }, { const: 'all' }] }),
    q('match', bool, 'false to skip resume matching'),
  ];

  const op = (tag, summary, { responses = {}, ...rest } = {}) => ({ tags: [tag], summary, ...rest, responses: { ...responses, ...errors } });

  return {
    openapi: '3.1.0',
    info: {
      title: 'mccannfam',
      version: '1.0.0',
      description: 'Alberta job search across sources, a swipe deck with piles, resume matching, quick replies and Gmail applications. Send your key in the x-api-key header.',
    },
    security: [{ apiKey: [] }],
    tags: ['Status', 'Jobs', 'Deck', 'Resume', 'Email', 'Applications', 'Saved searches'].map((name) => ({ name })),
    paths: {
      '/health': { get: { ...op('Status', 'Health check', { responses: { 200: json(obj({ ok: bool, sources: arr(str), homeCity: str })) } }), security: [] } },
      '/settings': { get: op('Status', 'Swipe directions, piles, card fields, tones and statuses for building your UI', { responses: { 200: json(ref('Settings')) } }) },
      '/settings/keys': {
        get: op('Status', 'Job source keys: which are set (the keys themselves are never returned)', { responses: { 200: json(ref('KeySettings')) } }),
        put: op('Status', 'Enter your own job source keys; they take effect straight away. "" removes a key', {
          requestBody: body(obj({ values: { type: 'object', additionalProperties: str, description: 'Setting name to value, e.g. { "ADZUNA_APP_ID": "..." }' } }, ['values'])),
          responses: { 200: json(ref('KeySettings')), 403: json(ref('Error'), 'Set API_KEY before changing keys from another device') },
        }),
      },
      '/settings/keys/{source}': { delete: op('Status', 'Remove the keys you saved for one source', { parameters: [pathParam('source', 'adzuna, jooble, jobbank or indeed')], responses: { 200: json(ref('KeySettings')) } }) },
      '/sources': { get: op('Status', 'Job sources and how many jobs each has', { responses: { 200: json(arr(obj({ name: str, kind: { enum: ['file', 'live'] }, jobs: num, fetchedAt: str }))) } }) },
      '/alberta/cities': { get: op('Status', 'Alberta regions and cities, job types and sort options', { responses: { 200: json(obj({ regions: arr(obj({ name: str, cities: arr(str) })), jobTypes: arr(str), sorts: arr(str) })) } }) },

      '/jobs': { get: op('Jobs', 'Search Alberta jobs', { parameters: filters, responses: { 200: json(ref('SearchResult')) } }) },
      '/jobs.csv': { get: op('Jobs', 'Download matching jobs as CSV', { parameters: filters, responses: { 200: { description: 'CSV file', content: { 'text/csv': { schema: str } } } } }) },
      '/insights': { get: op('Jobs', 'Job market numbers for a search', { parameters: filters, responses: { 200: json(obj({ total: num })) } }) },
      '/jobs/{id}': { get: op('Jobs', 'One job', { parameters: [pathParam('id', 'Job id, e.g. indeed:abc123')], responses: { 200: json(ref('Job')) } }) },
      '/jobs/{id}/match': { get: op('Jobs', 'How well the job fits your resume', { parameters: [pathParam('id')], responses: { 200: json(ref('Match')) } }) },
      '/jobs/{id}/quick-reply': {
        post: op('Jobs', 'Write an application, reply or follow-up message', {
          parameters: [pathParam('id')],
          requestBody: body(obj({ type: { enum: ['apply', 'reply', 'followup'] }, tone: { enum: Object.keys(config.replies.tones) }, employerMessage: str, availability: str }), false),
          responses: { 200: json(obj({ subject: str, message: str, applyUrl: str, intent: str })) },
        }),
      },

      '/deck': { get: op('Deck', 'Next jobs you have not swiped on', { parameters: filters, responses: { 200: json(obj({ remaining: num, hasResume: bool, cards: arr(ref('Card')) })) } }) },
      '/swipes': { post: op('Deck', 'Swipe a job into a pile', { requestBody: body(obj({ jobId: str, direction: { enum: directions } }, ['jobId', 'direction'])), responses: { 201: json(ref('Swipe')), 409: json(ref('Error'), 'Already swiped') } }) },
      '/swipes/undo': { post: op('Deck', 'Undo the last swipe', { responses: { 200: json(obj({ undone: obj({ jobId: str, direction: str, pile: str }) })) } }) },
      '/swipes/stats': { get: op('Deck', 'Counts per pile, applied, swiped today', { responses: { 200: json({ type: 'object', additionalProperties: num }) } }) },
      '/swipes/{jobId}': {
        patch: op('Deck', 'Move a job to another pile', { parameters: [pathParam('jobId')], requestBody: body(obj({ direction: { enum: directions } }, ['direction'])), responses: { 200: json(ref('Swipe')) } }),
        delete: op('Deck', 'Take a job out of its pile (back into the deck)', { parameters: [pathParam('jobId')], responses: { 200: json(obj({ removed: str })) } }),
      },
      '/swipes/{jobId}/apply': { post: op('Deck', 'Mark a piled job applied; returns its apply link and message', { parameters: [pathParam('jobId')], requestBody: { content: { 'application/json': { schema: obj({ message: str, notes: str }) } } }, responses: { 201: json(obj({ applyUrl: str, message: str, application: ref('Application') })) } }) },
      '/piles': { get: op('Deck', 'How many jobs are in each pile', { responses: { 200: json(obj(Object.fromEntries(piles.map((p) => [p, num])))) } }) },
      '/piles/{pile}': { get: op('Deck', 'Jobs in a pile, newest first', { parameters: [{ ...pathParam('pile'), schema: { enum: piles } }, q('applied', bool)], responses: { 200: json(arr(ref('Card'))) } }) },

      '/resume': {
        get: op('Resume', 'Your resume', { responses: { 200: json(ref('Resume')) } }),
        put: op('Resume', 'Save your resume (structured, or { "text": "..." })', { requestBody: body(ref('Resume')), responses: { 200: json(ref('Resume')) } }),
      },
      '/resume/file': {
        get: op('Resume', 'The resume file attached to emails', { responses: { 200: json(ref('ResumeFile')) } }),
        put: op('Resume', 'Upload a PDF/DOC/DOCX resume as base64', { requestBody: body(obj({ filename: str, contentBase64: str }, ['filename', 'contentBase64'])), responses: { 200: json(ref('ResumeFile')) } }),
      },

      '/email/status': { get: op('Email', 'Gmail connection and today\'s count', { responses: { 200: json(obj({ connected: bool, from: str, sentToday: num, dailyLimit: num, resumeFile: str })) } }) },
      '/email/sent': { get: op('Email', 'Emails sent', { responses: { 200: json(arr(obj({ jobId: str, to: str, subject: str, gmailId: str, at: str }))) } }) },
      '/jobs/{id}/email': {
        post: op('Email', 'Email an application from your Gmail with your resume attached', {
          parameters: [pathParam('id')],
          requestBody: { content: { 'application/json': { schema: obj({ to: str, subject: str, message: str, tone: str, attachResume: bool, preview: { ...bool, description: 'true = return the email without sending' } }) } } },
          responses: { 200: json(ref('EmailResult'), 'Preview'), 201: json(ref('EmailResult'), 'Sent'), 429: json(ref('Error'), 'Daily email limit reached'), 503: json(ref('Error'), 'Gmail not connected') },
        }),
      },

      '/applications': {
        get: op('Applications', 'Tracked applications', { parameters: [q('status', { enum: config.applicationStatuses })], responses: { 200: json(arr(ref('Application'))) } }),
        post: op('Applications', 'Track a job', { requestBody: body(obj({ jobId: str, status: { enum: config.applicationStatuses }, message: str, notes: str }, ['jobId'])), responses: { 201: json(ref('Application')) } }),
      },
      '/applications/{id}': { patch: op('Applications', 'Update an application', { parameters: [pathParam('id')], requestBody: body(obj({ status: { enum: config.applicationStatuses }, message: str, notes: str })), responses: { 200: json(ref('Application')) } }) },

      '/searches': {
        get: op('Saved searches', 'Saved searches', { responses: { 200: json(arr(obj({ id: str, name: str, filters: obj({}) }))) } }),
        post: op('Saved searches', 'Save a search', { requestBody: body(obj({ name: str, filters: obj({}) }, ['name'])), responses: { 201: json(obj({ id: str, name: str })) } }),
      },
      '/searches/{id}/run': { get: op('Saved searches', 'Run a saved search; new jobs have isNew', { parameters: [pathParam('id'), q('onlyNew', bool)], responses: { 200: json(ref('SearchResult')) } }) },
      '/searches/{id}': { delete: op('Saved searches', 'Delete a saved search', { parameters: [pathParam('id')], responses: { 200: json(obj({ deleted: bool })) } }) },
    },
    components: {
      securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' } },
      schemas: {
        Error: obj({ error: str }, ['error']),
        Match: obj({ jobId: str, score: num, matchedSkills: arr(str), missingSkills: arr(str), titleMatch: bool }),
        Job: obj({
          id: str, source: str, title: str, company: str, location: str, city: str, region: str, remote: bool,
          type: { enum: [...JOB_TYPES, ''] }, category: str, salary: str, salaryMin: { type: ['number', 'null'] }, salaryMax: { type: ['number', 'null'] },
          postedAt: str, description: str, url: str, applyEmail: str, applyPhone: str, applyMethod: str,
          proximity: { enum: ['city', 'region', 'alberta', null] }, match: ref('Match'),
        }),
        Card: { type: 'object', description: `Fields set by deck.cardFields: ${config.deck.cardFields.join(', ')}`, properties: { id: str, title: str, applyUrl: str, reply: obj({ subject: str, message: str }) }, additionalProperties: true },
        Swipe: obj({ jobId: str, direction: { enum: directions }, pile: { enum: piles }, at: str, card: ref('Card') }),
        SearchResult: obj({ total: num, page: num, limit: { oneOf: [num, { const: 'all' }] }, pages: num, sources: arr(obj({ name: str, ok: bool, error: str })), facets: obj({}), jobs: arr(ref('Job')) }),
        KeySettings: obj({
          sources: arr(obj({
            id: str, name: str, url: str, configured: bool,
            fields: arr(obj({ key: str, label: str, secret: bool, required: bool, set: bool, from: { enum: ['settings', 'env', null] }, preview: str, value: str })),
          })),
          active: arr(obj({ name: str, kind: { enum: ['file', 'live'] } })),
          canApplyNow: bool,
        }),
        Settings: obj({ homeCity: str, swipes: arr(obj({ direction: str, pile: str })), cardFields: arr(str), deckSize: num, tones: arr(str), applicationStatuses: arr(str) }),
        Resume: obj({
          name: str, email: str, phone: str, headline: str, summary: str, location: str, skills: arr(str),
          experience: arr(obj({ title: str, company: str, city: str, start: str, end: str, duties: arr(str) })),
          education: arr(obj({ credential: str, school: str, year: str })), certifications: arr(str), availability: str, references: str, links: arr(str), text: str,
        }),
        ResumeFile: obj({ filename: str, contentType: str, size: num, updatedAt: str }),
        Application: obj({ id: str, jobId: str, title: str, company: str, url: str, status: str, message: str, notes: str, createdAt: str, updatedAt: str }),
        EmailResult: obj({ to: str, subject: str, message: str, attachment: str, warning: str, preview: bool, sent: bool, gmailId: str, application: ref('Application') }),
      },
    },
  };
}

module.exports = { buildOpenApi };
