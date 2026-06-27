const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const log = require('electron-log');

const isDev = process.env.NODE_ENV === 'development' || !require('electron').app.isPackaged;

class WindowManager {
  constructor() {
    this.composeWindows = new Map(); // draftId → BrowserWindow
    this.windowOrder = []; // for z-index tracking
  }

  async openComposeWindow(draftId = null) {
    const id = draftId || uuidv4();

    // If window already open for this draft, focus it
    if (this.composeWindows.has(id)) {
      const existing = this.composeWindows.get(id);
      if (!existing.isDestroyed()) {
        existing.focus();
        return { draftId: id, windowId: existing.id };
      }
    }

    const win = new BrowserWindow({
      width: 750,
      height: 580,
      minWidth: 550,
      minHeight: 400,
      backgroundColor: '#0b0f14',
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#0b0f14',
        symbolColor: '#00ff94',
        height: 28
      },
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../electron-main/preload.js'),
      },
      show: false,
      skipTaskbar: false,
    });

    const url = isDev
      ? `http://localhost:3000/#/compose/${id}`
      : `file://${path.join(__dirname, '../build/index.html')}#/compose/${id}`;

    win.loadURL(url);

    win.once('ready-to-show', () => {
      win.show();
      win.focus();
    });

    win.on('closed', () => {
      this.composeWindows.delete(id);
      this.windowOrder = this.windowOrder.filter(w => w !== id);
      log.info(`[WindowManager] Compose window closed: ${id}`);
    });

    win.on('focus', () => {
      // Move to top of order
      this.windowOrder = this.windowOrder.filter(w => w !== id);
      this.windowOrder.push(id);
    });

    this.composeWindows.set(id, win);
    this.windowOrder.push(id);

    log.info(`[WindowManager] Opened compose window: ${id}`);
    return { draftId: id, windowId: win.id };
  }

  closeComposeWindow(draftId) {
    const win = this.composeWindows.get(draftId);
    if (win && !win.isDestroyed()) {
      win.close();
    }
  }

  focusComposeWindow(draftId) {
    const win = this.composeWindows.get(draftId);
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  }

  setAlwaysOnTop(draftId, value) {
    const win = this.composeWindows.get(draftId);
    if (win && !win.isDestroyed()) {
      win.setAlwaysOnTop(value);
    }
  }

  getOpenDraftIds() {
    return Array.from(this.composeWindows.keys()).filter(id => {
      const win = this.composeWindows.get(id);
      return win && !win.isDestroyed();
    });
  }

  broadcastToAll(channel, data) {
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    });
  }
}

module.exports = { WindowManager };
