const path = require('path');

const DEFAULT_ALLOWED_EXTENSIONS = 'jpg,jpeg,png,gif,webp,heic,pdf,doc,docx,xls,xlsx,txt,csv';
const BLOCKED_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.htm',
  '.html',
  '.js',
  '.jsx',
  '.mjs',
  '.shtml',
  '.svg',
  '.svgz',
  '.xhtml',
  '.xml',
]);
const BLOCKED_MIME_TYPES = new Set([
  'application/javascript',
  'application/xhtml+xml',
  'application/xml',
  'image/svg+xml',
  'text/html',
  'text/javascript',
  'text/xml',
]);

function normalizeExtension(filename = '') {
  return path.extname(filename).toLowerCase();
}

function parseAllowedExtensions(csv = DEFAULT_ALLOWED_EXTENSIONS) {
  return csv
    .split(',')
    .map(ext => ext.trim().toLowerCase())
    .filter(Boolean);
}

function isBlockedUploadType(filename = '', mimeType = '') {
  const ext = normalizeExtension(filename);
  if (BLOCKED_EXTENSIONS.has(ext)) return true;
  return BLOCKED_MIME_TYPES.has(String(mimeType).toLowerCase());
}

function isAllowedUploadType(filename = '', mimeType = '', allowedExtensionsCsv = DEFAULT_ALLOWED_EXTENSIONS) {
  const ext = normalizeExtension(filename);
  if (!ext || isBlockedUploadType(filename, mimeType)) return false;

  const allowed = parseAllowedExtensions(allowedExtensionsCsv);
  if (!allowed.includes('*') && !allowed.includes(ext.slice(1))) {
    return false;
  }

  const normalizedMime = String(mimeType || '').toLowerCase();
  if (ext === '.heic') {
    return normalizedMime === '' || normalizedMime === 'image/heic' || normalizedMime === 'image/heif';
  }
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
    return normalizedMime.startsWith('image/') && !normalizedMime.includes('svg');
  }
  return true;
}

function setUploadSecurityHeaders(res, filePath) {
  const ext = normalizeExtension(filePath);

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');

  if (BLOCKED_EXTENSIONS.has(ext)) {
    const safeName = path.basename(filePath).replace(/"/g, '');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
  }
}

module.exports = {
  DEFAULT_ALLOWED_EXTENSIONS,
  isAllowedUploadType,
  isBlockedUploadType,
  parseAllowedExtensions,
  setUploadSecurityHeaders,
};
