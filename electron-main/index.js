const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const log = require('electron-log');

// Single-instance lock — prevents two copies fighting over the DB
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  log.warn('Another instance is already running. Exiting.');
  app.quit();
  process.exit(0);
}

const db = require('../database/db');
const { startSyncWorker, stopSyncWorker } = require('../sync-worker/syncWorker');
const { setupIpcHandlers } = require('./ipcHandlers');
const { WindowManager } = require('../windows-manager/windowManager');

log.info('CyberMail starting...');

let mainWindow;
let windowManager;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0f14',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0b0f14',
      symbolColor: '#00ff94',
      height: 32,
    },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
    },
    // Skip icon if file doesn't exist — avoids crash in dev
    ...(require('fs').existsSync(path.join(__dirname, '../assets/icon.png'))
      ? { icon: path.join(__dirname, '../assets/icon.png') }
      : {}),
    show: false,
  });

  const url = isDev
    ? 'http://localhost:3000'
    : `file://${path.join(__dirname, '../build/index.html')}`;

  mainWindow.loadURL(url);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Only open DevTools if explicitly requested
    if (isDev && process.env.OPEN_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  Menu.setApplicationMenu(null);
  return mainWindow;
}

app.whenReady().then(async () => {
  try {
    await db.initialize();
    log.info('Database initialized');

    windowManager = new WindowManager();
    setupIpcHandlers(ipcMain, windowManager);
    createMainWindow();
    startSyncWorker();

    log.info('CyberMail ready');
  } catch (err) {
    log.error('Startup error:', err);
    // Show error dialog instead of silently failing
    const { dialog } = require('electron');
    dialog.showErrorBox(
      'CyberMail Startup Error',
      `Failed to start: ${err.message}\n\nIf you see "database is locked", close any other CyberMail windows and try again.`
    );
  }
});

// Bring existing window to front if user opens a second instance
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// Clean shutdown — commit WAL and close DB
app.on('before-quit', () => {
  log.info('Shutting down...');
  try { stopSyncWorker(); } catch {}
  try { db.closeDb(); } catch {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

module.exports = { getMainWindow: () => mainWindow };
