// Normalizes resume input. Accepts structured JSON, or { text } for a pasted plain-text resume.
const KNOWN_SKILLS = [
  'javascript', 'typescript', 'node', 'react', 'python', 'java', 'sql', 'aws', 'docker', 'kubernetes',
  'excel', 'customer service', 'sales', 'forklift', 'warehouse', 'inventory', 'cash handling', 'pos',
  'project management', 'communication', 'leadership', 'scheduling', 'data entry', 'microsoft office',
  'quickbooks', 'marketing', 'social media', 'nursing', 'cpr', 'driving', 'cdl', 'retail', 'cooking',
  'cleaning', 'construction', 'electrical', 'plumbing', 'welding', 'teamwork', 'spanish', 'bilingual',
];

function extractSkills(text) {
  const lower = ` ${text.toLowerCase()} `;
  return KNOWN_SKILLS.filter((s) => new RegExp(`[^a-z]${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^a-z]`).test(lower));
}

// Keeps only well-formed list entries, so one bad item can't break matching later.
const clean = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
const strings = (list) => (Array.isArray(list) ? list.map(clean).filter(Boolean) : []);
function entries(list, required, fields) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((e) => e && typeof e === 'object' && !Array.isArray(e) && clean(e[required]))
    .map((e) => {
      const out = {};
      for (const f of fields) if (e[f] !== undefined) out[f] = f === 'duties' ? strings(e[f]) : clean(e[f]);
      return out;
    });
}

function normalizeResume(input) {
  if (!input || typeof input !== 'object') throw new Error('Resume must be a JSON object');

  const text = typeof input.text === 'string' ? input.text : '';
  const firstLine = text.split('\n').map((l) => l.trim()).find(Boolean) || '';
  const email = input.email || (text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0] || '';
  const phone = input.phone || (text.match(/\+?\(?\d[\d\s().-]{8,}\d/) || [])[0] || '';

  const skills = strings(input.skills).length ? strings(input.skills) : extractSkills(text);

  const resume = {
    name: input.name || firstLine,
    email,
    phone: phone.trim(),
    headline: input.headline || '',
    summary: input.summary || '',
    location: input.location || '',
    skills: [...new Set(skills.map((s) => s.trim()).filter(Boolean))],
    experience: entries(input.experience, 'title', ['title', 'company', 'city', 'start', 'end', 'duties']),
    education: entries(input.education, 'credential', ['credential', 'school', 'year']),
    certifications: strings(input.certifications),
    availability: input.availability || '',
    references: input.references || '',
    links: strings(input.links),
    text,
  };

  if (!resume.name) throw new Error('Resume needs a "name" (or a "text" whose first line is your name)');
  return resume;
}

module.exports = { normalizeResume, extractSkills };
