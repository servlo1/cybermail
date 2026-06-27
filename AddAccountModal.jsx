import React, { useState } from 'react';
import useStore from '../store/useStore';
import './Modal.css';

const IMAP_PRESETS = {
  'gmail.com':     { imap_host: 'imap.gmail.com',      imap_port: 993, smtp_host: 'smtp.gmail.com',             smtp_port: 587 },
  'googlemail.com':{ imap_host: 'imap.gmail.com',      imap_port: 993, smtp_host: 'smtp.gmail.com',             smtp_port: 587 },
  'outlook.com':   { imap_host: 'outlook.office365.com', imap_port: 993, smtp_host: 'smtp-mail.outlook.com',     smtp_port: 587 },
  'hotmail.com':   { imap_host: 'outlook.office365.com', imap_port: 993, smtp_host: 'smtp-mail.outlook.com',     smtp_port: 587 },
  'yahoo.com':     { imap_host: 'imap.mail.yahoo.com', imap_port: 993, smtp_host: 'smtp.mail.yahoo.com',        smtp_port: 587 },
  'zoho.com':      { imap_host: 'imap.zoho.com',       imap_port: 993, smtp_host: 'smtp.zoho.com',              smtp_port: 587 },
  'zohomail.com':  { imap_host: 'imap.zoho.com',       imap_port: 993, smtp_host: 'smtp.zoho.com',              smtp_port: 587 },
  'rackspace.com': { imap_host: 'secure.emailsrvr.com', imap_port: 993, smtp_host: 'smtp.emailsrvr.com',        smtp_port: 587 },
  'suddenlink.net':{ imap_host: 'mail.suddenlink.net', imap_port: 993, smtp_host: 'mail.suddenlink.net',        smtp_port: 465 },
  'optonline.net': { imap_host: 'mail.optonline.net',  imap_port: 993, smtp_host: 'mail.optonline.net',         smtp_port: 465 },
  'spectrum.net':  { imap_host: 'mobile.charter.net',  imap_port: 993, smtp_host: 'smtp.charter.net',           smtp_port: 587 },
  'roadrunner.com':{ imap_host: 'mobile.charter.net',  imap_port: 993, smtp_host: 'smtp.charter.net',           smtp_port: 587 },
  'terra.com.br':  { imap_host: 'imap.terra.com.br',   imap_port: 993, smtp_host: 'smtp.terra.com.br',          smtp_port: 587 },
};

const ACCOUNT_COLORS = ['#00ff94','#00d9ff','#a855f7','#f97316','#eab308','#ef4444','#22d3ee'];

export default function AddAccountModal({ onClose }) {
  const { addAccount: storeAddAccount, showNotification } = useStore();
  const [step, setStep] = useState(1); // 1=basic, 2=advanced, 3=testing
  const [form, setForm] = useState({
    email: '', password: '', name: '', display_name: '',
    imap_host: '', imap_port: 993, imap_secure: true,
    smtp_host: '', smtp_port: 587, smtp_secure: false,
    color: '#00ff94',
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);

  function handleEmailChange(e) {
    const email = e.target.value;
    setForm(f => ({ ...f, email }));
    const domain = email.split('@')[1]?.toLowerCase();
    if (domain && IMAP_PRESETS[domain]) {
      const preset = IMAP_PRESETS[domain];
      setForm(f => ({ ...f, email, ...preset, imap_secure: true }));
    }
  }

  function set(key, val) {
    setForm(f => ({ ...f, [key]: val }));
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    const result = await window.electronAPI?.accounts.testConnection(form);
    setTestResult(result);
    setTesting(false);
  }

  async function handleSave() {
    if (!form.email || !form.password) {
      showNotification('Email and password are required', 'error');
      return;
    }
    setSaving(true);
    try {
      const acc = await window.electronAPI?.accounts.add(form);
      storeAddAccount(acc);
      showNotification(`Account ${form.email} added`, 'success');
      onClose();
    } catch (err) {
      showNotification(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 520 }}>
        <div className="modal-header">
          <span className="modal-title">⊕ ADD ACCOUNT</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {/* Step tabs */}
          <div className="modal-tabs">
            <button className={`modal-tab ${step === 1 ? 'active' : ''}`} onClick={() => setStep(1)}>Basic</button>
            <button className={`modal-tab ${step === 2 ? 'active' : ''}`} onClick={() => setStep(2)}>Advanced</button>
          </div>

          {step === 1 && (
            <div className="form-section">
              <div className="form-row">
                <label>Email Address</label>
                <input type="email" value={form.email} onChange={handleEmailChange} placeholder="you@example.com" autoFocus />
              </div>
              <div className="form-row">
                <label>Password / App Password</label>
                <input type="password" value={form.password} onChange={e => set('password', e.target.value)} placeholder="••••••••" />
              </div>
              <div className="form-row">
                <label>Display Name</label>
                <input type="text" value={form.display_name} onChange={e => set('display_name', e.target.value)} placeholder="Your Name" />
              </div>
              <div className="form-row">
                <label>Account Label</label>
                <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Work, Personal, etc." />
              </div>
              <div className="form-row">
                <label>Color</label>
                <div className="color-picker">
                  {ACCOUNT_COLORS.map(c => (
                    <button
                      key={c}
                      className={`color-swatch ${form.color === c ? 'selected' : ''}`}
                      style={{ background: c }}
                      onClick={() => set('color', c)}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="form-section">
              <div className="form-group-label">IMAP (Incoming)</div>
              <div className="form-row-2">
                <div className="form-row">
                  <label>Host</label>
                  <input type="text" value={form.imap_host} onChange={e => set('imap_host', e.target.value)} placeholder="imap.example.com" />
                </div>
                <div className="form-row narrow">
                  <label>Port</label>
                  <input type="number" value={form.imap_port} onChange={e => set('imap_port', +e.target.value)} />
                </div>
              </div>
              <div className="form-row">
                <label>
                  <input type="checkbox" checked={form.imap_secure} onChange={e => set('imap_secure', e.target.checked)} />
                  {' '}Use SSL/TLS
                </label>
              </div>

              <div className="form-group-label" style={{ marginTop: 16 }}>SMTP (Outgoing)</div>
              <div className="form-row-2">
                <div className="form-row">
                  <label>Host</label>
                  <input type="text" value={form.smtp_host} onChange={e => set('smtp_host', e.target.value)} placeholder="smtp.example.com" />
                </div>
                <div className="form-row narrow">
                  <label>Port</label>
                  <input type="number" value={form.smtp_port} onChange={e => set('smtp_port', +e.target.value)} />
                </div>
              </div>
              <div className="form-row">
                <label>
                  <input type="checkbox" checked={form.smtp_secure} onChange={e => set('smtp_secure', e.target.checked)} />
                  {' '}Use SSL/TLS
                </label>
              </div>
            </div>
          )}

          {/* Test result */}
          {testResult && (
            <div className="test-result">
              <div className={`test-item ${testResult.imap?.success ? 'success' : 'fail'}`}>
                IMAP: {testResult.imap?.success ? '✓ Connected' : `✕ ${testResult.imap?.error}`}
              </div>
              <div className={`test-item ${testResult.smtp?.success ? 'success' : 'fail'}`}>
                SMTP: {testResult.smtp?.success ? '✓ Connected' : `✕ ${testResult.smtp?.error}`}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={handleTest} disabled={testing || !form.email}>
            {testing ? 'Testing...' : '⚡ Test Connection'}
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Adding...' : '⊕ Add Account'}
          </button>
        </div>
      </div>
    </div>
  );
}
