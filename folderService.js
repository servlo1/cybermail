// folderService.js
const { getDb } = require('../database/db');

function listFolders(accountId) {
  const db = getDb();
  const query = accountId
    ? 'SELECT * FROM folders WHERE account_id = ? ORDER BY type, name'
    : 'SELECT * FROM folders ORDER BY account_id, type, name';
  return accountId ? db.prepare(query).all(accountId) : db.prepare(query).all();
}

function getUnreadCount(accountId, folderPath) {
  const db = getDb();
  const { count } = db.prepare(`
    SELECT COUNT(*) as count FROM emails
    WHERE account_id = ? AND folder_path = ? AND is_read = 0 AND is_deleted = 0
  `).get(accountId, folderPath) || { count: 0 };
  return count;
}

module.exports = { listFolders, getUnreadCount };
