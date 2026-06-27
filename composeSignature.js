export function hasReplyOrForwardContext(context = {}) {
  return Boolean(
    context.replyToId ||
    context.forwardOfId ||
    context.mode === 'reply' ||
    context.mode === 'forward'
  );
}

export function shouldAutoInsertSignature(context = {}) {
  return !hasReplyOrForwardContext(context);
}

export function buildComposeInitialBody(signatureHtml, context = {}) {
  if (!shouldAutoInsertSignature(context)) return '<p></p>';

  const signature = String(signatureHtml || '').trim();
  return signature ? `<p></p><p></p>${signature}` : '<p></p>';
}

export function prepareComposeBody(bodyHtml, signatureHtml, context = {}) {
  const body = String(bodyHtml || '').trim();

  if (!shouldAutoInsertSignature(context)) {
    return body || '<p></p>';
  }

  const signature = String(signatureHtml || '').trim();

  if (!signature) return body || '<p></p>';
  if (!body) return buildComposeInitialBody(signature, context);
  if (body.includes(signature)) return body;

  return `${body}<p></p>${signature}`;
}
