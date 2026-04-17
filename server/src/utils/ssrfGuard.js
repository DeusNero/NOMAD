const dns = require('dns').promises;
const net = require('net');

function isLoopbackOrPrivateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return true;

  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function isLoopbackOrPrivateIpv6(address) {
  const normalized = address.toLowerCase().split('%')[0];

  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(normalized)) return true;

  if (normalized.startsWith('::ffff:')) {
    return isLoopbackOrPrivateAddress(normalized.slice(7));
  }

  return false;
}

function isLoopbackOrPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isLoopbackOrPrivateIpv4(address);
  if (family === 6) return isLoopbackOrPrivateIpv6(address);
  return true;
}

function isBlockedHostname(hostname = '') {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local');
}

async function assertSafeOutboundUrl(rawUrl, resolver = dns.lookup) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http(s) URLs are allowed');
  }

  if (parsed.username || parsed.password) {
    throw new Error('Credentialed URLs are not allowed');
  }

  if (isBlockedHostname(parsed.hostname)) {
    throw new Error('Local URLs are not allowed');
  }

  if (net.isIP(parsed.hostname) && isLoopbackOrPrivateAddress(parsed.hostname)) {
    throw new Error('Private network URLs are not allowed');
  }

  const resolved = await resolver(parsed.hostname, { all: true, verbatim: true });
  if (!resolved?.length) {
    throw new Error('Host could not be resolved');
  }

  if (resolved.some(entry => isLoopbackOrPrivateAddress(entry.address))) {
    throw new Error('Private network URLs are not allowed');
  }

  return parsed;
}

module.exports = {
  assertSafeOutboundUrl,
  isBlockedHostname,
  isLoopbackOrPrivateAddress,
};
