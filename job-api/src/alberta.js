// Alberta geography: communities grouped into Statistics Canada's eight Alberta economic regions.
const REGIONS = {
  'Calgary': ['Calgary', 'Airdrie', 'Cochrane', 'Chestermere', 'Okotoks', 'High River', 'Strathmore', 'Crossfield', 'Black Diamond', 'Turner Valley', 'Didsbury', 'Carstairs'],
  'Edmonton': ['Edmonton', 'St. Albert', 'Sherwood Park', 'Spruce Grove', 'Stony Plain', 'Leduc', 'Nisku', 'Fort Saskatchewan', 'Beaumont', 'Morinville', 'Devon', 'Gibbons', 'Bon Accord', 'Redwater', 'Acheson', 'Strathcona County', 'Parkland County'],
  'Red Deer': ['Red Deer', 'Red Deer County', 'Springbrook', 'Sylvan Lake', 'Lacombe', 'Blackfalds', 'Innisfail', 'Penhold', 'Olds', 'Ponoka', 'Bowden', 'Sundre'],
  'Lethbridge–Medicine Hat': ['Lethbridge', 'Medicine Hat', 'Brooks', 'Taber', 'Coaldale', 'Cardston', 'Pincher Creek', 'Fort Macleod', 'Claresholm', 'Redcliff', 'Raymond', 'Picture Butte', 'Vulcan', 'Crowsnest Pass'],
  'Banff–Jasper–Rocky Mountain House': ['Banff', 'Canmore', 'Jasper', 'Hinton', 'Edson', 'Rocky Mountain House', 'Lake Louise', 'Drayton Valley', 'Whitecourt'],
  'Camrose–Drumheller': ['Camrose', 'Drumheller', 'Wetaskiwin', 'Stettler', 'Vegreville', 'Vermilion', 'Wainwright', 'Hanna', 'Tofield', 'Killam', 'Three Hills', 'Provost'],
  'Wood Buffalo–Cold Lake': ['Fort McMurray', 'Wood Buffalo', 'Cold Lake', 'Bonnyville', 'Lac La Biche', 'St. Paul', 'Lloydminster', 'Elk Point', 'Fort Chipewyan'],
  'Athabasca–Grande Prairie–Peace River': ['Grande Prairie', 'Peace River', 'Slave Lake', 'Athabasca', 'Westlock', 'Barrhead', 'High Level', 'Grande Cache', 'Fox Creek', 'Valleyview', 'Fairview', 'Sexsmith', 'Beaverlodge', 'Wembley', 'Manning', 'High Prairie', 'Swan Hills', 'Boyle'],
};

const CITIES = Object.entries(REGIONS).flatMap(([region, cities]) => cities.map((name) => ({ name, region })));

const OTHER_PROVINCES = /\b(british columbia|saskatchewan|manitoba|ontario|quebec|québec|nova scotia|new brunswick|newfoundland|prince edward island|yukon|nunavut|northwest territories|BC|SK|MB|ON|QC|NS|NB|NL|PE|PEI|YT|NU|NT)\b/;

const norm = (s) => String(s || '').toLowerCase().replace(/[.]/g, '').replace(/\s+/g, ' ').trim();

function findCity(location) {
  const loc = ` ${norm(location)} `;
  // Longest names first so "Sherwood Park" wins over shorter partial matches.
  return [...CITIES]
    .sort((a, b) => b.name.length - a.name.length)
    .find((c) => new RegExp(`[^a-z]${norm(c.name).replace(/[-]/g, '\\-')}[^a-z]`).test(loc)) || null;
}

function isAlberta(location) {
  const text = String(location || '');
  if (/\balberta\b/i.test(text) || /(^|[\s,(])AB(\b|$)/.test(text)) return true;
  if (OTHER_PROVINCES.test(text) || OTHER_PROVINCES.test(text.toLowerCase())) return false;
  return Boolean(findCity(text));
}

function lookupCity(name) {
  const n = norm(name);
  return CITIES.find((c) => norm(c.name) === n) || null;
}

function lookupRegion(name) {
  const n = norm(name);
  return Object.keys(REGIONS).find((r) => norm(r) === n || norm(r).split(/[–-]/).some((part) => part.trim() === n)) || null;
}

module.exports = { REGIONS, CITIES, findCity, isAlberta, lookupCity, lookupRegion };
