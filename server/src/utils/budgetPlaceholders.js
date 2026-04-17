function normalizeText(value = '') {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function extractIsoDate(value = '') {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function buildDateLabel(startDate, endDate) {
  if (startDate && endDate && endDate !== startDate) {
    return `${startDate} - ${endDate}`;
  }
  return startDate || endDate || '';
}

function joinNoteParts(parts = []) {
  return parts
    .map(part => String(part || '').trim())
    .filter(Boolean)
    .join('\n') || null;
}

function buildAccommodationPlaceholder(accommodation) {
  const dateLabel = buildDateLabel(accommodation.start_date, accommodation.end_date);
  const name = dateLabel
    ? `${accommodation.place_name} (${dateLabel})`
    : accommodation.place_name;

  let days = null;
  if (
    Number.isInteger(accommodation.start_day_number)
    && Number.isInteger(accommodation.end_day_number)
    && accommodation.end_day_number >= accommodation.start_day_number
  ) {
    days = accommodation.end_day_number - accommodation.start_day_number + 1;
  }

  return {
    category: 'Accommodation',
    name,
    total_price: 0,
    persons: null,
    days,
    note: joinNoteParts([
      accommodation.place_address,
      accommodation.confirmation ? `Confirmation: ${accommodation.confirmation}` : null,
      accommodation.notes,
    ]),
  };
}

function buildCarReservationPlaceholder(reservation) {
  const date = extractIsoDate(reservation.reservation_time);
  const name = date ? `${reservation.title} (${date})` : reservation.title;

  return {
    category: 'Transport',
    name,
    total_price: 0,
    persons: null,
    days: null,
    note: joinNoteParts([
      reservation.location ? `Location: ${reservation.location}` : null,
      reservation.confirmation_number ? `Confirmation: ${reservation.confirmation_number}` : null,
      normalizeText(reservation.notes) !== normalizeText(reservation.title) ? reservation.notes : null,
    ]),
  };
}

function findMissingBudgetPlaceholders({ accommodations = [], carReservations = [], existingItems = [] }) {
  const seenKeys = new Set(
    existingItems.map(item => `${normalizeText(item.category)}::${normalizeText(item.name)}`)
  );
  const placeholders = [];

  for (const accommodation of accommodations) {
    const placeholder = buildAccommodationPlaceholder(accommodation);
    const key = `${normalizeText(placeholder.category)}::${normalizeText(placeholder.name)}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    placeholders.push(placeholder);
  }

  for (const reservation of carReservations) {
    const placeholder = buildCarReservationPlaceholder(reservation);
    const key = `${normalizeText(placeholder.category)}::${normalizeText(placeholder.name)}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    placeholders.push(placeholder);
  }

  return placeholders;
}

module.exports = {
  buildAccommodationPlaceholder,
  buildCarReservationPlaceholder,
  findMissingBudgetPlaceholders,
};
