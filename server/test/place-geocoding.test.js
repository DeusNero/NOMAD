const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildGeocodeQueries,
  geocodePlaceWithSearch,
  pickBestGeocodeResult,
} = require('../src/utils/placeGeocoding');

const hanarePlace = {
  name: 'Hotel Hanare (Ryokan), Ueno',
  address: 'Tokio',
  description: 'Imported stay location: Tokio',
};

test('buildGeocodeQueries uses hotel-plus-location queries before city fallback', () => {
  const queries = buildGeocodeQueries(hanarePlace);

  assert.equal(queries[0], 'Hotel Hanare (Ryokan), Ueno, Tokio');
  assert.equal(queries[1], 'Hotel Hanare, Ueno, Tokio');
  assert.ok(queries.includes('Tokio'));
  assert.ok(queries.includes('Hotel Hanare, Ueno'));
});

test('pickBestGeocodeResult rejects wrong-city hotel matches when a location is known', () => {
  const match = pickBestGeocodeResult([
    {
      name: 'HOTEL KII TANABE HANARE',
      address: 'Tanabe, Wakayama, Japan',
      lat: 33.73,
      lng: 135.37,
    },
    {
      name: 'Tokyo',
      address: 'Tokyo, Japan',
      lat: 35.68,
      lng: 139.76,
    },
  ], 'Hotel Hanare (Ryokan), Ueno, Tokio', hanarePlace);

  assert.deepEqual(match, {
    name: 'Tokyo',
    address: 'Tokyo, Japan',
    lat: 35.68,
    lng: 139.76,
  });
});

test('pickBestGeocodeResult allows city fallback when the query is location-only', () => {
  const match = pickBestGeocodeResult([
    {
      name: 'Amami',
      address: 'Amami, Kagoshima, Japan',
      lat: 28.38,
      lng: 129.49,
    },
  ], 'Amami', {
    name: 'Airbnb Amami',
    address: 'Amami',
    description: 'Imported stay location: Amami',
  });

  assert.deepEqual(match, {
    name: 'Amami',
    address: 'Amami, Kagoshima, Japan',
    lat: 28.38,
    lng: 129.49,
  });
});

test('geocodePlaceWithSearch falls back to location queries when venue queries fail', async () => {
  const seenQueries = [];
  const match = await geocodePlaceWithSearch(hanarePlace, async query => {
    seenQueries.push(query);
    if (query === 'Tokio') {
      return [{
        name: 'Tokyo',
        address: 'Tokyo, Japan',
        lat: 35.68,
        lng: 139.76,
      }];
    }

    return [{
      name: 'HOTEL KII TANABE HANARE',
      address: 'Tanabe, Wakayama, Japan',
      lat: 33.73,
      lng: 135.37,
    }];
  });

  assert.deepEqual(seenQueries.slice(0, 3), [
    'Hotel Hanare (Ryokan), Ueno, Tokio',
    'Hotel Hanare, Ueno, Tokio',
    'Tokio',
  ]);
  assert.equal(match.query, 'Tokio');
  assert.equal(match.name, 'Tokyo');
});
