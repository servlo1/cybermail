import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import './ComposeWindow.css';

export default function ComposeWindow() {
  const { draftId } = useParams();
  const [draft, setDraft] = useState({
    id: draftId,
    subject: '',
    to_addresses: [],
    cc_addresses: [],
    bcc_addresses: [],
    from_name: '',
    from_email: '',
    account_id: null,
  });
  const [accounts, setAccounts] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [showCC, setShowCC] = useState(false);
  const [showBCC, setShowBCC] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState(null); // 'sent' | 'error' | null
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [toInput, setToInput] = useState('');
  const [ccInput, setCcInput] = useState('');
  const [bccInput, setBccInput] = useState('');
  const autoSaveRef = useRef(null);
  const hasChanges = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: 'Write your message...' }),
    ],
    content: '',
    onUpdate: () => { hasChanges.current = true; },
  });

  useEffect(() => {
    loadAccounts();
    loadTemplates();
    if (draftId) loadDraft(draftId);

    // Start autosave
    autoSaveRef.current = setInterval(() => {
      if (hasChanges.current) saveDraft(false);
    }, 5000);

    return () => clearInterval(autoSaveRef.current);
  }, [draftId]);

  async function loadAccounts() {
    if (!window.electronAPI) return;
    const accs = await window.electronAPI.accounts.list();
    setAccounts(accs || []);
    if (accs?.length > 0 && !draft.account_id) {
      const acc = accs[0];
      setDraft(d => ({ ...d, account_id: acc.id, from_email: acc.email, from_name: acc.display_name || acc.name }));
    }
  }

  async function loadTemplates() {
    if (!window.electronAPI) return;
    const tpls = await window.electronAPI.settings.getTemplates();
    setTemplates(tpls || []);
  }

  async function loadDraft(id) {
    if (!window.electronAPI) return;
    const d = await window.electronAPI.compose.getDraft(id);
    if (!d) return;

    setDraft({
      id: d.id,
      account_id: d.account_id,
      subject: d.subject || '',
      to_addresses: d.to_addresses || [],
      cc_addresses: d.cc_addresses || [],
      bcc_addresses: d.bcc_addresses || [],
      from_name: d.from_name || '',
      from_email: d.from_email || '',
      reply_to_id: d.reply_to_id,
      forward_of_id: d.forward_of_id,
    });

    if (d.cc_addresses?.length > 0) setShowCC(true);
    if (d.bcc_addresses?.length > 0) setShowBCC(true);
    if (d.attachments?.length > 0) setAttachments(d.attachments);

    // Load signature if new message
    if (!d.body_html && !d.reply_to_id) {
      const sig = await window.electronAPI.settings.getSignature();
      const sigHtml = sig?.html || '';
      editor?.commands.setContent(`<br/><br/>${sigHtml}`);
    } else {
      editor?.commands.setContent(d.body_html || '');
    }
    hasChanges.current = false;
  }

  async function saveDraft(notify = false) {
    if (!editor) return;
    const bodyHtml = editor.getHTML();
    const bodyText = editor.getText();

    const payload = {
      id: draft.id,
      account_id: draft.account_id,
      subject: draft.subject,
      to_addresses: draft.to_addresses,
      cc_addresses: draft.cc_addresses,
      bcc_addresses: draft.bcc_addresses,
      from_name: draft.from_name,
      from_email: draft.from_email,
      body_html: bodyHtml,
      body_text: bodyText,
      attachment_ids: attachments.map(a => a.id),
      reply_to_id: draft.reply_to_id,
      forward_of_id: draft.forward_of_id,
    };

    if (window.electronAPI) {
      const result = await window.electronAPI.compose.saveDraft(payload);
      if (result?.id) setDraft(d => ({ ...d, id: result.id }));
    }
    hasChanges.current = false;
    if (notify) setSendStatus('saved');
  }

  async function handleSend() {
    if (!editor || sending) return;
    if (!draft.to_addresses?.length && !toInput.trim()) {
      alert('Please add at least one recipient.');
      return;
    }

    // Finalize any inline address inputs
    let finalTo = [...(draft.to_addresses || [])];
    if (toInput.trim()) finalTo.push(toInput.trim());

    setSending(true);
    setSendStatus(null);

    try {
      const result = await window.electronAPI.compose.send({
        account_id: draft.account_id,
        from_email: draft.from_email,
        from_name: draft.from_name,
        to: finalTo,
        cc: draft.cc_addresses,
        bcc: draft.bcc_addresses,
        subject: draft.subject,
        body_html: editor.getHTML(),
        body_text: editor.getText(),
        attachment_ids: attachments.map(a => a.id),
        draft_id: draft.id,
        reply_to_message_id: draft.reply_to_id,
      });

      if (result.success || result.queued) {
        setSendStatus('sent');
        setTimeout(() => window.close(), 1500);
      } else {
        setSendStatus('error');
      }
    } catch (err) {
      setSendStatus('error');
    } finally {
      setSending(false);
    }
  }

  async function handleFileAttach() {
    if (!window.electronAPI) return;
    const files = await window.electronAPI.showFilePicker();
    for (const fp of files) {
      const att = await window.electronAPI.compose.uploadAttachment(fp);
      if (att) setAttachments(prev => [...prev, att]);
    }
    hasChanges.current = true;
  }

  function insertTemplate(tpl) {
    if (!editor) return;
    editor.commands.setContent(tpl.body_html);
    setShowTemplates(false);
    hasChanges.current = true;
  }

  function addAddress(type, value) {
    if (!value.trim()) return;
    const emails = value.split(/[,;\s]+/).filter(e => e.includes('@'));
    if (type === 'to') {
      setDraft(d => ({ ...d, to_addresses: [...(d.to_addresses||[]), ...emails] }));
      setToInput('');
    } else if (type === 'cc') {
      setDraft(d => ({ ...d, cc_addresses: [...(d.cc_addresses||[]), ...emails] }));
      setCcInput('');
    } else if (type === 'bcc') {
      setDraft(d => ({ ...d, bcc_addresses: [...(d.bcc_addresses||[]), ...emails] }));
      setBccInput('');
    }
    hasChanges.current = true;
  }

  function removeAddress(type, email) {
    if (type === 'to') setDraft(d => ({ ...d, to_addresses: d.to_addresses.filter(e => e !== email) }));
    else if (type === 'cc') setDraft(d => ({ ...d, cc_addresses: d.cc_addresses.filter(e => e !== email) }));
    else if (type === 'bcc') setDraft(d => ({ ...d, bcc_addresses: d.bcc_addresses.filter(e => e !== email) }));
  }

  function handleAccountChange(e) {
    const acc = accounts.find(a => a.id === e.target.value);
    if (acc) setDraft(d => ({ ...d, account_id: acc.id, from_email: acc.email, from_name: acc.display_name || acc.name }));
  }

  if (!editor) return <div className="compose-loading">Initializing<span className="cursor">_</span></div>;

  return (
    <div className="compose-window">
      {/* Toolbar */}
      <div className="compose-toolbar">
        <div className="compose-toolbar-left">
          <span className="compose-title">◈ COMPOSE</span>
          <button
            className={`toolbar-btn ${alwaysOnTop ? 'active' : ''}`}
            onClick={() => setAlwaysOnTop(v => !v)}
            data-tooltip="Pin window"
          >
            📌
          </button>
        </div>
        <div className="compose-toolbar-right">
          <button className="toolbar-btn" onClick={() => saveDraft(true)} data-tooltip="Save draft">
            💾
          </button>
          <button className="toolbar-btn" onClick={handleFileAttach} data-tooltip="Attach file">
            ⊕
          </button>
          <button
            className="toolbar-btn"
            onClick={() => setShowTemplates(v => !v)}
            data-tooltip="Templates"
          >
            ◧
          </button>
        </div>
      </div>

      {/* Template dropdown */}
      {showTemplates && (
        <div className="template-dropdown">
          <div className="template-header">Templates</div>
          {templates.length === 0 ? (
            <div className="template-empty">No templates saved</div>
          ) : (
            templates.map(t => (
              <button key={t.name} className="template-item" onClick={() => insertTemplate(t)}>
                {t.name}
              </button>
            ))
          )}
        </div>
      )}

      {/* Fields */}
      <div className="compose-fields">
        {/* From */}
        <div className="field-row">
          <span className="field-label">From</span>
          <div className="field-from">
            <select value={draft.account_id || ''} onChange={handleAccountChange} className="from-select">
              {accounts.map(acc => (
                <option key={acc.id} value={acc.id}>{acc.email}</option>
              ))}
            </select>
            <input
              type="text"
              className="from-name-input"
              placeholder="Display name"
              value={draft.from_name}
              onChange={e => setDraft(d => ({ ...d, from_name: e.target.value }))}
            />
          </div>
        </div>

        {/* To */}
        <div className="field-row">
          <span className="field-label">To</span>
          <div className="field-tags">
            {(draft.to_addresses||[]).map(e => (
              <span key={e} className="tag">
                {e} <button onClick={() => removeAddress('to', e)}>×</button>
              </span>
            ))}
            <input
              type="text"
              placeholder="recipient@email.com"
              value={toInput}
              onChange={e => setToInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
                  e.preventDefault();
                  addAddress('to', toInput);
                }
              }}
              onBlur={() => addAddress('to', toInput)}
            />
          </div>
          <div className="field-extras">
            {!showCC && <button className="extra-btn" onClick={() => setShowCC(true)}>CC</button>}
            {!showBCC && <button className="extra-btn" onClick={() => setShowBCC(true)}>BCC</button>}
          </div>
        </div>

        {/* CC */}
        {showCC && (
          <div className="field-row">
            <span className="field-label">CC</span>
            <div className="field-tags">
              {(draft.cc_addresses||[]).map(e => (
                <span key={e} className="tag">
                  {e} <button onClick={() => removeAddress('cc', e)}>×</button>
                </span>
              ))}
              <input
                type="text"
                placeholder="cc@email.com"
                value={ccInput}
                onChange={e => setCcInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addAddress('cc', ccInput); }
                }}
                onBlur={() => addAddress('cc', ccInput)}
              />
            </div>
          </div>
        )}

        {/* BCC */}
        {showBCC && (
          <div className="field-row">
            <span className="field-label">BCC</span>
            <div className="field-tags">
              {(draft.bcc_addresses||[]).map(e => (
                <span key={e} className="tag">
                  {e} <button onClick={() => removeAddress('bcc', e)}>×</button>
                </span>
              ))}
              <input
                type="text"
                placeholder="bcc@email.com"
                value={bccInput}
                onChange={e => setBccInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addAddress('bcc', bccInput); }
                }}
                onBlur={() => addAddress('bcc', bccInput)}
              />
            </div>
          </div>
        )}

        {/* Subject */}
        <div className="field-row">
          <span className="field-label">Subj</span>
          <input
            type="text"
            className="subject-input"
            placeholder="Subject"
            value={draft.subject}
            onChange={e => { setDraft(d => ({ ...d, subject: e.target.value })); hasChanges.current = true; }}
          />
        </div>
      </div>

      {/* Editor toolbar */}
      {editor && <EditorToolbar editor={editor} />}

      {/* Editor */}
      <div className="compose-editor-wrap">
        <EditorContent editor={editor} className="compose-editor" />
      </div>

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="compose-attachments">
          {attachments.map(att => (
            <span key={att.id} className="att-chip">
              <span className="att-icon">⊕</span>
              {att.filename}
              <button onClick={() => setAttachments(prev => prev.filter(a => a.id !== att.id))}>×</button>
            </span>
          ))}
        </div>
      )}

      {/* Send bar */}
      <div className="compose-send-bar">
        {sendStatus === 'sent' && <span className="send-status success">✓ Sent</span>}
        {sendStatus === 'error' && <span className="send-status error">✕ Failed — queued for retry</span>}
        {sendStatus === 'saved' && <span className="send-status info">◈ Draft saved</span>}
        <div className="send-bar-right">
          <button className="btn-ghost" onClick={() => window.close()}>Discard</button>
          <button
            className="btn-primary"
            onClick={handleSend}
            disabled={sending}
          >
            {sending ? 'Sending...' : '► SEND'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditorToolbar({ editor }) {
  return (
    <div className="editor-toolbar">
      <button
        className={`editor-btn ${editor.isActive('bold') ? 'active' : ''}`}
        onClick={() => editor.chain().focus().toggleBold().run()}
        data-tooltip="Bold"
      >B</button>
      <button
        className={`editor-btn italic-btn ${editor.isActive('italic') ? 'active' : ''}`}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        data-tooltip="Italic"
      >I</button>
      <button
        className={`editor-btn underline-btn ${editor.isActive('underline') ? 'active' : ''}`}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        data-tooltip="Underline"
      >U</button>
      <div className="editor-toolbar-divider" />
      <button
        className={`editor-btn ${editor.isActive('bulletList') ? 'active' : ''}`}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        data-tooltip="Bullet list"
      >•—</button>
      <button
        className={`editor-btn ${editor.isActive('orderedList') ? 'active' : ''}`}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        data-tooltip="Numbered list"
      >1—</button>
      <div className="editor-toolbar-divider" />
      <button
        className="editor-btn"
        onClick={() => {
          const url = window.prompt('URL:');
          if (url) editor.chain().focus().setLink({ href: url }).run();
        }}
        data-tooltip="Insert link"
      >⊕</button>
      <button
        className="editor-btn"
        onClick={() => editor.chain().focus().sinkListItem('listItem').run()}
        data-tooltip="Indent"
      >→</button>
      <button
        className="editor-btn"
        onClick={() => editor.chain().focus().liftListItem('listItem').run()}
        data-tooltip="Outdent"
      >←</button>
    </div>
  );
}
