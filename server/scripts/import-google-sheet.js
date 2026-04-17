#!/usr/bin/env node
const fetch = require('node-fetch');

const {
  buildPackingImport,
  buildPlanImport,
  extractSheetTabsFromHtml,
  extractSpreadsheetId,
  extractSpreadsheetTitle,
  findSheetTab,
  parseCsv,
} = require('../src/utils/googleSheetImport');

function printUsage() {
  console.log(`Usage:
  npm run import:sheet -- --sheet <google-sheet-url> [options]

Options:
  --base-url <url>      NOMAD base URL (default: http://127.0.0.1:3000)
  --token <jwt>         Bearer token for authenticated instances
  --trip-title <title>  Override the imported trip title
  --currency <code>     Trip currency (default: EUR)
  --plan-gid <gid>      Override the itinerary sheet gid
  --packing-gid <gid>   Override the packing sheet gid
  --dry-run             Parse and summarize without writing to NOMAD
`);
}

function parseArgs(argv) {
  const result = {
    baseUrl: process.env.NOMAD_BASE_URL || 'http://127.0.0.1:3000',
    currency: 'EUR',
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

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url} (${response.status})`);
  }
  return response.text();
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

function buildExportUrl(spreadsheetId, gid) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
}

function summarizeImport(tripTitle, planImport, packingItems, resolvedSheets) {
  return {
    tripTitle,
    dateRange: `${planImport.startDate} -> ${planImport.endDate}`,
    days: planImport.days.length,
    reservations: planImport.days.reduce((sum, day) => sum + day.reservations.length, 0),
    dayNotes: planImport.days.reduce((sum, day) => sum + day.dayNotes.length, 0),
    accommodations: planImport.accommodations.length,
    packingItems: packingItems.length,
    sheets: resolvedSheets,
    preview: {
      firstDay: planImport.days[0],
      firstAccommodation: planImport.accommodations[0] || null,
      firstPackingItems: packingItems.slice(0, 5),
    },
  };
}

async function ensureTrip(baseUrl, token, tripTitle, currency, sheetUrl, planImport) {
  const response = await apiRequest(baseUrl, '/api/trips', {
    method: 'POST',
    token,
    body: {
      title: tripTitle,
      description: `Imported from Google Sheets: ${sheetUrl}`,
      start_date: planImport.startDate,
      end_date: planImport.endDate,
      currency,
    },
  });
  return response.trip;
}

async function loadDaysByDate(baseUrl, token, tripId) {
  const response = await apiRequest(baseUrl, `/api/trips/${tripId}/days`, { token });
  return new Map((response.days || []).filter(day => day.date).map(day => [day.date, day]));
}

async function importPlan(baseUrl, token, tripId, planImport) {
  const dayByDate = await loadDaysByDate(baseUrl, token, tripId);
  const placeIdByKey = new Map();

  for (const day of planImport.days) {
    const targetDay = dayByDate.get(day.date);
    if (!targetDay) {
      throw new Error(`Generated day not found for ${day.date}`);
    }

    if (day.title) {
      await apiRequest(baseUrl, `/api/trips/${tripId}/days/${targetDay.id}`, {
        method: 'PUT',
        token,
        body: { title: day.title },
      });
    }

    for (const note of day.dayNotes) {
      await apiRequest(baseUrl, `/api/trips/${tripId}/days/${targetDay.id}/notes`, {
        method: 'POST',
        token,
        body: note,
      });
    }

    for (const reservation of day.reservations) {
      await apiRequest(baseUrl, `/api/trips/${tripId}/reservations`, {
        method: 'POST',
        token,
        body: {
          ...reservation,
          day_id: targetDay.id,
        },
      });
    }
  }

  for (const stay of planImport.accommodations) {
    const startDay = dayByDate.get(stay.startDate);
    const endDay = dayByDate.get(stay.endDate);
    if (!startDay || !endDay) {
      throw new Error(`Accommodation days missing for ${stay.place.name}`);
    }

    const placeKey = `${stay.place.name}|${stay.place.address || ''}`;
    let placeId = placeIdByKey.get(placeKey);

    if (!placeId) {
      const placeResponse = await apiRequest(baseUrl, `/api/trips/${tripId}/places`, {
        method: 'POST',
        token,
        body: {
          name: stay.place.name,
          address: stay.place.address,
          description: stay.place.location ? `Imported stay location: ${stay.place.location}` : null,
        },
      });
      placeId = placeResponse.place.id;
      placeIdByKey.set(placeKey, placeId);
    }

    await apiRequest(baseUrl, `/api/trips/${tripId}/accommodations`, {
      method: 'POST',
      token,
      body: {
        place_id: placeId,
        start_day_id: startDay.id,
        end_day_id: endDay.id,
        confirmation: stay.confirmation_number || null,
        notes: stay.notes || null,
      },
    });
  }
}

async function importPacking(baseUrl, token, tripId, packingItems) {
  for (const item of packingItems) {
    await apiRequest(baseUrl, `/api/trips/${tripId}/packing`, {
      method: 'POST',
      token,
      body: item,
    });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.sheet) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const spreadsheetId = extractSpreadsheetId(args.sheet);
  if (!spreadsheetId) {
    throw new Error('Could not extract a Google Sheets document ID from --sheet');
  }

  const editUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  const html = await fetchText(editUrl);
  const tabs = extractSheetTabsFromHtml(html);
  const planTab = args.planGid
    ? { gid: String(args.planGid), name: 'Plan' }
    : findSheetTab(tabs, ['plan', 'itinerary']);
  const packingTab = args.packingGid
    ? { gid: String(args.packingGid), name: 'Packliste' }
    : findSheetTab(tabs, ['packliste', 'packing', 'packing list']);

  if (!planTab) {
    throw new Error('Could not find a Plan/itinerary sheet tab. Pass --plan-gid to override.');
  }

  const planCsv = await fetchText(buildExportUrl(spreadsheetId, planTab.gid));
  const planImport = buildPlanImport(parseCsv(planCsv));

  let packingItems = [];
  if (packingTab) {
    const packingCsv = await fetchText(buildExportUrl(spreadsheetId, packingTab.gid));
    packingItems = buildPackingImport(parseCsv(packingCsv));
  }

  const tripTitle = args.tripTitle || extractSpreadsheetTitle(html) || `Imported trip ${new Date().toISOString().slice(0, 10)}`;
  const summary = summarizeImport(tripTitle, planImport, packingItems, {
    plan: planTab,
    packing: packingTab,
  });

  if (args.dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const trip = await ensureTrip(args.baseUrl, args.token, tripTitle, args.currency || 'EUR', args.sheet, planImport);
  await importPlan(args.baseUrl, args.token, trip.id, planImport);
  await importPacking(args.baseUrl, args.token, trip.id, packingItems);

  console.log(JSON.stringify({
    ...summary,
    createdTrip: {
      id: trip.id,
      title: trip.title,
    },
    baseUrl: args.baseUrl,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
