/**
 * Manual DB repair script — run if CyberMail fails to start:
 *   node scripts/fix-db.js
 */
const path = require('path');
const os   = require('os');
const fs   = require('fs');

const dbPath = path.join(
  process.env.APPDATA || path.join(os.homedir(), '.config'),
  'cybermail', 'cybermail.db'
);

if (!fs.existsSync(dbPath)) {
  console.log('No database found at', dbPath, '— nothing to fix.');
  process.exit(0);
}

const Database = require('better-sqlite3');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = OFF');

console.log('Repairing database at', dbPath);

// ── 1. Fix from_address → from_email column rename ──────────────────────────
const emailsRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='emails'").get();
if (emailsRow && /\bfrom_address\b/.test(emailsRow.sql) && !/\bfrom_email\b/.test(emailsRow.sql)) {
  console.log('Renaming from_address → from_email in emails table...');
  const cols = db.pragma('table_info(emails)').map(c => c.name);
  const oldCols = cols.join(', ');
  const newCols = cols.map(c => c === 'from_address' ? 'from_email' : c).join(', ');

  db.exec(`
    DROP TRIGGER IF EXISTS emails_fts_insert;
    DROP TRIGGER IF EXISTS emails_fts_update;
    DROP TRIGGER IF EXISTS emails_fts_delete;
    DROP TABLE IF EXISTS emails_fts;
    ALTER TABLE emails RENAME TO emails_old;

    CREATE TABLE emails (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, folder_path TEXT NOT NULL,
      uid INTEGER, message_id TEXT, thread_id TEXT, subject TEXT, from_name TEXT,
      from_email TEXT NOT NULL DEFAULT '', to_addresses TEXT DEFAULT '[]',
      cc_addresses TEXT DEFAULT '[]', bcc_addresses TEXT DEFAULT '[]',
      reply_to TEXT, date INTEGER, received_at INTEGER NOT NULL DEFAULT (unixepoch()),
      body_html TEXT, body_text TEXT, snippet TEXT,
      is_read INTEGER NOT NULL DEFAULT 0, is_starred INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0, has_attachments INTEGER NOT NULL DEFAULT 0,
      flags TEXT DEFAULT '[]', headers TEXT DEFAULT '{}', raw_size INTEGER DEFAULT 0,
      UNIQUE(account_id, folder_path, uid)
    );

    INSERT INTO emails (${newCols}) SELECT ${oldCols} FROM emails_old;
    DROP TABLE emails_old;
  `);
  console.log('✓ Column renamed');
}

// ── 2. Rebuild FTS table ────────────────────────────────────────────────────
console.log('Rebuilding FTS table...');
db.exec(`
  DROP TRIGGER IF EXISTS emails_fts_insert;
  DROP TRIGGER IF EXISTS emails_fts_update;
  DROP TRIGGER IF EXISTS emails_fts_delete;
  DROP TABLE IF EXISTS emails_fts;

  CREATE VIRTUAL TABLE emails_fts USING fts5(
    id UNINDEXED, subject, from_name, from_email, body_text, snippet,
    content=emails, content_rowid=rowid
  );

  CREATE TRIGGER emails_fts_insert AFTER INSERT ON emails BEGIN
    INSERT INTO emails_fts(rowid, id, subject, from_name, from_email, body_text, snippet)
    VALUES (new.rowid, new.id, new.subject, new.from_name, new.from_email, new.body_text, new.snippet);
  END;

  CREATE TRIGGER emails_fts_update AFTER UPDATE ON emails BEGIN
    UPDATE emails_fts SET subject=new.subject, from_name=new.from_name,
      from_email=new.from_email, body_text=new.body_text, snippet=new.snippet
    WHERE id=new.id;
  END;

  CREATE TRIGGER emails_fts_delete AFTER DELETE ON emails BEGIN
    DELETE FROM emails_fts WHERE id=old.id;
  END;
`);

const n = db.prepare('SELECT COUNT(*) as n FROM emails').get().n;
if (n > 0) {
  console.log(`Re-indexing ${n} emails...`);
  db.exec("INSERT INTO emails_fts(emails_fts) VALUES('rebuild')");
}

db.pragma('foreign_keys = ON');
db.pragma('wal_checkpoint(TRUNCATE)');
db.close();

console.log('');
console.log('✓ Database repaired. Run: npm start');
