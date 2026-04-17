const express = require('express');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const multer = require('multer');
const { db, canAccessTrip } = require('../db/database');
const { authenticate, adminOnly, demoUploadBlock } = require('../middleware/auth');
const { broadcast } = require('../websocket');
const {
  buildFtsQuery,
  buildKnowledgebaseNoMatchReply,
  buildKnowledgebasePrompt,
  chunkMarkdownContent,
  collectMarkdownFiles,
  ensureReadableDirectory,
  extractAnthropicText,
  extractGeminiText,
  isPathInside,
  sanitizeUploadFilename,
  tokenizeSearchTerms,
} = require('../utils/knowledgebase');

const router = express.Router({ mergeParams: true });
const PROVIDERS = new Set(['gemini', 'anthropic']);
const DEFAULT_MODELS = {
  gemini: 'gemini-2.5-pro',
  anthropic: 'claude-sonnet-4-20250514',
};

const markdownUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedMime = new Set([
      'text/markdown',
      'text/plain',
      'text/x-markdown',
      'application/octet-stream',
    ]);
    if (ext !== '.md') return cb(new Error('Only markdown files are allowed'));
    if (file.mimetype && !allowedMime.has(file.mimetype)) {
      return cb(new Error('Only markdown files are allowed'));
    }
    return cb(null, true);
  },
});

function verifyTripAccess(tripId, userId) {
  return canAccessTrip(tripId, userId);
}

function avatarUrl(user) {
  return user?.avatar ? `/uploads/avatars/${user.avatar}` : null;
}

function getKnowledgebaseConfig(tripId) {
  return db.prepare(`
    SELECT kc.*
    FROM knowledgebase_configs kc
    WHERE kc.trip_id = ?
  `).get(tripId);
}

function getKnowledgebaseKeys() {
  return db.prepare(`
    SELECT gemini_api_key, anthropic_api_key
    FROM users
    WHERE role = 'admin'
    ORDER BY id ASC
    LIMIT 1
  `).get() || {};
}

function getKnowledgebaseStats(tripId) {
  return db.prepare(`
    SELECT
      COUNT(DISTINCT relative_path) AS file_count,
      COUNT(*) AS chunk_count,
      MAX(indexed_at) AS last_indexed_at
    FROM knowledgebase_chunks
    WHERE trip_id = ?
  `).get(tripId) || { file_count: 0, chunk_count: 0, last_indexed_at: null };
}

function serializeConfig(config, stats, isAdmin) {
  if (!config) {
    return {
      configured: false,
      provider: 'gemini',
      model: DEFAULT_MODELS.gemini,
      allow_uploads: true,
      stats,
    };
  }

  const payload = {
    configured: true,
    provider: config.provider,
    model: config.model,
    allow_uploads: !!config.allow_uploads,
    updated_at: config.updated_at,
    last_indexed_at: config.last_indexed_at || stats.last_indexed_at || null,
    stats,
  };

  if (isAdmin) {
    payload.vault_path = config.vault_path;
    payload.upload_path = config.upload_path;
  }

  return payload;
}

