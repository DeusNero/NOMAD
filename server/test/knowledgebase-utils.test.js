const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('path');

const {
  buildFtsQuery,
  buildKnowledgebaseNoMatchReply,
  buildKnowledgebasePrompt,
  chunkMarkdownContent,
  isPathInside,
  isLikelyMarkdownNoteReference,
  normalizeKnowledgebaseSessionId,
  normalizeAbsolutePath,
  normalizeVaultReferenceTarget,
  parseVaultReference,
  rankKnowledgebaseCandidates,
  resolveVaultReference,
  sanitizeUploadFilename,
  tokenizeSearchTerms,
} = require('../src/utils/knowledgebase');

test('normalizeAbsolutePath accepts absolute paths and rejects relative ones', () => {
  const absolute = path.resolve('fixtures', 'vault');

  assert.equal(normalizeAbsolutePath(absolute), path.normalize(absolute));
  assert.equal(normalizeAbsolutePath('fixtures/vault'), null);
  assert.equal(normalizeAbsolutePath(''), null);
});

test('isPathInside recognizes child paths and blocks siblings', () => {
  const root = path.resolve('vault');
  const child = path.join(root, 'raw', 'note.md');
  const sibling = path.resolve('outside', 'note.md');

  assert.equal(isPathInside(root, child), true);
  assert.equal(isPathInside(root, sibling), false);
});

test('sanitizeUploadFilename strips traversal and forces markdown extension', () => {
  assert.equal(sanitizeUploadFilename('../secret.txt'), 'secret.md');
  assert.equal(sanitizeUploadFilename('trip notes.md'), 'trip notes.md');
  assert.equal(sanitizeUploadFilename(''), 'knowledgebase-upload.md');
});

test('chunkMarkdownContent keeps title and headings for markdown sections', () => {
  const chunks = chunkMarkdownContent(`# Welcome

Intro paragraph.

## Tokyo
Ramen spot one.

Another paragraph.

## Kyoto
Temple notes.`, 'japan/guide.md', 60);

  assert.equal(chunks[0].title, 'Welcome');
  assert.equal(chunks[0].heading, 'Welcome');
  assert.equal(chunks[1].heading, 'Tokyo');
  assert.equal(chunks.at(-1).heading, 'Kyoto');
  assert.ok(chunks.every(chunk => chunk.chunkText.length > 0));
});

test('buildFtsQuery tokenizes natural questions for sqlite fts', () => {
  const query = buildFtsQuery('Best ramen bars in Tokyo?');

  assert.match(query, /"best"\*/);
  assert.match(query, /"tokyo"\*/);
  assert.equal(buildFtsQuery('!?'), null);
});

test('tokenizeSearchTerms de-duplicates tokens and can enforce a longer minimum length', () => {
  assert.deepEqual(
    tokenizeSearchTerms('Tokyo tokyo wine bars in Tokyo'),
    ['tokyo', 'wine', 'bars']
  );
  assert.deepEqual(
    tokenizeSearchTerms('hi mt fuji Kyoto', 3),
    ['fuji', 'kyoto']
  );
});

test('tokenizeSearchTerms drops conversational filler before retrieval', () => {
  assert.deepEqual(
    tokenizeSearchTerms('Can you tell me what I should visit in Naha?'),
    ['naha']
  );
});

test('normalizeVaultReferenceTarget strips wrappers from quoted links', () => {
  assert.equal(
    normalizeVaultReferenceTarget('"https://www.gov-online.go.jp/hlj/en/november_2025/november_2025-07.html"'),
    'https://www.gov-online.go.jp/hlj/en/november_2025/november_2025-07.html'
  );
  assert.equal(
    normalizeVaultReferenceTarget('<related-pages/naha-guide.md>'),
    'related-pages/naha-guide.md'
  );
});

