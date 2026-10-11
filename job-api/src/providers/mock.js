// Sample jobs so the app can be built and tested without Indeed credentials.
const JOBS = [
  {
    id: 'mock-1', title: 'Warehouse Associate', company: 'Northside Logistics', location: 'Dallas, TX',
    salary: '$18 - $21 an hour', type: 'Full-time', postedAt: '2026-10-08', contactName: 'Maria Lopez',
    skills: ['forklift', 'inventory', 'teamwork'],
    description: 'Pick, pack and ship orders. Forklift experience and inventory accuracy a plus. Teamwork required.',
  },
  {
    id: 'mock-2', title: 'Customer Service Representative', company: 'BrightPath Insurance', location: 'Remote',
    salary: '$42,000 a year', type: 'Full-time', postedAt: '2026-10-09', contactName: 'James Carter',
    skills: ['customer service', 'communication', 'data entry', 'microsoft office'],
    description: 'Answer customer calls and emails. Strong customer service and communication skills, data entry, Microsoft Office.',
  },
  {
    id: 'mock-3', title: 'Junior Software Developer', company: 'Lakeview Tech', location: 'Austin, TX',
    salary: '$70,000 - $85,000 a year', type: 'Full-time', postedAt: '2026-10-10',
    skills: ['javascript', 'react', 'node', 'sql'],
    description: 'Build web features with JavaScript, React and Node. SQL experience helpful.',
  },
  {
    id: 'mock-4', title: 'Retail Sales Associate', company: 'Main Street Outfitters', location: 'Dallas, TX',
    salary: '$15 - $17 an hour', type: 'Part-time', postedAt: '2026-10-07',
    skills: ['sales', 'cash handling', 'pos', 'customer service'],
    description: 'Help shoppers, run the POS register and handle cash. Retail sales experience preferred.',
  },
];

function createMockProvider() {
  const withUrl = (j) => ({ ...j, url: `https://www.indeed.com/viewjob?jk=${j.id}`, source: 'mock' });

  return {
    name: 'mock',
    async searchJobs({ query = '', location = '', page = 1, limit = 20 }) {
      const q = query.toLowerCase();
      const loc = location.toLowerCase();
      const hits = JOBS.filter((j) =>
        (!q || `${j.title} ${j.company} ${j.description}`.toLowerCase().includes(q)) &&
        (!loc || j.location.toLowerCase().includes(loc)));
      const start = (page - 1) * limit;
      return { total: hits.length, page, jobs: hits.slice(start, start + limit).map(withUrl) };
    },
    async getJob(id) {
      const job = JOBS.find((j) => j.id === id);
      return job ? withUrl(job) : null;
    },
  };
}

module.exports = { createMockProvider };
