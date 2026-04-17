const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPackingImport,
  buildPlanImport,
  extractSheetTabsFromHtml,
  extractSpreadsheetId,
  extractSpreadsheetTitle,
  findSheetTab,
  parseCsv,
  parseDateCell,
} = require('../src/utils/googleSheetImport');

test('parseCsv preserves multiline quoted cells', () => {
  const csv = [
    'Name,Route,Notes',
    '"Tokyo","Boat: Queen Zamami',
    'Departure: 09:00',
    'Arrival: 09:50","Book ferry"',
  ].join('\n');

  const rows = parseCsv(csv);

  assert.equal(rows.length, 2);
  assert.equal(rows[1][1], 'Boat: Queen Zamami\nDeparture: 09:00\nArrival: 09:50');
});

test('spreadsheet helpers extract id, title, and tabs from html', () => {
  const html = `
    <title>Japan 2026 plan - Google Sheets</title>
    [21350203,"[0,0,\\"0\\",[{\\"1\\":[[0,0,\\"Plan\\"],[{\\"1\\":6,\\"2\\":0,\\"9\\":0}]]}],1000,26]"]
    [21350203,"[1,0,\\"1151283738\\",[{\\"1\\":[[0,0,\\"Packliste\\"],[{\\"1\\":6,\\"2\\":0,\\"9\\":0}]]}],1000,26]"]
  `;

  const tabs = extractSheetTabsFromHtml(html);

  assert.equal(extractSpreadsheetId('https://docs.google.com/spreadsheets/d/abc123/edit?gid=0'), 'abc123');
  assert.equal(extractSpreadsheetTitle(html), 'Japan 2026 plan');
  assert.deepEqual(tabs, [
    { gid: '0', name: 'Plan' },
    { gid: '1151283738', name: 'Packliste' },
  ]);
  assert.deepEqual(findSheetTab(tabs, ['packliste']), { gid: '1151283738', name: 'Packliste' });
});

test('parseDateCell accepts Swiss-style day/month/year dates', () => {
  assert.equal(parseDateCell('12/06/2026'), '2026-06-12');
  assert.equal(parseDateCell('2026-07-01'), '2026-07-01');
  assert.equal(parseDateCell(''), null);
});

test('buildPlanImport maps days, reservations, notes, and grouped accommodations', () => {
  const csv = [
    'Wochentag,Datum,"Ort der Übernachtung",Hotel Name,"Reiseroute (Zugfahrten/Flüge, Mietwagen)",mögliche Aktivitäten,Offene Punkte,"Kosten für 2 Personen",Kommentare',
    'Freitag,12/06/2026,Tokio,"Hotel Hanare (Ryokan), Ueno","Direktflug nach Tokyo mit Swiss 13:05-09:10 (+1)',
    'Airbnb Booking Ref #FBTJIW",Yadorigi Cafe,,,',
    'Samstag,13/06/2026,Tokio,"Hotel Hanare (Ryokan), Ueno",,Ueno Park,Book museum,,,',
    'Sonntag,14/06/2026,Kyoto,Hotel The Blossom Kyoto,"Zugticket nach Kyoto vor Ort kaufen",Dinner by the river,,,',
  ].join('\n');

  const result = buildPlanImport(parseCsv(csv));

  assert.equal(result.startDate, '2026-06-12');
  assert.equal(result.endDate, '2026-06-14');
  assert.equal(result.days.length, 3);
  assert.equal(result.days[0].title, 'Tokio');
  assert.equal(result.days[0].reservations.length, 1);
  assert.equal(result.days[0].reservations[0].type, 'flight');
  assert.equal(result.days[0].reservations[0].status, 'pending');
  assert.equal(result.days[0].dayNotes[0].text, 'Yadorigi Cafe');
  assert.equal(result.days[1].dayNotes[1].text, 'Book museum');
  assert.equal(result.accommodations.length, 2);
  assert.equal(result.accommodations[0].startDate, '2026-06-12');
  assert.equal(result.accommodations[0].endDate, '2026-06-13');
  assert.equal(result.accommodations[0].confirmation_number, 'FBTJIW');
  assert.equal(result.accommodations[1].place.name, 'Hotel The Blossom Kyoto');
});

test('buildPackingImport maps grouped packing columns and inline category resets', () => {
  const csv = [
    'Japan,,,12/06/2026,bis,07/07/2026,Tage,25,,,,,,,',
    ',,,,,,,,,,,,,,',
    'Kleidung Catherine,Anz.,Comments,Necessaire/Bad,Anz.,Comments,Outdoor & anderes,Anz.,Comments,Anderes / Handgepäck,Anz.,Comments',
    'Unterhose,7,,Antibrumm,1 fl.,,Taschenmesser,1,,Itinerary,1,Handgepäck',
    'Kleidung Viktor,Anz.,Comments,Parfüm,1,,Fächer,1,,Stativ,1,,',
    'T-shirt,5,packed,,,,,,,,,',
  ].join('\n');

  const items = buildPackingImport(parseCsv(csv));

  assert.deepEqual(items, [
    { category: 'Kleidung Catherine', name: 'Unterhose (7)', checked: false },
    { category: 'Necessaire/Bad', name: 'Antibrumm (1 fl.)', checked: false },
    { category: 'Outdoor & anderes', name: 'Taschenmesser (1)', checked: false },
    { category: 'Anderes / Handgepäck', name: 'Itinerary (1) - Handgepäck', checked: false },
    { category: 'Necessaire/Bad', name: 'Parfüm (1)', checked: false },
    { category: 'Outdoor & anderes', name: 'Fächer (1)', checked: false },
    { category: 'Anderes / Handgepäck', name: 'Stativ (1)', checked: false },
    { category: 'Kleidung Viktor', name: 'T-shirt (5) - packed', checked: false },
  ]);
});
