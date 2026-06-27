const log = require('electron-log');
const { getDb } = require('../database/db');
const { ImapEngine } = require('../imap-engine/imapEngine');
const { broadcastToMainWindow } = require('../utils/broadcast');

const POLL_INTERVAL_MS = 2 * 60 * 1000;
const activeEngines  = new Map();
const syncStatus     = new Map();
const failedAccounts = new Set();
let pollTimer = null;

function startSyncWorker() {
  log.info('[SyncWorker] Starting');
  setTimeout(() => syncAllAccounts(), 4000);
  pollTimer = setInterval(() => syncAllAccounts(), POLL_INTERVAL_MS);
  const { sendQueue } = require('../smtp-engine/smtpEngine');
  setInterval(() => sendQueue.processQueue(), 30000);
}

function stopSyncWorker() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  for (const e of activeEngines.values()) { try { e.stop(); } catch {} }
  activeEngines.clear();
  syncStatus.clear();
}

async function syncAllAccounts() {
  let accounts = [];
  try { accounts = getDb().prepare('SELECT * FROM accounts WHERE is_active=1').all(); }
  catch (err) { log.error('[SyncWorker] DB error:', err.message); return; }
  for (const acc of accounts) {
    if (!failedAccounts.has(acc.id)) {
      syncAccount(acc).catch(err => log.error(`[SyncWorker] ${acc.email}:`, err.message));
    }
  }
}

async function syncAccount(account) {
  if (syncStatus.get(account.id)?.status === 'syncing') return;

  setSyncStatus(account.id, 'syncing');

  try {
    let engine = activeEngines.get(account.id);
    if (!engine || !engine.isConnected || engine.stopped) {
      engine = new ImapEngine(account);
      try {
        await engine.connect();
        activeEngines.set(account.id, engine);
      } catch (err) {
        activeEngines.delete(account.id);
        if (isPermErr(err.message)) {
          failedAccounts.add(account.id);
          setSyncStatus(account.id, 'error', 'Authentication failed — check credentials in Settings');
        } else {
          setSyncStatus(account.id, 'error', err.message);
        }
        return;
      }
    }

    const db = getDb();
    let folderRows = db.prepare('SELECT * FROM folders WHERE account_id=?').all(account.id);

    if (folderRows.length === 0) {
      try {
        const imapFolders = await engine.getFolders();
        const { v4: uuidv4 } = require('uuid');
        const ins = db.prepare('INSERT OR IGNORE INTO folders (id,account_id,name,path,type) VALUES (?,?,?,?,?)');
        db.transaction(flds => { for (const f of flds) ins.run(uuidv4(), account.id, f.name, f.path, f.type); })(imapFolders);
        folderRows = db.prepare('SELECT * FROM folders WHERE account_id=?').all(account.id);
      } catch (err) { log.error(`[SyncWorker] getFolders failed:`, err.message); }
    }

    const weight = { inbox:0, sent:1, drafts:2, trash:3, spam:4, custom:5 };
    const sorted = [...folderRows].sort((a,b) => (weight[a.type]||5)-(weight[b.type]||5));

    let totalFetched = 0;
    for (const folder of sorted) {
      if (engine.stopped) break;
      try {
        broadcastToMainWindow('sync:progress', { accountId:account.id, folder:folder.path, status:'syncing' });
        const result = await engine.syncFolder(folder.path);
        totalFetched += result.fetched;
        if (result.fetched > 0) log.info(`[SyncWorker] ${account.email}/${folder.path}: +${result.fetched}`);
      } catch (err) { log.warn(`[SyncWorker] Folder error ${folder.path}:`, err.message); }
    }

    // Start IDLE on inbox — use a SEPARATE connection so syncing other folders doesn't break IDLE
    const inbox = sorted.find(f => f.type==='inbox');
    if (inbox && !engine.idleActive && !engine.stopped) {
      engine.startIdle(inbox.path, async () => {
        // New mail via IDLE — resync inbox only (non-blocking)
        log.info(`[SyncWorker] IDLE triggered sync for ${account.email}`);
        // Small delay to let server finish delivering
        await new Promise(r => setTimeout(r, 500));
        try { await engine.syncFolder(inbox.path); }
        catch (err) { log.warn(`[SyncWorker] IDLE sync error:`, err.message); }
      }).catch(err => log.warn('[SyncWorker] IDLE start:', err.message));
    }

    setSyncStatus(account.id, 'idle', null, { lastSync: new Date().toISOString(), fetched: totalFetched });
    log.info(`[SyncWorker] ${account.email} done. Fetched: ${totalFetched}`);

  } catch (err) {
    log.error(`[SyncWorker] ${account.email} failed:`, err.message);
    setSyncStatus(account.id, 'error', err.message);
    const old = activeEngines.get(account.id);
    if (old) { try { old.stop(); } catch {} activeEngines.delete(account.id); }
  }
}

function setSyncStatus(accountId, status, error=null, extra={}) {
  const s = { status, error, ...extra };
  syncStatus.set(accountId, s);
  broadcastToMainWindow('sync:status', { accountId, ...s });
}

function isPermErr(msg) {
  return ['invalid user','authentication','password','login failed']
    .some(e => (msg||'').toLowerCase().includes(e));
}

function getStatus() {
  const out = {};
  syncStatus.forEach((v,k) => { out[k]=v; });
  return out;
}

async function triggerSync(accountId) {
  failedAccounts.delete(accountId);
  const db = getDb();
  const account = db.prepare('SELECT * FROM accounts WHERE id=?').get(accountId);
  if (!account) throw new Error('Account not found');
  const old = activeEngines.get(accountId);
  if (old) { try { old.stop(); } catch {} activeEngines.delete(accountId); }
  syncStatus.delete(accountId);
  return syncAccount(account);
}

module.exports = { startSyncWorker, stopSyncWorker, syncAllAccounts, triggerSync, getStatus };
