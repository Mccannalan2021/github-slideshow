// Sample Alberta jobs so the app can be built and tested without any API keys.
// One Vancouver job is included on purpose: the aggregator should filter it out.
const JOBS = [
  { id: '1', title: 'Warehouse Associate', company: 'Northside Logistics', location: 'Calgary, AB', salary: '$18 - $21 an hour', type: 'Full-time', postedAt: '2026-10-08', contactName: 'Maria Lopez', category: 'Logistics & Warehouse', skills: ['forklift', 'inventory', 'teamwork'], description: 'Pick, pack and ship orders. Forklift experience and inventory accuracy a plus. Teamwork required.' },
  { id: '2', title: 'Customer Service Representative', company: 'BrightPath Insurance', location: 'Remote in Edmonton, AB', salary: '$42,000 a year', type: 'Full-time', postedAt: '2026-10-09', contactName: 'James Carter', category: 'Customer Services', skills: ['customer service', 'communication', 'data entry', 'microsoft office'], description: 'Answer customer calls and emails from home. Strong customer service and communication skills, data entry, Microsoft Office.' },
  { id: '3', title: 'Junior Software Developer', company: 'Lakeview Tech', location: 'Calgary, Alberta', salary: '$70,000 - $85,000 a year', type: 'Full-time', postedAt: '2026-10-10', category: 'IT Jobs', skills: ['javascript', 'react', 'node', 'sql'], description: 'Build web features with JavaScript, React and Node. SQL experience helpful.' },
  { id: '4', title: 'Retail Sales Associate', company: 'Main Street Outfitters', location: 'Red Deer, AB', salary: '$16 - $17 an hour', type: 'Part-time', postedAt: '2026-10-07', category: 'Retail', skills: ['sales', 'cash handling', 'pos', 'customer service'], description: 'Help shoppers, run the POS register and handle cash. Retail sales experience preferred.' },
  { id: '5', title: 'Heavy Equipment Operator', company: 'Athabasca Earthworks', location: 'Fort McMurray, AB', salary: '$38 - $45 an hour', type: 'Full-time', postedAt: '2026-10-06', category: 'Trade & Construction Jobs', skills: ['construction', 'driving', 'teamwork'], description: 'Operate dozers and excavators on oil sands sites. 14 days on, 7 off. Camp provided.' },
  { id: '6', title: 'Licensed Practical Nurse', company: 'Chinook Health Centre', location: 'Lethbridge, AB', salary: '$34 an hour', type: 'Full-time', postedAt: '2026-10-05', category: 'Healthcare & Nursing Jobs', skills: ['nursing', 'cpr', 'communication'], description: 'Provide patient care on a busy medical unit. Current CLPNA registration and CPR required.' },
  { id: '7', title: 'Line Cook', company: 'Bow Valley Lodge', location: 'Banff, AB', salary: '$19 an hour', type: 'Seasonal', postedAt: '2026-10-09', category: 'Hospitality & Catering Jobs', skills: ['cooking', 'teamwork', 'cleaning'], description: 'Seasonal kitchen role for the winter season. Staff housing available.' },
  { id: '8', title: 'Class 1 Truck Driver', company: 'Peace Country Hauling', location: 'Grande Prairie, AB', salary: '$90,000 - $110,000 a year', type: 'Full-time', postedAt: '2026-10-04', category: 'Logistics & Warehouse', skills: ['driving', 'cdl'], description: 'Haul oilfield equipment across northern Alberta. Class 1 licence and clean abstract required.' },
  { id: '9', title: 'Office Administrator', company: 'Prairie Accounting', location: 'Medicine Hat, AB', salary: '$22 - $25 an hour', type: 'Contract', postedAt: '2026-10-10', category: 'Admin Jobs', skills: ['microsoft office', 'data entry', 'scheduling', 'quickbooks'], description: '12-month contract. Reception, scheduling, data entry and QuickBooks bookkeeping support.' },
  { id: '10', title: 'Customer Service Representative', company: 'BrightPath Insurance', location: 'Edmonton, Alberta', salary: '$42,000 a year', type: 'Full-time', postedAt: '2026-10-08', category: 'Customer Services', skills: ['customer service'], description: 'Duplicate of job 2 as another board would list it.' },
  { id: '11', title: 'Barista', company: 'Harbour Coffee', location: 'Vancouver, BC', salary: '$18 an hour', type: 'Part-time', postedAt: '2026-10-10', category: 'Hospitality & Catering Jobs', skills: ['customer service'], description: 'Not in Alberta.' },
];

function createMockProvider({ name = 'mock' } = {}) {
  const withUrl = (j) => ({ ...j, url: `https://example.com/jobs/${j.id}` });

  return {
    name,
    async searchJobs({ query = '', limit = 50, page = 1 }) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = JOBS.filter((j) => {
        const hay = `${j.title} ${j.company} ${j.description} ${j.category}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      });
      const start = (page - 1) * limit;
      return { total: hits.length, jobs: hits.slice(start, start + limit).map(withUrl) };
    },
    async getJob(id) {
      const job = JOBS.find((j) => j.id === id);
      return job ? withUrl(job) : null;
    },
  };
}

module.exports = { createMockProvider };