function parseCitations(raw) {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function formatMessage(row) {
  const ownRole = row.role === 'assistant' ? 'assistant' : 'user';
  return {
    id: row.id,
    role: ownRole,
    content: row.content,
    provider: row.provider || null,
    model: row.model || null,
    citations: parseCitations(row.citations),
    created_at: row.created_at,
    user_id: row.user_id || null,
    username: row.username || 'Knowledgebase',
    avatar_url: row.role === 'assistant' ? null : avatarUrl(row),
  };
}

function loadMessages(tripId, limit = 100) {
  const rows = db.prepare(`
    SELECT km.*, u.username, u.avatar
    FROM knowledgebase_messages km
    LEFT JOIN users u ON km.user_id = u.id
    WHERE km.trip_id = ?
    ORDER BY km.id DESC
    LIMIT ?
  `).all(tripId, limit);

  return rows.reverse().map(formatMessage);
}

function loadMessageById(messageId) {
  return formatMessage(db.prepare(`
    SELECT km.*, u.username, u.avatar
    FROM knowledgebase_messages km
    LEFT JOIN users u ON km.user_id = u.id
    WHERE km.id = ?
  `).get(messageId));
}

function insertKnowledgebaseExchange({ tripId, userId, question, assistantContent, provider = null, model = null, citations = [] }) {
  const insertMessage = db.prepare(`
    INSERT INTO knowledgebase_messages (trip_id, user_id, role, content, provider, model, citations)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const userInsert = insertMessage.run(tripId, userId, 'user', question, null, null, null);
  const assistantInsert = insertMessage.run(
    tripId,
    null,
    'assistant',
    assistantContent,
    provider,
    model,
    citations.length > 0 ? JSON.stringify(citations) : null
  );

  return {
    userMessage: loadMessageById(userInsert.lastInsertRowid),
    assistantMessage: loadMessageById(assistantInsert.lastInsertRowid),
  };
}

function removeChunksByIds(chunkIds) {
  if (!chunkIds || chunkIds.length === 0) return;
  const placeholders = chunkIds.map(() => '?').join(',');
  db.prepare(`DELETE FROM knowledgebase_chunks_fts WHERE rowid IN (${placeholders})`).run(...chunkIds);
  db.prepare(`DELETE FROM knowledgebase_chunks WHERE id IN (${placeholders})`).run(...chunkIds);
}

function buildChunkRows(vaultPath, filePath) {
  const stat = fs.statSync(filePath);
  const raw = fs.readFileSync(filePath, 'utf8');
  const relativePath = path.relative(vaultPath, filePath).split(path.sep).join('/');
  const chunks = chunkMarkdownContent(raw, relativePath);

  return chunks.map(chunk => ({
    relative_path: relativePath,
    title: chunk.title,
    heading: chunk.heading,
    chunk_index: chunk.chunkIndex,
    chunk_text: chunk.chunkText,
    excerpt: chunk.excerpt,
    file_modified_at: stat.mtime.toISOString(),
    file_size: stat.size,
  }));
}

const replaceTripIndex = db.transaction((tripId, chunkRows) => {
  const existingIds = db.prepare('SELECT id FROM knowledgebase_chunks WHERE trip_id = ?').all(tripId).map(row => row.id);
  removeChunksByIds(existingIds);

  const insertChunk = db.prepare(`
    INSERT INTO knowledgebase_chunks (
      trip_id, relative_path, title, heading, chunk_index, chunk_text, excerpt, file_modified_at, file_size
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertFts = db.prepare(`
    INSERT INTO knowledgebase_chunks_fts (rowid, trip_id, chunk_text, title, heading, relative_path)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const row of chunkRows) {
    const result = insertChunk.run(
      tripId,
      row.relative_path,
      row.title,
      row.heading,
      row.chunk_index,
      row.chunk_text,
      row.excerpt,
      row.file_modified_at,
      row.file_size
    );

    insertFts.run(
      result.lastInsertRowid,
      String(tripId),
      row.chunk_text,
      row.title,
      row.heading,
      row.relative_path
    );
  }

  db.prepare(`
    UPDATE knowledgebase_configs
    SET last_indexed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE trip_id = ?
  `).run(tripId);
});

const replaceSingleFileIndex = db.transaction((tripId, chunkRows, relativePath) => {
  const existingIds = db.prepare(`
    SELECT id
    FROM knowledgebase_chunks
    WHERE trip_id = ? AND relative_path = ?
  `).all(tripId, relativePath).map(row => row.id);
  removeChunksByIds(existingIds);

  const insertChunk = db.prepare(`
    INSERT INTO knowledgebase_chunks (
      trip_id, relative_path, title, heading, chunk_index, chunk_text, excerpt, file_modified_at, file_size
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertFts = db.prepare(`
    INSERT INTO knowledgebase_chunks_fts (rowid, trip_id, chunk_text, title, heading, relative_path)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const row of chunkRows) {
    const result = insertChunk.run(
      tripId,
      row.relative_path,
      row.title,
      row.heading,
      row.chunk_index,
      row.chunk_text,
      row.excerpt,
      row.file_modified_at,
      row.file_size
    );
    insertFts.run(
      result.lastInsertRowid,
      String(tripId),
      row.chunk_text,
      row.title,
      row.heading,
      row.relative_path
    );
  }

  db.prepare(`
    UPDATE knowledgebase_configs
    SET last_indexed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE trip_id = ?
  `).run(tripId);
});

function reindexTripKnowledgebase(tripId, config) {
  const vaultPath = ensureReadableDirectory(config.vault_path);
  const files = collectMarkdownFiles(vaultPath);
  const rows = files.flatMap(filePath => buildChunkRows(vaultPath, filePath));
  replaceTripIndex(tripId, rows);
  return {
    indexed_files: files.length,
    indexed_chunks: rows.length,
  };
}

function indexUploadedFile(tripId, config, absoluteFilePath) {
  const vaultPath = ensureReadableDirectory(config.vault_path);
  const rows = buildChunkRows(vaultPath, absoluteFilePath);
  const relativePath = path.relative(vaultPath, absoluteFilePath).split(path.sep).join('/');
  replaceSingleFileIndex(tripId, rows, relativePath);
  return { relativePath, chunkCount: rows.length };
}

function searchKnowledgebaseSnippets(tripId, question, limit = 6) {
  const ftsQuery = buildFtsQuery(question);
  let rows = [];

  if (ftsQuery) {
    try {
      rows = db.prepare(`
        SELECT
          c.id,
          c.relative_path,
          c.title,
          c.heading,
          c.chunk_text,
          c.chunk_index,
          bm25(knowledgebase_chunks_fts) AS score
        FROM knowledgebase_chunks_fts
        JOIN knowledgebase_chunks c ON c.id = knowledgebase_chunks_fts.rowid
        WHERE knowledgebase_chunks_fts MATCH ?
          AND knowledgebase_chunks_fts.trip_id = ?
        ORDER BY score
        LIMIT ?
      `).all(ftsQuery, String(tripId), limit);
    } catch {
      rows = [];
    }
  }

  if (rows.length > 0) return rows;

  const looseTokens = tokenizeSearchTerms(question, 3);
  if (looseTokens.length === 0) return [];

  const tokenClauses = looseTokens
    .map(() => `(
      LOWER(chunk_text) LIKE ?
      OR LOWER(COALESCE(title, '')) LIKE ?
      OR LOWER(COALESCE(heading, '')) LIKE ?
      OR LOWER(relative_path) LIKE ?
    )`)
    .join(' OR ');

  const params = [
    tripId,
    ...looseTokens.flatMap(token => {
      const pattern = `%${token}%`;
      return [pattern, pattern, pattern, pattern];
    }),
    Math.max(limit * 8, 40),
  ];

  const candidates = db.prepare(`
    SELECT
      id,
      relative_path,
      title,
      heading,
      chunk_text,
      chunk_index,
      file_modified_at
    FROM knowledgebase_chunks
    WHERE trip_id = ?
      AND (${tokenClauses})
    ORDER BY file_modified_at DESC, id DESC
    LIMIT ?
  `).all(...params);

  const scored = candidates
    .map(row => {
      const relativePath = String(row.relative_path || '').toLowerCase();
      const title = String(row.title || '').toLowerCase();
      const heading = String(row.heading || '').toLowerCase();
      const text = String(row.chunk_text || '').toLowerCase();

      const score = looseTokens.reduce((sum, token) => {
        let tokenScore = 0;
        if (relativePath.includes(token)) tokenScore += 5;
        if (title.includes(token)) tokenScore += 7;
        if (heading.includes(token)) tokenScore += 6;
        if (text.includes(token)) tokenScore += 2;
        return sum + tokenScore;
      }, 0);

      return { ...row, score };
    })
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || String(b.file_modified_at || '').localeCompare(String(a.file_modified_at || '')) || b.id - a.id)
    .slice(0, limit);

  return scored;
}

async function requestGemini(model, apiKey, prompt) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || 'Gemini request failed');
  }

  const text = extractGeminiText(body);
  if (!text) throw new Error('Gemini returned an empty response');
  return text;
}

async function requestAnthropic(model, apiKey, prompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 900,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || 'Anthropic request failed');
  }

  const text = extractAnthropicText(body);
  if (!text) throw new Error('Anthropic returned an empty response');
  return text;
}

async function generateAnswer(provider, model, apiKey, prompt) {
  if (provider === 'gemini') return requestGemini(model, apiKey, prompt);
  if (provider === 'anthropic') return requestAnthropic(model, apiKey, prompt);
  throw new Error('Unsupported provider');
}

function loadKnowledgebaseSource(config, relativePath) {
  const vaultPath = ensureReadableDirectory(config.vault_path);
  const normalizedRelativePath = String(relativePath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim();

  if (!normalizedRelativePath) throw new Error('Source path is required');

  const absolutePath = path.resolve(vaultPath, normalizedRelativePath);
  if (!isPathInside(vaultPath, absolutePath)) {
    throw new Error('Source path must stay inside the vault path');
  }

  const stat = fs.statSync(absolutePath, { throwIfNoEntry: false });
  if (!stat || !stat.isFile()) throw new Error('Source file not found');
  if (path.extname(absolutePath).toLowerCase() !== '.md') {
    throw new Error('Only markdown sources can be opened');
  }

  return {
    relative_path: normalizedRelativePath,
    content: fs.readFileSync(absolutePath, 'utf8'),
    file_modified_at: stat.mtime.toISOString(),
  };
}

router.get('/', authenticate, (req, res) => {
  const tripId = Number(req.params.tripId);
  if (!verifyTripAccess(tripId, req.user.id)) return res.status(404).json({ error: 'Trip not found' });

  const config = getKnowledgebaseConfig(tripId);
  const stats = getKnowledgebaseStats(tripId);
  const keys = getKnowledgebaseKeys();

  res.json({
    config: serializeConfig(config, stats, req.user.role === 'admin'),
    capabilities: {
      can_configure: req.user.role === 'admin',
      can_upload: !!config?.allow_uploads,
      has_gemini_key: !!keys.gemini_api_key,
      has_anthropic_key: !!keys.anthropic_api_key,
    },
    messages: loadMessages(tripId),
  });
});

router.put('/config', authenticate, adminOnly, (req, res) => {
  const tripId = Number(req.params.tripId);
  if (!verifyTripAccess(tripId, req.user.id)) return res.status(404).json({ error: 'Trip not found' });

  try {
    const provider = PROVIDERS.has(req.body.provider) ? req.body.provider : 'gemini';
    const model = String(req.body.model || DEFAULT_MODELS[provider]).trim() || DEFAULT_MODELS[provider];
    const vaultPath = ensureReadableDirectory(req.body.vault_path);
    const uploadPath = ensureReadableDirectory(req.body.upload_path);
    const allowUploads = req.body.allow_uploads !== false;

    if (!isPathInside(vaultPath, uploadPath)) {
      return res.status(400).json({ error: 'Upload path must be inside the vault path' });
    }

    fs.accessSync(uploadPath, fs.constants.W_OK);

    db.prepare(`
      INSERT INTO knowledgebase_configs (
        trip_id, vault_path, upload_path, provider, model, allow_uploads, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(trip_id) DO UPDATE SET
        vault_path = excluded.vault_path,
        upload_path = excluded.upload_path,
        provider = excluded.provider,
        model = excluded.model,
        allow_uploads = excluded.allow_uploads,
        updated_by = excluded.updated_by,
        updated_at = CURRENT_TIMESTAMP
    `).run(tripId, vaultPath, uploadPath, provider, model, allowUploads ? 1 : 0, req.user.id);

    const config = getKnowledgebaseConfig(tripId);
    const stats = getKnowledgebaseStats(tripId);
    const payload = serializeConfig(config, stats, true);

    res.json({ config: payload });
    broadcast(tripId, 'knowledgebase:config:updated', { config: serializeConfig(config, stats, false) }, req.headers['x-socket-id']);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Invalid knowledgebase configuration' });
  }
});

router.post('/reindex', authenticate, adminOnly, (req, res) => {
  const tripId = Number(req.params.tripId);
  if (!verifyTripAccess(tripId, req.user.id)) return res.status(404).json({ error: 'Trip not found' });

  try {
    const config = getKnowledgebaseConfig(tripId);
    if (!config) return res.status(400).json({ error: 'Knowledgebase is not configured yet' });

    const result = reindexTripKnowledgebase(tripId, config);
    const stats = getKnowledgebaseStats(tripId);

    res.json({ success: true, ...result, stats });
    broadcast(tripId, 'knowledgebase:indexed', { stats }, req.headers['x-socket-id']);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to reindex knowledgebase' });
  }
});

router.post('/query', authenticate, async (req, res) => {
  const tripId = Number(req.params.tripId);
  if (!verifyTripAccess(tripId, req.user.id)) return res.status(404).json({ error: 'Trip not found' });

  const question = String(req.body.question || '').trim();
  if (!question) return res.status(400).json({ error: 'Question is required' });

  try {
    const config = getKnowledgebaseConfig(tripId);
    if (!config) return res.status(400).json({ error: 'Knowledgebase is not configured yet' });
    const stats = getKnowledgebaseStats(tripId);

    const keys = getKnowledgebaseKeys();
    const provider = PROVIDERS.has(config.provider) ? config.provider : 'gemini';
    const apiKey = provider === 'anthropic' ? keys.anthropic_api_key : keys.gemini_api_key;
    if (!apiKey) {
      return res.status(400).json({ error: `No ${provider} API key has been configured` });
    }

    const snippets = searchKnowledgebaseSnippets(tripId, question, 6);
    if (snippets.length === 0) {
      const reply = buildKnowledgebaseNoMatchReply(stats);
      const { userMessage, assistantMessage } = insertKnowledgebaseExchange({
        tripId,
        userId: req.user.id,
        question,
        assistantContent: reply,
      });

      res.status(201).json({ userMessage, assistantMessage });
      broadcast(tripId, 'knowledgebase:message:created', { message: userMessage }, req.headers['x-socket-id']);
      broadcast(tripId, 'knowledgebase:message:created', { message: assistantMessage }, req.headers['x-socket-id']);
      return;
    }

    const history = loadMessages(tripId, 8).map(message => ({
      role: message.role,
      content: message.content,
    }));

    const prompt = buildKnowledgebasePrompt({ question, snippets, history });
    const answer = await generateAnswer(provider, config.model || DEFAULT_MODELS[provider], apiKey, prompt);
    const citations = snippets.map((snippet, index) => ({
      index: index + 1,
      relative_path: snippet.relative_path,
      title: snippet.title,
      heading: snippet.heading,
      excerpt: snippet.chunk_text.slice(0, 280),
    }));

    const { userMessage, assistantMessage } = insertKnowledgebaseExchange({
      tripId,
      userId: req.user.id,
      question,
      assistantContent: answer,
      provider,
      model: config.model || DEFAULT_MODELS[provider],
      citations,
    });

    res.status(201).json({ userMessage, assistantMessage });
    broadcast(tripId, 'knowledgebase:message:created', { message: userMessage }, req.headers['x-socket-id']);
    broadcast(tripId, 'knowledgebase:message:created', { message: assistantMessage }, req.headers['x-socket-id']);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Knowledgebase query failed' });
  }
});

router.get('/source', authenticate, (req, res) => {
  const tripId = Number(req.params.tripId);
  if (!verifyTripAccess(tripId, req.user.id)) return res.status(404).json({ error: 'Trip not found' });

  try {
    const config = getKnowledgebaseConfig(tripId);
    if (!config) return res.status(400).json({ error: 'Knowledgebase is not configured yet' });

    const source = loadKnowledgebaseSource(config, req.query.path);
    res.json(source);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to open knowledgebase source' });
  }
});

router.post('/upload', authenticate, demoUploadBlock, markdownUpload.single('file'), (req, res) => {
  const tripId = Number(req.params.tripId);
  if (!verifyTripAccess(tripId, req.user.id)) return res.status(404).json({ error: 'Trip not found' });
  if (!req.file) return res.status(400).json({ error: 'Markdown file is required' });

  try {
    const config = getKnowledgebaseConfig(tripId);
    if (!config) return res.status(400).json({ error: 'Knowledgebase is not configured yet' });
    if (!config.allow_uploads) return res.status(403).json({ error: 'Uploads are disabled for this knowledgebase' });

    const vaultPath = ensureReadableDirectory(config.vault_path);
    const uploadPath = ensureReadableDirectory(config.upload_path);
    if (!isPathInside(vaultPath, uploadPath)) {
      return res.status(400).json({ error: 'Upload path must stay inside the vault path' });
    }

    let fileName = sanitizeUploadFilename(req.file.originalname);
    let targetPath = path.join(uploadPath, fileName);

    if (fs.existsSync(targetPath)) {
      const stem = fileName.slice(0, -3);
      fileName = `${stem}-${Date.now()}.md`;
      targetPath = path.join(uploadPath, fileName);
    }

    fs.writeFileSync(targetPath, req.file.buffer);
    const { relativePath, chunkCount } = indexUploadedFile(tripId, config, targetPath);

    const uploadedFile = {
      file_name: fileName,
      relative_path: relativePath,
      uploaded_by: req.user.username,
      chunk_count: chunkCount,
    };

    res.status(201).json({ file: uploadedFile, stats: getKnowledgebaseStats(tripId) });
    broadcast(tripId, 'knowledgebase:file:uploaded', { file: uploadedFile }, req.headers['x-socket-id']);
    broadcast(tripId, 'knowledgebase:indexed', { stats: getKnowledgebaseStats(tripId) }, req.headers['x-socket-id']);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Markdown upload failed' });
  }
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message || 'Knowledgebase request failed' });
  }
  return next();
});

module.exports = router;
