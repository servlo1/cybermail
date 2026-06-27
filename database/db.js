const path = require('path');
const { app } = require('electron');
const log = require('electron-log');
const fs = require('fs');

let db;

function getDbPath() {
  const base = app ? app.getPath('userData') : path.join(process.cwd(), '.cybermail');
  return path.join(base, 'cybermail.db');
}

function clearStaleLock(dbPath) {
  for (const ext of ['-wal', '-shm']) {
    const p = dbPath + ext;
    try { if (fs.existsSync(p)) { fs.unlinkSync(p); log.info('Removed stale lock:', p); } }
    catch (e) { log.warn('Cannot remove', p, e.message); }
  }
}

async function initialize() {
  const Database = require('better-sqlite3');
  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  log.info('Opening database at', dbPath);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      db = new Database(dbPath, { timeout: 10000 });
      break;
    } catch (err) {
      if (attempt === 1) throw err;
      log.warn('DB open failed, clearing stale lock:', err.message);
      clearStaleLock(dbPath);
      await new Promise(r => setTimeout(r, 500));
    }
  }

  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 10000');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = OFF'); // OFF during migrations so we can alter tables
  db.pragma('cache_size = -32000');
  db.pragma('temp_store = MEMORY');

  // Step 1: fix legacy column names BEFORE running any migrations
  repairLegacySchema();

  // Step 2: drop/recreate FTS if it references wrong columns
  repairFts();

  // Step 3: create any missing tables / indexes
  runMigrations();

  // Re-enable FK enforcement
  db.pragma('foreign_keys = ON');

  log.info('Database ready at', dbPath);
  return db;
}

/**
 * Rename legacy columns that changed between versions.
 * SQLite doesn't support ALTER COLUMN, so we use the rename-table method.
 */
function repairLegacySchema() {
  // Check if emails table exists
  const emailsTable = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='emails'"
  ).get();

  if (!emailsTable) return; // fresh DB, nothing to repair

  const sql = emailsTable.sql || '';

  // Detect if old schema uses 'from_address' instead of 'from_email'
  const hasFromAddress = /\bfrom_address\b/.test(sql);
  const hasFromEmail   = /\bfrom_email\b/.test(sql);

  if (hasFromAddress && !hasFromEmail) {
    log.info('Migrating emails.from_address → from_email');

    // Get all column names from old table
    const cols = db.pragma('table_info(emails)').map(c => c.name);

    // Build column list, renaming from_address → from_email
    const oldCols = cols.join(', ');
    const newCols = cols.map(c => c === 'from_address' ? 'from_email' : c).join(', ');

	db.exec(`
	  -- Remove ALL possible legacy triggers
	  DROP TRIGGER IF EXISTS emails_ai;
	  DROP TRIGGER IF EXISTS emails_au;
	  DROP TRIGGER IF EXISTS emails_ad;

	  DROP TRIGGER IF EXISTS emails_fts_insert;
	  DROP TRIGGER IF EXISTS emails_fts_update;
	  DROP TRIGGER IF EXISTS emails_fts_delete;

	  DROP TABLE IF EXISTS emails_fts;

	  ALTER TABLE emails RENAME TO emails_old;

	  CREATE TABLE emails (
		id TEXT PRIMARY KEY,
		account_id TEXT NOT NULL,
		folder_path TEXT NOT NULL,
		uid INTEGER,
		message_id TEXT,
		thread_id TEXT,
		subject TEXT,
		from_name TEXT,
		from_email TEXT NOT NULL DEFAULT '',
		to_addresses TEXT DEFAULT '[]',
		cc_addresses TEXT DEFAULT '[]',
		bcc_addresses TEXT DEFAULT '[]',
		reply_to TEXT,
		date INTEGER,
		received_at INTEGER NOT NULL DEFAULT (unixepoch()),
		body_html TEXT,
		body_text TEXT,
		snippet TEXT,
		is_read INTEGER NOT NULL DEFAULT 0,
		is_starred INTEGER NOT NULL DEFAULT 0,
		is_deleted INTEGER NOT NULL DEFAULT 0,
		has_attachments INTEGER NOT NULL DEFAULT 0,
		flags TEXT DEFAULT '[]',
		headers TEXT DEFAULT '{}',
		raw_size INTEGER DEFAULT 0,
		UNIQUE(account_id, folder_path, uid)
	  );

	  INSERT INTO emails (${newCols})
	  SELECT ${oldCols} FROM emails_old;

	  DROP TABLE emails_old;
	`);

    log.info('emails table column migration complete');
  }

  // Also repair any other known column renames here as needed
}

