const fs = require('fs');
const os = require('os');
const path = require('path');

const { collectMarkdownFiles } = require('./knowledgebase');

const DEFAULT_HERMES_STATUS_STALE_MS = 45_000;
const DEFAULT_MAX_ACTIVITY_ENTRIES = 500;

function stripMarkdownExtension(value) {
  return String(value || '').replace(/\.md$/i, '');
}

function normalizeSourceSlug(value) {
  const normalized = stripMarkdownExtension(String(value || '').trim().replace(/\\/g, '/'));
  if (!normalized) return null;
  return path.posix.basename(normalized);
}

function extractKnowledgebaseSourceSlugs(markdown) {
  const slugs = new Set();
  const lines = String(markdown || '').split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/^\*?\*?Sources\*?\*?:\s*(.+)$/i);
    if (!match) continue;

    const wikilinks = match[1].matchAll(/\[\[([^\]]+)\]\]/g);
    for (const wikilink of wikilinks) {
      const target = wikilink[1]?.split('|')[0]?.split('#')[0];
      const slug = normalizeSourceSlug(target);
      if (slug) slugs.add(slug);
    }
  }

  return [...slugs];
}

function collectKnowledgebaseSourceSlugs(searchRoot) {
  const slugs = new Set();

  for (const filePath of collectMarkdownFiles(searchRoot)) {
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const slug of extractKnowledgebaseSourceSlugs(raw)) {
      slugs.add(slug);
    }
  }

  return slugs;
}

function findCommonAncestor(paths) {
  const resolved = paths
    .map(value => path.resolve(value))
    .filter(Boolean);

  if (resolved.length === 0) return null;

  const segmented = resolved.map(value => {
    const parsed = path.parse(value);
    const parts = value.slice(parsed.root.length).split(path.sep).filter(Boolean);
    return { root: parsed.root, parts };
  });

  const sharedRoot = segmented[0].root;
  if (!segmented.every(entry => entry.root.toLowerCase() === sharedRoot.toLowerCase())) {
    return sharedRoot;
  }

  const commonParts = [];
  const minLength = Math.min(...segmented.map(entry => entry.parts.length));
  for (let index = 0; index < minLength; index += 1) {
    const segment = segmented[0].parts[index];
    if (!segmented.every(entry => entry.parts[index].toLowerCase() === segment.toLowerCase())) break;
    commonParts.push(segment);
  }

  return path.join(sharedRoot, ...commonParts);
}

function buildSourceCandidates(commonRoot, uploadRoot, absolutePath) {
  const candidates = new Set();
  const baseName = stripMarkdownExtension(path.basename(absolutePath));
  if (baseName) candidates.add(baseName);

  if (commonRoot) {
    const relativeToCommon = stripMarkdownExtension(path.relative(commonRoot, absolutePath).split(path.sep).join('/'));
    if (relativeToCommon && !relativeToCommon.startsWith('..')) {
      candidates.add(relativeToCommon);
      candidates.add(path.posix.basename(relativeToCommon));
    }
  }

  if (uploadRoot) {
    const relativeToUpload = stripMarkdownExtension(path.relative(uploadRoot, absolutePath).split(path.sep).join('/'));
    if (relativeToUpload && !relativeToUpload.startsWith('..')) {
      candidates.add(relativeToUpload);
      candidates.add(path.posix.basename(relativeToUpload));
    }
  }

  return [...candidates].filter(Boolean);
}

function collectPendingKnowledgebaseUploads({ searchRoot, uploadRoot }) {
  const referencedSlugs = collectKnowledgebaseSourceSlugs(searchRoot);
  const commonRoot = findCommonAncestor([searchRoot, uploadRoot]) || uploadRoot;

  return collectMarkdownFiles(uploadRoot)
    .map(filePath => {
      const sourceCandidates = buildSourceCandidates(commonRoot, uploadRoot, filePath);
      return {
        absolute_path: filePath,
        file_name: path.basename(filePath),
        source_slug: stripMarkdownExtension(path.basename(filePath)),
        relative_upload_path: path.relative(uploadRoot, filePath).split(path.sep).join('/'),
        relative_activity_path: path.relative(commonRoot, filePath).split(path.sep).join('/'),
        source_candidates: sourceCandidates,
      };
    })
    .filter(file => !file.source_candidates.some(candidate => referencedSlugs.has(candidate)));
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function queueKnowledgebaseSynthesisBatch({
  tripId,
  files,
  activityLogPath,
  sourceId = `nomad-knowledgebase-${tripId}`,
  sourceName = 'Nomad Knowledgebase',
  maxEntries = DEFAULT_MAX_ACTIVITY_ENTRIES,
}) {
  if (!files?.length) return { queuedCount: 0 };

  const data = readJsonFile(activityLogPath, { entries: [] });
  const now = new Date().toISOString();

  for (const file of [...files].reverse()) {
    data.entries.unshift({
      id: `kb-evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: now,
      sourceId,
      sourceName,
      articleUrl: null,
      articleTitle: file.source_slug,
      markdownPath: file.relative_activity_path,
      status: 'ingested',
      method: 'nomad-upload',
      detail: `Queued from Nomad trip ${tripId}`,
    });
  }

  if (data.entries.length > maxEntries) {
    data.entries = data.entries.slice(0, maxEntries);
  }

  writeJsonAtomic(activityLogPath, data);
  return { queuedCount: files.length };
}

function presentHermesStatus(record, {
  now = new Date(),
  staleAfterMs = DEFAULT_HERMES_STATUS_STALE_MS,
} = {}) {
  const updatedAt = record?.updatedAt ? new Date(record.updatedAt) : null;
  const stale = record?.busy === true && (!updatedAt || ((+now) - (+updatedAt)) > staleAfterMs);
  const busy = record?.busy === true && !stale;

  return {
    busy,
    stale,
    staleAfterMs,
    taskSummary: typeof record?.taskSummary === 'string' && record.taskSummary.trim()
      ? record.taskSummary.trim()
      : null,
    updatedAt: updatedAt && !Number.isNaN(+updatedAt) ? updatedAt.toISOString() : null,
    state: busy ? 'working' : 'idle',
  };
}

function readKnowledgebaseHermesStatus(statusFilePath, options = {}) {
  const record = readJsonFile(statusFilePath, null);
  return presentHermesStatus(record, options);
}

function getDefaultKnowledgebaseSynthesisPaths() {
  const horizonDataDir = path.join(os.homedir(), 'projects', 'horizon-dashboard', 'data');
  return {
    activityLogPath: process.env.KNOWLEDGEBASE_SYNTHESIS_ACTIVITY_PATH || path.join(horizonDataDir, 'blog-activity.json'),
    hermesStatusPath: process.env.KNOWLEDGEBASE_HERMES_STATUS_PATH || path.join(horizonDataDir, 'hermes-status.json'),
  };
}

module.exports = {
  DEFAULT_HERMES_STATUS_STALE_MS,
  collectKnowledgebaseSourceSlugs,
  collectPendingKnowledgebaseUploads,
  extractKnowledgebaseSourceSlugs,
  getDefaultKnowledgebaseSynthesisPaths,
  queueKnowledgebaseSynthesisBatch,
  readKnowledgebaseHermesStatus,
};
