import { create } from 'zustand';

const useStore = create((set, get) => ({
  // Accounts
  accounts: [],
  setAccounts: (accounts) => set({ accounts }),
  addAccount: (acc) => set((s) => ({ accounts: [...s.accounts, acc] })),
  removeAccount: (id) => set((s) => ({ accounts: s.accounts.filter(a => a.id !== id) })),

  // Selected state
  selectedAccountId: null,
  setSelectedAccountId: (id) => set({ selectedAccountId: id, selectedFolder: 'INBOX', selectedEmailId: null }),

  selectedFolder: 'INBOX',
  setSelectedFolder: (folder) => set({ selectedFolder: folder, selectedEmailId: null }),

  selectedEmailId: null,
  setSelectedEmailId: (id) => set({ selectedEmailId: id }),

  // Emails
  emails: [],
  setEmails: (emails) => set({ emails }),
  prependEmail: (email) => set((s) => ({
    emails: [email, ...s.emails.filter(e => e.id !== email.id)]
  })),
  updateEmail: (id, changes) => set((s) => ({
    emails: s.emails.map(e => e.id === id ? { ...e, ...changes } : e)
  })),
  totalEmails: 0,
  setTotalEmails: (n) => set({ totalEmails: n }),

  // Folders
  folders: [],
  setFolders: (folders) => set({ folders }),

  // Sync status
  syncStatus: {},
  setSyncStatus: (accountId, status) => set((s) => ({
    syncStatus: { ...s.syncStatus, [accountId]: status }
  })),

  // Search
  searchQuery: '',
  setSearchQuery: (q) => set({ searchQuery: q }),
  searchResults: [],
  setSearchResults: (r) => set({ searchResults: r }),
  isSearching: false,
  setIsSearching: (v) => set({ isSearching: v }),

  // UI state
  isLoading: false,
  setIsLoading: (v) => set({ isLoading: v }),
  showAddAccount: false,
  setShowAddAccount: (v) => set({ showAddAccount: v }),
  showSettings: false,
  setShowSettings: (v) => set({ showSettings: v }),
  notification: null,
  showNotification: (msg, type = 'info') => {
    set({ notification: { msg, type, id: Date.now() } });
    setTimeout(() => set({ notification: null }), 4000);
  },
}));

export default useStore;
