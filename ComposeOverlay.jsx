import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import useStore from '../store/useStore';
import './ComposeOverlay.css';

// Global compose state — lives outside React so it survives re-renders
let _openComposes = [];
let _setComposes = null;

export function openCompose(init = {}) {
  const id = init.id || `compose-${Date.now()}`;
  const draft = { id, subject: '', to: [], cc: [], bcc: [], fromAccountId: null, bodyHtml: '', ...init };
  _openComposes = [..._openComposes.filter(c => c.id !== id), draft];
  if (_setComposes) _setComposes([..._openComposes]);
  return id;
}

export function closeCompose(id) {
  _openComposes = _openComposes.filter(c => c.id !== id);
  if (_setComposes) _setComposes([..._openComposes]);
}

export default function ComposeManager() {
  const [composes, setComposes] = useState([]);
  useEffect(() => { _setComposes = setComposes; return () => { _setComposes = null; }; }, []);

  return (
    <>
      {composes.map((draft, i) => (
        <ComposePanel
          key={draft.id}
          draft={draft}
          stackIndex={i}
          total={composes.length}
          onClose={() => closeCompose(draft.id)}
        />
      ))}
    </>
  );
}

function ComposePanel({ draft, stackIndex, total, onClose }) {
  const { accounts, showNotification } = useStore();
  const [toInput, setToInput] = useState('');
  const [ccInput, setCcInput] = useState('');
  const [to, setTo] = useState(draft.to || []);
  const [cc, setCc] = useState(draft.cc || []);
  const [subject, setSubject] = useState(draft.subject || '');
  const [showCc, setShowCc] = useState((draft.cc||[]).length > 0);
  const [minimized, setMinimized] = useState(false);
  const [fromAccountId, setFromAccountId] = useState(
    draft.fromAccountId || accounts[0]?.id || null
  );
  const [attachments, setAttachments] = useState([]);
  const panelRef = useRef(null);
  const subjectRef = useRef(null);

  const fromAccount = accounts.find(a => a.id === fromAccountId) || accounts[0];

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: 'Write your message…' }),
    ],
    content: draft.bodyHtml || '',
    autofocus: !draft.subject, // focus editor if no subject
  });

  // Load signature on mount
  useEffect(() => {
    if (!draft.bodyHtml && window.electronAPI) {
      window.electronAPI.settings.getSignature().then(sig => {
        if (sig?.html && editor) {
          editor.commands.setContent(`<p><br></p><p><br></p>${sig.html}`);
          editor.commands.focus('start');
        }
      }).catch(() => {});
    }
  }, [editor]);

  // Optimistic send — fire and forget, close immediately
  const handleSend = useCallback(async () => {
    const recipients = [...to];
    if (toInput.trim()) recipients.push(...toInput.split(/[,;\s]+/).filter(e => e.includes('@')));

    if (!recipients.length) {
      if (subjectRef.current) subjectRef.current.focus();
      showNotification('Add at least one recipient', 'error');
      return;
    }

    // Close IMMEDIATELY — optimistic UI
    onClose();
    showNotification('Sending…', 'info');

    // Fire in background
    const payload = {
      account_id: fromAccount?.id,
      from_email: fromAccount?.email,
      from_name: fromAccount?.display_name || fromAccount?.name,
      to: recipients,
      cc,
      subject,
      body_html: editor?.getHTML() || '',
      body_text: editor?.getText() || '',
      attachment_ids: attachments.map(a => a.id),
      reply_to_id: draft.replyToId,
    };

    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.compose.send(payload);
        if (result?.success || result?.queued) {
          showNotification('Sent ✓', 'success');
        } else {
          showNotification('Send failed — saved to queue', 'error');
        }
      }
    } catch {
      showNotification('Send queued — will retry', 'info');
    }
  }, [to, toInput, cc, subject, editor, fromAccount, attachments, draft, onClose, showNotification]);

  // Ctrl+Enter sends
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSend();
      }
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSend, onClose]);

  function addTag(type, raw) {
    const emails = raw.split(/[,;\s]+/).filter(e => e.includes('@'));
    if (!emails.length) return;
    if (type === 'to') { setTo(p => [...p, ...emails]); setToInput(''); }
    else { setCc(p => [...p, ...emails]); setCcInput(''); }
  }

  function removeTag(type, email) {
    if (type === 'to') setTo(p => p.filter(e => e !== email));
    else setCc(p => p.filter(e => e !== email));
  }

  async function handleAttach() {
    if (!window.electronAPI) return;
    const files = await window.electronAPI.showFilePicker();
    for (const fp of files) {
      const att = await window.electronAPI.compose.uploadAttachment(fp);
      if (att) setAttachments(p => [...p, att]);
    }
  }

  // Right-stack positioning: each panel offset from right
  const right = 20 + stackIndex * 340;

  if (minimized) {
    return (
      <div className="compose-minimized" style={{ right }} onClick={() => setMinimized(false)}>
        <span className="compose-min-icon">◈</span>
        <span className="compose-min-subject">{subject || 'New Message'}</span>
        <button className="compose-min-close" onClick={e => { e.stopPropagation(); onClose(); }}>✕</button>
      </div>
    );
  }

  return (
    <div className="compose-overlay-panel" style={{ right }} ref={panelRef}>
      {/* Header bar — drag handle */}
      <div className="co-header">
        <span className="co-title">◈ {subject || 'New Message'}</span>
        <div className="co-header-actions">
          <button className="co-btn" onClick={() => setMinimized(true)} title="Minimize">─</button>
          <button className="co-btn co-btn-close" onClick={onClose} title="Discard">✕</button>
        </div>
      </div>

      {/* From */}
      <div className="co-field-row">
        <span className="co-label">From</span>
        <select
          className="co-from-select"
          value={fromAccountId || ''}
          onChange={e => setFromAccountId(e.target.value)}
        >
          {accounts.map(acc => (
            <option key={acc.id} value={acc.id}>{acc.email}</option>
          ))}
        </select>
      </div>

      {/* To */}
      <div className="co-field-row">
        <span className="co-label">To</span>
        <div className="co-tags-wrap">
          {to.map(e => (
            <span key={e} className="co-tag">
              {e}<button onClick={() => removeTag('to', e)}>×</button>
            </span>
          ))}
          <input
            autoFocus={!!draft.subject}
            className="co-tag-input"
            value={toInput}
            placeholder="recipient@email.com"
            onChange={e => setToInput(e.target.value)}
            onKeyDown={e => {
              if (['Enter','Tab',',',' '].includes(e.key)) { e.preventDefault(); addTag('to', toInput); }
              if (e.key==='Backspace' && !toInput && to.length) setTo(p => p.slice(0,-1));
            }}
            onBlur={() => toInput.trim() && addTag('to', toInput)}
          />
        </div>
        {!showCc && (
          <button className="co-extra-btn" onClick={() => setShowCc(true)}>CC</button>
        )}
      </div>

      {/* CC */}
      {showCc && (
        <div className="co-field-row">
          <span className="co-label">CC</span>
          <div className="co-tags-wrap">
            {cc.map(e => (
              <span key={e} className="co-tag">
                {e}<button onClick={() => removeTag('cc', e)}>×</button>
              </span>
            ))}
            <input
              className="co-tag-input"
              value={ccInput}
              placeholder="cc@email.com"
              onChange={e => setCcInput(e.target.value)}
              onKeyDown={e => {
                if (['Enter','Tab',',',' '].includes(e.key)) { e.preventDefault(); addTag('cc', ccInput); }
              }}
              onBlur={() => ccInput.trim() && addTag('cc', ccInput)}
            />
          </div>
        </div>
      )}

      {/* Subject */}
      <div className="co-field-row">
        <span className="co-label">Subj</span>
        <input
          ref={subjectRef}
          className="co-subject-input"
          value={subject}
          placeholder="Subject"
          onChange={e => setSubject(e.target.value)}
        />
      </div>

      {/* Formatting toolbar */}
      {editor && (
        <div className="co-format-bar">
          <button className={`co-fmt-btn ${editor.isActive('bold')?'active':''}`}
            onMouseDown={e=>{e.preventDefault();editor.chain().focus().toggleBold().run()}}>B</button>
          <button className={`co-fmt-btn italic ${editor.isActive('italic')?'active':''}`}
            onMouseDown={e=>{e.preventDefault();editor.chain().focus().toggleItalic().run()}}>I</button>
          <button className={`co-fmt-btn uline ${editor.isActive('underline')?'active':''}`}
            onMouseDown={e=>{e.preventDefault();editor.chain().focus().toggleUnderline().run()}}>U</button>
          <div className="co-fmt-sep"/>
          <button className={`co-fmt-btn ${editor.isActive('bulletList')?'active':''}`}
            onMouseDown={e=>{e.preventDefault();editor.chain().focus().toggleBulletList().run()}}>•—</button>
          <button className={`co-fmt-btn ${editor.isActive('orderedList')?'active':''}`}
            onMouseDown={e=>{e.preventDefault();editor.chain().focus().toggleOrderedList().run()}}>1—</button>
          <div className="co-fmt-sep"/>
          <button className="co-fmt-btn" title="Attach file" onClick={handleAttach}>⊕</button>
        </div>
      )}

      {/* Body editor */}
      <div className="co-editor-wrap">
        <EditorContent editor={editor} className="co-editor" />
      </div>

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="co-attachments">
          {attachments.map(att => (
            <span key={att.id} className="co-att-chip">
              ⊕ {att.filename}
              <button onClick={() => setAttachments(p => p.filter(a => a.id !== att.id))}>×</button>
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="co-footer">
        <span className="co-shortcut">Ctrl+Enter to send</span>
        <button className="co-send-btn" onClick={handleSend}>
          ► SEND
        </button>
      </div>
    </div>
  );
}
