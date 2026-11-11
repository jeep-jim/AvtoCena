import nodemailer from 'nodemailer';

export function accountMailConfigured() {
  if (process.env.ACCOUNT_MAIL_PROVIDER === 'yandex-postbox') return !!process.env.ACCOUNT_MAIL_FROM;
  return !!(process.env.ACCOUNT_SMTP_HOST && process.env.ACCOUNT_SMTP_USER && process.env.ACCOUNT_SMTP_PASSWORD && process.env.ACCOUNT_MAIL_FROM);
}

/** Fixed endpoints: neither credentials nor user input can redirect mail requests. */
async function sendPostbox(to: string, subject: string, text: string) {
  const metadata = await fetch('http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: {'Metadata-Flavor': 'Google'}, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(3000),
  });
  if (!metadata.ok) throw new Error('Mail authentication unavailable');
  const token = await metadata.json();
  if (typeof token.access_token !== 'string' || !token.access_token || !(Number(token.expires_in) > 0)) throw new Error('Mail authentication unavailable');
  const response = await fetch('https://postbox.cloud.yandex.net/v2/email/outbound-emails', {
    method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000),
    headers: {'Content-Type': 'application/json', 'X-YaCloud-SubjectToken': token.access_token},
    body: JSON.stringify({FromEmailAddress: process.env.ACCOUNT_MAIL_FROM, Destination: {ToAddresses: [to]}, Content: {Simple: {
      Subject: {Data: subject, Charset: 'UTF-8'}, Body: {Text: {Data: text, Charset: 'UTF-8'}},
    }}}),
  });
  // Do not retry an ambiguous send: Postbox may already have accepted the message.
  if (!response.ok) throw new Error('Mail delivery unavailable');
}

export async function sendAccountMail(to: string, subject: string, text: string) {
  if (!accountMailConfigured()) throw new Error('Отправка писем пока не подключена. Обратитесь к вашему менеджеру.');
  try {
    if (process.env.ACCOUNT_MAIL_PROVIDER === 'yandex-postbox') return await sendPostbox(to, subject, text);
    const port = Number(process.env.ACCOUNT_SMTP_PORT || 465);
    const transport = nodemailer.createTransport({host: process.env.ACCOUNT_SMTP_HOST, port, secure: port === 465, requireTLS: port !== 465,
      auth: {user: process.env.ACCOUNT_SMTP_USER, pass: process.env.ACCOUNT_SMTP_PASSWORD}, connectionTimeout: 10000, socketTimeout: 15000});
    try { await transport.sendMail({from: process.env.ACCOUNT_MAIL_FROM, to, subject, text}); }
    finally { transport.close(); }
  } catch { throw new Error('Не удалось отправить письмо. Попробуйте позже.'); }
}
