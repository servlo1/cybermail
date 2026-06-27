const { getDb } = require('../database/db');
const path = require('path');
const fs = require('fs');
const log = require('electron-log');

function listEmails({ accountId, folder = 'INBOX', page = 0, limit = 50, unreadOnly = false } = {}) {
  const db = getDb();
  const offset = page * limit;

  let query = `
    SELECT e.*,
      a.color as account_color,
      a.name as account_name,
      (SELECT COUNT(*) FROM attachments att WHERE att.email_id = e.id) as attachment_count
    FROM emails e
    JOIN accounts a ON a.id = e.account_id
    WHERE e.is_deleted = 0
  `;
  const params = [];

  if (accountId) {
    query += ' AND e.account_id = ?';
    params.push(accountId);
  }

  if (folder) {
    // Handle folder aliases
    const folderAliases = {
      'INBOX': ['INBOX', 'Inbox'],
      'Sent': ['Sent', 'Sent Items', 'Sent Mail', '[Gmail]/Sent Mail'],
      'Drafts': ['Drafts', '[Gmail]/Drafts'],
      'Trash': ['Trash', 'Deleted Items', '[Gmail]/Trash'],
      'Spam': ['Junk', 'Spam', '[Gmail]/Spam'],
    };
    const aliases = folderAliases[folder] || [folder];
    const placeholders = aliases.map(() => '?').join(',');
    query += ` AND e.folder_path IN (${placeholders})`;
    params.push(...aliases);
  }

  if (unreadOnly) {
    query += ' AND e.is_read = 0';
  }

  query += ' ORDER BY e.date DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const emails = db.prepare(query).all(...params);

  // Get total count
  let countQuery = `SELECT COUNT(*) as total FROM emails e WHERE e.is_deleted = 0`;
  const countParams = [];
  if (accountId) { countQuery += ' AND e.account_id = ?'; countParams.push(accountId); }
  if (folder) {
    const aliases = { 'INBOX': ['INBOX', 'Inbox'] }[folder] || [folder];
    countQuery += ` AND e.folder_path IN (${aliases.map(() => '?').join(',')})`;
    countParams.push(...aliases);
  }
  if (unreadOnly) countQuery += ' AND e.is_read = 0';

  const { total } = db.prepare(countQuery).get(...countParams);

  return { emails, total, page, limit };
}

function getEmail(id) {
  const db = getDb();
  const email = db.prepare(`
    SELECT e.*, a.color as account_color, a.name as account_name
    FROM emails e
    JOIN accounts a ON a.id = e.account_id
    WHERE e.id = ?
  `).get(id);

  if (!email) return null;

  const attachments = db.prepare('SELECT * FROM attachments WHERE email_id = ?').all(id);
  return { ...email, attachments };
}

function searchEmails(query) {
  if (!query || query.trim().length < 2) return [];
  const db = getDb();

  const sanitized = query.trim().replace(/['"*]/g, '').split(/\s+/).join(' ');

  try {
    const results = db.prepare(`
      SELECT e.id, e.subject, e.from_name, e.from_email, e.snippet,
             e.date, e.is_read, e.account_id, e.folder_path,
             a.color as account_color
      FROM emails_fts fts
      JOIN emails e ON e.id = fts.id
      JOIN accounts a ON a.id = e.account_id
      WHERE emails_fts MATCH ?
      AND e.is_deleted = 0
      ORDER BY rank
      LIMIT 50
    `).all(`${sanitized}*`);

    return results;
  } catch (err) {
    log.error('[EmailService] Search error:', err.message);
    // Fallback to LIKE search
    const like = `%${query}%`;
    return db.prepare(`
      SELECT e.id, e.subject, e.from_name, e.from_email, e.snippet,
             e.date, e.is_read, e.account_id, e.folder_path,
             a.color as account_color
      FROM emails e
      JOIN accounts a ON a.id = e.account_id
      WHERE e.is_deleted = 0 AND (
        e.subject LIKE ? OR e.from_name LIKE ? OR e.from_email LIKE ? OR e.body_text LIKE ?
      )
      ORDER BY e.date DESC LIMIT 50
    `).all(like, like, like, like);
  }
}

function markRead(id) {
  const db = getDb();
  db.prepare('UPDATE emails SET is_read = 1 WHERE id = ?').run(id);
  return { success: true };
}

function markUnread(id) {
  const db = getDb();
  db.prepare('UPDATE emails SET is_read = 0 WHERE id = ?').run(id);
  return { success: true };
}

function deleteEmail(id) {
  const db = getDb();
  db.prepare('UPDATE emails SET is_deleted = 1 WHERE id = ?').run(id);
  return { success: true };
}

function moveToFolder(id, folderPath) {
  const db = getDb();
  db.prepare('UPDATE emails SET folder_path = ? WHERE id = ?').run(folderPath, id);
  return { success: true };
}

function getAttachment(attachId) {
  const db = getDb();
  const att = db.prepare('SELECT * FROM attachments WHERE id = ?').get(attachId);
  if (!att) return null;

  if (att.file_path && fs.existsSync(att.file_path)) {
    const data = fs.readFileSync(att.file_path);
    return {
      ...att,
      data: data.toString('base64'),
    };
  }
  return att;
}

module.exports = { listEmails, getEmail, searchEmails, markRead, markUnread, deleteEmail, moveToFolder, getAttachment };
