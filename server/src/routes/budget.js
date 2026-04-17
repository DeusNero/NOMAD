const express = require('express');
const { db, canAccessTrip } = require('../db/database');
const { authenticate } = require('../middleware/auth');
const { broadcast } = require('../websocket');
const { findMissingBudgetPlaceholders } = require('../utils/budgetPlaceholders');

const router = express.Router({ mergeParams: true });

function verifyTripOwnership(tripId, userId) {
  return canAccessTrip(tripId, userId);
}

function loadItemMembers(itemId) {
  return db.prepare(`
    SELECT bm.user_id, bm.paid, u.username, u.avatar
    FROM budget_item_members bm
    JOIN users u ON bm.user_id = u.id
    WHERE bm.budget_item_id = ?
  `).all(itemId);
}

function avatarUrl(user) {
  return user.avatar ? `/uploads/avatars/${user.avatar}` : null;
}

function getPlaceholderSourceData(tripId) {
  const accommodations = db.prepare(`
    SELECT
      a.place_id,
      a.start_day_id,
      a.end_day_id,
      a.check_in,
      a.check_out,
      a.confirmation,
      a.notes,
      a.created_at,
      p.name as place_name,
      p.address as place_address,
      sd.date as start_date,
      ed.date as end_date,
      sd.day_number as start_day_number,
      ed.day_number as end_day_number
    FROM day_accommodations a
    JOIN places p ON p.id = a.place_id
    JOIN days sd ON sd.id = a.start_day_id
    JOIN days ed ON ed.id = a.end_day_id
    WHERE a.trip_id = ?
    ORDER BY sd.day_number ASC, a.created_at ASC
  `).all(tripId);

  const carReservations = db.prepare(`
    SELECT title, reservation_time, location, confirmation_number, notes, created_at
    FROM reservations
    WHERE trip_id = ? AND type = 'car'
    ORDER BY reservation_time ASC, created_at ASC
  `).all(tripId);

  const existingItems = db.prepare(`
    SELECT category, name
    FROM budget_items
    WHERE trip_id = ?
  `).all(tripId);

  return { accommodations, carReservations, existingItems };
}

