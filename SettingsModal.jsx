import React, { useState, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import useStore from '../store/useStore';
import './Modal.css';

export default function SettingsModal({ onClose }) {
  const { accounts, showNotification } = useStore();
  const [tab, setTab] = useState('signature');
  const [sigHtml, setSigHtml] = useState('');
  const [sigPlain, setSigPlain] = useState('');
  const [templates, setTemplates] = useState([]);
  const [newTpl, setNewTpl] = useState({ name: '', body_html: '' });
  const [settings, setSettings] = useState({});

  const sigEditor = useEditor({
    extensions: [StarterKit],
    content: sigHtml,
    onUpdate: ({ editor }) => setSigHtml(editor.getHTML()),
  });

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    if (!window.electronAPI) return;
    const [sig, tpls, cfg] = await Promise.all([
      window.electronAPI.settings.getSignature(),
      window.electronAPI.settings.getTemplates(),
      window.electronAPI.settings.get(),
    ]);
    setSigHtml(sig?.html || '');
    setSigPlain(sig?.plain_text || '');
    setTemplates(tpls || []);
    setSettings(cfg || {});
    sigEditor?.commands.setContent(sig?.html || '');
  }

  async function saveSignature() {
    await window.electronAPI?.settings.setSignature({ html: sigHtml, plain_text: sigPlain });
    showNotification('Signature saved', 'success');
  }

  async function saveTemplate() {
    if (!newTpl.name.trim()) return;
    const saved = await window.electronAPI?.settings.saveTemplate(newTpl);
    setTemplates(prev => [...prev.filter(t => t.name !== saved.name), saved]);
    setNewTpl({ name: '', body_html: '' });
    showNotification('Template saved', 'success');
  }

  async function deleteTemplate(name) {
    await window.electronAPI?.settings.deleteTemplate(name);
    setTemplates(prev => prev.filter(t => t.name !== name));
    showNotification('Template deleted', 'info');
  }

  const TABS = [
    { key: 'signature', label: 'Signature' },
    { key: 'templates', label: 'Templates' },
    { key: 'accounts', label: 'Accounts' },
    { key: 'general', label: 'General' },
  ];

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal settings-modal">
        <div className="modal-header">
          <span className="modal-title">⚙ SETTINGS</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="settings-layout">
          {/* Sidebar tabs */}
          <div className="settings-tabs">
            {TABS.map(t => (
              <button
                key={t.key}
                className={`settings-tab ${tab === t.key ? 'active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="settings-content">
            {/* ─── SIGNATURE ─── */}
            {tab === 'signature' && (
              <div>
                <div className="settings-section-title">Email Signature</div>
                <p className="settings-hint">Appended to new messages and replies automatically.</p>
                <div className="sig-editor-wrap">
                  {sigEditor && <EditorContent editor={sigEditor} className="sig-editor" />}
                </div>
                <div className="form-row" style={{ marginTop: 12 }}>
                  <label>Plain text fallback</label>
                  <textarea
                    rows={4}
                    value={sigPlain}
                    onChange={e => setSigPlain(e.target.value)}
                    placeholder="Plain text version..."
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                  <button className="btn-primary" onClick={saveSignature}>Save Signature</button>
                </div>
              </div>
            )}

            {/* ─── TEMPLATES ─── */}
            {tab === 'templates' && (
              <div>
                <div className="settings-section-title">Email Templates</div>
                <p className="settings-hint">Use variables: {'{{FirstName}}'}, {'{{Email}}'}, {'{{Company}}'}</p>

                <div className="template-list">
                  {templates.map(t => (
                    <div key={t.name} className="template-card">
                      <div className="template-card-name">{t.name}</div>
                      <div
                        className="template-card-preview"
                        dangerouslySetInnerHTML={{ __html: t.body_html.substring(0, 150) + '...' }}
                      />
                      <button className="btn-danger" onClick={() => deleteTemplate(t.name)}>Delete</button>
                    </div>
                  ))}
                </div>

                <div className="settings-section-title" style={{ marginTop: 20 }}>New Template</div>
                <div className="form-row">
                  <label>Name</label>
                  <input
                    type="text"
                    value={newTpl.name}
                    onChange={e => setNewTpl(n => ({ ...n, name: e.target.value }))}
                    placeholder="Template name"
                  />
                </div>
                <div className="form-row">
                  <label>HTML Body</label>
                  <textarea
                    rows={6}
                    value={newTpl.body_html}
                    onChange={e => setNewTpl(n => ({ ...n, body_html: e.target.value }))}
                    placeholder="<p>Dear {{FirstName}},</p><p>...</p>"
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <button className="btn-primary" onClick={saveTemplate}>Save Template</button>
                </div>
              </div>
            )}

            {/* ─── ACCOUNTS ─── */}
            {tab === 'accounts' && (
              <div>
                <div className="settings-section-title">Connected Accounts</div>
                {accounts.length === 0 && (
                  <p className="settings-hint">No accounts. Add one from the sidebar.</p>
                )}
                {accounts.map(acc => (
                  <div key={acc.id} className="account-card">
                    <span className="account-dot-lg" style={{ background: acc.color }} />
                    <div>
                      <div className="acc-name">{acc.name || acc.email}</div>
                      <div className="acc-email">{acc.email}</div>
                      <div className="acc-meta">
                        {acc.imap_host}:{acc.imap_port} · {acc.smtp_host}:{acc.smtp_port}
                      </div>
                    </div>
                    <button
                      className="btn-danger"
                      style={{ marginLeft: 'auto' }}
                      onClick={async () => {
                        if (confirm(`Remove ${acc.email}?`)) {
                          await window.electronAPI?.accounts.remove(acc.id);
                          useStore.getState().removeAccount(acc.id);
                        }
                      }}
                    >Remove</button>
                  </div>
                ))}
              </div>
            )}

            {/* ─── GENERAL ─── */}
            {tab === 'general' && (
              <div>
                <div className="settings-section-title">General Settings</div>
                <div className="form-row">
                  <label>Sync interval</label>
                  <select
                    value={settings.sync_interval_ms || 120000}
                    onChange={async e => {
                      const v = +e.target.value;
                      setSettings(s => ({ ...s, sync_interval_ms: v }));
                      await window.electronAPI?.settings.set({ sync_interval_ms: v });
                    }}
                  >
                    <option value={60000}>Every 1 minute</option>
                    <option value={120000}>Every 2 minutes</option>
                    <option value={300000}>Every 5 minutes</option>
                    <option value={600000}>Every 10 minutes</option>
                  </select>
                </div>
                <div className="form-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.notifications_enabled !== 'false'}
                      onChange={async e => {
                        const v = String(e.target.checked);
                        setSettings(s => ({ ...s, notifications_enabled: v }));
                        await window.electronAPI?.settings.set({ notifications_enabled: v });
                      }}
                    />
                    {' '}Desktop notifications
                  </label>
                </div>
                <div className="settings-section-title" style={{ marginTop: 20 }}>About</div>
                <div className="settings-hint">
                  CyberMail v1.0.0 — Cybersecurity-themed desktop email client<br />
                  Built with Electron + React + SQLite
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
