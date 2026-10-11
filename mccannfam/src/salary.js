// Turns salary text or min/max numbers into annual CAD so jobs can be filtered and sorted by pay.
const HOURS_PER_YEAR = 2080;
const MULTIPLIER = { hour: HOURS_PER_YEAR, day: 260, week: 52, month: 12, year: 1 };

function detectPeriod(text, amount) {
  const t = String(text || '').toLowerCase();
  if (/hour|hr\b|hourly|\/h\b/.test(t)) return 'hour';
  if (/\bday\b|daily/.test(t)) return 'day';
  if (/week/.test(t)) return 'week';
  if (/month/.test(t)) return 'month';
  if (/year|annual|annum|\/yr|salary/.test(t)) return 'year';
  return amount && amount < 200 ? 'hour' : 'year';
}

function parseAmounts(text) {
  return [...String(text || '').replace(/,/g, '').matchAll(/(\d+(?:\.\d+)?)\s*(k)?/gi)]
    .map((m) => Number(m[1]) * (m[2] ? 1000 : 1))
    .filter((n) => n >= 5);
}

// Returns { salaryMin, salaryMax } in annual CAD, or nulls when nothing usable is present.
function normalizeSalary({ text = '', min, max, period } = {}) {
  let lo = Number(min) || null;
  let hi = Number(max) || null;
  if (!lo && !hi) {
    const amounts = parseAmounts(text);
    if (!amounts.length) return { salaryMin: null, salaryMax: null };
    lo = Math.min(...amounts);
    hi = Math.max(...amounts);
  }
  lo = lo || hi;
  hi = hi || lo;
  const mult = MULTIPLIER[period || detectPeriod(text, lo)];
  return { salaryMin: Math.round(lo * mult), salaryMax: Math.round(hi * mult) };
}

module.exports = { normalizeSalary, HOURS_PER_YEAR };
