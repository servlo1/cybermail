import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { formatDate } from '../utils/dateUtils';
import useStore from '../store/useStore';
import './EmailList.css';

export default function EmailList() {
  const {
    accounts, selectedAccountId, selectedFolder,
    emails, setEmails, totalEmails, setTotalEmails,
    selectedEmailId, setSelectedEmailId,
    searchQuery, setSearchQuery, searchResults, setSearchResults, isSearching, setIsSearching,
    syncStatus, isLoading, setIsLoading,
  } = useStore();

  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const searchTimerRef = useRef(null);

  useEffect(() => {
    setPage(0);
    setHasMore(true);
    loadEmails(0, true);
  }, [selectedAccountId, selectedFolder]);

  useEffect(() => {
    // Subscribe to new email events
    if (!window.electronAPI) return;
    window.electronAPI.on('emails:new', () => {
      loadEmails(0, true);
    });
  }, [selectedAccountId, selectedFolder]);

  async function loadEmails(pageNum = 0, reset = false) {
    if (!window.electronAPI) return;
    setIsLoading(true);

    try {
      const result = await window.electronAPI.emails.list({
        accountId: selectedAccountId || undefined,
        folder: selectedFolder,
        page: pageNum,
        limit: 50,
      });

      if (reset) {
        setEmails(result.emails || []);
      } else {
        setEmails([...emails, ...(result.emails || [])]);
      }
      setTotalEmails(result.total || 0);
      setHasMore((result.emails?.length || 0) === 50);
    } catch (err) {
      console.error('loadEmails error:', err);
    } finally {
      setIsLoading(false);
    }
  }

  function handleLoadMore() {
    if (!hasMore || isLoading) return;
    const nextPage = page + 1;
    setPage(nextPage);
    loadEmails(nextPage, false);
  }

  function handleSearch(e) {
    const q = e.target.value;
    setSearchQuery(q);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (q.trim().length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      if (!window.electronAPI) return;
      const results = await window.electronAPI.emails.search(q);
      setSearchResults(results || []);
    }, 300);
  }

  async function handleEmailClick(email) {
    setSelectedEmailId(email.id);
    if (!email.is_read && window.electronAPI) {
      await window.electronAPI.emails.markRead(email.id);
      useStore.getState().updateEmail(email.id, { is_read: 1 });
    }
  }

  const displayEmails = isSearching ? searchResults : emails;
  const syncInfo = selectedAccountId ? syncStatus[selectedAccountId] : null;

  return (
    <div className="email-list-pane">
      {/* Header */}
      <div className="email-list-header">
        <div className="email-list-title">
          <span className="folder-name">{selectedFolder || 'Inbox'}</span>
          <span className="email-count">{totalEmails.toLocaleString()}</span>
        </div>
        <div className="search-bar">
          <span className="search-icon">⌕</span>
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={handleSearch}
            className="search-input"
          />
          {searchQuery && (
            <button className="search-clear" onClick={() => {
              setSearchQuery('');
              setSearchResults([]);
              setIsSearching(false);
            }}>✕</button>
          )}
        </div>
      </div>

      {/* Sync status bar */}
      {syncInfo?.status === 'syncing' && (
        <div className="sync-bar">
          <span className="sync-bar-dot" />
          <span>Syncing {syncInfo.folder || ''}...</span>
        </div>
      )}

      {/* Email items */}
      <div className="email-list-body">
        {displayEmails.length === 0 && !isLoading ? (
          <div className="email-list-empty">
            {isSearching ? (
              <>
                <span className="empty-icon">⌕</span>
                <span>No results for "{searchQuery}"</span>
              </>
            ) : (
              <>
                <span className="empty-icon">▣</span>
                <span>Empty folder</span>
              </>
            )}
          </div>
        ) : (
          <Virtuoso
            data={displayEmails}
            endReached={handleLoadMore}
            overscan={200}
            itemContent={(index, email) => (
              <EmailRow
                key={email.id}
                email={email}
                isSelected={email.id === selectedEmailId}
                onClick={() => handleEmailClick(email)}
              />
            )}
            components={{
              Footer: () => isLoading ? (
                <div className="loading-more">Loading...</div>
              ) : null
            }}
          />
        )}
      </div>

      {/* Compose FAB */}
      <button className="compose-fab" onClick={() => window.electronAPI?.compose.openWindow(null)}>
        +
      </button>
    </div>
  );
}

function EmailRow({ email, isSelected, onClick }) {
  const date = formatDate(email.date);
  const fromDisplay = email.from_name || email.from_email || 'Unknown';
  const isUnread = !email.is_read;

  return (
    <div
      className={`email-row ${isSelected ? 'selected' : ''} ${isUnread ? 'unread' : ''}`}
      onClick={onClick}
    >
      <div className="email-row-left">
        {isUnread && <span className="unread-dot" />}
        {!isUnread && <span className="read-spacer" />}
        <div
          className="account-stripe"
          style={{ background: email.account_color || '#00ff94' }}
        />
      </div>

      <div className="email-row-content">
        <div className="email-row-top">
          <span className="email-from">{fromDisplay}</span>
          <span className="email-date">{date}</span>
        </div>
        <div className="email-subject">{email.subject || '(no subject)'}</div>
        <div className="email-snippet">{email.snippet}</div>
      </div>

      {email.attachment_count > 0 && (
        <span className="attachment-badge">⊕</span>
      )}
    </div>
  );
}