/**
 * Drop and recreate the FTS table if its schema doesn't match what we need.
 */
function repairFts() {
  // Remove ALL trigger names from every previous version
  db.exec(`
    DROP TRIGGER IF EXISTS emails_ai;
    DROP TRIGGER IF EXISTS emails_au;
    DROP TRIGGER IF EXISTS emails_ad;

    DROP TRIGGER IF EXISTS emails_fts_insert;
    DROP TRIGGER IF EXISTS emails_fts_update;
    DROP TRIGGER IF EXISTS emails_fts_delete;
  `);

  const ftsRow = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='emails_fts'"
  ).get();

  if (!ftsRow) return;

  const sql = ftsRow.sql || '';
  const ok = sql.includes('from_email') && !sql.includes('from_address');

  if (!ok) {
    log.info('Dropping incompatible emails_fts for rebuild');

    db.exec(`
      DROP TABLE IF EXISTS emails_fts;
    `);
  }
}

function runMigrations() {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT,
        imap_host TEXT NOT NULL,
        imap_port INTEGER NOT NULL DEFAULT 993,
        imap_secure INTEGER NOT NULL DEFAULT 1,
        smtp_host TEXT NOT NULL DEFAULT '',
        smtp_port INTEGER NOT NULL DEFAULT 587,
        smtp_secure INTEGER NOT NULL DEFAULT 0,
        auth_type TEXT NOT NULL DEFAULT 'password',
        oauth_access_token TEXT,
        oauth_refresh_token TEXT,
        oauth_expires_at INTEGER,
        color TEXT DEFAULT '#00ff94',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        type TEXT DEFAULT 'custom',
        unread_count INTEGER DEFAULT 0,
        total_count INTEGER DEFAULT 0,
        uid_validity INTEGER,
        uid_next INTEGER,
        last_synced_at INTEGER,
        UNIQUE(account_id, path)
      );

      CREATE TABLE IF NOT EXISTS emails (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        folder_path TEXT NOT NULL,
        uid INTEGER,
        message_id TEXT,
        thread_id TEXT,
        subject TEXT,
        from_name TEXT,
        from_email TEXT NOT NULL DEFAULT '',
        to_addresses TEXT DEFAULT '[]',
        cc_addresses TEXT DEFAULT '[]',
        bcc_addresses TEXT DEFAULT '[]',
        reply_to TEXT,
        date INTEGER,
        received_at INTEGER NOT NULL DEFAULT (unixepoch()),
        body_html TEXT,
        body_text TEXT,
        snippet TEXT,
        is_read INTEGER NOT NULL DEFAULT 0,
        is_starred INTEGER NOT NULL DEFAULT 0,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        has_attachments INTEGER NOT NULL DEFAULT 0,
        flags TEXT DEFAULT '[]',
        headers TEXT DEFAULT '{}',
        raw_size INTEGER DEFAULT 0,
        UNIQUE(account_id, folder_path, uid)
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS emails_fts USING fts5(
        id UNINDEXED,
        subject,
        from_name,
        from_email,
        body_text,
        snippet,
        content=emails,
        content_rowid=rowid
      );

      CREATE TRIGGER IF NOT EXISTS emails_fts_insert AFTER INSERT ON emails BEGIN
        INSERT INTO emails_fts(rowid, id, subject, from_name, from_email, body_text, snippet)
        VALUES (new.rowid, new.id, new.subject, new.from_name, new.from_email, new.body_text, new.snippet);
      END;

      CREATE TRIGGER IF NOT EXISTS emails_fts_update AFTER UPDATE ON emails BEGIN
        UPDATE emails_fts
        SET subject=new.subject, from_name=new.from_name, from_email=new.from_email,
            body_text=new.body_text, snippet=new.snippet
        WHERE id=new.id;
      END;

      CREATE TRIGGER IF NOT EXISTS emails_fts_delete AFTER DELETE ON emails BEGIN
        DELETE FROM emails_fts WHERE id=old.id;
      END;

      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        email_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        mime_type TEXT,
        size INTEGER DEFAULT 0,
        content_id TEXT,
        is_inline INTEGER DEFAULT 0,
        file_path TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS drafts (
        id TEXT PRIMARY KEY,
        account_id TEXT,
        subject TEXT DEFAULT '',
        to_addresses TEXT DEFAULT '[]',
        cc_addresses TEXT DEFAULT '[]',
        bcc_addresses TEXT DEFAULT '[]',
        from_name TEXT DEFAULT '',
        from_email TEXT DEFAULT '',
        body_html TEXT DEFAULT '',
        body_text TEXT DEFAULT '',
        reply_to_id TEXT,
        forward_of_id TEXT,
        attachment_ids TEXT DEFAULT '[]',
        window_x INTEGER,
        window_y INTEGER,
        window_width INTEGER DEFAULT 750,
        window_height INTEGER DEFAULT 580,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS sync_state (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        folder_path TEXT NOT NULL,
        last_uid INTEGER DEFAULT 0,
        uid_validity INTEGER DEFAULT 0,
        highest_modseq TEXT DEFAULT '0',
        last_sync_at INTEGER DEFAULT 0,
        status TEXT DEFAULT 'idle',
        UNIQUE(account_id, folder_path)
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        body_html TEXT NOT NULL DEFAULT '',
        body_text TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS send_queue (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        attempts INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 3,
        status TEXT DEFAULT 'pending',
        error TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        next_attempt_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_emails_account_folder ON emails(account_id, folder_path);
      CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date DESC);
      CREATE INDEX IF NOT EXISTS idx_emails_from ON emails(from_email);
      CREATE INDEX IF NOT EXISTS idx_emails_read ON emails(is_read);
      CREATE INDEX IF NOT EXISTS idx_emails_deleted ON emails(is_deleted);
      CREATE INDEX IF NOT EXISTS idx_attachments_email ON attachments(email_id);
      CREATE INDEX IF NOT EXISTS idx_sync_state ON sync_state(account_id, folder_path);
    `);

    const set = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    set.run('theme', 'dark');
    set.run('signature_html', '');
    set.run('signature_plain', '');
    set.run('notifications_enabled', 'true');
    set.run('sync_interval_ms', '120000');

	// Rebuild FTS index if emails exist but FTS is empty
	const emailCount = db.prepare(
	  'SELECT COUNT(*) AS n FROM emails'
	).get().n;

	let ftsCount = 0;

	try {
	  ftsCount = db.prepare(
		'SELECT COUNT(*) AS n FROM emails_fts'
	  ).get().n;
	} catch (err) {
	  log.warn('FTS table missing, forcing rebuild:', err.message);
	  ftsCount = 0;
	}

	if (emailCount > 0 && ftsCount === 0) {
	  log.info(`Rebuilding FTS index for ${emailCount} existing emails`);

	  try {
		db.exec("INSERT INTO emails_fts(emails_fts) VALUES('rebuild')");
	  } catch (err) {
		log.warn('FTS rebuild failed:', err.message);
	  }
	}
  })(); // immediately invoke the transaction

  log.info('Schema migrations complete');
}

function getDb() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

function closeDb() {
  if (db) {
    try { db.pragma('wal_checkpoint(TRUNCATE)'); db.close(); db = null; log.info('DB closed'); }
    catch (e) { log.warn('DB close error:', e.message); }
  }
}

module.exports = { initialize, getDb, closeDb };
