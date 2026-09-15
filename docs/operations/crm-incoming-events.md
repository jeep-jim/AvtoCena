# Telegram incoming events, 2026-09-15

Website and favorites notifications are verified working via dispatch (PR 962); do not revert that path or catalog performance fixes.

New receiver: /api/telegram/incoming, authenticated by Telegram secret header. Private message/callback events are saved to existing private Object Storage, then GitHub workflow_dispatch operation=deliver is requested. Return 503 if wake-up fails, retaining both local event and Telegram retries. Group chatter is ignored.

Worker reuses existing bot handlers, global processing lease and completed-update receipts. Event mode does not advance or filter by polling offset: out-of-order webhook updates remain eligible. Completed queue payloads are cleared on the next queue read. Duplicate event IDs do not create duplicate queue rows.

Activation is separate from publishing: enable-events verifies bot identity, exact live release and authenticated receiver reachability, refuses an unknown existing webhook and an active polling lease, selects event mode, then sets the direct Yandex container URL with max_connections=1 and drop_pending_updates=false. On activation failure, deletes that webhook without dropping pending updates and restores polling mode. Locally queued events remain preserved if rollback occurs and must be drained after restoring event mode.

The receiver reachability probe comes from GitHub, not Telegram. Only actual incoming Telegram traffic and a resulting workflow_dispatch prove Telegram connectivity. Do not call this complete before that evidence. No new hosting or secrets are needed.

Acceptance: direct car link yields same car/link, confirmation creates CRM lead and group notice; plain /start welcomes; typed question stays private and is recorded against the selected lead. Immediate replies are not guaranteed by GitHub runner scheduling. Website notify mode remains separate and does not install worker dependencies.
