const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

const serverRoot = path.resolve(__dirname, '..');

function seedLegacyPreSessionIdDb(dbPath) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE knowledgebase_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL,
      user_id INTEGER,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      citations TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.close();
}

function runInitDbInChildProcess(dataDir) {
  return spawnSync(process.execPath, ['-e', 'require("./src/db/database");'], {
    cwd: serverRoot,
    env: {
      ...process.env,
      NOMAD_DATA_DIR: dataDir,
      DEMO_MODE: 'false',
      TRUSTED_MODE: 'false',
    },
    encoding: 'utf-8',
  });
}

test('initDb recovers a pre-PR-11 database that lacks knowledgebase_messages.session_id', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomad-dbinit-legacy-'));
  try {
    const dbPath = path.join(tmpDir, 'travel.db');
    seedLegacyPreSessionIdDb(dbPath);

    const result = runInitDbInChildProcess(tmpDir);

    assert.equal(
      result.status,
      0,
      `initDb exited with ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );

    const db = new Database(dbPath, { readonly: true });
    try {
      const columns = db
        .prepare("SELECT name FROM pragma_table_info('knowledgebase_messages')")
        .all()
        .map(row => row.name);
      assert.ok(
        columns.includes('session_id'),
        `migration 34 did not add session_id — columns: ${columns.join(', ')}`,
      );

      const hasIndex = db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_knowledgebase_messages_trip_session'",
        )
        .get();
      assert.ok(hasIndex, 'idx_knowledgebase_messages_trip_session missing after initDb');
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('initDb succeeds against a fresh empty data directory', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomad-dbinit-fresh-'));
  try {
    const result = runInitDbInChildProcess(tmpDir);

    assert.equal(
      result.status,
      0,
      `initDb exited with ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );

    const dbPath = path.join(tmpDir, 'travel.db');
    assert.ok(fs.existsSync(dbPath), 'travel.db was not created');

    const db = new Database(dbPath, { readonly: true });
    try {
      const columns = db
        .prepare("SELECT name FROM pragma_table_info('knowledgebase_messages')")
        .all()
        .map(row => row.name);
      assert.ok(columns.includes('session_id'), 'fresh DB missing session_id column');
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
