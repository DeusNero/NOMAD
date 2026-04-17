const fs = require('fs');
const path = require('path');

const MAX_CHUNK_LENGTH = 1400;
const SKIP_DIRS = new Set([
  '.git',
  '.obsidian',
  '.trash',
  'node_modules',
]);

function normalizeAbsolutePath(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed || !path.isAbsolute(trimmed)) return null;
  return path.normalize(trimmed);
}

function ensureReadableDirectory(dirPath) {
  const normalized = normalizeAbsolutePath(dirPath);
  if (!normalized) throw new Error('Path must be absolute');

  const stat = fs.statSync(normalized, { throwIfNoEntry: false });
  if (!stat || !stat.isDirectory()) throw new Error('Directory not found');

  fs.accessSync(normalized, fs.constants.R_OK);
  return normalized;
}

function isPathInside(parentPath, targetPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(targetPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function sanitizeUploadFilename(fileName) {
  const base = path.basename(fileName || 'knowledgebase-upload.md');
  const stem = base.replace(/\.[^.]+$/, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const safeStem = stem || 'knowledgebase-upload';
  return `${safeStem}.md`;
}

function collectMarkdownFiles(rootDir) {
  const files = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.github') {
        if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
          stack.push(path.join(currentDir, entry.name));
        }
        continue;
      }

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          stack.push(path.join(currentDir, entry.name));
        }
        continue;
      }

      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        files.push(path.join(currentDir, entry.name));
      }
    }
  }

  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function stripFrontmatter(content) {
  if (!content.startsWith('---\n')) return content;
  const end = content.indexOf('\n---\n', 4);
  if (end === -1) return content;
  return content.slice(end + 5);
}

function firstHeading(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function chunkMarkdownContent(content, relativePath, maxChunkLength = MAX_CHUNK_LENGTH) {
  const cleaned = stripFrontmatter(String(content || '').replace(/\r\n/g, '\n'));
  const title = firstHeading(cleaned) || path.basename(relativePath, '.md');
  const lines = cleaned.split('\n');
  const chunks = [];

  let heading = title;
  let buffer = [];
  let chunkIndex = 0;

  const pushChunk = () => {
    const text = buffer.join('\n').trim();
    if (!text) return;
    chunks.push({
      title,
      heading,
      chunkIndex: chunkIndex++,
      chunkText: text,
      excerpt: text.slice(0, 240),
    });
    buffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^#{1,6}\s+/.test(trimmed)) {
      pushChunk();
      heading = trimmed.replace(/^#{1,6}\s+/, '').trim() || title;
      continue;
    }

    const candidate = [...buffer, line].join('\n').trim();
    if (candidate.length > maxChunkLength && buffer.length > 0) {
      pushChunk();
    }

    buffer.push(line);

    if (trimmed === '' && buffer.join('\n').trim().length >= maxChunkLength) {
      pushChunk();
    }
  }

  pushChunk();

  if (chunks.length === 0) {
    return [{
      title,
      heading: title,
      chunkIndex: 0,
      chunkText: cleaned.trim(),
      excerpt: cleaned.trim().slice(0, 240),
    }].filter(chunk => chunk.chunkText);
  }

  return chunks;
}

function buildFtsQuery(text) {
  const tokens = String(text || '')
    .toLowerCase()
    .match(/[a-z0-9]{2,}/g);

  if (!tokens || tokens.length === 0) return null;

  return tokens
    .slice(0, 8)
    .map(token => `"${token.replace(/"/g, '')}"*`)
    .join(' OR ');
}

function buildKnowledgebasePrompt({ question, snippets, history }) {
  const historyText = (history || [])
    .slice(-6)
    .map(message => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content}`)
    .join('\n');

  const snippetText = (snippets || [])
    .map((snippet, index) => {
      const heading = snippet.heading && snippet.heading !== snippet.title
        ? ` > ${snippet.heading}`
        : '';
      return [
        `[${index + 1}] ${snippet.relative_path}${heading}`,
        snippet.chunk_text,
      ].join('\n');
    })
    .join('\n\n');

  return [
    'You are the Knowledgebase assistant for a shared Obsidian-style markdown vault.',
    'Answer only from the provided snippets and conversation context.',
    'If the answer is not supported by the snippets, say you do not know.',
    'Cite supporting snippets inline using [1], [2], etc.',
    'Prefer concise, direct answers over speculation.',
    historyText ? `Conversation so far:\n${historyText}` : '',
    `Question:\n${question}`,
    `Available snippets:\n${snippetText}`,
  ].filter(Boolean).join('\n\n');
}

function extractGeminiText(body) {
  const parts = body?.candidates?.[0]?.content?.parts || [];
  return parts
    .map(part => part?.text)
    .filter(Boolean)
    .join('\n')
    .trim();
}

function extractAnthropicText(body) {
  const parts = body?.content || [];
  return parts
    .filter(part => part?.type === 'text' && part?.text)
    .map(part => part.text)
    .join('\n')
    .trim();
}

module.exports = {
  MAX_CHUNK_LENGTH,
  buildFtsQuery,
  buildKnowledgebasePrompt,
  chunkMarkdownContent,
  collectMarkdownFiles,
  ensureReadableDirectory,
  extractAnthropicText,
  extractGeminiText,
  isPathInside,
  normalizeAbsolutePath,
  sanitizeUploadFilename,
};
