const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const log = require('electron-log');
const { getDb } = require('../database/db');

// ISP and provider SMTP configs
const SMTP_PRESETS = {
  'gmail.com': { host: 'smtp.gmail.com', port: 587, secure: false },
  'googlemail.com': { host: 'smtp.gmail.com', port: 587, secure: false },
  'outlook.com': { host: 'smtp-mail.outlook.com', port: 587, secure: false },
  'hotmail.com': { host: 'smtp-mail.outlook.com', port: 587, secure: false },
  'live.com': { host: 'smtp-mail.outlook.com', port: 587, secure: false },
  'yahoo.com': { host: 'smtp.mail.yahoo.com', port: 587, secure: false },
  'zoho.com': { host: 'smtp.zoho.com', port: 587, secure: false },
  'zohomail.com': { host: 'smtp.zoho.com', port: 587, secure: false },
  // ISP Webmails
  'suddenlink.net': { host: 'mail.optimum.net', port: 465, secure: true },
  'optimum.net':    { host: 'mail.optimum.net', port: 465, secure: true },
  'optonline.net':  { host: 'mail.optimum.net', port: 465, secure: true },
  'terra.com.br': { host: 'smtp.terra.com.br', port: 587, secure: false },
  'spectrum.net': { host: 'smtp.charter.net', port: 587, secure: false },
  'roadrunner.com': { host: 'smtp.charter.net', port: 587, secure: false },
  'rr.com': { host: 'smtp.charter.net', port: 587, secure: false },
  // Transactional
  'zeptomail.com': { host: 'smtp.zeptomail.com', port: 587, secure: false },
  'rackspace.com': { host: 'smtp.emailsrvr.com', port: 587, secure: false },
};

function getSmtpPreset(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  return SMTP_PRESETS[domain] || null;
}

class SmtpEngine {
  constructor(account) {
    this.account = account;
    this.transporter = null;
  }

  _getPassword() {
    const db = getDb();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?')
      .get(`pwd_${this.account.id}`);
    return row ? Buffer.from(row.value, 'base64').toString('utf8') : '';
  }

  _createTransport() {
    const cfg = {
      host: this.account.smtp_host,
      port: this.account.smtp_port,
      secure: this.account.smtp_secure === 1,
      tls: { rejectUnauthorized: false },
    };

    if (this.account.auth_type === 'oauth2') {
      cfg.auth = {
        type: 'OAuth2',
        user: this.account.email,
        accessToken: this.account.oauth_access_token,
      };
    } else {
      cfg.auth = {
        user: this.account.email,
        pass: this._getPassword(),
      };
    }

    return nodemailer.createTransport(cfg);
  }

  async getTransporter() {
    if (!this.transporter) {
      this.transporter = this._createTransport();
    }
    return this.transporter;
  }

  async sendEmail(payload) {
    const {
      from_email,
      from_name,
      to,
      cc,
      bcc,
      subject,
      body_html,
      body_text,
      attachments = [],
      reply_to_message_id,
    } = payload;

    const transport = await this.getTransporter();

    const mailOptions = {
      from: `"${from_name || this.account.display_name}" <${from_email || this.account.email}>`,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject: subject || '(no subject)',
      html: body_html,
      text: body_text || this._htmlToText(body_html),
    };

    if (cc?.length) mailOptions.cc = Array.isArray(cc) ? cc.join(', ') : cc;
    if (bcc?.length) mailOptions.bcc = Array.isArray(bcc) ? bcc.join(', ') : bcc;
    if (reply_to_message_id) mailOptions.inReplyTo = reply_to_message_id;

    // Attachments
    if (attachments.length > 0) {
      const fs = require('fs');
      mailOptions.attachments = attachments.map(att => ({
        filename: att.filename,
        path: att.file_path,
        contentType: att.mime_type,
      })).filter(a => a.path && fs.existsSync(a.path));
    }

    try {
      const info = await transport.sendMail(mailOptions);
      log.info(`[SMTP] Sent: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (err) {
      log.error('[SMTP] Send error:', err.message);
      throw err;
    }
  }

  async testConnection() {
    try {
      const transport = await this.getTransporter();
      await transport.verify();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  _htmlToText(html) {
    if (!html) return '';
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&quot;/g, '"')
      .trim();
  }
}

// Send queue processor
class SendQueue {
  constructor() {
    this.processing = false;
  }

  async enqueue(accountId, payload) {
    const db = getDb();
    const id = uuidv4();
    db.prepare(`
      INSERT INTO send_queue (id, account_id, payload, status)
      VALUES (?, ?, ?, 'pending')
    `).run(id, accountId, JSON.stringify(payload));
    this.processQueue();
    return id;
  }

  async processQueue() {
    if (this.processing) return;
    this.processing = true;

    try {
      const db = getDb();
      const pending = db.prepare(`
        SELECT * FROM send_queue
        WHERE status = 'pending' AND attempts < max_attempts
        AND next_attempt_at <= unixepoch()
        ORDER BY created_at ASC
        LIMIT 10
      `).all();

      for (const item of pending) {
        try {
          db.prepare(`UPDATE send_queue SET status = 'sending', attempts = attempts + 1 WHERE id = ?`)
            .run(item.id);

          const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(item.account_id);
          if (!account) {
            db.prepare(`UPDATE send_queue SET status = 'failed', error = ? WHERE id = ?`)
              .run('Account not found', item.id);
            continue;
          }

          const engine = new SmtpEngine(account);
          await engine.sendEmail(JSON.parse(item.payload));

          db.prepare(`UPDATE send_queue SET status = 'sent' WHERE id = ?`).run(item.id);
          log.info(`[SendQueue] Item ${item.id} sent successfully`);

        } catch (err) {
          log.error(`[SendQueue] Failed item ${item.id}:`, err.message);
          const nextAttempt = Math.floor(Date.now() / 1000) + Math.pow(2, item.attempts) * 60;
          db.prepare(`
            UPDATE send_queue SET status = 'pending', error = ?, next_attempt_at = ?
            WHERE id = ?
          `).run(err.message, nextAttempt, item.id);
        }
      }
    } finally {
      this.processing = false;
    }
  }
}

const sendQueue = new SendQueue();
module.exports = { SmtpEngine, SendQueue, sendQueue, getSmtpPreset };
