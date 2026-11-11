// Offline guard only. Does not contact providers or print credential values.
const problems = [];
const required = ['YC_OBJECT_STORAGE_ENDPOINT', 'YC_OBJECT_STORAGE_REGION',
  'YC_OBJECT_STORAGE_BUCKET', 'YC_OBJECT_STORAGE_PREFIX',
  'YC_OBJECT_STORAGE_ACCESS_KEY_ID', 'YC_OBJECT_STORAGE_SECRET_ACCESS_KEY',
  'AUTH_SECRET', 'AUTH_ACCESS_KEY'];
for (const name of required) if (!process.env[name]?.trim()) problems.push(`Missing ${name}`);
try {
  const endpoint = new URL(process.env.YC_OBJECT_STORAGE_ENDPOINT);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password ||
      /(^|\.)yandexcloud\.net$/i.test(endpoint.hostname)) problems.push('Use an explicit HTTPS target storage endpoint, not Yandex');
} catch { problems.push('Invalid storage endpoint'); }
if (process.env.JSON_STORAGE_DRIVER !== 'object') problems.push('JSON_STORAGE_DRIVER must be object');
if (!/^migration-staging\/[a-z0-9-]+\/$/.test(process.env.YC_OBJECT_STORAGE_PREFIX || '')) {
  problems.push('Use an isolated migration-staging/<name>/ prefix');
}
for (const name of ['TELEGRAM_BOT_TOKEN', 'CRM_GITHUB_DISPATCH_TOKEN',
  'DEALER_YOOKASSA_SECRET', 'ACCOUNT_SMTP_PASSWORD']) {
  if (process.env[name]) problems.push(`Remove live integration ${name} from the initial isolated test`);
}
if (process.env.ACCOUNT_MAIL_PROVIDER === 'yandex-postbox') problems.push('Postbox metadata authentication is Yandex-specific');
if (process.env.DEALER_PAYMENTS_ENABLED === 'true') problems.push('Disable real payments in the isolated test');
if (problems.length) {
  for (const problem of problems) console.error(problem);
  process.exitCode = 1;
} else console.log('Offline configuration checks passed; storage compatibility and runtime are NOT yet verified.');
