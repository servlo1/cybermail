const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/db');
const { SmtpEngine } = require('../smtp-engine/smtpEngine');
const { sendQueue } = require('../smtp-engine/smtpEngine');
const path = require('path');
const fs = require('fs');
const log = require('electron-log');
const { app } = require('electron');

async function sendEmail(payload) {
  const db = getDb();
  const accountId = payload.account_id;
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!account) throw new Error('Account not found');

  // Resolve attachment metadata
  let attachments = [];
  if (payload.attachment_ids?.length > 0) {
    attachments = db.prepare(
      `SELECT * FROM attachments WHERE id IN (${payload.attachment_ids.map(() => '?').join(',')})`
    ).all(...payload.attachment_ids);
  }

  const sendPayload = { ...payload, attachments };

  try {
    const engine = new SmtpEngine(account);
    const result = await engine.sendEmail(sendPayload);

    // Delete draft if sent successfully
    if (payload.draft_id) {
      db.prepare('DELETE FROM drafts WHERE id = ?').run(payload.draft_id);
    }

    // Store in Sent folder
    storeInSent(account, sendPayload, result.messageId);

    return result;
  } catch (err) {
    log.error('[ComposeService] Send failed, queuing:', err.message);
    const queueId = await sendQueue.enqueue(accountId, sendPayload);
    return { success: false, queued: true, queueId, error: err.message };
  }
}

function storeInSent(account, payload, messageId) {
  const db = getDb();
  const id = uuidv4();
  const sentFolder = 'Sent';

  try {
    db.prepare(`
      INSERT OR IGNORE INTO emails (
        id, account_id, folder_path, message_id,
        subject, from_name, from_email,
        to_addresses, cc_addresses, bcc_addresses,
        date, received_at,
        body_html, body_text, snippet,
        is_read, flags
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch(), ?, ?, ?, 1, '["\\Seen"]')
    `).run(
      id, account.id, sentFolder, messageId,
      payload.subject || '(no subject)',
      payload.from_name || account.display_name,
      payload.from_email || account.email,
      JSON.stringify(payload.to || []),
      JSON.stringify(payload.cc || []),
      JSON.stringify(payload.bcc || []),
      payload.body_html || '',
      payload.body_text || '',
      (payload.body_text || '').substring(0, 200)
    );
  } catch (err) {
    log.error('[ComposeService] storeInSent error:', err.message);
  }
}

function saveDraft(data) {
  const db = getDb();
  const id = data.id || uuidv4();
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT OR REPLACE INTO drafts (
      id, account_id, subject,
      to_addresses, cc_addresses, bcc_addresses,
      from_name, from_email,
      body_html, body_text,
      reply_to_id, forward_of_id,
      attachment_ids,
      window_x, window_y, window_width, window_height,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?,
      ?, ?, ?, ?,
      COALESCE((SELECT created_at FROM drafts WHERE id = ?), ?),
      ?
    )
  `).run(
    id,
    data.account_id || null,
    data.subject || '',
    JSON.stringify(data.to || []),
    JSON.stringify(data.cc || []),
    JSON.stringify(data.bcc || []),
    data.from_name || '',
    data.from_email || '',
    data.body_html || '',
    data.body_text || '',
    data.reply_to_id || null,
    data.forward_of_id || null,
    JSON.stringify(data.attachment_ids || []),
    data.window_x || null,
    data.window_y || null,
    data.window_width || 750,
    data.window_height || 580,
    id, now,
    now
  );

  return { id, success: true };
}

function getDraft(id) {
  const db = getDb();
  const draft = db.prepare('SELECT * FROM drafts WHERE id = ?').get(id);
  if (!draft) return null;

  // Parse JSON fields
  try { draft.to_addresses = JSON.parse(draft.to_addresses); } catch { draft.to_addresses = []; }
  try { draft.cc_addresses = JSON.parse(draft.cc_addresses); } catch { draft.cc_addresses = []; }
  try { draft.bcc_addresses = JSON.parse(draft.bcc_addresses); } catch { draft.bcc_addresses = []; }
  try { draft.attachment_ids = JSON.parse(draft.attachment_ids); } catch { draft.attachment_ids = []; }

  // Load attachments
  if (draft.attachment_ids.length > 0) {
    draft.attachments = db.prepare(
      `SELECT * FROM attachments WHERE id IN (${draft.attachment_ids.map(() => '?').join(',')})`
    ).all(...draft.attachment_ids);
  } else {
    draft.attachments = [];
  }

  return draft;
}

function deleteDraft(id) {
  const db = getDb();
  // Clean up attachments
  const attachments = db.prepare('SELECT * FROM attachments WHERE email_id = ?').all(id);
  for (const att of attachments) {
    if (att.file_path && fs.existsSync(att.file_path)) {
      try { fs.unlinkSync(att.file_path); } catch {}
    }
  }
  db.prepare('DELETE FROM drafts WHERE id = ?').run(id);
  return { success: true };
}

function listDrafts() {
  const db = getDb();
  return db.prepare('SELECT * FROM drafts ORDER BY updated_at DESC').all();
}

async function processAttachment(filePath) {
  const id = uuidv4();
  const filename = path.basename(filePath);
  const mime = require('mime-types').lookup(filePath) || 'application/octet-stream';
  const stats = fs.statSync(filePath);

  // Copy to app data
  const destDir = path.join(app.getPath('userData'), 'attachments', 'outgoing');
  fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, `${id}-${filename}`);
  fs.copyFileSync(filePath, destPath);

  const db = getDb();
  db.prepare(`
    INSERT INTO attachments (id, email_id, filename, mime_type, size, file_path)
    VALUES (?, 'draft', ?, ?, ?, ?)
  `).run(id, filename, mime, stats.size, destPath);

  return { id, filename, mime_type: mime, size: stats.size, file_path: destPath };
}

module.exports = { sendEmail, saveDraft, getDraft, deleteDraft, listDrafts, processAttachment };
