#!/usr/bin/env node
const fetch = require('node-fetch');

const { geocodePlaceWithSearch } = require('../src/utils/placeGeocoding');

function printUsage() {
  console.log(`Usage:
  npm run geocode:trip -- --trip-id <id> [options]

Options:
  --base-url <url>      NOMAD base URL (default: http://127.0.0.1:3000)
  --token <jwt>         Bearer token for authenticated instances
  --dry-run             Preview updates without writing to NOMAD
`);
}

function parseArgs(argv) {
  const result = {
    baseUrl: process.env.NOMAD_BASE_URL || 'http://127.0.0.1:3000',
    dryRun: false,
    token: process.env.NOMAD_TOKEN || null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      result.dryRun = true;
      continue;
    }
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[index + 1];
    result[key] = value;
    index += 1;
  }

  return result;
}

async function apiRequest(baseUrl, path, { method = 'GET', token, body } = {}) {
  const url = new URL(path, baseUrl).toString();
  const headers = {
    Accept: 'application/json',
  };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`API ${method} ${path} failed (${response.status}): ${details}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createPlaceSearch(baseUrl, token) {
  let lastRequestAt = 0;
  let searchSource = null;

  return async function searchPlaces(query) {
    if (searchSource === 'openstreetmap' && lastRequestAt) {
      const waitMs = 1100 - (Date.now() - lastRequestAt);
      if (waitMs > 0) {
        await sleep(waitMs);
      }
    }

    const response = await apiRequest(baseUrl, '/api/maps/search?lang=en', {
      method: 'POST',
      token,
      body: { query },
    });

    lastRequestAt = Date.now();
    searchSource = response.source || searchSource;
    return response.places || [];
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.tripId) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const tripId = Number(args.tripId);
  if (!Number.isInteger(tripId) || tripId <= 0) {
    throw new Error('--trip-id must be a positive integer');
  }

  const placesResponse = await apiRequest(args.baseUrl, `/api/trips/${tripId}/places`, { token: args.token });
  const places = placesResponse.places || [];
  const candidates = places.filter(place => place && (place.lat === null || place.lat === undefined || place.lng === null || place.lng === undefined));
  const searchPlaces = createPlaceSearch(args.baseUrl, args.token);

  const updated = [];
  const skipped = [];

  for (const place of candidates) {
    const geocoded = await geocodePlaceWithSearch(place, searchPlaces);
    if (!geocoded) {
      skipped.push({
        id: place.id,
        name: place.name,
        reason: 'No geocoding match found',
      });
      continue;
    }

    const payload = {
      lat: geocoded.lat,
      lng: geocoded.lng,
      address: geocoded.address || place.address,
      google_place_id: geocoded.google_place_id ?? place.google_place_id ?? null,
      website: geocoded.website ?? place.website ?? null,
    };

    if (!args.dryRun) {
      await apiRequest(args.baseUrl, `/api/trips/${tripId}/places/${place.id}`, {
        method: 'PUT',
        token: args.token,
        body: payload,
      });
    }

    updated.push({
      id: place.id,
      name: place.name,
      query: geocoded.query,
      lat: geocoded.lat,
      lng: geocoded.lng,
      address: payload.address,
    });
  }

  console.log(JSON.stringify({
    tripId,
    baseUrl: args.baseUrl,
    dryRun: args.dryRun,
    totalPlaces: places.length,
    geocodedCandidates: candidates.length,
    updatedCount: updated.length,
    skippedCount: skipped.length,
    updated,
    skipped,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
