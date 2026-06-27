import React, { useEffect } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import MainLayout from './pages/MainLayout';
import ComposeWindow from './pages/ComposeWindow';
import useStore from './store/useStore';

function App() {
  const { setSyncStatus, prependEmail, showNotification } = useStore();

  useEffect(() => {
    if (!window.electronAPI) return;

    // Listen for events from main process
    window.electronAPI.on('sync:status', (data) => {
      setSyncStatus(data.accountId, data);
    });

    window.electronAPI.on('emails:new', (data) => {
      showNotification(`New email received`, 'success');
    });

    window.electronAPI.on('notification:show', ({ message, type }) => {
      showNotification(message, type);
    });

    return () => {
      window.electronAPI.off('sync:status');
      window.electronAPI.off('emails:new');
      window.electronAPI.off('notification:show');
    };
  }, []);

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<MainLayout />} />
        <Route path="/compose/:draftId" element={<ComposeWindow />} />
        <Route path="/compose" element={<ComposeWindow />} />
      </Routes>
    </HashRouter>
  );
}

export default App;
