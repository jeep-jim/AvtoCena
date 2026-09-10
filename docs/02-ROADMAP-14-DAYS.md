# Roadmap 14 дней

День 1–2: ядро, структура, главная форма.
День 3–4: JSON-база и рекомендации.
День 5–6: расчёты и карточка АвтоЦена.
День 7–8: CRM.
День 9–10: партнёрка и CPA.
День 11–12: Telegram Bot + Mini App.
День 13: SEO-страницы.
День 14: деплой Selectel.


### 2026-09-10 — Alice cloud browser pilot (implementation, pending deployment)

- Added a mobile bottom sheet with the catalog dialog colors, a real browser image, scrolling, follow-up input and a photo request chip. The first user-triggered question includes AvtoCena and the canonical offer URL; no synthetic activity and no SEO ranking promise. AI answers never automatically change the price calculator.
- Isolated Chromium service: sandbox enabled, one browser per visitor, global maximum two; 20-second heartbeat lease, 90-second inactivity timeout and ten-minute lifetime. Close, hidden page, pagehide, freeze, offline and unmount stop requests and signal deletion. Mobile shutdown delivery is best effort; server expiry is the fallback.
- TLS-pinned server-to-worker requests, HTTP-only ownership cookie, same-origin checks, encrypted runtime config, no stored chats/images, no exposed browser debugging port. Fail closed on provider blocks; no CAPTCHA bypass.
- GitHub provisioning uses existing cloud credentials, one 2-vCPU/8-GiB VM with 30-GB disk, no autoscaling, seven-day expiry/poweroff. A running VM is still billed between sessions; stopped disks remain billable. Existing instances are not duplicated. Failed initial worker health stops the newly created VM.
- Local tests: session expiry/launch-close race/ownership/concurrency, encrypted configuration and canonical query context. Public Alice browser accepted a real question and follow-up; the anonymous service returned a less capable model and did not provide photos in that test. Photo availability is not guaranteed. Cloud access, sandbox CI and live deployment still need verification.
- Japan Drom and five-market collection remain a separate pending market PR; no new market publication is claimed by this change.
