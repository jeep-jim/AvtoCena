# Event-driven website lead delivery

Prepared 2026-09-15; activation requires the repository secret `CRM_GITHUB_DISPATCH_TOKEN` and deployment. Existing schedule is retained as a delayed fallback, not a timing guarantee.

Create a fine-grained GitHub token owned by jeep-jim, restricted to the AvtoCena repository, with repository Actions permission Read and write. Set an expiry and record its renewal date. Save directly in GitHub Settings → Secrets and variables → Actions → New repository secret. Never paste the token into chat or source code.

Deploy workflow passes this secret to the existing Yandex container. On successful POST /api/leads, a server-only two-second bounded request dispatches `crm-telegram-delivery.yml` on main with operation=notify. No customer fields or lead IDs are sent to GitHub dispatch inputs. Notify skips npm installation and customer polling and uses the existing approved-group sender. Existing queue leases, retries and recipient validation are unchanged.

Acceptance after deploying with the secret: submit one labelled site request; verify durable CRM record, a new workflow_dispatch run (not workflow_run or schedule), and matching group delivery. Measure time; do not claim a fixed delivery SLA. Check GitHub access from the actual Yandex runtime. A 204 acknowledgement is dispatch acceptance, not Telegram delivery confirmation.

The customer bot webhook/callback path is NOT changed by this patch. Its timely processing remains unresolved and requires a separate incoming webhook test. Catalog rendering, prices and runtime resource settings are unchanged.

Rollback: remove the runtime dispatch token and redeploy; intake still succeeds and the existing notification queue remains intact.
