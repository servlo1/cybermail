const { shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const log = require('electron-log');

const AccountService = require('../services/accountService');
const EmailService = require('../services/emailService');
const ComposeService = require('../services/composeService');
const FolderService = require('../services/folderService');
const SettingsService = require('../services/settingsService');
const SyncService = require('../services/syncService');

function setupIpcHandlers(ipcMain, windowManager) {

  // ─── ACCOUNTS ──────────────────────────────────────────────
  ipcMain.handle('accounts:list', async () => {
    return AccountService.listAccounts();
  });

  ipcMain.handle('accounts:add', async (event, account) => {
    return AccountService.addAccount(account);
  });

  ipcMain.handle('accounts:remove', async (event, id) => {
    return AccountService.removeAccount(id);
  });

  ipcMain.handle('accounts:update', async (event, id, data) => {
    return AccountService.updateAccount(id, data);
  });

  ipcMain.handle('accounts:testConnection', async (event, config) => {
    return AccountService.testConnection(config);
  });

  // ─── EMAILS ────────────────────────────────────────────────
  ipcMain.handle('emails:list', async (event, params) => {
    return EmailService.listEmails(params);
  });

  ipcMain.handle('emails:get', async (event, id) => {
    return EmailService.getEmail(id);
  });

  ipcMain.handle('emails:search', async (event, query) => {
    return EmailService.searchEmails(query);
  });

  ipcMain.handle('emails:markRead', async (event, id) => {
    return EmailService.markRead(id);
  });

  ipcMain.handle('emails:markUnread', async (event, id) => {
    return EmailService.markUnread(id);
  });

  ipcMain.handle('emails:delete', async (event, id) => {
    return EmailService.deleteEmail(id);
  });

  ipcMain.handle('emails:moveToFolder', async (event, id, folder) => {
    return EmailService.moveToFolder(id, folder);
  });

  ipcMain.handle('emails:getAttachment', async (event, attachId) => {
    return EmailService.getAttachment(attachId);
  });

  // ─── COMPOSE ───────────────────────────────────────────────
  ipcMain.handle('compose:openWindow', async (event, draftId) => {
    return windowManager.openComposeWindow(draftId);
  });

  ipcMain.handle('compose:send', async (event, data) => {
    return ComposeService.sendEmail(data);
  });

  ipcMain.handle('compose:saveDraft', async (event, data) => {
    return ComposeService.saveDraft(data);
  });

  ipcMain.handle('compose:getDraft', async (event, id) => {
    return ComposeService.getDraft(id);
  });

  ipcMain.handle('compose:deleteDraft', async (event, id) => {
    return ComposeService.deleteDraft(id);
  });

  ipcMain.handle('compose:listDrafts', async () => {
    return ComposeService.listDrafts();
  });

  ipcMain.handle('compose:uploadAttachment', async (event, filePath) => {
    return ComposeService.processAttachment(filePath);
  });

  // ─── FOLDERS ───────────────────────────────────────────────
  ipcMain.handle('folders:list', async (event, accountId) => {
    return FolderService.listFolders(accountId);
  });

  ipcMain.handle('folders:getUnreadCount', async (event, accountId, folder) => {
    return FolderService.getUnreadCount(accountId, folder);
  });

  // ─── SETTINGS ──────────────────────────────────────────────
  ipcMain.handle('settings:get', async () => {
    return SettingsService.getSettings();
  });

  ipcMain.handle('settings:set', async (event, data) => {
    return SettingsService.updateSettings(data);
  });

  ipcMain.handle('settings:getSignature', async () => {
    return SettingsService.getSignature();
  });

  ipcMain.handle('settings:setSignature', async (event, data) => {
    return SettingsService.setSignature(data);
  });

  ipcMain.handle('settings:getTemplates', async () => {
    return SettingsService.getTemplates();
  });

  ipcMain.handle('settings:saveTemplate', async (event, tpl) => {
    return SettingsService.saveTemplate(tpl);
  });

  ipcMain.handle('settings:deleteTemplate', async (event, name) => {
    return SettingsService.deleteTemplate(name);
  });

  // ─── SYNC ──────────────────────────────────────────────────
  ipcMain.handle('sync:trigger', async (event, accountId) => {
    return SyncService.triggerSync(accountId);
  });

  ipcMain.handle('sync:getStatus', async () => {
    return SyncService.getStatus();
  });

  // ─── SHELL ─────────────────────────────────────────────────
  ipcMain.handle('shell:openExternal', async (event, url) => {
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle('shell:showFilePicker', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'All Files', extensions: ['*'] }]
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('shell:showSaveDialog', async (event, opts) => {
    const result = await dialog.showSaveDialog(opts || {});
    return result.canceled ? null : result.filePath;
  });

  log.info('IPC handlers registered');
}

module.exports = { setupIpcHandlers };