test('normalizeKnowledgebaseSessionId accepts safe browser-scoped ids and rejects invalid values', () => {
  assert.equal(
    normalizeKnowledgebaseSessionId('kb_session_1234-abcd:device'),
    'kb_session_1234-abcd:device'
  );
  assert.equal(normalizeKnowledgebaseSessionId('short-id'), null);
  assert.equal(normalizeKnowledgebaseSessionId('kb session with spaces'), null);
});

test('parseVaultReference keeps heading targets for note links', () => {
  assert.deepEqual(
    parseVaultReference('[[naha-guide#Related pages|Read more]]'),
    { reference: 'naha-guide', focusHeading: 'Related pages' }
  );
  assert.deepEqual(
    parseVaultReference('naha-guide.md#Top sights'),
    { reference: 'naha-guide.md', focusHeading: 'Top sights' }
  );
});

test('isLikelyMarkdownNoteReference recognizes extensionless and markdown note links', () => {
  assert.equal(isLikelyMarkdownNoteReference('naha-guide'), true);
  assert.equal(isLikelyMarkdownNoteReference('related/naha-guide.md'), true);
  assert.equal(isLikelyMarkdownNoteReference('docs/photo.webp'), false);
  assert.equal(isLikelyMarkdownNoteReference('https://example.com/guide'), false);
});

test('resolveVaultReference finds related notes relative to the current note', () => {
  const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-vault-'));
  const sourceDir = path.join(vaultRoot, 'japan', 'okinawa');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'naha.md'), '# Naha');
  fs.writeFileSync(path.join(sourceDir, 'tokashiki.md'), '# Tokashiki');

  const resolved = resolveVaultReference(
    vaultRoot,
    'japan/okinawa/guide.md',
    'tokashiki#Beaches',
    { preferMarkdown: true }
  );

  assert.equal(resolved.relativePath, 'japan/okinawa/tokashiki.md');
  assert.equal(resolved.focusHeading, 'Beaches');
});

test('rankKnowledgebaseCandidates prefers exact place matches over unrelated snippets', () => {
  const ranked = rankKnowledgebaseCandidates([
    {
      id: 1,
      relative_path: 'raw/japan/okinawa/naha-what-to-see.md',
      title: 'What To See In Naha',
      heading: 'Top sights',
      chunk_text: 'Naha is a good base for Shuri Castle, Kokusai-dori, and day trips around Okinawa.',
      file_modified_at: '2026-04-18T00:00:00.000Z',
    },
    {
      id: 2,
      relative_path: 'raw/rwa/crypto-native-investor-relations.md',
      title: 'The Crypto Native Guide to Investor Relations',
      heading: 'Narrative matters',
      chunk_text: 'Narrative matters, but the market will still judge whether the data backs it up.',
      file_modified_at: '2026-04-18T00:00:00.000Z',
    },
  ], 'Can you tell me what I should visit in Naha?', 10);

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].relative_path, 'raw/japan/okinawa/naha-what-to-see.md');
});

test('buildKnowledgebasePrompt includes history, question, and numbered snippets', () => {
  const prompt = buildKnowledgebasePrompt({
    question: 'Where should we drink wine in Tokyo?',
    history: [{ role: 'user', content: 'Focus on natural wine.' }],
    snippets: [{
      relative_path: 'raw/tokyo-bars.md',
      title: 'Tokyo Bars',
      heading: 'Natural Wine',
      chunk_text: 'Bar A focuses on natural wine and late-night pours.',
    }],
  });

  assert.match(prompt, /Focus on natural wine/);
  assert.match(prompt, /Where should we drink wine in Tokyo/);
  assert.match(prompt, /\[1\] raw\/tokyo-bars\.md > Natural Wine/);
});

test('buildKnowledgebaseNoMatchReply distinguishes empty and populated indexes', () => {
  assert.match(
    buildKnowledgebaseNoMatchReply({ chunk_count: 0 }),
    /no markdown has been indexed yet/i
  );
  assert.match(
    buildKnowledgebaseNoMatchReply({ chunk_count: 24 }),
    /could not find relevant notes/i
  );
});
