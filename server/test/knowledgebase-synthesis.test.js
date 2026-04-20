const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  collectPendingKnowledgebaseUploads,
  extractKnowledgebaseSourceSlugs,
  queueKnowledgebaseSynthesisBatch,
  readKnowledgebaseHermesStatus,
} = require('../src/utils/knowledgebase-synthesis');

test('extractKnowledgebaseSourceSlugs reads Sources lines and strips aliases', () => {
  const markdown = `# Tokyo\n\n**Sources**: [[raw/japan/tokyo-guide.md|Tokyo Guide]], [[akihabara#Shops]], [[travel-notes]]`;

  assert.deepEqual(
    extractKnowledgebaseSourceSlugs(markdown),
    ['tokyo-guide', 'akihabara', 'travel-notes'],
  );
});

test('collectPendingKnowledgebaseUploads returns only raw markdown not yet cited by the wiki', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-synthesis-'));
  const searchRoot = path.join(root, 'wiki', 'japan');
  const uploadRoot = path.join(root, 'raw', 'japan');
  fs.mkdirSync(searchRoot, { recursive: true });
  fs.mkdirSync(uploadRoot, { recursive: true });

  fs.writeFileSync(
    path.join(searchRoot, 'tokyo.md'),
    '# Tokyo\n\n**Sources**: [[tokyo-guide]], [[akihabara]]\n',
  );
  fs.writeFileSync(path.join(uploadRoot, 'tokyo-guide.md'), '# Tokyo Guide');
  fs.writeFileSync(path.join(uploadRoot, 'kyoto-guide.md'), '# Kyoto Guide');

  const pending = collectPendingKnowledgebaseUploads({ searchRoot, uploadRoot });

  assert.equal(pending.length, 1);
  assert.equal(pending[0].file_name, 'kyoto-guide.md');
  assert.equal(pending[0].relative_activity_path, 'raw/japan/kyoto-guide.md');
});

test('queueKnowledgebaseSynthesisBatch appends Nomad activity events', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-activity-'));
  const activityLogPath = path.join(root, 'blog-activity.json');

  queueKnowledgebaseSynthesisBatch({
    tripId: 42,
    activityLogPath,
    files: [
      {
        source_slug: 'kyoto-guide',
        relative_activity_path: 'raw/japan/kyoto-guide.md',
      },
    ],
  });

  const data = JSON.parse(fs.readFileSync(activityLogPath, 'utf8'));
  assert.equal(data.entries.length, 1);
  assert.equal(data.entries[0].status, 'ingested');
  assert.equal(data.entries[0].markdownPath, 'raw/japan/kyoto-guide.md');
  assert.equal(data.entries[0].sourceId, 'nomad-knowledgebase-42');
});

test('readKnowledgebaseHermesStatus marks stale busy records idle', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-hermes-status-'));
  const statusPath = path.join(root, 'hermes-status.json');
  fs.writeFileSync(statusPath, JSON.stringify({
    busy: true,
    taskSummary: 'Synthesizing Japan uploads',
    updatedAt: '2026-04-20T08:00:00.000Z',
  }));

  const status = readKnowledgebaseHermesStatus(statusPath, {
    now: new Date('2026-04-20T08:01:00.000Z'),
    staleAfterMs: 45_000,
  });

  assert.equal(status.busy, false);
  assert.equal(status.stale, true);
  assert.equal(status.state, 'idle');
});
