const { BrowserWindow } = require('electron');
const { getDb } = require('../database/db');
const log = require('electron-log');

// Gmail OAuth2
const GMAIL_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GMAIL_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_SCOPES = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

// Microsoft OAuth2
const MS_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const MS_SCOPES = 'https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access email openid';

async function startGmailOAuth(clientId, clientSecret, redirectUri = 'urn:ietf:wg:oauth:2.0:oob') {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
  });

  return openAuthWindow(`${GMAIL_AUTH_URL}?${params}`, 'Google Sign-In', /[?&]code=([^&]+)/);
}

async function startMicrosoftOAuth(clientId, redirectUri = 'http://localhost:8765') {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: MS_SCOPES,
    response_mode: 'query',
  });

  return openAuthWindow(`${MS_AUTH_URL}?${params}`, 'Microsoft Sign-In', /[?&]code=([^&]+)/);
}

function openAuthWindow(url, title, codePattern) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 500,
      height: 650,
      title,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    win.loadURL(url);

    function checkUrl(navUrl) {
      const match = navUrl.match(codePattern);
      if (match) {
        win.close();
        resolve(decodeURIComponent(match[1]));
      }
    }

    win.webContents.on('will-navigate', (_, navUrl) => checkUrl(navUrl));
    win.webContents.on('did-redirect-navigation', (_, navUrl) => checkUrl(navUrl));
    win.on('closed', () => reject(new Error('Auth window closed')));
  });
}

async function exchangeGmailCode(code, clientId, clientSecret, redirectUri) {
  const res = await fetch(GMAIL_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri || 'urn:ietf:wg:oauth:2.0:oob',
      grant_type: 'authorization_code',
    }),
  });
  return res.json();
}

async function refreshGmailToken(refreshToken, clientId, clientSecret) {
  const res = await fetch(GMAIL_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });
  return res.json();
}

async function ensureValidToken(account) {
  if (!account.oauth_access_token) return account;

  const expiresAt = account.oauth_expires_at || 0;
  const nowSec = Math.floor(Date.now() / 1000);

  if (expiresAt - nowSec > 300) return account; // still valid

  log.info(`[OAuth] Refreshing token for ${account.email}`);
  try {
    const db = getDb();
    const clientId = db.prepare("SELECT value FROM settings WHERE key = 'oauth_client_id'").get()?.value;
    const clientSecret = db.prepare("SELECT value FROM settings WHERE key = 'oauth_client_secret'").get()?.value;

    const tokens = await refreshGmailToken(account.oauth_refresh_token, clientId, clientSecret);
    const newExpiry = Math.floor(Date.now() / 1000) + tokens.expires_in;

    db.prepare(`
      UPDATE accounts SET oauth_access_token = ?, oauth_expires_at = ? WHERE id = ?
    `).run(tokens.access_token, newExpiry, account.id);

    return { ...account, oauth_access_token: tokens.access_token, oauth_expires_at: newExpiry };
  } catch (err) {
    log.error('[OAuth] Token refresh failed:', err.message);
    return account;
  }
}

module.exports = { startGmailOAuth, startMicrosoftOAuth, exchangeGmailCode, refreshGmailToken, ensureValidToken };
