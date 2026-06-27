import React, { useEffect, useState } from 'react';
import Sidebar from '../components/Sidebar';
import EmailList from '../components/EmailList';
import EmailPreview from '../components/EmailPreview';
import Notification from '../components/Notification';
import AddAccountModal from '../components/AddAccountModal';
import SettingsModal from '../components/SettingsModal';
import useStore from '../store/useStore';
import './MainLayout.css';

export default function MainLayout() {
  const {
    accounts, setAccounts,
    selectedAccountId, selectedFolder,
    folders, setFolders,
    showAddAccount, showSettings
  } = useStore();

  useEffect(() => {
    loadAccounts();
  }, []);

  useEffect(() => {
    if (selectedAccountId) loadFolders(selectedAccountId);
  }, [selectedAccountId]);

  async function loadAccounts() {
    if (!window.electronAPI) return;
    const accs = await window.electronAPI.accounts.list();
    setAccounts(accs || []);
  }

  async function loadFolders(accountId) {
    if (!window.electronAPI) return;
    const flds = await window.electronAPI.folders.list(accountId);
    setFolders(flds || []);
  }

  return (
    <div className="main-layout">
      <div className="scan-line" />

      <Sidebar />

      <div className="workspace">
        <EmailList />
        <EmailPreview />
      </div>

      <Notification />
      {showAddAccount && <AddAccountModal onClose={() => useStore.getState().setShowAddAccount(false)} />}
      {showSettings && <SettingsModal onClose={() => useStore.getState().setShowSettings(false)} />}
    </div>
  );
}
