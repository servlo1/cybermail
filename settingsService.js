const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/db');

function getSettings() {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) {
    if (!row.key.startsWith('pwd_')) {
      try { settings[row.key] = JSON.parse(row.value); } catch { settings[row.key] = row.value; }
    }
  }
  return settings;
}

function updateSettings(data) {
  const db = getDb();
  const set = db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, unixepoch())`);
  for (const [key, value] of Object.entries(data)) {
    set.run(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  return { success: true };
}

function getSignature() {
  const db = getDb();
  const html = db.prepare("SELECT value FROM settings WHERE key = 'signature_html'").get();
  const plain = db.prepare("SELECT value FROM settings WHERE key = 'signature_plain'").get();
  return {
    html: html?.value || '',
    plain_text: plain?.value || ''
  };
}

function setSignature({ html, plain_text }) {
  const db = getDb();
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('signature_html', ?)`).run(html || '');
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('signature_plain', ?)`).run(plain_text || '');
  return { success: true };
}

function getTemplates() {
  const db = getDb();
  return db.prepare('SELECT * FROM templates ORDER BY name').all();
}

function saveTemplate({ name, body_html, body_text }) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM templates WHERE name = ?').get(name);
  const id = existing?.id || uuidv4();
  db.prepare(`
    INSERT OR REPLACE INTO templates (id, name, body_html, body_text, updated_at)
    VALUES (?, ?, ?, ?, unixepoch())
  `).run(id, name, body_html || '', body_text || '');
  return { id, name, body_html };
}

function deleteTemplate(name) {
  const db = getDb();
  db.prepare('DELETE FROM templates WHERE name = ?').run(name);
  return { success: true };
}

module.exports = { getSettings, updateSettings, getSignature, setSignature, getTemplates, saveTemplate, deleteTemplate };
