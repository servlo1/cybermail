const Imap = require('imap');
const { simpleParser } = require('mailparser');
const { v4: uuidv4 } = require('uuid');
const log = require('electron-log');
const { getDb } = require('../database/db');
const { broadcastToMainWindow } = require('../utils/broadcast');

const PERMANENT_ERRORS = [
  'invalid user name or password','authentication failed','invalid credentials',
  'login failed','bad username or password','too many login failures',
  'application-specific password required','account not activated',
];
const isPermanentError = (msg) => PERMANENT_ERRORS.some(e => (msg||'').toLowerCase().includes(e));
const accountLabel = (a) => a.email;

class ImapEngine {
  constructor(account) {
    this.account = account;
    this.imap = null;
    this.idleTimer = null;
    this.isConnected = false;
    this.idleActive = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.baseDelay = 10000;
    this.stopped = false;
    this._reconnectTimer = null;
    this._onNewCallback = null;
    this._currentBox = null; // track which box is open
  }

  getImapConfig() {
    const cfg = {
      user: this.account.email,
      host: this.account.imap_host,
      port: this.account.imap_port,
      tls: this.account.imap_secure === 1,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 20000,
      authTimeout: 15000,
      keepalive: { interval: 30000, idleInterval: 300000, forceNoop: true },
    };
    if (this.account.auth_type === 'oauth2') {
      cfg.xoauth2 = Buffer.from(`user=${this.account.email}\x01auth=Bearer ${this.account.oauth_access_token}\x01\x01`).toString('base64');
    } else {
      cfg.password = this._getPassword();
    }
    return cfg;
  }

