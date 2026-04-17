const { cleanCell } = require('./googleSheetImport');

const STOP_WORDS = new Set([
  'the',
  'and',
  'hotel',
  'hotels',
  'airbnb',
  'ryokan',
  'lodge',
  'guest',
  'guesthouse',
  'house',
  'mount',
  'mountain',
  'apartment',
  'apartments',
  'villa',
  'hostel',
]);

function normalizeSearchText(value = '') {
  return cleanCell(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .toLowerCase()
    .replace(/\btokio\b/g, 'tokyo')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value = '') {
  return normalizeSearchText(value)
    .split(' ')
    .filter(token => token && token.length >= 3 && !STOP_WORDS.has(token));
}

function getLocationTokens(place = {}) {
  const importedLocation = extractImportedStayLocation(place.description);
  return tokenize([place.address, importedLocation].filter(Boolean).join(' '));
}

function extractImportedStayLocation(description = '') {
  const match = String(description || '').match(/Imported stay location:\s*(.+)$/i);
  return match ? cleanCell(match[1]) : null;
}

function simplifyPlaceName(name = '') {
  const cleaned = cleanCell(name)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .trim();
  return cleaned;
}

function dedupeQueries(values) {
  const seen = new Set();
  const queries = [];

  for (const value of values) {
    const cleaned = cleanCell(value);
    if (!cleaned) continue;
    const key = normalizeSearchText(cleaned);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    queries.push(cleaned);
  }

  return queries;
}

function buildGeocodeQueries(place = {}) {
  const name = cleanCell(place.name);
  const simplifiedName = simplifyPlaceName(name);
  const address = cleanCell(place.address);
  const importedLocation = extractImportedStayLocation(place.description);
  const fallbackLocation = importedLocation || address;

  return dedupeQueries([
    [name, address].filter(Boolean).join(', '),
    [simplifiedName, address].filter(Boolean).join(', '),
    [name, fallbackLocation].filter(Boolean).join(', '),
    [simplifiedName, fallbackLocation].filter(Boolean).join(', '),
    address,
    fallbackLocation,
    simplifiedName,
    name,
  ]);
}

function scoreMapResult(result, place = {}) {
  const haystack = normalizeSearchText(`${result.name || ''} ${result.address || ''}`);
  const importedLocation = extractImportedStayLocation(place.description);
  const locationTokens = getLocationTokens(place);
  const nameTokens = tokenize(`${simplifyPlaceName(place.name)} ${importedLocation || ''}`);

  let locationMatches = 0;
  let nameMatches = 0;
  let score = 0;
  for (const token of locationTokens) {
    if (haystack.includes(token)) {
      locationMatches += 1;
      score += 4;
    }
  }
  for (const token of nameTokens) {
    if (haystack.includes(token)) {
      nameMatches += 1;
      score += 2;
    }
  }
  if (result.google_place_id) score += 1;
  return {
    locationMatches,
    nameMatches,
    score,
  };
}

function pickBestGeocodeResult(results = [], query = '', place = {}) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const locationTokens = getLocationTokens(place);

  const locationOnlyValues = [
    cleanCell(place.address),
    extractImportedStayLocation(place.description),
  ]
    .filter(Boolean)
    .map(normalizeSearchText);
  const isLocationOnlyQuery = locationOnlyValues.includes(normalizeSearchText(query));

  const scored = results
    .filter(result => result && result.lat !== null && result.lng !== null && result.lat !== undefined && result.lng !== undefined)
    .map(result => ({
      result,
      ...scoreMapResult(result, place),
    }))
    .sort((a, b) => {
      if (b.locationMatches !== a.locationMatches) return b.locationMatches - a.locationMatches;
      if (b.score !== a.score) return b.score - a.score;
      return b.nameMatches - a.nameMatches;
    });

  if (scored.length === 0) return null;
  const ranked = !isLocationOnlyQuery && locationTokens.length > 0
    ? scored.filter(result => result.locationMatches > 0)
    : scored;

  if (ranked.length === 0) {
    return isLocationOnlyQuery ? scored[0].result : null;
  }

  if (ranked[0].score > 0) return ranked[0].result;
  return isLocationOnlyQuery ? scored[0].result : null;
}

async function geocodePlaceWithSearch(place, searchFn) {
  const queries = buildGeocodeQueries(place);

  for (const query of queries) {
    const results = await searchFn(query);
    const match = pickBestGeocodeResult(results, query, place);
    if (match) {
      return {
        query,
        ...match,
      };
    }
  }

  return null;
}

module.exports = {
  buildGeocodeQueries,
  extractImportedStayLocation,
  geocodePlaceWithSearch,
  normalizeSearchText,
  pickBestGeocodeResult,
  simplifyPlaceName,
};
