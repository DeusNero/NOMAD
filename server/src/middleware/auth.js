const jwt = require('jsonwebtoken');
const { db, getTrustedUser } = require('../db/database');
const { JWT_SECRET, TRUSTED_MODE } = require('../config');

const authenticate = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token && TRUSTED_MODE) {
    const trustedUser = getTrustedUser();
    if (!trustedUser) {
      return res.status(500).json({ error: 'Trusted mode user not available' });
    }
    req.user = trustedUser;
    return next();
  }

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare(
      'SELECT id, username, email, role, maps_api_key, unsplash_api_key, openweather_api_key FROM users WHERE id = ?'
    ).get(decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token && TRUSTED_MODE) {
    req.user = getTrustedUser();
    return next();
  }

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare(
      'SELECT id, username, email, role, maps_api_key, unsplash_api_key, openweather_api_key FROM users WHERE id = ?'
    ).get(decoded.id);
    req.user = user || null;
  } catch (err) {
    req.user = null;
  }
  next();
};

const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

const demoUploadBlock = (req, res, next) => {
  if (process.env.DEMO_MODE === 'true' && req.user?.email === 'demo@nomad.app') {
    return res.status(403).json({ error: 'Uploads are disabled in demo mode. Self-host NOMAD for full functionality.' });
  }
  next();
};

module.exports = { authenticate, optionalAuth, adminOnly, demoUploadBlock };
