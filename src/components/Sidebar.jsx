import React, { useState } from 'react';
import useStore from '../store/useStore';
import './Sidebar.css';

const FOLDER_ICONS = {
  inbox:   '▼',
  sent:    '►',
  drafts:  '◈',
  trash:   '✕',
  spam:    '⚠',
  archive: '▣',
  custom:  '▸',
};

const SYSTEM_FOLDERS = [
  { key: 'INBOX',   label: 'Inbox',   icon: '▼', type: 'inbox' },
  { key: 'Sent',    label: 'Sent',    icon: '►', type: 'sent' },
  { key: 'Drafts',  label: 'Drafts',  icon: '◈', type: 'drafts' },
  { key: 'Trash',   label: 'Trash',   icon: '✕', type: 'trash' },
  { key: 'Spam',    label: 'Spam',    icon: '⚠', type: 'spam' },
];

export default function Sidebar() {
  const {
    accounts, selectedAccountId, setSelectedAccountId,
    selectedFolder, setSelectedFolder,
    folders, syncStatus,
    setShowAddAccount, setShowSettings
  } = useStore();

  const [expandedAccounts, setExpandedAccounts] = useState({});

  function toggleAccount(id) {
    setExpandedAccounts(prev => ({ ...prev, [id]: !prev[id] }));
    setSelectedAccountId(id);
  }

  async function openCompose() {
    if (window.electronAPI) {
      await window.electronAPI.compose.openWindow(null);
    }
  }

  const getFolderUnread = (folderKey) => {
    const accountFolders = folders.filter(f =>
      f.account_id === selectedAccountId &&
      (f.path === folderKey || f.path.toLowerCase().includes(folderKey.toLowerCase()))
    );
    return accountFolders.reduce((sum, f) => sum + (f.unread_count || 0), 0);
  };

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <span className="logo-icon">⬡</span>
        <span className="logo-text">CYBER<span className="logo-accent">MAIL</span></span>
      </div>

      {/* Compose button */}
      <button className="compose-btn" onClick={openCompose}>
        <span className="compose-icon">+</span>
        <span>Compose</span>
      </button>

      {/* Accounts & Folders */}
      <nav className="sidebar-nav">
        {accounts.length === 0 ? (
          <div className="sidebar-empty">
            <p>No accounts</p>
            <button className="btn-ghost" onClick={() => setShowAddAccount(true)}>+ Add account</button>
          </div>
        ) : (
          accounts.map(acc => {
            const isExpanded = expandedAccounts[acc.id] !== false;
            const isSelected = acc.id === selectedAccountId;
            const syncInfo = syncStatus[acc.id];

            return (
              <div key={acc.id} className={`account-group ${isSelected ? 'is-selected' : ''}`}>
                <button
                  className="account-header"
                  onClick={() => toggleAccount(acc.id)}
                  style={{ '--acc-color': acc.color || '#00ff94' }}
                >
                  <span className="account-dot" />
                  <span className="account-name">{acc.name || acc.email}</span>
                  <span className={`account-chevron ${isExpanded ? 'expanded' : ''}`}>›</span>
                  {syncInfo?.status === 'syncing' && <span className="sync-dot" />}
                </button>

                {isExpanded && (
                  <div className="folder-list">
                    {SYSTEM_FOLDERS.map(f => {
                      const unread = f.type === 'inbox' ? getFolderUnread(f.key) : 0;
                      const isActiveFolder = selectedFolder === f.key && isSelected;
                      return (
                        <button
                          key={f.key}
                          className={`folder-item ${isActiveFolder ? 'active' : ''}`}
                          onClick={() => {
                            setSelectedAccountId(acc.id);
                            setSelectedFolder(f.key);
                          }}
                        >
                          <span className="folder-icon">{f.icon}</span>
                          <span className="folder-label">{f.label}</span>
                          {unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
                        </button>
                      );
                    })}

                    {/* Custom folders */}
                    {folders
                      .filter(f => f.account_id === acc.id && !SYSTEM_FOLDERS.some(sf => f.type === sf.type))
                      .map(f => (
                        <button
                          key={f.path}
                          className={`folder-item ${selectedFolder === f.path && isSelected ? 'active' : ''}`}
                          onClick={() => {
                            setSelectedAccountId(acc.id);
                            setSelectedFolder(f.path);
                          }}
                        >
                          <span className="folder-icon">▸</span>
                          <span className="folder-label">{f.name}</span>
                          {f.unread_count > 0 && <span className="badge">{f.unread_count}</span>}
                        </button>
                      ))
                    }
                  </div>
                )}
              </div>
            );
          })
        )}
      </nav>

      {/* Sidebar footer */}
      <div className="sidebar-footer">
        <button className="sidebar-footer-btn" onClick={() => setShowAddAccount(true)} data-tooltip="Add account">
          +
        </button>
        <button className="sidebar-footer-btn" onClick={async () => {
          if (window.electronAPI && selectedAccountId) {
            await window.electronAPI.sync.triggerSync(selectedAccountId);
          }
        }} data-tooltip="Sync now">
          ↻
        </button>
        <button className="sidebar-footer-btn" onClick={() => setShowSettings(true)} data-tooltip="Settings">
          ⚙
        </button>
      </div>
    </aside>
  );
}
