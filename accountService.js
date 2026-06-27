const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/db');
const { ImapEngine } = require('../imap-engine/imapEngine');
const { SmtpEngine, getSmtpPreset } = require('../smtp-engine/smtpEngine');
const log = require('electron-log');

function listAccounts() {
  const db = getDb();
  return db.prepare('SELECT * FROM accounts ORDER BY created_at ASC').all();
}

function addAccount(account) {
  const db = getDb();
  const id = uuidv4();

  // Auto-detect SMTP if not provided
  if (!account.smtp_host) {
    const preset = getSmtpPreset(account.email);
    if (preset) {
      account.smtp_host = preset.host;
      account.smtp_port = preset.port;
      account.smtp_secure = preset.secure ? 1 : 0;
    }
  }

  // Store password securely (base64 encoded in settings table)
  if (account.password) {
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(
      `pwd_${id}`,
      Buffer.from(account.password).toString('base64')
    );
  }

  db.prepare(`
    INSERT INTO accounts (
      id, name, email, display_name,
      imap_host, imap_port, imap_secure,
      smtp_host, smtp_port, smtp_secure,
      auth_type, color
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    account.name || account.email,
    account.email,
    account.display_name || account.name || account.email,
    account.imap_host,
    account.imap_port || 993,
    account.imap_secure !== false ? 1 : 0,
    account.smtp_host || '',
    account.smtp_port || 587,
    account.smtp_secure ? 1 : 0,
    account.auth_type || 'password',
    account.color || '#00ff94'
  );

  // Trigger initial sync
  const { triggerSync } = require('../sync-worker/syncWorker');
  setTimeout(() => triggerSync(id).catch(log.error), 1000);

  return { id, ...account };
}

function removeAccount(id) {
  const db = getDb();
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  db.prepare('DELETE FROM settings WHERE key = ?').run(`pwd_${id}`);
  return { success: true };
}

function updateAccount(id, data) {
  const db = getDb();
  const fields = [];
  const values = [];

  const allowed = ['name', 'display_name', 'imap_host', 'imap_port', 'imap_secure',
                   'smtp_host', 'smtp_port', 'smtp_secure', 'color', 'is_active'];

  for (const key of allowed) {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(data[key]);
    }
  }

  if (data.password) {
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(
      `pwd_${id}`,
      Buffer.from(data.password).toString('base64')
    );
  }

  if (fields.length > 0) {
    fields.push('updated_at = unixepoch()');
    values.push(id);
    db.prepare(`UPDATE accounts SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  return getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id);
}

async function testConnection(config) {
  const mockAccount = {
    id: 'test',
    email: config.email,
    imap_host: config.imap_host,
    imap_port: config.imap_port || 993,
    imap_secure: config.imap_secure !== false ? 1 : 0,
    smtp_host: config.smtp_host,
    smtp_port: config.smtp_port || 587,
    smtp_secure: config.smtp_secure ? 1 : 0,
    auth_type: 'password',
  };

  // Temp store password
  const db = getDb();
  if (config.password) {
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(
      `pwd_test`,
      Buffer.from(config.password).toString('base64')
    );
  }

  const imapEngine = new ImapEngine(mockAccount);
  const smtpEngine = new SmtpEngine(mockAccount);

  const [imapResult, smtpResult] = await Promise.allSettled([
    imapEngine.testConnection(),
    smtpEngine.testConnection(),
  ]);

  db.prepare('DELETE FROM settings WHERE key = ?').run('pwd_test');

  return {
    imap: imapResult.status === 'fulfilled' ? imapResult.value : { success: false, error: imapResult.reason?.message },
    smtp: smtpResult.status === 'fulfilled' ? smtpResult.value : { success: false, error: smtpResult.reason?.message },
  };
}

module.exports = { listAccounts, addAccount, removeAccount, updateAccount, testConnection };
