const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isAllowedUploadType,
  setUploadSecurityHeaders,
} = require('../src/utils/uploadSecurity');
const {
  assertSafeOutboundUrl,
  isLoopbackOrPrivateAddress,
} = require('../src/utils/ssrfGuard');

test('blocks active content uploads and allows safe attachments', () => {
  assert.equal(isAllowedUploadType('payload.html', 'text/html'), false);
  assert.equal(isAllowedUploadType('payload.svg', 'image/svg+xml'), false);
  assert.equal(isAllowedUploadType('plan.pdf', 'application/pdf'), true);
  assert.equal(isAllowedUploadType('packing-list.txt', 'text/plain'), true);
});

test('applies anti-sniffing and download-only headers to risky uploads', () => {
  const headers = new Map();
  const res = {
    setHeader(name, value) {
      headers.set(name, value);
    },
  };

  setUploadSecurityHeaders(res, 'C:\\uploads\\payload.html');

  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
  assert.match(headers.get('Content-Disposition'), /^attachment;/);
  assert.equal(headers.get('Content-Security-Policy'), "sandbox; default-src 'none'");
});

test('recognizes loopback and private network addresses', () => {
  assert.equal(isLoopbackOrPrivateAddress('127.0.0.1'), true);
  assert.equal(isLoopbackOrPrivateAddress('192.168.1.10'), true);
  assert.equal(isLoopbackOrPrivateAddress('::1'), true);
  assert.equal(isLoopbackOrPrivateAddress('93.184.216.34'), false);
});

test('rejects localhost and private-network preview targets', async () => {
  await assert.rejects(
    assertSafeOutboundUrl('http://localhost:3000', async () => [{ address: '127.0.0.1' }]),
    /Local URLs are not allowed/
  );

  await assert.rejects(
    assertSafeOutboundUrl('http://travel-box.example', async () => [{ address: '192.168.1.20' }]),
    /Private network URLs are not allowed/
  );
});

test('allows public preview targets', async () => {
  const parsed = await assertSafeOutboundUrl(
    'https://example.com/plan',
    async () => [{ address: '93.184.216.34' }]
  );

  assert.equal(parsed.hostname, 'example.com');
  assert.equal(parsed.protocol, 'https:');
});
