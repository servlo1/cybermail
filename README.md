# CyberMail — Cybersecurity-Themed Desktop Email Client

A production-grade **Windows desktop email client** built with:
- **Electron** (main process + window management)
- **React** (UI with TipTap rich editor)
- **SQLite + FTS5** (offline-first local database)
- **IMAP + IDLE** (real-time push sync)
- **SMTP** (multi-provider sending with retry queue)
- **OAuth2** (Gmail + Microsoft 365)

---

## ⚡ Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Rebuild native modules for Electron
npx electron-rebuild

# 3. Start development
npm start
```

> **Node.js 18+ required.** Tested on Windows 10/11, macOS 13+, Ubuntu 22.04.

---

## 📁 Project Structure

```
cybermail/
├── electron-main/          # Electron main process
│   ├── index.js            # App entry, window creation
│   ├── preload.js          # Secure IPC bridge
│   └── ipcHandlers.js      # All IPC route handlers
│
├── src/                    # React renderer (CRA)
│   ├── App.jsx             # Router + event listeners
│   ├── components/
│   │   ├── Sidebar.jsx     # Account tree + folder nav
│   │   ├── EmailList.jsx   # Virtualized email list
│   │   ├── EmailPreview.jsx# Email reading pane
│   │   ├── AddAccountModal.jsx
│   │   ├── SettingsModal.jsx
│   │   └── Notification.jsx
│   ├── pages/
│   │   ├── MainLayout.jsx  # 3-pane layout
│   │   └── ComposeWindow.jsx # Rich editor compose
│   ├── store/
│   │   └── useStore.js     # Zustand global state
│   └── styles/
│       └── globals.css     # Cyberpunk design tokens
│
├── imap-engine/
│   └── imapEngine.js       # IMAP sync + IDLE
│
├── smtp-engine/
│   └── smtpEngine.js       # SMTP send + retry queue
│
├── sync-worker/
│   └── syncWorker.js       # Background sync orchestrator
│
├── database/
│   └── db.js               # SQLite schema + init
│
├── auth/
│   └── oauthHandler.js     # Gmail + Microsoft OAuth2
│
├── windows-manager/
│   └── windowManager.js    # Compose window tracking
│
└── services/               # Business logic layer
    ├── accountService.js
    ├── emailService.js
    ├── composeService.js
    ├── folderService.js
    ├── settingsService.js
    └── syncService.js
```

---

## 🔌 Supported Email Providers

### IMAP/SMTP (Auto-configured)
| Provider | Domain |
|---|---|
| Gmail | gmail.com |
| Outlook / Hotmail | outlook.com, hotmail.com, live.com |
| Yahoo Mail | yahoo.com |
| Zoho Mail | zoho.com, zohomail.com |
| Rackspace | rackspace.com |
| Suddenlink | suddenlink.net |
| Optonline | optonline.net |
| Spectrum | spectrum.net |
| Roadrunner | roadrunner.com, rr.com |
| Terra (Brazil) | terra.com.br |
| ZeptoMail | zeptomail.com |

### Custom IMAP/SMTP
Any server — configure host/port manually in Account Settings.

---

## 🏗 Architecture

### Sync Pipeline
```
Background SyncWorker
   ↓
ImapEngine.connect() → IMAP Server
   ↓
syncFolder() → UID-based incremental fetch
   ↓
_storeEmail() → SQLite (emails + attachments)
   ↓
broadcastToMainWindow('emails:new') → React UI update
   ↓
startIdle() → IMAP IDLE push notifications
```

### Compose Pipeline
```
ComposeWindow (separate BrowserWindow)
   ↓
TipTap rich editor (HTML)
   ↓
autosave → SQLite drafts table
   ↓
handleSend → SmtpEngine.sendEmail()
   ↓
Success → storeInSent() + close window
Failure → SendQueue.enqueue() → retry with backoff
```

### Database
SQLite with WAL mode, 64MB cache, FTS5 full-text search:
- `accounts` — IMAP/SMTP credentials
- `emails` — all messages (deduplicated by UID)
- `emails_fts` — FTS5 virtual table for instant search
- `attachments` — file references
- `drafts` — compose window persistence
- `folders` — folder list + unread counts
- `sync_state` — per-folder sync cursors
- `settings` — key/value config store
- `templates` — HTML email templates
- `send_queue` — retry queue for failed sends

---

## 🖥 Build for Distribution

```bash
# Build React + package Electron
npm run dist

# Output in ./dist/
# - CyberMail-Setup-1.0.0.exe  (NSIS installer)
# - CyberMail-1.0.0.exe        (Portable)
```

---

## 🔐 Security Notes

- Passwords stored base64-encoded in SQLite settings table
  - Production: replace with `keytar` (system keychain) — already imported
- Email bodies rendered in sandboxed `<iframe>` (no JS execution)
- Context isolation enabled in all windows
- External links open in system browser via `shell.openExternal`

---

## 🔑 Gmail App Passwords

Gmail requires an **App Password** (not your regular password):
1. Go to myaccount.google.com → Security → 2-Step Verification → App passwords
2. Generate a password for "Mail" + "Windows Computer"
3. Use that 16-char password in CyberMail

For OAuth2, set `oauth_client_id` and `oauth_client_secret` in Settings.

---

## ⌨ Keyboard Shortcuts

| Action | Shortcut |
|---|---|
| New compose | Ctrl+N |
| Search | Ctrl+F |
| Reply | Ctrl+R |
| Forward | Ctrl+Shift+F |
| Send | Ctrl+Enter |
| Save draft | Ctrl+S |

---

## 🛠 Troubleshooting

**`npm install` fails on better-sqlite3:**
```bash
npm install --ignore-scripts
npx electron-rebuild -f -w better-sqlite3
```

**IMAP connection refused:**
- Gmail: enable IMAP in Gmail settings, use App Password
- Outlook: enable IMAP in Outlook settings
- Check firewall / antivirus blocking port 993

**Emails not appearing:**
- Click ↻ sync button in sidebar footer
- Check account credentials in Settings → Accounts

---

## 📋 Settings API Reference

### Signature
```
PUT /api/settings/signature
{ "html": "<div>...</div>", "plain_text": "..." }

GET /api/settings/signature
→ { "html": "...", "plain_text": "..." }
```

### Templates
```
POST /api/settings/templates
{ "name": "My Template", "body_html": "<p>Dear {{FirstName}},</p>" }

GET /api/settings/templates
→ [{ "id": "...", "name": "...", "body_html": "..." }]

DELETE /api/settings/templates/{name}
```

Variables: `{{FirstName}}`, `{{Email}}`, `{{Company}}`

---

## License

MIT
