import React, { useEffect, useState, useRef } from 'react';
import { formatDateFull } from '../utils/dateUtils';
import useStore from '../store/useStore';
import './EmailPreview.css';

export default function EmailPreview() {
  const { selectedEmailId, accounts, selectedAccountId } = useStore();
  const [email, setEmail] = useState(null);
  const [loading, setLoading] = useState(false);
  const iframeRef = useRef(null);

  useEffect(() => {
    if (!selectedEmailId) { setEmail(null); return; }
    loadEmail(selectedEmailId);
  }, [selectedEmailId]);

  async function loadEmail(id) {
    if (!window.electronAPI) return;
    setLoading(true);
    try {
      const data = await window.electronAPI.emails.get(id);
      setEmail(data);
    } catch (err) {
      console.error('loadEmail error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleReply() {
    if (!email || !window.electronAPI) return;
    // Pre-populate compose with reply data
    const draft = await window.electronAPI.compose.saveDraft({
      account_id: email.account_id,
      subject: `Re: ${email.subject}`,
      to_addresses: [email.from_email],
      reply_to_id: email.id,
      body_html: buildReplyBody(email),
    });
    const { openCompose } = require("../components/ComposeOverlay");
    openCompose({ bodyHtml: buildReplyBody(email), subject: `Re: ${email.subject}`, to: [email.from_email], replyToId: email.id });
  }

  async function handleForward() {
    if (!email || !window.electronAPI) return;
    const draft = await window.electronAPI.compose.saveDraft({
      account_id: email.account_id,
      subject: `Fwd: ${email.subject}`,
      forward_of_id: email.id,
      body_html: buildForwardBody(email),
    });
    const { openCompose } = require("../components/ComposeOverlay");
    openCompose({ bodyHtml: buildReplyBody(email), subject: `Re: ${email.subject}`, to: [email.from_email], replyToId: email.id });
  }

  async function handleDelete() {
    if (!email || !window.electronAPI) return;
    await window.electronAPI.emails.delete(email.id);
    useStore.getState().updateEmail(email.id, { is_deleted: 1 });
    useStore.getState().setSelectedEmailId(null);
    setEmail(null);
  }

  function buildReplyBody(email) {
    const date = formatDateFull(email.date);
    return `<br/><br/>
<div style="border-left:2px solid #00ff94;padding-left:12px;margin-top:16px;color:#94a3b8;font-size:12px;">
  <p>On ${date}, <strong>${email.from_name || email.from_email}</strong> wrote:</p>
  ${email.body_html || `<p>${email.body_text || ''}</p>`}
</div>`;
  }

  function buildForwardBody(email) {
    const date = formatDateFull(email.date);
    return `<br/><br/>
<div style="border-top:1px solid #1e2d3d;padding-top:12px;margin-top:16px;color:#94a3b8;font-size:12px;">
  <p>---------- Forwarded message ---------</p>
  <p>From: ${email.from_name || ''} &lt;${email.from_email}&gt;</p>
  <p>Date: ${date}</p>
  <p>Subject: ${email.subject}</p>
  <br/>
  ${email.body_html || `<p>${email.body_text || ''}</p>`}
</div>`;
  }

  function injectEmailHtml(html) {
    if (!html) return '';
    // Inject dark theme styles into email HTML
    return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; }
  html, body {
    background: #0d1117 !important;
    color: #e2e8f0 !important;
    font-family: -apple-system, Arial, sans-serif;
    font-size: 13px;
    line-height: 1.6;
    margin: 0;
    padding: 16px;
    overflow-x: hidden;
  }
  a { color: #00ff94; }
  img { max-width: 100%; height: auto; }
  pre, code { background: #111820; padding: 8px; border-radius: 4px; overflow-x: auto; }
  blockquote { border-left: 2px solid #00ff94; margin: 0; padding-left: 12px; color: #94a3b8; }
</style>
</head>
<body>${html}</body>
</html>`;
  }

  if (!selectedEmailId) {
    return (
      <div className="email-preview-empty">
        <div className="preview-empty-inner">
          <span className="preview-icon">⬡</span>
          <span>Select an email to read</span>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="email-preview-empty">
        <div className="preview-empty-inner">
          <span className="loading-dots">Loading<span className="cursor">_</span></span>
        </div>
      </div>
    );
  }

  if (!email) return null;

  const toAddresses = tryParse(email.to_addresses);
  const ccAddresses = tryParse(email.cc_addresses);

  return (
    <div className="email-preview">
      {/* Header */}
      <div className="preview-header">
        <div className="preview-header-top">
          <h2 className="preview-subject">{email.subject || '(no subject)'}</h2>
          <div className="preview-actions">
            <button className="action-btn" onClick={handleReply} data-tooltip="Reply">↩</button>
            <button className="action-btn" onClick={handleForward} data-tooltip="Forward">↪</button>
            <button className="action-btn danger" onClick={handleDelete} data-tooltip="Delete">✕</button>
          </div>
        </div>

        <div className="preview-meta">
          <div className="meta-row">
            <span className="meta-label">From</span>
            <span className="meta-value">
              {email.from_name ? `${email.from_name} ` : ''}
              <span className="meta-email">&lt;{email.from_email}&gt;</span>
            </span>
          </div>
          {toAddresses.length > 0 && (
            <div className="meta-row">
              <span className="meta-label">To</span>
              <span className="meta-value">
                {toAddresses.map((a, i) => (
                  <span key={i}>
                    {a.name ? `${a.name} ` : ''}
                    <span className="meta-email">&lt;{a.email || a}&gt;</span>
                    {i < toAddresses.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </span>
            </div>
          )}
          {ccAddresses.length > 0 && (
            <div className="meta-row">
              <span className="meta-label">CC</span>
              <span className="meta-value meta-email">{ccAddresses.map(a => a.email || a).join(', ')}</span>
            </div>
          )}
          <div className="meta-row">
            <span className="meta-label">Date</span>
            <span className="meta-value">{formatDateFull(email.date)}</span>
          </div>
        </div>

        {/* Attachments */}
        {email.attachments?.length > 0 && (
          <div className="preview-attachments">
            {email.attachments.filter(a => !a.is_inline).map(att => (
              <AttachmentChip key={att.id} attachment={att} />
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="preview-body email-body">
        {email.body_html ? (
          <iframe
            ref={iframeRef}
            className="preview-iframe"
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            srcDoc={injectEmailHtml(email.body_html)}
            title="Email content"
            onLoad={() => {
              // Auto-resize iframe
              const iframe = iframeRef.current;
              if (iframe?.contentDocument) {
                const height = iframe.contentDocument.body.scrollHeight;
                iframe.style.height = `${height + 32}px`;
              }
            }}
          />
        ) : (
          <pre className="preview-plain">{email.body_text || 'No content'}</pre>
        )}
      </div>
    </div>
  );
}

function AttachmentChip({ attachment }) {
  async function download() {
    if (!window.electronAPI) return;
    const data = await window.electronAPI.emails.getAttachment(attachment.id);
    if (!data?.data) return;
    const blob = new Blob([Buffer.from(data.data, 'base64')], { type: data.mime_type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = attachment.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button className="attachment-chip" onClick={download}>
      <span className="att-icon">⊕</span>
      <span className="att-name">{attachment.filename}</span>
      <span className="att-size">{formatSize(attachment.size)}</span>
    </button>
  );
}

function tryParse(str) {
  try { return JSON.parse(str) || []; } catch { return []; }
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}
