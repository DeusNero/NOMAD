function stripBom(text = '') {
  return String(text).replace(/^\uFEFF/, '');
}

function cleanCell(value = '') {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00A0/g, ' ')
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .trim();
}

function collapseWhitespace(value = '') {
  return cleanCell(value)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ');
}

function parseCsv(text, delimiter = ',') {
  const rows = [];
  const input = stripBom(text);
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (next === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === delimiter) {
      row.push(field);
      field = '';
      continue;
    }

    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    if (char === '\r') {
      if (next === '\n') continue;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function extractSpreadsheetId(input) {
  const match = String(input || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

function decodeHtmlEntities(value = '') {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function extractSpreadsheetTitle(html = '') {
  const match = String(html).match(/<title>(.*?) - Google Sheets<\/title>/i);
  return match ? decodeHtmlEntities(match[1].trim()) : null;
}

function extractSheetTabsFromHtml(html = '') {
  const tabs = [];
  const seen = new Set();
  const regex = /\[\d+,0,\\"([^"]+)\\",\[\{\\"1\\":\[\[0,0,\\"([^"]+)\\"/g;
  let match = regex.exec(String(html));

  while (match) {
    const gid = match[1];
    const rawName = match[2];
    const name = decodeHtmlEntities(rawName.replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
    const key = `${gid}:${name}`;
    if (!seen.has(key)) {
      tabs.push({ gid, name });
      seen.add(key);
    }
    match = regex.exec(String(html));
  }

  return tabs;
}

function normalizeSheetName(name = '') {
  return cleanCell(name)
    .replace(/\s+/g, ' ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function findSheetTab(tabs, candidates) {
  const normalizedCandidates = (candidates || []).map(normalizeSheetName);
  return (tabs || []).find(tab => normalizedCandidates.includes(normalizeSheetName(tab.name))) || null;
}

function parseDateCell(value) {
  const text = cleanCell(value);
  if (!text) return null;

  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    return `${match[3]}-${month}-${day}`;
  }

  return null;
}

function isoToUtcDate(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`);
}

function isNextDay(previousIsoDate, nextIsoDate) {
  if (!previousIsoDate || !nextIsoDate) return false;
  const diffMs = isoToUtcDate(nextIsoDate).getTime() - isoToUtcDate(previousIsoDate).getTime();
  return diffMs === 24 * 60 * 60 * 1000;
}

function splitLines(value = '') {
  return cleanCell(value)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function extractConfirmationCode(text = '') {
  const match = String(text).match(/(?:booking\s*ref|conf(?:irmation)?\.?#?|confirmation(?:\s*number)?)[^A-Z0-9]*([A-Z0-9-]{4,})/i);
  return match ? match[1] : null;
}

function classifyReservationType(text = '') {
  const value = normalizeSheetName(text);
  if (!value) return 'other';
  if (/(flight|flug|airline| swiss\b| ana\b|japan airlines|haneda|zurich|zürich)/.test(value)) return 'flight';
  if (/(train|zug|shinkansen)/.test(value)) return 'train';
  if (/(rental car|rent-a-car|car return|driving|mietwagen|orix)/.test(value)) return 'car';
  if (/(boat|ferry|queen zamami|ship)/.test(value)) return 'cruise';
  if (/(tour|gyg|getyourguide)/.test(value)) return 'tour';
  if (/(hotel|airbnb|ryokan|lodge)/.test(value)) return 'hotel';
  if (/(dinner|restaurant)/.test(value)) return 'restaurant';
  return 'other';
}

function determineReservationStatus(text = '') {
  const value = normalizeSheetName(text);
  if (!value) return 'pending';
  if (/(tbd|vor ort|vor ort kaufen|kaufen|book .* in advance)/.test(value)) return 'pending';
  if (/(booking\s*ref|conf(?:irmation)?\.?#?|booked|getyourguide|gyg)/.test(value)) return 'confirmed';
  return 'pending';
}

function extractTimeRange(text = '') {
  const match = String(text).match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})(\s*\(\+1\))?/i);
  if (!match) return { startTime: null, endTime: null, endOffsetDays: 0 };
  return {
    startTime: match[1],
    endTime: match[2],
    endOffsetDays: match[3] ? 1 : 0,
  };
}

function addDays(isoDate, count) {
  const base = isoToUtcDate(isoDate);
  base.setUTCDate(base.getUTCDate() + count);
  return base.toISOString().slice(0, 10);
}

function isAccommodationPlaceholder(hotelName = '', overnightLocation = '') {
  const combined = normalizeSheetName(`${hotelName} ${overnightLocation}`);
  if (!combined) return true;
  return /(flugzeug|flight|home\b|flug nach|direktflug)/.test(combined);
}

function parseAccommodationPlace(hotelName = '', overnightLocation = '') {
  const normalizedHotel = cleanCell(hotelName);
  const lines = splitLines(normalizedHotel);

  let name = lines[0] || normalizedHotel;
  let address = lines.slice(1).join(', ');

  if (!address) {
    const parenMatch = name.match(/^(.*?)\s*\((.+)\)$/);
    if (parenMatch) {
      name = parenMatch[1].trim();
      address = parenMatch[2].trim();
    }
  }

  name = collapseWhitespace(name);
  address = collapseWhitespace(address);
  const location = collapseWhitespace(overnightLocation);

  return {
    name,
    address: address || location || null,
    location: location || null,
  };
}

function isRouteContinuationLine(line = '') {
  return /^(booking\s*ref|conf(?:irmation)?\.?#?|confirmation|arrival|departure)/i.test(line);
}

function looksLikeAccommodationRouteLine(line = '', hotelName = '') {
  if (!hotelName) return false;
  const normalizedLine = normalizeSheetName(line);
  return /(airbnb|hotel|ryokan|lodge)/.test(normalizedLine);
}

function splitRouteEntries(routeText = '', hotelName = '') {
  const lines = splitLines(routeText);
  const reservationEntries = [];
  const accommodationLines = [];
  let current = null;

  for (const line of lines) {
    if (current && isRouteContinuationLine(line)) {
      current += `\n${line}`;
      continue;
    }

    if (looksLikeAccommodationRouteLine(line, hotelName)) {
      accommodationLines.push(line);
      continue;
    }

    if (current) reservationEntries.push(current);
    current = line;
  }

  if (current) reservationEntries.push(current);

  return { reservationEntries, accommodationLines };
}

function createReservationFromEntry(entry, date, fallbackLocation) {
  const cleaned = cleanCell(entry);
  if (!cleaned) return null;

  const { startTime, endTime, endOffsetDays } = extractTimeRange(cleaned);
  const confirmationNumber = extractConfirmationCode(cleaned);
  const notes = cleaned;
  let title = splitLines(cleaned)[0] || cleaned;
  title = title.replace(/\s*(?:booking\s*ref|conf(?:irmation)?\.?#?|confirmation(?:\s*number)?).*/i, '').trim() || title;

  return {
    title,
    type: classifyReservationType(cleaned),
    status: determineReservationStatus(cleaned),
    reservation_time: startTime ? `${date}T${startTime}` : date,
    reservation_end_time: endTime || null,
    reservation_end_date: endOffsetDays > 0 ? addDays(date, endOffsetDays) : date,
    location: collapseWhitespace(fallbackLocation) || null,
    confirmation_number: confirmationNumber,
    notes,
  };
}

function createNoteEntry(text, icon) {
  const cleaned = cleanCell(text);
  if (!cleaned) return null;
  return {
    icon,
    text: cleaned,
  };
}

function findHeaderRow(rows, requiredHeader) {
  const required = normalizeSheetName(requiredHeader);
  return (rows || []).findIndex(row => row.some(cell => normalizeSheetName(cell) === required));
}

function buildPlanImport(rows) {
  const headerIndex = findHeaderRow(rows, 'Datum');
  if (headerIndex === -1) {
    throw new Error('Plan sheet header row not found');
  }

  const headers = rows[headerIndex].map(normalizeSheetName);
  const indexByHeader = Object.fromEntries(headers.map((header, index) => [header, index]));

  const parsedDays = [];
  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    const date = parseDateCell(row[indexByHeader.datum]);
    if (!date) continue;

    const overnightLocation = cleanCell(row[indexByHeader['ort der ubernachtung']] ?? row[indexByHeader['ort der \n ubernachtung']]);
    const hotelName = cleanCell(row[indexByHeader['hotel name']]);
    const route = cleanCell(row[indexByHeader['reiseroute (zugfahrten/fluge, mietwagen)']] ?? row[indexByHeader['reiseroute (zugfahrten/flüge, mietwagen)']]);
    const activities = cleanCell(row[indexByHeader['mogliche aktivitaten']] ?? row[indexByHeader['mögliche aktivitäten']]);
    const openPoints = cleanCell(row[indexByHeader['offene punkte']]);
    const cost = cleanCell(row[indexByHeader['kosten fur 2 personen']] ?? row[indexByHeader['kosten für 2 personen']]);
    const comments = cleanCell(row[indexByHeader.kommentare]);

    const { reservationEntries, accommodationLines } = splitRouteEntries(route, hotelName);
    const reservations = reservationEntries
      .map(entry => createReservationFromEntry(entry, date, overnightLocation))
      .filter(Boolean);

    const dayNotes = [
      createNoteEntry(activities, '📍'),
      createNoteEntry(openPoints, '❗'),
      createNoteEntry(comments, '💬'),
      cost ? createNoteEntry(`Kosten für 2 Personen: ${cost}`, '💸') : null,
    ].filter(Boolean);

    parsedDays.push({
      date,
      title: overnightLocation || null,
      overnightLocation,
      hotelName,
      route,
      activities,
      openPoints,
      cost,
      comments,
      reservations,
      accommodationLines,
      dayNotes,
    });
  }

  if (parsedDays.length === 0) {
    throw new Error('No dated rows found in plan sheet');
  }

  const accommodations = [];
  let currentStay = null;

  for (const day of parsedDays) {
    if (isAccommodationPlaceholder(day.hotelName, day.overnightLocation)) {
      currentStay = null;
      continue;
    }

    const place = parseAccommodationPlace(day.hotelName, day.overnightLocation);
    const stayKey = `${place.name}|${place.address || ''}`;
    const confirmationNumber = extractConfirmationCode(day.accommodationLines.join('\n'));
    const notes = day.accommodationLines.length > 0 ? day.accommodationLines.join('\n') : null;

    if (
      currentStay
      && currentStay.key === stayKey
      && isNextDay(currentStay.endDate, day.date)
    ) {
      currentStay.endDate = day.date;
      if (!currentStay.confirmation_number && confirmationNumber) {
        currentStay.confirmation_number = confirmationNumber;
      }
      if (notes) {
        currentStay.notes = currentStay.notes ? `${currentStay.notes}\n${notes}` : notes;
      }
      continue;
    }

    currentStay = {
      key: stayKey,
      startDate: day.date,
      endDate: day.date,
      place,
      confirmation_number: confirmationNumber,
      notes,
    };
    accommodations.push(currentStay);
  }

  return {
    startDate: parsedDays[0].date,
    endDate: parsedDays[parsedDays.length - 1].date,
    days: parsedDays,
    accommodations: accommodations.map(({ key, ...stay }) => stay),
  };
}

function looksLikePackingHeaderRow(row = []) {
  const normalized = row.map(normalizeSheetName);
  return normalized.filter(value => value === 'anz.' || value === 'comments').length >= 2;
}

function isPackingCategoryHeader(item, quantity, comments) {
  return Boolean(cleanCell(item))
    && normalizeSheetName(quantity) === 'anz.'
    && normalizeSheetName(comments) === 'comments';
}

function formatPackingItemName(name, quantity, comments) {
  const parts = [cleanCell(name)];
  const qty = cleanCell(quantity);
  const note = cleanCell(comments);

  if (qty) parts[0] += ` (${qty})`;
  if (note) parts.push(note);

  return parts.filter(Boolean).join(' - ');
}

function buildPackingImport(rows) {
  const headerIndex = rows.findIndex(looksLikePackingHeaderRow);
  if (headerIndex === -1) {
    throw new Error('Packing sheet header row not found');
  }

  const headerRow = rows[headerIndex];
  const groups = [];
  for (let index = 0; index + 2 < headerRow.length; index += 3) {
    const category = cleanCell(headerRow[index]);
    if (!category) continue;
    groups.push({ start: index, category });
  }

  const activeCategories = new Map(groups.map(group => [group.start, group.category]));
  const items = [];

  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];

    for (const group of groups) {
      const item = row[group.start];
      const quantity = row[group.start + 1];
      const comments = row[group.start + 2];

      if (!cleanCell(item) && !cleanCell(quantity) && !cleanCell(comments)) continue;

      if (isPackingCategoryHeader(item, quantity, comments)) {
        activeCategories.set(group.start, cleanCell(item));
        continue;
      }

      if (!cleanCell(item)) continue;

      items.push({
        category: activeCategories.get(group.start) || group.category,
        name: formatPackingItemName(item, quantity, comments),
        checked: false,
      });
    }
  }

  return items;
}

module.exports = {
  buildPackingImport,
  buildPlanImport,
  classifyReservationType,
  cleanCell,
  collapseWhitespace,
  determineReservationStatus,
  extractSheetTabsFromHtml,
  extractSpreadsheetId,
  extractSpreadsheetTitle,
  findSheetTab,
  formatPackingItemName,
  parseCsv,
  parseDateCell,
};
