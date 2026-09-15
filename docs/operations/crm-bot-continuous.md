# Continuous Telegram worker — prepared, not deployed

Decision 2026-09-15: retain both site-form notifications to the approved private group and contextual customer bot conversations. GitHub schedule is not a five-minute delivery guarantee. No support escalation requested. The Yandex container network trial failed and was rolled back; temporary subnets were deleted.

Deployment requires a Linux host with Docker Compose and verified outbound access to Telegram, avtocena.com and the existing Object Storage. No listening ports are needed. Hosting and connectivity have NOT been provisioned or verified for this package.

Use a clean checkout of the reviewed commit, not a directory containing local credentials. Store the existing worker environment in `/etc/avtocena-bot.env` (root-owned mode 0600). Required keys: JSON_STORAGE_DRIVER=object, AUTH_SECRET, AUTH_ACCESS_KEY, TELEGRAM_BOT_TOKEN, YC_OBJECT_STORAGE_BUCKET, YC_OBJECT_STORAGE_ACCESS_KEY_ID, YC_OBJECT_STORAGE_SECRET_ACCESS_KEY; copy the existing endpoint, region and prefix as well. Never put secrets into the repository or chat.

From the repository root:

```sh
docker compose -f services/crm-bot/compose.yml build
docker compose -f services/crm-bot/compose.yml run --rm bot node --import tsx scripts/crm-bot-preflight.ts
# Continue only when preflight exits successfully.
docker compose -f services/crm-bot/compose.yml up -d
docker compose -f services/crm-bot/compose.yml logs --tail=30
```

The existing shared polling and notification leases remain active. Do not reset offsets, erase queued notices, or change the group. The approved Bot API group ID is -1002697164330, title «Заявки TopAvto».

Acceptance: one uniquely labelled website request must appear in CRM and the approved group without a manual workflow run; a fresh car deep link must yield that exact car and URL in the private bot; confirm submission and check its CRM record and group notice. Verify processing again after a worker restart. Only after these checks retire scheduled GitHub polling. A successful preflight alone is not acceptance.

Rollback: `docker compose -f services/crm-bot/compose.yml stop`. Preserve storage, credentials, offsets and queue. Existing scheduled delivery remains a delayed fallback until explicitly retired.
