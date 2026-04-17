const fs = require('fs');
const path = require('path');

const MAX_CHUNK_LENGTH = 1400;
const SKIP_DIRS = new Set([
  '.git',
  '.obsidian',
  '.trash',
  'node_modules',
]);
const SEARCH_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'can',
  'do',
  'for',
  'from',
  'get',
  'give',
  'help',
  'here',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'know',
  'me',
  'my',
  'of',
  'on',
  'or',
  'please',
  'should',
  'show',
  'some',
  'tell',
  'that',
  'the',
  'there',
  'these',
  'this',
  'to',
  'us',
  'visit',
  'want',
  'what',
  'when',
  'where',
  'which',
  'with',
  'would',
  'you',
  'your',
]);

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenizeSearchTerms(text, minLength = 2, options = {}) {
  const {
    includeStopWords = false,
    maxTokens = 8,
  } = options;
  const tokens = String(text || '')
    .toLowerCase()
    .match(/[a-z0-9]{2,}/g);

  if (!tokens) return [];

  return [...new Set(tokens.filter(token => (
    token.length >= minLength
    && (includeStopWords || !SEARCH_STOP_WORDS.has(token))
  )))].slice(0, maxTokens);
}

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

function findVaultFileByBasename(rootDir, targetName) {
  if (!targetName) return null;

  const wanted = String(targetName).toLowerCase();
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

      if (entry.isFile() && entry.name.toLowerCase() === wanted) {
        return path.join(currentDir, entry.name);
      }
    }
  }

  return null;
}

function buildFtsQuery(text) {
  const tokens = tokenizeSearchTerms(text);
  if (!tokens || tokens.length === 0) return null;

  return tokens
    .slice(0, 8)
    .map(token => `"${token.replace(/"/g, '')}"*`)
    .join(' OR ');
}

function buildKnowledgebaseNoMatchReply(stats = {}) {
  if (!stats.chunk_count) {
    return 'The knowledgebase is configured but no markdown has been indexed yet. Run Reindex first, then try your question again.';
  }

  return 'I could not find relevant notes for that question in the indexed knowledgebase. Try naming a place, topic, or note title more specifically, or reindex if the vault changed.';
}

function countWholeWordMatches(text, token) {
  if (!text || !token) return 0;
  const matches = String(text).match(new RegExp(`\\b${escapeRegExp(token)}\\b`, 'gi'));
  return matches ? matches.length : 0;
}

function scoreKnowledgebaseCandidate(candidate, tokens) {
  if (!candidate || !tokens || tokens.length === 0) {
    return {
      ...candidate,
      score: 0,
      matched_token_count: 0,
      strong_match_count: 0,
    };
  }

  const relativePath = String(candidate.relative_path || '').toLowerCase();
  const title = String(candidate.title || '').toLowerCase();
  const heading = String(candidate.heading || '').toLowerCase();
  const text = String(candidate.chunk_text || '').toLowerCase();
  const basename = path.basename(relativePath, path.extname(relativePath));

  let score = 0;
  let matchedTokenCount = 0;
  let strongMatchCount = 0;

  for (const token of tokens) {
    const pathWhole = countWholeWordMatches(relativePath, token);
    const titleWhole = countWholeWordMatches(title, token);
    const headingWhole = countWholeWordMatches(heading, token);
    const basenameWhole = countWholeWordMatches(basename, token);
    const textWhole = countWholeWordMatches(text, token);

    const pathPartial = !pathWhole && relativePath.includes(token);
    const titlePartial = !titleWhole && title.includes(token);
    const headingPartial = !headingWhole && heading.includes(token);
    const textPartial = !textWhole && text.includes(token);

    const tokenScore = (
      (basenameWhole * 36)
      + (titleWhole * 28)
      + (headingWhole * 24)
      + (pathWhole * 20)
      + (textWhole * 7)
      + (titlePartial ? 8 : 0)
      + (headingPartial ? 6 : 0)
      + (pathPartial ? 5 : 0)
      + (textPartial ? 2 : 0)
    );

    if (tokenScore > 0) {
      matchedTokenCount += 1;
    }

    if (basenameWhole || titleWhole || headingWhole || pathWhole) {
      strongMatchCount += 1;
    }

    score += tokenScore;
  }

  if (matchedTokenCount > 0) {
    score += matchedTokenCount * 12;
  }

  if (tokens.length > 1) {
    const phrase = tokens.join(' ');
    if (phrase && (relativePath.includes(phrase) || title.includes(phrase) || heading.includes(phrase) || text.includes(phrase))) {
      score += 30;
    }
  }

  if (matchedTokenCount === tokens.length && tokens.length > 1) {
    score += 18;
  }

  return {
    ...candidate,
    score,
    matched_token_count: matchedTokenCount,
    strong_match_count: strongMatchCount,
  };
}

function rankKnowledgebaseCandidates(candidates, question, maxResults = 10) {
  const tokens = tokenizeSearchTerms(question, 2, { maxTokens: 12 });
  if (tokens.length === 0) return [];

  const scored = (candidates || [])
    .map(candidate => scoreKnowledgebaseCandidate(candidate, tokens))
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => (
      b.score - a.score
      || b.matched_token_count - a.matched_token_count
      || b.strong_match_count - a.strong_match_count
      || String(b.file_modified_at || '').localeCompare(String(a.file_modified_at || ''))
      || b.id - a.id
    ));

  if (scored.length === 0) return [];

  const topScore = scored[0].score;
  const minMatchedTokens = tokens.length > 1 ? 2 : 1;
  const threshold = Math.max(tokens.length === 1 ? 12 : 20, Math.floor(topScore * 0.35));
  const strongThreshold = Math.max(threshold, Math.floor(topScore * 0.65));

  return scored
    .filter(candidate => (
      candidate.score >= threshold
      && (
        candidate.matched_token_count >= minMatchedTokens
        || tokens.length === 1
        || (candidate.strong_match_count >= 1 && candidate.score >= strongThreshold)
      )
    ))
    .slice(0, maxResults);
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
  buildKnowledgebaseNoMatchReply,
  buildKnowledgebasePrompt,
  chunkMarkdownContent,
  collectMarkdownFiles,
  ensureReadableDirectory,
  extractAnthropicText,
  extractGeminiText,
  findVaultFileByBasename,
  isPathInside,
  normalizeAbsolutePath,
  rankKnowledgebaseCandidates,
  scoreKnowledgebaseCandidate,
  sanitizeUploadFilename,
  tokenizeSearchTerms,
};
