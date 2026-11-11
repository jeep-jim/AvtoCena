"""Prepare production settings without printing credentials or activating them."""
import json, os, sys
names = ['SMARTCAPTCHA_CLIENT_KEY', 'SMARTCAPTCHA_SERVER_KEY', 'ACCOUNT_MAIL_PROVIDER', 'ACCOUNT_SMTP_HOST', 'ACCOUNT_SMTP_PORT', 'ACCOUNT_SMTP_USER', 'ACCOUNT_SMTP_PASSWORD', 'ACCOUNT_MAIL_FROM', 'DEALER_YOOKASSA_SHOP_ID', 'DEALER_YOOKASSA_SECRET', 'DEALER_PAYMENTS_ENABLED', 'DEALER_PAYMENTS_MODE', 'DEALER_RECEIPTS_CONFIRMED', 'DEALER_FISCAL_FLOW_CONFIRMED', 'AUTH_SECRET', 'AUTH_ACCESS_KEY', 'CRM_GITHUB_DISPATCH_TOKEN', 'DADATA_API_KEY', 'TELEGRAM_BOT_USERNAME', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET']
values = {name: os.environ.get(name, '') for name in names}
values.update({
 'NODE_ENV':'production','HOSTNAME':'0.0.0.0','PORT':'3000',
 'NEXT_PUBLIC_SITE_URL':'https://avtocena.com','JSON_STORAGE_DRIVER':'object',
 'YC_OBJECT_STORAGE_ENDPOINT':'https://s3.regru.cloud','YC_OBJECT_STORAGE_REGION':'us-east-1',
 'YC_OBJECT_STORAGE_BUCKET':'avtocena-staging-8120751',
 'YC_OBJECT_STORAGE_PREFIX':'migration-staging/full-20261011/',
 'YC_OBJECT_STORAGE_ACCESS_KEY_ID':os.environ['TARGET_ACCESS'],
 'YC_OBJECT_STORAGE_SECRET_ACCESS_KEY':os.environ['TARGET_SECRET'],
 'AVTOCENA_RELEASE_SHA':'dd63dc40f51ee97d33c12a86654ad60d3714053f',
 'NEXT_TELEMETRY_DISABLED':'1'
})
required=['AUTH_SECRET','AUTH_ACCESS_KEY','YC_OBJECT_STORAGE_ACCESS_KEY_ID','YC_OBJECT_STORAGE_SECRET_ACCESS_KEY']
missing=[name for name in required if not values[name]]
if missing: raise SystemExit('Required settings absent: '+', '.join(missing))
for name,value in values.items():
 if any(c in value for c in ['\n','\r','\0']): raise SystemExit('Invalid single-line setting: '+name)
with open(sys.argv[1],'w') as out:
 out.write(''.join(name+'='+value+'\n' for name,value in values.items()))
os.chmod(sys.argv[1],0o600)
print(json.dumps({'productionConfigurationPrepared':True,'authKeysPresent':True,
 'mailProvider':values.get('ACCOUNT_MAIL_PROVIDER') or 'smtp',
 'smtpConfigured':all(values.get(n) for n in ['ACCOUNT_SMTP_HOST','ACCOUNT_SMTP_USER','ACCOUNT_SMTP_PASSWORD','ACCOUNT_MAIL_FROM']),
 'telegramConfigured':bool(values.get('TELEGRAM_BOT_TOKEN')),
 'captchaConfigured':all(values.get(n) for n in ['SMARTCAPTCHA_CLIENT_KEY','SMARTCAPTCHA_SERVER_KEY']),
 'dispatchConfigured':bool(values.get('CRM_GITHUB_DISPATCH_TOKEN')),
 'paymentsEnabled':values.get('DEALER_PAYMENTS_ENABLED')=='true',
 'activated':False}))