function syncBudgetPlaceholders(tripId) {
  const sync = db.transaction((currentTripId) => {
    const { accommodations, carReservations, existingItems } = getPlaceholderSourceData(currentTripId);
    const placeholders = findMissingBudgetPlaceholders({ accommodations, carReservations, existingItems });

    if (placeholders.length === 0) return [];

    const insert = db.prepare(`
      INSERT INTO budget_items (trip_id, category, name, total_price, persons, days, note, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const selectItem = db.prepare('SELECT * FROM budget_items WHERE id = ?');
    const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM budget_items WHERE trip_id = ?').get(currentTripId);
    let nextSortOrder = (maxOrder.max !== null ? maxOrder.max : -1) + 1;

    return placeholders.map(placeholder => {
      const result = insert.run(
        currentTripId,
        placeholder.category,
        placeholder.name,
        placeholder.total_price,
        placeholder.persons,
        placeholder.days,
        placeholder.note,
        nextSortOrder++
      );

      const item = selectItem.get(result.lastInsertRowid);
      item.members = [];
      return item;
    });
  });

  return sync(tripId);
}

// GET /api/trips/:tripId/budget
router.get('/', authenticate, (req, res) => {
  const { tripId } = req.params;

  const trip = verifyTripOwnership(tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const items = db.prepare(
    'SELECT * FROM budget_items WHERE trip_id = ? ORDER BY category ASC, created_at ASC'
  ).all(tripId);

  // Batch-load all members
  const itemIds = items.map(i => i.id);
  const membersByItem = {};
  if (itemIds.length > 0) {
    const allMembers = db.prepare(`
      SELECT bm.budget_item_id, bm.user_id, bm.paid, u.username, u.avatar
      FROM budget_item_members bm
      JOIN users u ON bm.user_id = u.id
      WHERE bm.budget_item_id IN (${itemIds.map(() => '?').join(',')})
    `).all(...itemIds);
    for (const m of allMembers) {
      if (!membersByItem[m.budget_item_id]) membersByItem[m.budget_item_id] = [];
      membersByItem[m.budget_item_id].push({
        user_id: m.user_id, paid: m.paid, username: m.username, avatar_url: avatarUrl(m)
      });
    }
  }
  items.forEach(item => { item.members = membersByItem[item.id] || []; });

  res.json({ items });
});

// GET /api/trips/:tripId/budget/summary/per-person (must be before /:id routes)
router.get('/summary/per-person', authenticate, (req, res) => {
  const { tripId } = req.params;
  if (!canAccessTrip(Number(tripId), req.user.id)) return res.status(404).json({ error: 'Trip not found' });

  const summary = db.prepare(`
    SELECT bm.user_id, u.username, u.avatar,
      SUM(bi.total_price * 1.0 / (SELECT COUNT(*) FROM budget_item_members WHERE budget_item_id = bi.id)) as total_assigned,
      SUM(CASE WHEN bm.paid = 1 THEN bi.total_price * 1.0 / (SELECT COUNT(*) FROM budget_item_members WHERE budget_item_id = bi.id) ELSE 0 END) as total_paid,
      COUNT(bi.id) as items_count
    FROM budget_item_members bm
    JOIN budget_items bi ON bm.budget_item_id = bi.id
    JOIN users u ON bm.user_id = u.id
    WHERE bi.trip_id = ?
    GROUP BY bm.user_id
  `).all(tripId);

  res.json({ summary: summary.map(s => ({ ...s, avatar_url: avatarUrl(s) })) });
});

// POST /api/trips/:tripId/budget/sync-placeholders
router.post('/sync-placeholders', authenticate, (req, res) => {
  const { tripId } = req.params;

  const trip = verifyTripOwnership(tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const items = syncBudgetPlaceholders(tripId);

  res.json({ items });
  for (const item of items) {
    broadcast(tripId, 'budget:created', { item }, req.headers['x-socket-id']);
  }
});

// POST /api/trips/:tripId/budget
router.post('/', authenticate, (req, res) => {
  const { tripId } = req.params;
  const { category, name, total_price, persons, days, note } = req.body;

  const trip = verifyTripOwnership(tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  if (!name) return res.status(400).json({ error: 'Name is required' });

  const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM budget_items WHERE trip_id = ?').get(tripId);
  const sortOrder = (maxOrder.max !== null ? maxOrder.max : -1) + 1;

  const result = db.prepare(
    'INSERT INTO budget_items (trip_id, category, name, total_price, persons, days, note, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    tripId,
    category || 'Other',
    name,
    total_price || 0,
    persons != null ? persons : null,
    days !== undefined && days !== null ? days : null,
    note || null,
    sortOrder
  );

  const item = db.prepare('SELECT * FROM budget_items WHERE id = ?').get(result.lastInsertRowid);
  item.members = [];
  res.status(201).json({ item });
  broadcast(tripId, 'budget:created', { item }, req.headers['x-socket-id']);
});

// PUT /api/trips/:tripId/budget/:id
router.put('/:id', authenticate, (req, res) => {
  const { tripId, id } = req.params;
  const { category, name, total_price, persons, days, note, sort_order } = req.body;

  const trip = verifyTripOwnership(tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const item = db.prepare('SELECT * FROM budget_items WHERE id = ? AND trip_id = ?').get(id, tripId);
  if (!item) return res.status(404).json({ error: 'Budget item not found' });

  db.prepare(`
    UPDATE budget_items SET
      category = COALESCE(?, category),
      name = COALESCE(?, name),
      total_price = CASE WHEN ? IS NOT NULL THEN ? ELSE total_price END,
      persons = CASE WHEN ? IS NOT NULL THEN ? ELSE persons END,
      days = CASE WHEN ? THEN ? ELSE days END,
      note = CASE WHEN ? THEN ? ELSE note END,
      sort_order = CASE WHEN ? IS NOT NULL THEN ? ELSE sort_order END
    WHERE id = ?
  `).run(
    category || null,
    name || null,
    total_price !== undefined ? 1 : null, total_price !== undefined ? total_price : 0,
    persons !== undefined ? 1 : null, persons !== undefined ? persons : null,
    days !== undefined ? 1 : 0, days !== undefined ? days : null,
    note !== undefined ? 1 : 0, note !== undefined ? note : null,
    sort_order !== undefined ? 1 : null, sort_order !== undefined ? sort_order : 0,
    id
  );

  const updated = db.prepare('SELECT * FROM budget_items WHERE id = ?').get(id);
  updated.members = loadItemMembers(id);
  res.json({ item: updated });
  broadcast(tripId, 'budget:updated', { item: updated }, req.headers['x-socket-id']);
});

// PUT /api/trips/:tripId/budget/:id/members
router.put('/:id/members', authenticate, (req, res) => {
  const { tripId, id } = req.params;
  if (!canAccessTrip(Number(tripId), req.user.id)) return res.status(404).json({ error: 'Trip not found' });

  const item = db.prepare('SELECT * FROM budget_items WHERE id = ? AND trip_id = ?').get(id, tripId);
  if (!item) return res.status(404).json({ error: 'Budget item not found' });

  const { user_ids } = req.body;
  if (!Array.isArray(user_ids)) return res.status(400).json({ error: 'user_ids must be an array' });

  // Preserve paid status for existing members
  const existingPaid = {};
  const existing = db.prepare('SELECT user_id, paid FROM budget_item_members WHERE budget_item_id = ?').all(id);
  for (const e of existing) existingPaid[e.user_id] = e.paid;

  db.prepare('DELETE FROM budget_item_members WHERE budget_item_id = ?').run(id);
  if (user_ids.length > 0) {
    const insert = db.prepare('INSERT OR IGNORE INTO budget_item_members (budget_item_id, user_id, paid) VALUES (?, ?, ?)');
    for (const userId of user_ids) insert.run(id, userId, existingPaid[userId] || 0);
    // Auto-update persons count
    db.prepare('UPDATE budget_items SET persons = ? WHERE id = ?').run(user_ids.length, id);
  } else {
    db.prepare('UPDATE budget_items SET persons = NULL WHERE id = ?').run(id);
  }

  const members = loadItemMembers(id).map(m => ({ ...m, avatar_url: avatarUrl(m) }));
  const updated = db.prepare('SELECT * FROM budget_items WHERE id = ?').get(id);
  res.json({ members, item: updated });
  broadcast(Number(tripId), 'budget:members-updated', { itemId: Number(id), members, persons: updated.persons }, req.headers['x-socket-id']);
});

// PUT /api/trips/:tripId/budget/:id/members/:userId/paid
router.put('/:id/members/:userId/paid', authenticate, (req, res) => {
  const { tripId, id, userId } = req.params;
  if (!canAccessTrip(Number(tripId), req.user.id)) return res.status(404).json({ error: 'Trip not found' });

  const { paid } = req.body;
  db.prepare('UPDATE budget_item_members SET paid = ? WHERE budget_item_id = ? AND user_id = ?')
    .run(paid ? 1 : 0, id, userId);

  const member = db.prepare(`
    SELECT bm.user_id, bm.paid, u.username, u.avatar
    FROM budget_item_members bm JOIN users u ON bm.user_id = u.id
    WHERE bm.budget_item_id = ? AND bm.user_id = ?
  `).get(id, userId);

  const result = member ? { ...member, avatar_url: avatarUrl(member) } : null;
  res.json({ member: result });
  broadcast(Number(tripId), 'budget:member-paid-updated', { itemId: Number(id), userId: Number(userId), paid: paid ? 1 : 0 }, req.headers['x-socket-id']);
});

// DELETE /api/trips/:tripId/budget/:id
router.delete('/:id', authenticate, (req, res) => {
  const { tripId, id } = req.params;

  const trip = verifyTripOwnership(tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const item = db.prepare('SELECT id FROM budget_items WHERE id = ? AND trip_id = ?').get(id, tripId);
  if (!item) return res.status(404).json({ error: 'Budget item not found' });

  db.prepare('DELETE FROM budget_items WHERE id = ?').run(id);
  res.json({ success: true });
  broadcast(tripId, 'budget:deleted', { itemId: Number(id) }, req.headers['x-socket-id']);
});

module.exports = router;
