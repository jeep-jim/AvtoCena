/** Embedded reCAPTCHA for a contact form is not a blocked listing page. */
export function publicResponseChallenge(body) {
  // Some HTTP 200 challenge pages consist entirely of executable script.
  if (/window\.solveChallenge\s*\(/.test(String(body)) && /EO-Bot-Js-Token/.test(String(body))) return true;
  const visible = String(body).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const title = visible.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
  return /has_been_cr_blocked[^"<>\s]*\.html/i.test(visible)
    || /<iframe\b[^>]*src=["\'][^"\']*\/_Incapsula_Resource\b/i.test(visible)
    || /captcha|access denied|security check|just a moment|pardon our interruption|访问验证|安全验证/i.test(title)
    || /verify (?:that )?you are human|complete the security check|确认您是真人/i.test(visible.replace(/<[^>]+>/g, ' '));
}
