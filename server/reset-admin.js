const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'data/travel.db');
const db = new Database(dbPath);

const username = (process.argv[2] || process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin').trim();
const email = (process.argv[3] || process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase();
const password = process.argv[4] || process.env.BOOTSTRAP_ADMIN_PASSWORD;

if (!password || password.length < 12) {
  console.error('Provide a bootstrap admin password with at least 12 characters via argv or BOOTSTRAP_ADMIN_PASSWORD.');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);
const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);

if (existing) {
  db.prepare('UPDATE users SET username = ?, password_hash = ?, role = ? WHERE email = ?')
    .run(username, hash, 'admin', email);
  console.log(`Bootstrap admin password reset for ${email}`);
} else {
  db.prepare('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(username, email, hash, 'admin');
  console.log(`Bootstrap admin created for ${email}`);
}

db.close();
