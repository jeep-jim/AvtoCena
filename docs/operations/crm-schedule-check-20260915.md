# CRM delivery schedule investigation, 2026-09-15

User requires website lead notices in «Заявки TopAvto» and contextual bot entry. No additional server is available. Do not treat a manually triggered delivery as proof of autonomous service.

Before the group migration, commit 5d3fa9e already used the same GitHub workflow with `*/5 * * * *` and manual dispatch. Observed schedule-created runs include 34865755102 (2026-09-14 15:59 UTC), 34891905855 (20:16), 34907742686 (23:12), 34917496606 (2026-09-15 01:29) and 34937743270 (06:37). Other inspected deliveries were push, workflow_dispatch or workflow_run events. There is no verified continuously running prior service to restore.

Bounded adjustment: move schedule to minutes 2,7,...57 as GitHub recommends avoiding busy minute slots, and deliver existing website notices before polling customer updates. Run delivery again afterward for new bot submissions. Preserve failure status and all existing recipient, queue and lease checks.

This is a mitigation experiment, NOT a five-minute guarantee or a completed repair. Verify a genuinely schedule-triggered run after publication and an actual queued test delivery. Do not invite repeated submissions. If delays remain, this scheduler cannot meet the requirement; do not mask that by manual restarts or endless chained workflows.

Reference: https://docs.github.com/actions/using-workflows/events-that-trigger-workflows#schedule
