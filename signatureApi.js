export function normalizeSignatureData(value) {
  if (!value) return { html: '', plain_text: '' };

  if (typeof value === 'string') {
    return { html: value, plain_text: '' };
  }

  if (typeof value !== 'object') {
    return { html: '', plain_text: '' };
  }

  if (value.signature && typeof value.signature === 'object') {
    return normalizeSignatureData(value.signature);
  }

  return {
    html:
      typeof value.html === 'string'
        ? value.html
        : typeof value.signature_html === 'string'
          ? value.signature_html
          : typeof value.signatureHtml === 'string'
            ? value.signatureHtml
            : '',
    plain_text:
      typeof value.plain_text === 'string'
        ? value.plain_text
        : typeof value.signature_plain_text === 'string'
          ? value.signature_plain_text
          : typeof value.plainText === 'string'
            ? value.plainText
            : '',
  };
}

export async function getSignatureSettings() {
  if (window.electronAPI?.settings?.getSignature) {
    try {
      return normalizeSignatureData(await window.electronAPI.settings.getSignature());
    } catch (error) {
      console.warn('[Signature] electron getSignature failed:', error);
    }
  }

  if (typeof fetch === 'function') {
    try {
      const response = await fetch('/api/settings/signature');
      if (response.ok) {
        return normalizeSignatureData(await response.json());
      }
    } catch (error) {
      console.warn('[Signature] fetch GET /api/settings/signature failed:', error);
    }
  }

  if (window.electronAPI?.settings?.get) {
    try {
      return normalizeSignatureData(await window.electronAPI.settings.get());
    } catch (error) {
      console.warn('[Signature] settings.get fallback failed:', error);
    }
  }

  return { html: '', plain_text: '' };
}

export async function setSignatureSettings(nextSignature) {
  const normalized = normalizeSignatureData(nextSignature);

  if (window.electronAPI?.settings?.setSignature) {
    try {
      return await window.electronAPI.settings.setSignature(normalized);
    } catch (error) {
      console.warn('[Signature] electron setSignature failed:', error);
    }
  }

  if (typeof fetch === 'function') {
    try {
      const response = await fetch('/api/settings/signature', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(normalized),
      });

      if (response.ok) {
        try {
          return normalizeSignatureData(await response.json());
        } catch {
          return normalized;
        }
      }
    } catch (error) {
      console.warn('[Signature] fetch PUT /api/settings/signature failed:', error);
    }
  }

  if (window.electronAPI?.settings?.set) {
    return window.electronAPI.settings.set({
      signature_html: normalized.html,
      signature_plain_text: normalized.plain_text,
    });
  }

  throw new Error('No signature settings API available');
}
