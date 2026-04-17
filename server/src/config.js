const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let JWT_SECRET = process.env.JWT_SECRET;
const TRUSTED_MODE = process.env.TRUSTED_MODE === 'true';
const TRUSTED_NAME = (process.env.TRUSTED_NAME || 'Household').trim() || 'Household';
const TRUSTED_EMAIL = 'trusted@nomad.local';
const ALLOW_BOOTSTRAP_REGISTRATION = process.env.ALLOW_BOOTSTRAP_REGISTRATION === 'true';

if (!JWT_SECRET) {
  // Try to read a persisted secret from disk
  const dataDir = path.resolve(__dirname, '../data');
  const secretFile = path.join(dataDir, '.jwt_secret');

  try {
    JWT_SECRET = fs.readFileSync(secretFile, 'utf8').trim();
  } catch {
    // File doesn't exist yet — generate and persist a new secret
    JWT_SECRET = crypto.randomBytes(32).toString('hex');
    try {
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(secretFile, JWT_SECRET, { mode: 0o600 });
      console.log('Generated and saved JWT secret to', secretFile);
    } catch (writeErr) {
      console.warn('WARNING: Could not persist JWT secret to disk:', writeErr.message);
      console.warn('Sessions will reset on server restart. Set JWT_SECRET env var for persistent sessions.');
    }
  }
}

module.exports = {
  ALLOW_BOOTSTRAP_REGISTRATION,
  JWT_SECRET,
  TRUSTED_EMAIL,
  TRUSTED_MODE,
  TRUSTED_NAME,
};