  _getPassword() {
    try {
      const db = getDb();
      const row = db.prepare('SELECT value FROM settings WHERE key=?').get(`pwd_${this.account.id}`);
      return row ? Buffer.from(row.value,'base64').toString('utf8') : '';
    } catch { return ''; }
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (this.stopped) return reject(new Error('Engine stopped'));
      try { this.imap = new Imap(this.getImapConfig()); } catch(err) { return reject(err); }

      log.info(`[IMAP] Connecting ${accountLabel(this.account)} -> ${this.account.imap_host}:${this.account.imap_port}`);
      let resolved = false;

      const onReady = () => {
        resolved = true;
        this.isConnected = true;
        this.reconnectAttempts = 0;
        log.info(`[IMAP] Connected: ${accountLabel(this.account)}`);
        this.imap.removeListener('error', onInitError);
        this.imap.on('error', (err) => this._onRuntimeError(err));
        resolve(this.imap);
      };

      const onInitError = (err) => {
        if (resolved) return;
        resolved = true;
        log.error(`[IMAP] Connect error (${accountLabel(this.account)}): ${err.message}`);
        this.isConnected = false;
        reject(err);
      };

      this.imap.once('ready', onReady);
      this.imap.once('error', onInitError);
      this.imap.on('end', () => {
        this.isConnected = false;
        this.idleActive = false;
        this._currentBox = null;
        if (!this.stopped) this._scheduleReconnect();
      });
      this.imap.connect();
    });
  }

  _onRuntimeError(err) {
    log.error(`[IMAP] Runtime error for ${accountLabel(this.account)}: ${err.message}`);
    this.isConnected = false;
    this.idleActive = false;
    this._currentBox = null;
    if (!this.stopped) {
      if (isPermanentError(err.message)) this._markAccountError('auth_failed');
      else this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this.stopped) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      log.warn(`[IMAP] Max reconnects for ${accountLabel(this.account)}`);
      this._markAccountError('max_retries');
      return;
    }
    const delay = this.baseDelay * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;
    log.info(`[IMAP] Reconnect #${this.reconnectAttempts} in ${delay/1000}s for ${accountLabel(this.account)}`);
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(async () => {
      if (this.stopped) return;
      try {
        await this.connect();
        if (this._onNewCallback) await this.startIdle('INBOX', this._onNewCallback);
      } catch(err) {
        if (isPermanentError(err.message)) this._markAccountError('auth_failed');
        else this._scheduleReconnect();
      }
    }, delay);
  }

  _markAccountError(reason) {
    const msg = reason==='auth_failed'
      ? 'Authentication failed — check credentials in Settings'
      : 'Connection failed after retries';
    try { broadcastToMainWindow('sync:status',{accountId:this.account.id,status:'error',error:msg}); } catch{}
  }

  stop() {
    this.stopped = true; this.idleActive = false;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer=null; }
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer=null; }
    if (this.imap && this.isConnected) { try { this.imap.end(); } catch{} }
    this.isConnected = false;
  }
  disconnect() { this.stop(); }

  async getFolders() {
    return new Promise((resolve, reject) => {
      this.imap.getBoxes((err, boxes) => {
        if (err) return reject(err);
        resolve(this._flattenBoxes(boxes));
      });
    });
  }

  _flattenBoxes(boxes, prefix='') {
    const result = [];
    for (const [name, box] of Object.entries(boxes||{})) {
      const delim = box.delimiter||'/';
      const fullPath = prefix ? `${prefix}${delim}${name}` : name;
      result.push({ name, path:fullPath, type:this._detectFolderType(name,box), delimiter:delim });
      if (box.children) result.push(...this._flattenBoxes(box.children, fullPath));
    }
    return result;
  }

  _detectFolderType(name, box) {
    const flags = (box.attribs||[]).map(f=>f.toLowerCase());
    if (flags.includes('\\inbox')||name.toLowerCase()==='inbox') return 'inbox';
    if (flags.includes('\\sent')||/sent/i.test(name)) return 'sent';
    if (flags.includes('\\drafts')||/draft/i.test(name)) return 'drafts';
    if (flags.includes('\\trash')||/trash|deleted/i.test(name)) return 'trash';
    if (flags.includes('\\junk')||/junk|spam/i.test(name)) return 'spam';
    if (flags.includes('\\archive')||/archive/i.test(name)) return 'archive';
    return 'custom';
  }

  async openBox(folderPath, readOnly=true) {
    return new Promise((resolve, reject) => {
      this.imap.openBox(folderPath, readOnly, (err, box) => {
        if (err) return reject(err);
        this._currentBox = { path: folderPath, box };
        resolve(box);
      });
    });
  }

  async syncFolder(folderPath, _depth=0) {
    if (_depth > 1) { log.warn(`[IMAP] Recursion guard hit for ${folderPath}`); return {fetched:0,total:0}; }
    if (!this.isConnected) {
      try { await this.connect(); } catch(err) { return {fetched:0,total:0}; }
    }

    const db = getDb();
    const syncState = db.prepare('SELECT * FROM sync_state WHERE account_id=? AND folder_path=?')
      .get(this.account.id, folderPath);

    let box;
    try { box = await this.openBox(folderPath, true); }
    catch(err) { log.warn(`[IMAP] Cannot open "${folderPath}": ${err.message}`); return {fetched:0,total:0}; }

    const total = box.messages.total;

    // UID validity changed — wipe + resync once
    if (syncState && syncState.uid_validity && syncState.uid_validity !== 0
        && syncState.uid_validity !== box.uidvalidity) {
      log.info(`[IMAP] UID validity changed for ${folderPath} — clearing cache`);
      db.prepare('DELETE FROM emails WHERE account_id=? AND folder_path=?').run(this.account.id, folderPath);
      db.prepare(`INSERT OR REPLACE INTO sync_state (id,account_id,folder_path,last_uid,uid_validity,last_sync_at,status)
                  VALUES (?,?,?,0,?,unixepoch(),'idle')`)
        .run(syncState.id||uuidv4(), this.account.id, folderPath, box.uidvalidity);
      return this.syncFolder(folderPath, _depth+1);
    }

    // Nothing in this folder
    if (total === 0) {
      this._saveSyncCursor(db, syncState, folderPath, 0, box.uidvalidity);
      return {fetched:0,total:0};
    }

    const lastUid = syncState?.last_uid || 0;
    let rawMessages = [];

    try {
      // Re-open box to get a FRESH message count before any fetch
      // (IDLE may have been triggered when box was empty, then filled)
      try { box = await this.openBox(folderPath, true); } catch {}
      const freshTotal = box.messages.total;
      if (freshTotal === 0) return {fetched:0,total:0};

      if (lastUid === 0) {
        // Initial sync: fetch last 100 by sequence
        const batchSize = 100;
        const start = Math.max(1, freshTotal - batchSize + 1);
        const range = freshTotal === 1 ? '1' : `${start}:${freshTotal}`;
        rawMessages = await this._fetchBySeq(range);
      } else {
        const knownCount = db.prepare(
          'SELECT COUNT(*) as n FROM emails WHERE account_id=? AND folder_path=?'
        ).get(this.account.id, folderPath)?.n || 0;

        if (freshTotal <= knownCount) return {fetched:0,total:freshTotal};

        const newCount = freshTotal - knownCount;
        const start = Math.max(1, knownCount + 1);
        // Clamp range to actual box size
        const end = Math.min(start + newCount - 1, freshTotal);
        const range = start === end ? `${start}` : `${start}:${end}`;
        rawMessages = await this._fetchBySeq(range);
      }
    } catch(err) {
      log.error(`[IMAP] Fetch error in ${folderPath}: ${err.message}`);
      return {fetched:0,total};
    }

    if (!rawMessages.length) return {fetched:0,total};

    // Parse and store
    const parsed = [];
    for (const raw of rawMessages) {
      const p = await this._parseRaw(raw);
      if (p) parsed.push({ parsed:p, uid:raw.uid, flags:raw.flags, rawSize:raw.raw?.length||0 });
    }

    let fetched = 0;
    db.transaction((items) => {
      for (const item of items) {
        try { this._storeEmailSync(item, folderPath, db); fetched++; }
        catch(err) { log.debug('[IMAP] Store skipped:', err.message); }
      }
    })(parsed);

    // Save cursor using highest UID seen
    const maxUid = rawMessages.reduce((m,msg) => Math.max(m, msg.uid||0), lastUid);
    this._saveSyncCursor(db, syncState, folderPath, maxUid, box.uidvalidity);
    this._updateFolderMeta(db, folderPath, total, box.uidvalidity);

    if (fetched > 0) {
      broadcastToMainWindow('emails:new', {accountId:this.account.id, folder:folderPath, count:fetched});
    }
    return {fetched,total};
  }

  _saveSyncCursor(db, syncState, folderPath, maxUid, uidValidity) {
    db.prepare(`
      INSERT OR REPLACE INTO sync_state (id,account_id,folder_path,last_uid,uid_validity,last_sync_at,status)
      VALUES (COALESCE((SELECT id FROM sync_state WHERE account_id=? AND folder_path=?),?),?,?,?,?,unixepoch(),'idle')
    `).run(this.account.id, folderPath, uuidv4(), this.account.id, folderPath, maxUid, uidValidity);
  }

  _updateFolderMeta(db, folderPath, total, uidValidity) {
    const {unread} = db.prepare(
      'SELECT COUNT(*) as unread FROM emails WHERE account_id=? AND folder_path=? AND is_read=0 AND is_deleted=0'
    ).get(this.account.id, folderPath)||{unread:0};

    const type = this._detectFolderTypeFromPath(folderPath);
    db.prepare(`
      INSERT OR REPLACE INTO folders (id,account_id,name,path,type,unread_count,total_count,uid_validity,last_synced_at)
      VALUES (COALESCE((SELECT id FROM folders WHERE account_id=? AND path=?),?),?,?,?,?,?,?,?,unixepoch())
    `).run(
      this.account.id, folderPath, uuidv4(),
      this.account.id, folderPath.split(/[/\\]/).pop(), folderPath,
      type, unread, total, uidValidity
    );
  }

  _detectFolderTypeFromPath(p) {
    const low = p.toLowerCase();
    if (low==='inbox'||low.endsWith('.inbox')) return 'inbox';
    if (/sent/i.test(p)) return 'sent';
    if (/draft/i.test(p)) return 'drafts';
    if (/trash|deleted/i.test(p)) return 'trash';
    if (/junk|spam/i.test(p)) return 'spam';
    return 'custom';
  }

  _fetchBySeq(range) {
    return new Promise((resolve) => {
      const messages = [];
      let fetch;
      try {
        fetch = this.imap.seq.fetch(range, { bodies:'', struct:false });
      } catch(err) {
        log.warn(`[IMAP] seq.fetch(${range}) threw: ${err.message}`);
        return resolve([]);
      }
      this._drainFetch(fetch, messages, resolve);
    });
  }

  _drainFetch(fetch, messages, resolve) {
    fetch.on('message', (msg) => {
      const m = { uid:null, raw:'', flags:[] };
      msg.on('body', (stream) => {
        const chunks = [];
        stream.on('data', c => chunks.push(Buffer.isBuffer(c)?c:Buffer.from(c)));
        stream.once('end', () => { m.raw = Buffer.concat(chunks).toString('utf8'); });
      });
      msg.once('attributes', (attrs) => { m.uid=attrs.uid; m.flags=attrs.flags||[]; });
      msg.once('end', () => messages.push(m));
    });
    fetch.once('error', (err) => {
      if (/nothing to fetch|invalid messageset/i.test(err.message)) return resolve([]);
      log.warn('[IMAP] Fetch stream error:', err.message);
      resolve(messages);
    });
    fetch.once('end', () => resolve(messages));
  }

  async _parseRaw(msgData) {
    if (!msgData?.raw) return null;
    try { return await simpleParser(msgData.raw, {skipHtmlToText:false}); }
    catch { return null; }
  }

  _storeEmailSync(item, folderPath, db) {
    if (!item?.parsed) throw new Error('invalid item');
    const { parsed, uid, flags, rawSize } = item;

    if (uid) {
      const exists = db.prepare('SELECT id FROM emails WHERE account_id=? AND folder_path=? AND uid=?')
        .get(this.account.id, folderPath, uid);
      if (exists) return;
    }

    const id = uuidv4();
    const isRead = (flags||[]).includes('\\Seen') ? 1 : 0;
    const toArr = (parsed.to?.value||[]).map(a=>({name:a.name||'',email:a.address||''}));
    const ccArr = (parsed.cc?.value||[]).map(a=>({name:a.name||'',email:a.address||''}));
    const snippet = (parsed.text||'').replace(/\s+/g,' ').trim().slice(0,200);
    const dateTs = parsed.date ? Math.floor(parsed.date.getTime()/1000) : Math.floor(Date.now()/1000);

    db.prepare(`
      INSERT OR IGNORE INTO emails
        (id,account_id,folder_path,uid,message_id,subject,from_name,from_email,
         to_addresses,cc_addresses,date,received_at,body_html,body_text,snippet,
         is_read,flags,has_attachments,raw_size)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,unixepoch(),?,?,?,?,?,?,?)
    `).run(
      id, this.account.id, folderPath, uid||null,
      parsed.messageId||`gen-${id}`,
      parsed.subject||'(no subject)',
      parsed.from?.value?.[0]?.name||'',
      parsed.from?.value?.[0]?.address||'',
      JSON.stringify(toArr), JSON.stringify(ccArr),
      dateTs,
      parsed.html||null, parsed.text||null, snippet,
      isRead, JSON.stringify(flags||[]),
      (parsed.attachments?.length>0)?1:0, rawSize||0
    );

    // Attachments
    if (parsed.attachments?.length) {
      const {app:ea} = require('electron');
      const np = require('path'), nf = require('fs');
      const dir = np.join(ea.getPath('userData'),'attachments',id);
      nf.mkdirSync(dir,{recursive:true});
      for (const att of parsed.attachments) {
        if (!att.content) continue;
        const attId=uuidv4(), fname=att.filename||`file-${attId}`;
        const fpath=np.join(dir,fname);
        try {
          nf.writeFileSync(fpath,att.content);
          db.prepare(`INSERT OR IGNORE INTO attachments (id,email_id,filename,mime_type,size,content_id,is_inline,file_path)
                      VALUES (?,?,?,?,?,?,?,?)`)
            .run(attId,id,fname,att.contentType||'application/octet-stream',
                 att.size||att.content?.length||0,att.cid||null,
                 att.contentDisposition==='inline'?1:0,fpath);
        } catch{}
      }
    }
  }

  async startIdle(folderPath, onNew) {
    this._onNewCallback = onNew;
    if (!this.isConnected) { try { await this.connect(); } catch { return; } }
    // If a different box is open, reopen INBOX
    if (this._currentBox?.path !== folderPath) {
      try { await this.openBox(folderPath, true); }
      catch(err) { log.warn(`[IMAP IDLE] Cannot open ${folderPath}: ${err.message}`); return; }
    }
    log.info(`[IMAP IDLE] Active on ${folderPath} for ${accountLabel(this.account)}`);
    this.imap.on('mail', (n) => {
      log.info(`[IMAP IDLE] ${n} new message(s) on ${accountLabel(this.account)}`);
      if (onNew) onNew(n);
    });
    this.idleActive = true;
    const keepAlive = () => {
      if (!this.idleActive||!this.isConnected||this.stopped) return;
      try { if (this.imap?.imap?.noop) this.imap.imap.noop(); } catch{}
      this.idleTimer = setTimeout(keepAlive, 20*60*1000);
    };
    this.idleTimer = setTimeout(keepAlive, 20*60*1000);
  }

  async testConnection() {
    try {
      await this.connect();
      const folders = await this.getFolders();
      this.stop();
      return {success:true, folderCount:folders.length};
    } catch(err) {
      this.stop();
      return {success:false, error:err.message};
    }
  }
}

module.exports = { ImapEngine };
