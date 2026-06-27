const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Account management
  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    add: (account) => ipcRenderer.invoke('accounts:add', account),
    remove: (id) => ipcRenderer.invoke('accounts:remove', id),
    update: (id, data) => ipcRenderer.invoke('accounts:update', id, data),
    testConnection: (config) => ipcRenderer.invoke('accounts:testConnection', config),
  },

  // Email operations
  emails: {
    list: (params) => ipcRenderer.invoke('emails:list', params),
    get: (id) => ipcRenderer.invoke('emails:get', id),
    search: (query) => ipcRenderer.invoke('emails:search', query),
    markRead: (id) => ipcRenderer.invoke('emails:markRead', id),
    markUnread: (id) => ipcRenderer.invoke('emails:markUnread', id),
    delete: (id) => ipcRenderer.invoke('emails:delete', id),
    moveToFolder: (id, folder) => ipcRenderer.invoke('emails:moveToFolder', id, folder),
    getAttachment: (attachId) => ipcRenderer.invoke('emails:getAttachment', attachId),
  },

  // Compose & SMTP
  compose: {
    openWindow: (draftId) => ipcRenderer.invoke('compose:openWindow', draftId),
    send: (data) => ipcRenderer.invoke('compose:send', data),
    saveDraft: (data) => ipcRenderer.invoke('compose:saveDraft', data),
    getDraft: (id) => ipcRenderer.invoke('compose:getDraft', id),
    deleteDraft: (id) => ipcRenderer.invoke('compose:deleteDraft', id),
    listDrafts: () => ipcRenderer.invoke('compose:listDrafts'),
    uploadAttachment: (filePath) => ipcRenderer.invoke('compose:uploadAttachment', filePath),
  },

  // Folders
  folders: {
    list: (accountId) => ipcRenderer.invoke('folders:list', accountId),
    getUnreadCount: (accountId, folder) => ipcRenderer.invoke('folders:getUnreadCount', accountId, folder),
  },

  // Settings
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (data) => ipcRenderer.invoke('settings:set', data),
    getSignature: () => ipcRenderer.invoke('settings:getSignature'),
    setSignature: (data) => ipcRenderer.invoke('settings:setSignature', data),
    getTemplates: () => ipcRenderer.invoke('settings:getTemplates'),
    saveTemplate: (tpl) => ipcRenderer.invoke('settings:saveTemplate', tpl),
    deleteTemplate: (name) => ipcRenderer.invoke('settings:deleteTemplate', name),
  },

  // Sync
  sync: {
    triggerSync: (accountId) => ipcRenderer.invoke('sync:trigger', accountId),
    getStatus: () => ipcRenderer.invoke('sync:getStatus'),
  },

  // Events from main → renderer
  on: (channel, callback) => {
    const validChannels = [
      'emails:new',
      'emails:updated',
      'sync:status',
      'sync:progress',
      'compose:draftSaved',
      'notification:show',
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  },
  off: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  },

  // Shell
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  showFilePicker: () => ipcRenderer.invoke('shell:showFilePicker'),
  showSaveDialog: (opts) => ipcRenderer.invoke('shell:showSaveDialog', opts),
});
