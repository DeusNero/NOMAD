const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAccommodationPlaceholder,
  buildCarReservationPlaceholder,
  findMissingBudgetPlaceholders,
} = require('../src/utils/budgetPlaceholders');

test('buildAccommodationPlaceholder uses stay range and known night count', () => {
  const placeholder = buildAccommodationPlaceholder({
    place_name: 'Hotel Hanare',
    place_address: 'Ueno, Tokyo',
    start_date: '2026-06-12',
    end_date: '2026-06-13',
    start_day_number: 1,
    end_day_number: 2,
    confirmation: 'FBTJIW',
    notes: 'Imported from plan',
  });

  assert.deepEqual(placeholder, {
    category: 'Accommodation',
    name: 'Hotel Hanare (2026-06-12 - 2026-06-13)',
    total_price: 0,
    persons: null,
    days: 2,
    note: 'Ueno, Tokyo\nConfirmation: FBTJIW\nImported from plan',
  });
});

test('buildCarReservationPlaceholder uses reservation date and car-specific note details', () => {
  const placeholder = buildCarReservationPlaceholder({
    title: 'Orix rental car',
    reservation_time: '2026-06-14T09:00',
    location: 'Kyoto Station',
    confirmation_number: 'CAR-1234',
    notes: 'Pick up near the south exit',
  });

  assert.deepEqual(placeholder, {
    category: 'Transport',
    name: 'Orix rental car (2026-06-14)',
    total_price: 0,
    persons: null,
    days: null,
    note: 'Location: Kyoto Station\nConfirmation: CAR-1234\nPick up near the south exit',
  });
});

test('findMissingBudgetPlaceholders skips existing names and de-duplicates repeated sources', () => {
  const placeholders = findMissingBudgetPlaceholders({
    accommodations: [
      {
        place_name: 'Hotel Hanare',
        place_address: 'Ueno, Tokyo',
        start_date: '2026-06-12',
        end_date: '2026-06-13',
        start_day_number: 1,
        end_day_number: 2,
        confirmation: null,
        notes: null,
      },
      {
        place_name: 'Hotel Hanare',
        place_address: 'Ueno, Tokyo',
        start_date: '2026-06-12',
        end_date: '2026-06-13',
        start_day_number: 1,
        end_day_number: 2,
        confirmation: null,
        notes: null,
      },
    ],
    carReservations: [
      {
        title: 'Orix rental car',
        reservation_time: '2026-06-14T09:00',
        location: 'Kyoto Station',
        confirmation_number: null,
        notes: null,
      },
    ],
    existingItems: [
      { category: 'Accommodation', name: 'Hotel Hanare (2026-06-12 - 2026-06-13)' },
    ],
  });

  assert.equal(placeholders.length, 1);
  assert.equal(placeholders[0].category, 'Transport');
  assert.equal(placeholders[0].name, 'Orix rental car (2026-06-14)');
});
