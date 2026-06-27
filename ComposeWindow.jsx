import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import './ComposeWindow.css';

const EMAIL_RE = /^[^\s@<>(),;:"']+@[^\s@<>(),;:"']+\.[^\s@<>(),;:"']+$/i;
const ADDRESS_SPLIT_RE = /[,;\s]+/;
const AUTOSAVE_MS = 2500;

export default function ComposePage() {
  const params = new URLSearchParams(window.location.search);
  const queryDraftId = params.get('draftId');
  const draftId = queryDraftId || `draft-${Date.now()}`;
  const mode = params.get('mode') || 'new';

  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [to, setTo] = useState([]);
  const [cc, setCc] = useState([]);
  const [bcc, setBcc] = useState([]);
  const [fromName, setFromName] = useState('');
  const [subject, setSubject] = useState('');
  const [templates, setTemplates] = useState([]);
  const [attachments, setAttachments] = useState([]);

  const [toInput, setToInput] = useState('');
  const [ccInput, setCcInput] = useState('');
  const [bccInput, setBccInput] = useState('');

  const [showCC, setShowCC] = useState(false);
  const [showBCC, setShowBCC] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showFromName, setShowFromName] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);

  const [sendState, setSendState] = useState('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [statusTone, setStatusTone] = useState('info');

  const [fieldErrors, setFieldErrors] = useState({
    to: '',
    cc: '',
    bcc: '',
    from: '',
  });

  const dirtyRef = useRef(false);
  const saveTimerRef = useRef(null);
  const sendLockRef = useRef(false);
  const signatureRef = useRef('');
  const loadingDraftRef = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
      }),
      Placeholder.configure({
        placeholder: 'Write your message…',
      }),
    ],
    content: '',
    onUpdate: () => {
      if (!loadingDraftRef.current) dirtyRef.current = true;
    },
  });

  const setStatus = useCallback((message, tone = 'info') => {
    setStatusMessage(message || '');
    setStatusTone(tone);
  }, []);

  const markDirty = useCallback(() => {
    if (!loadingDraftRef.current) dirtyRef.current = true;
  }, []);

  const buildPayload = useCallback(() => {
    const parsedTo = parseAddressInput(toInput);
    const parsedCc = parseAddressInput(ccInput);
    const parsedBcc = parseAddressInput(bccInput);

    return {
      id: draftId,
      mode,
      account_id: selectedAccount?.id || null,
      from_email: selectedAccount?.email || '',
      from_name: fromName.trim(),
      to: mergeUniqueEmails(to, parsedTo.valid),
      cc: mergeUniqueEmails(cc, parsedCc.valid),
      bcc: mergeUniqueEmails(bcc, parsedBcc.valid),
      to_input: toInput,
      cc_input: ccInput,
      bcc_input: bccInput,
      subject: subject.trim(),
      attachment_ids: attachments.map((item) => item.id),
      invalid_inputs: {
        to: parsedTo.invalid,
        cc: parsedCc.invalid,
        bcc: parsedBcc.invalid,
      },
    };
  }, [attachments, bcc, bccInput, cc, ccInput, draftId, fromName, mode, selectedAccount, subject, to, toInput]);

  const saveDraft = useCallback(async (silent = true) => {
    if (!window.electronAPI?.compose?.saveDraft || !editor) return null;

    try {
      const payload = buildPayload();

      const result = await window.electronAPI.compose.saveDraft({
        ...payload,
        body_html: ensureSignature(editor.getHTML(), signatureRef.current),
        body_text: editor.getText(),
      });

      dirtyRef.current = false;

      if (!silent) setStatus('Draft saved', 'success');
      return result;
    } catch (error) {
      console.error('[Compose] saveDraft failed:', error);
      if (!silent) setStatus('Draft save failed', 'error');
      return null;
    }
  }, [buildPayload, editor, setStatus]);

  const loadDraft = useCallback(async (existingDraftId, accountList) => {
    if (!window.electronAPI?.compose?.getDraft || !editor) return;

    try {
      loadingDraftRef.current = true;

      const draft = await window.electronAPI.compose.getDraft(existingDraftId);
      if (!draft) return;

      setSubject(draft.subject || '');
      setTo(Array.isArray(draft.to_addresses) ? draft.to_addresses : []);
      setCc(Array.isArray(draft.cc_addresses) ? draft.cc_addresses : []);
      setBcc(Array.isArray(draft.bcc_addresses) ? draft.bcc_addresses : []);
      setToInput(draft.to_input || '');
      setCcInput(draft.cc_input || '');
      setBccInput(draft.bcc_input || '');
      setAttachments(Array.isArray(draft.attachments) ? draft.attachments : []);
      setFromName(draft.from_name || '');
      setShowCC(Boolean((draft.cc_addresses || []).length || draft.cc_input));
      setShowBCC(Boolean((draft.bcc_addresses || []).length || draft.bcc_input));
      setShowFromName(Boolean(draft.from_name));

      if (draft.account_id && Array.isArray(accountList)) {
        const account = accountList.find((item) => String(item.id) === String(draft.account_id));
        if (account) setSelectedAccount(account);
      }

      editor.commands.setContent(
        draft.body_html || buildInitialBody(signatureRef.current)
      );

      setFieldErrors({ to: '', cc: '', bcc: '', from: '' });
      setStatus('', 'info');
      dirtyRef.current = false;
    } catch (error) {
      console.error('[Compose] loadDraft failed:', error);
      setStatus('Could not load draft', 'error');
    } finally {
      loadingDraftRef.current = false;
    }
  }, [editor, setStatus]);

  const uploadAttachments = useCallback(async (items) => {
    if (!window.electronAPI?.compose?.uploadAttachment) return;

    const files = Array.from(items || []).filter(Boolean);
    if (!files.length) return;

    try {
      const uploaded = await Promise.all(
        files.map((file) => window.electronAPI.compose.uploadAttachment(file.path || file))
      );

      const next = uploaded.filter(Boolean);
      if (!next.length) return;

      setAttachments((prev) => dedupeAttachments([...prev, ...next]));
      markDirty();
      setStatus(`${next.length} attachment${next.length > 1 ? 's' : ''} added`, 'success');
    } catch (error) {
      console.error('[Compose] uploadAttachments failed:', error);
      setStatus('Attachment upload failed', 'error');
    }
  }, [markDirty, setStatus]);

  const handleAttach = useCallback(async () => {
    if (!window.electronAPI?.showFilePicker) return;
    const files = await window.electronAPI.showFilePicker();
    await uploadAttachments(files);
  }, [uploadAttachments]);

  const addAddresses = useCallback((type) => {
    const inputValue =
      type === 'to' ? toInput : type === 'cc' ? ccInput : bccInput;

    if (!inputValue.trim()) return true;

    const parsed = parseAddressInput(inputValue);

    if (parsed.invalid.length) {
      setFieldErrors((prev) => ({
        ...prev,
        [type]: `Invalid address: ${parsed.invalid[0]}`,
      }));
      if (type === 'to') setStatus('Fix the recipient address before sending', 'error');
      return false;
    }

    if (type === 'to') {
      setTo((prev) => mergeUniqueEmails(prev, parsed.valid));
      setToInput('');
    } else if (type === 'cc') {
      setCc((prev) => mergeUniqueEmails(prev, parsed.valid));
      setCcInput('');
    } else {
      setBcc((prev) => mergeUniqueEmails(prev, parsed.valid));
      setBccInput('');
    }

    setFieldErrors((prev) => ({ ...prev, [type]: '' }));
    markDirty();
    return true;
  }, [bccInput, ccInput, markDirty, toInput]);

  const removeAddress = useCallback((type, email) => {
    if (type === 'to') setTo((prev) => prev.filter((item) => item !== email));
    if (type === 'cc') setCc((prev) => prev.filter((item) => item !== email));
    if (type === 'bcc') setBcc((prev) => prev.filter((item) => item !== email));
    markDirty();
  }, [markDirty]);

  const insertTemplate = useCallback((template) => {
    if (!editor) return;

    if (template?.subject) setSubject(template.subject);

    const html = ensureSignature(template?.body_html || '', signatureRef.current);
    editor.commands.setContent(html || buildInitialBody(signatureRef.current));
    setShowTemplates(false);
    markDirty();
    setStatus('Template inserted', 'success');
  }, [editor, markDirty, setStatus]);

  const toggleAlwaysOnTop = useCallback(() => {
    const next = !alwaysOnTop;
    setAlwaysOnTop(next);
    window.electronAPI?.compose?.setAlwaysOnTop?.(next);
  }, [alwaysOnTop]);

  const handleAccountChange = useCallback((event) => {
    const account = accounts.find((item) => String(item.id) === String(event.target.value));
    setSelectedAccount(account || null);

    if (account && !fromName.trim()) {
      setFromName(account.display_name || account.name || '');
    }

    setFieldErrors((prev) => ({ ...prev, from: '' }));
    markDirty();
  }, [accounts, fromName, markDirty]);

  const handleSend = useCallback(async () => {
    if (!window.electronAPI?.compose?.send || !editor || sendLockRef.current) return;

    addAddresses('to');
    addAddresses('cc');
    addAddresses('bcc');

    const payload = buildPayload();
    const validation = validatePayload(payload);

    setFieldErrors(validation.errors);

    if (!validation.ok) {
      setSendState('error');
      setStatus(validation.message, 'error');
      return;
    }

    sendLockRef.current = true;
    setSendState('sending');
    setStatus('Queueing message…', 'info');

    const finalPayload = {
      ...payload,
      draft_id: draftId,
      body_html: ensureSignature(editor.getHTML(), signatureRef.current),
      body_text: editor.getText(),
      close_after_queue: true,
      sent_from_window: 'compose',
    };

    try {
      window.electronAPI.compose.send(finalPayload)
        .then((result) => {
          if (!(result?.queued || result?.accepted || result?.success)) {
            console.warn('[Compose] send result:', result);
          }
        })
        .catch((error) => {
          console.error('[Compose] send failed:', error);
        });

      window.electronAPI?.compose?.notifySendQueued?.({
        draftId,
        from: finalPayload.from_email,
        to: finalPayload.to,
        subject: finalPayload.subject,
        queuedAt: Date.now(),
      });

      window.close();
    } catch (error) {
      console.error('[Compose] send launch failed:', error);
      sendLockRef.current = false;
      setSendState('error');
      setStatus('Could not queue message', 'error');
    }
  }, [addAddresses, buildPayload, draftId, editor, setStatus]);

  const handleEditorDrop = useCallback(async (event) => {
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) return;
    event.preventDefault();
    await uploadAttachments(files);
  }, [uploadAttachments]);

  useEffect(() => {
    if (!editor || !window.electronAPI) return;

    let cancelled = false;

    async function bootstrap() {
      try {
        const [accountList, templateList, signature] = await Promise.all([
          window.electronAPI.accounts?.list?.() || [],
          window.electronAPI.settings?.getTemplates?.() || [],
          window.electronAPI.settings?.getSignature?.().catch(() => null),
        ]);

        if (cancelled) return;

        const nextAccounts = Array.isArray(accountList) ? accountList : [];
        setAccounts(nextAccounts);
        setTemplates(Array.isArray(templateList) ? templateList : []);
        signatureRef.current = signature?.html || '';

        if (queryDraftId) {
          await loadDraft(queryDraftId, nextAccounts);
        } else {
          const account = nextAccounts[0] || null;
          setSelectedAccount(account);
          setFromName(account?.display_name || account?.name || '');
          editor.commands.setContent(buildInitialBody(signatureRef.current));
          dirtyRef.current = false;
        }
      } catch (error) {
        console.error('[Compose] bootstrap failed:', error);
        setStatus('Could not initialize compose window', 'error');
      }
    }

    bootstrap();

    saveTimerRef.current = window.setInterval(() => {
      if (dirtyRef.current) void saveDraft(true);
    }, AUTOSAVE_MS);

    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        void handleSend();
      }
    };

    const onBeforeUnload = () => {
      if (dirtyRef.current) void saveDraft(true);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      cancelled = true;
      if (saveTimerRef.current) clearInterval(saveTimerRef.current);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [editor, handleSend, loadDraft, queryDraftId, saveDraft, setStatus]);

  if (!editor) {
    return <div className="compose-loading">Initializing compose window…</div>;
  }

  return (
    <div className="compose-window">
      <div className="compose-toolbar">
        <div className="compose-toolbar-left">
          <div className="compose-title">{subject || 'NEW MESSAGE'}</div>
        </div>

        <div className="compose-toolbar-right">
          <button
            className={`toolbar-btn ${alwaysOnTop ? 'active' : ''}`}
            onClick={toggleAlwaysOnTop}
            title="Pin window"
          >
            Pin
          </button>
          <button
            className="toolbar-btn"
            onClick={() => void saveDraft(false)}
            title="Save draft"
          >
            Save
          </button>
          <button
            className="toolbar-btn"
            onClick={() => void handleAttach()}
            title="Attach files"
          >
            Attach
          </button>
          <button
            className={`toolbar-btn ${showFromName ? 'active' : ''}`}
            onClick={() => setShowFromName((prev) => !prev)}
            title="Toggle From Name"
          >
            Name
          </button>
          <button
            className={`toolbar-btn ${showTemplates ? 'active' : ''}`}
            onClick={() => setShowTemplates((prev) => !prev)}
            title="Templates"
          >
            Templates
          </button>
        </div>
      </div>

      {showTemplates && (
        <div className="template-dropdown">
          <div className="template-header">Insert Template</div>
          {templates.length === 0 ? (
            <div className="template-empty">No templates saved.</div>
          ) : (
            templates.map((template) => (
              <button
                key={template.id || template.name}
                className="template-item"
                onClick={() => insertTemplate(template)}
              >
                {template.name}
              </button>
            ))
          )}
        </div>
      )}

      <div className="compose-fields">
        <div className={`field-row ${fieldErrors.from ? 'error' : ''}`}>
          <div className="field-label">From</div>

          <div className="field-from">
            <select
              className="from-select"
              value={selectedAccount?.id || ''}
              onChange={handleAccountChange}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.email}
                </option>
              ))}
            </select>

            {showFromName && (
              <input
                className="from-name-input"
                placeholder="Display name"
                value={fromName}
                onChange={(event) => {
                  setFromName(event.target.value);
                  markDirty();
                }}
              />
            )}
          </div>
        </div>

        <div className={`field-row ${fieldErrors.to ? 'error' : ''}`}>
          <div className="field-label">To</div>

          <div className="field-tags">
            {to.map((email) => (
              <span key={email} className="tag">
                {email}
                <button onClick={() => removeAddress('to', email)}>×</button>
              </span>
            ))}

            <input
              value={toInput}
              placeholder={fieldErrors.to || 'recipient@domain.com'}
              onChange={(event) => {
                setToInput(event.target.value);
                setFieldErrors((prev) => ({ ...prev, to: '' }));
                markDirty();
              }}
              onKeyDown={(event) => {
                if (['Enter', 'Tab', ',', ' '].includes(event.key)) {
                  event.preventDefault();
                  addAddresses('to');
                }
                if (event.key === 'Backspace' && !toInput && to.length) {
                  setTo((prev) => prev.slice(0, -1));
                  markDirty();
                }
              }}
              onBlur={() => addAddresses('to')}
            />
          </div>

          <div className="field-extras">
            {!showCC && (
              <button className="extra-btn" onClick={() => setShowCC(true)}>
                CC
              </button>
            )}
            {!showBCC && (
              <button className="extra-btn" onClick={() => setShowBCC(true)}>
                BCC
              </button>
            )}
          </div>
        </div>

        {showCC && (
          <div className={`field-row ${fieldErrors.cc ? 'error' : ''}`}>
            <div className="field-label">Cc</div>

            <div className="field-tags">
              {cc.map((email) => (
                <span key={email} className="tag">
                  {email}
                  <button onClick={() => removeAddress('cc', email)}>×</button>
                </span>
              ))}

              <input
                value={ccInput}
                placeholder={fieldErrors.cc || 'cc@domain.com'}
                onChange={(event) => {
                  setCcInput(event.target.value);
                  setFieldErrors((prev) => ({ ...prev, cc: '' }));
                  markDirty();
                }}
                onKeyDown={(event) => {
                  if (['Enter', 'Tab', ',', ' '].includes(event.key)) {
                    event.preventDefault();
                    addAddresses('cc');
                  }
                }}
                onBlur={() => addAddresses('cc')}
              />
            </div>
          </div>
        )}

        {showBCC && (
          <div className={`field-row ${fieldErrors.bcc ? 'error' : ''}`}>
            <div className="field-label">Bcc</div>

            <div className="field-tags">
              {bcc.map((email) => (
                <span key={email} className="tag">
                  {email}
                  <button onClick={() => removeAddress('bcc', email)}>×</button>
                </span>
              ))}

              <input
                value={bccInput}
                placeholder={fieldErrors.bcc || 'bcc@domain.com'}
                onChange={(event) => {
                  setBccInput(event.target.value);
                  setFieldErrors((prev) => ({ ...prev, bcc: '' }));
                  markDirty();
                }}
                onKeyDown={(event) => {
                  if (['Enter', 'Tab', ',', ' '].includes(event.key)) {
                    event.preventDefault();
                    addAddresses('bcc');
                  }
                }}
                onBlur={() => addAddresses('bcc')}
              />
            </div>
          </div>
        )}

        <div className="field-row">
          <div className="field-label">Subj</div>
          <input
            className="subject-input"
            placeholder="Subject"
            value={subject}
            onChange={(event) => {
              setSubject(event.target.value);
              markDirty();
            }}
          />
        </div>
      </div>

      <div className="editor-toolbar">
        <button
          className={`editor-btn ${editor.isActive('bold') ? 'active' : ''}`}
          onMouseDown={(event) => {
            event.preventDefault();
            editor.chain().focus().toggleBold().run();
          }}
          title="Bold"
        >
          B
        </button>

        <button
          className={`editor-btn italic-btn ${editor.isActive('italic') ? 'active' : ''}`}
          onMouseDown={(event) => {
            event.preventDefault();
            editor.chain().focus().toggleItalic().run();
          }}
          title="Italic"
        >
          I
        </button>

        <button
          className={`editor-btn underline-btn ${editor.isActive('underline') ? 'active' : ''}`}
          onMouseDown={(event) => {
            event.preventDefault();
            editor.chain().focus().toggleUnderline().run();
          }}
          title="Underline"
        >
          U
        </button>

        <div className="editor-toolbar-divider" />

        <button
          className={`editor-btn ${editor.isActive('bulletList') ? 'active' : ''}`}
          onMouseDown={(event) => {
            event.preventDefault();
            editor.chain().focus().toggleBulletList().run();
          }}
          title="Bullet list"
        >
          •
        </button>

        <button
          className={`editor-btn ${editor.isActive('orderedList') ? 'active' : ''}`}
          onMouseDown={(event) => {
            event.preventDefault();
            editor.chain().focus().toggleOrderedList().run();
          }}
          title="Numbered list"
        >
          1.
        </button>

        <div className="editor-toolbar-divider" />

        <button
          className="editor-btn"
          onMouseDown={(event) => {
            event.preventDefault();
            editor.chain().focus().sinkListItem('listItem').run();
          }}
          title="Indent"
        >
          &gt;
        </button>

        <button
          className="editor-btn"
          onMouseDown={(event) => {
            event.preventDefault();
            editor.chain().focus().liftListItem('listItem').run();
          }}
          title="Outdent"
        >
          &lt;
        </button>

        <div className="editor-toolbar-divider" />

        <button
          className={`editor-btn ${editor.isActive('link') ? 'active' : ''}`}
          onMouseDown={(event) => {
            event.preventDefault();
            const currentLink = editor.getAttributes('link').href || '';
            const nextLink = window.prompt('Enter URL', currentLink);

            if (nextLink === null) return;
            if (!nextLink.trim()) {
              editor.chain().focus().unsetLink().run();
              return;
            }

            editor.chain().focus().extendMarkRange('link').setLink({ href: nextLink.trim() }).run();
          }}
          title="Link"
        >
          Link
        </button>

        <button
          className="editor-btn"
          onMouseDown={(event) => {
            event.preventDefault();
            editor.chain().focus().unsetAllMarks().clearNodes().run();
          }}
          title="Clear formatting"
        >
          Clear
        </button>
      </div>

      <div
        className="compose-editor-wrap"
        onDrop={(event) => void handleEditorDrop(event)}
        onDragOver={(event) => event.preventDefault()}
      >
        <EditorContent editor={editor} className="compose-editor" />
      </div>

      {attachments.length > 0 && (
        <div className="compose-attachments">
          {attachments.map((attachment) => (
            <div key={attachment.id || `${attachment.filename}-${attachment.size}`} className="att-chip">
              <span className="att-icon">📎</span>
              <span>{attachment.filename}</span>
              <span>{fmtSize(attachment.size)}</span>
              <button
                onClick={() => {
                  setAttachments((prev) => prev.filter((item) => item.id !== attachment.id));
                  markDirty();
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="compose-send-bar">
        {statusMessage ? (
          <div className={`send-status ${statusTone}`}>{statusMessage}</div>
        ) : (
          <div className="compose-meta">
            {selectedAccount?.email || 'Select an account'}
          </div>
        )}

        <div className="send-bar-right">
          <button
            className="discard-btn"
            onClick={() => {
              if (window.confirm('Discard this draft?')) {
                if (queryDraftId) {
                  window.electronAPI?.compose?.deleteDraft?.(queryDraftId);
                }
                window.close();
              }
            }}
          >
            Discard
          </button>

          <button
            className="send-btn"
            disabled={sendState === 'sending'}
            onClick={() => void handleSend()}
          >
            {sendState === 'sending' ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

function parseAddressInput(raw) {
  const tokens = String(raw || '')
    .split(ADDRESS_SPLIT_RE)
    .map((item) => item.trim())
    .filter(Boolean);

  const valid = [];
  const invalid = [];
  const seen = new Set();

  for (const token of tokens) {
    const email = token.toLowerCase();
    if (!EMAIL_RE.test(email)) {
      invalid.push(token);
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    valid.push(email);
  }

  return { valid, invalid };
}

function mergeUniqueEmails(existing, incoming) {
  const output = [];
  const seen = new Set();

  for (const email of [...(existing || []), ...(incoming || [])]) {
    const value = String(email || '').trim().toLowerCase();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }

  return output;
}

function dedupeAttachments(items) {
  const seen = new Set();
  const output = [];

  for (const item of items || []) {
    const key = item.id || `${item.filename}:${item.size}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }

  return output;
}

function ensureSignature(bodyHtml, signatureHtml) {
  const body = String(bodyHtml || '').trim();
  const signature = String(signatureHtml || '').trim();

  if (!signature) return body || '<p></p>';
  if (!body) return buildInitialBody(signature);
  if (body.includes(signature)) return body;

  return `${body}<p></p>${signature}`;
}

function buildInitialBody(signatureHtml) {
  const signature = String(signatureHtml || '').trim();
  return signature ? `<p></p><p></p>${signature}` : '<p></p>';
}

function validatePayload(payload) {
  const errors = {
    to: '',
    cc: '',
    bcc: '',
    from: '',
  };

  if (!payload.account_id || !payload.from_email || !EMAIL_RE.test(payload.from_email)) {
    errors.from = 'Select a valid From account';
  }

  if (!payload.to.length) {
    errors.to = 'Add at least one recipient';
  }

  if (payload.invalid_inputs.to.length) {
    errors.to = `Invalid address: ${payload.invalid_inputs.to[0]}`;
  }

  if (payload.invalid_inputs.cc.length) {
    errors.cc = `Invalid address: ${payload.invalid_inputs.cc[0]}`;
  }

  if (payload.invalid_inputs.bcc.length) {
    errors.bcc = `Invalid address: ${payload.invalid_inputs.bcc[0]}`;
  }

  const ok = !errors.to && !errors.cc && !errors.bcc && !errors.from;

  return {
    ok,
    errors,
    message: ok ? '' : 'Fix the highlighted fields before sending.',
  };
}

function fmtSize(size) {
  if (!size) return '';
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)}KB`;
  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
}
