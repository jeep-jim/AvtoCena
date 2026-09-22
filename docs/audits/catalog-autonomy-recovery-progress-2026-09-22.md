# Catalog recovery execution — 2026-09-22

Owner clarification: prevent a market collapse, not preservation of every old row. Autohome new inventory must remain <=10%. No unsafe quota cut to obtain a cosmetic 80/20.

PR #1120 merged as e607da1e1e4e18ec75338dc4a22db03b7462559a after CI 35689568987 passed. Five independent refresh schedules, guarded multipart Japan checkpoints, bounded transient retries/watchdog, 15m seller-price cap, per-market journals and stale public/internal writer protection are on main. Deployment 35689935513 succeeded. Six recovery runs were triggered by main commit 2863b95 (full SHA in git).

| Market | Run |
|---|---:|
| Japan | 35689946933 |
| China | 35689947147 |
| Korea | 35689947182 |
| UAE | 35689947115 |
| Georgia | 35689947205 |
| Europe | 35689947156 |

The five markets reuse the saved observations from 35534895557 through repaired publication code. Japan actually resumes source collection. Fresh independent crawls still need to be observed; a re-publication is not a new scrape.

Initial public catalog: 76,065 (Japan 12,544; China 19,368; Korea 13,600; Europe 21,442; Georgia 8,355; UAE 756), generation gen_1789962476542_8f0a78a7. Browser check at 1440/390 returned HTTP 200, no page errors, but DOM arrival through this environment took 17.0/15.4 sec. This does not resolve the user's unidentified VPN problem.

Detailed prior source logs: Encar blocked 403; K Car 1,887 observations. Dubizzle challenge, DubiCars 631 then 403, CarSwitch 113 then transient 202. These access denials are not bypassed. MyAuto current direct check also returned 403. Autopapa 8,365 then bridge 500. mobile.de 17,517, source_finished. AutoScout resumed at page 201 and parsed zero; a normal fresh page 1 returned HTTP 200 and 19 parsed valid rows. Autohome resumed at page 4001; zero accepted observations by page 6001. Fresh-start schedules address obsolete cursors, but source access cannot be promised.

Georgia recovery job 106624676944 safely refused cutover: candidate 7,888 vs minimum total 7,504, but MyAuto 6 -> 0 triggered source-specific minimum 4. The market remains 8,355. Follow-up permits tiny source samples (<20) to decline independently, while enforcing 90% total and substantial-source retention. It also allows verified low-power newcomers to replace retained high/unknown rows against a FIXED previous-count baseline. Repeated preview/persist processing must be idempotent; source and total guards still apply. Actual 80/20 requires sufficient verified low-power supply and has not been confirmed.

Next normal slots (UTC): China 23 Sep 18:11, Korea 19:17, UAE 20:23, Georgia 21:29, Europe 22:37, then every 72h calendar day. Japan daily 03:00 plus incomplete-checkpoint continuations, fresh full-cycle interval 14 days. Watchdog every two hours at :43. GitHub scheduled start times may be delayed.

Post-deploy audit 35690254498 confirms live CRM advances (China 160,000; Korea 110,000) agree with displayed cards. Its next mismatch is an explicitly saved manager calculation: UAE c7b4eca0d367f0822069dbc8 has data-offer-saved-version 930ba947-ec91-4e25-a56f-50d143b9b0eb and total 1,909,579, versus seller-price listing 875,654. Follow-up audit verifies the saved version and amount against the identity-bound storage record; ordinary cards still require exact list/detail equality. No price or saved calculation is changed.


## Verified execution through 06:03 UTC

- PR #1121 merged as 04437a4b1a2b8e14e8ec7826aa75a0ca21de8a7e after CI 35691097338 passed. Deployment 35691499546 and post-deploy quote parity 35691880435 passed. Fixed-baseline low-power replacement and tiny-source guard corrections are deployed.
- Korea recovery 35689947182 published generation gen_1790054483298_b684f4f8: 13,598 versus 13,600. Sources: Encar 11,701 retained, K Car 1,897. Power: verified low 1,466; high 2,412; unknown 9,720. Actual 80/20 is NOT achieved. Other markets were preserved.
- Japan collect job 106624600299 succeeded: 8,326 details and 6,935 prepared rows; stopped normally at its 40-minute budget. Its durable v2 checkpoint is 565,369,209 bytes in nine parts, beyond the former 512 MiB failure. Read-only verification run 35692818885/job 106633238120 downloaded, checked and restored the production checkpoint in isolated runner storage; restored counts match. No remote writes or source requests occurred in that verification. Publication and automatic continuation are not yet confirmed.
- PR #1122 merged as b8279725411f4cf2b7c90e1fd1fe682d5946bfcd after CI 35691783428 passed; deployment 35692146649 succeeded and live health confirmed its release. Completion-triggered storage maintenance skips redundant work only after a recent healthy report with sufficient headroom; daily/manual maintenance and publication preflight remain enabled.
- Main operation marker ed58eeb started fresh source sweeps with cursors reset: Korea 35691565684, China 35691565627, UAE 35691565659, Europe 35691565662. Georgia 35691565694 retries saved observations through the corrected tiny-source guard. These runs are ongoing, not completed evidence of fresh supply.
- Watchdog 35691466944 correctly reported Encar access denial and Georgia's then-deterministic source guard instead of retrying them indefinitely. Automatic dispatch after a completed Japan publication has not yet been observed.
- Live browser reproduction confirmed engine inputs 1,5 -> 1500 and 1498 -> 1498 with budget preserved after waiting for React readiness on each document navigation. PR #1123 fixes that readiness wait in the audit only; CI 35692503780 passed, merged 095216b7e5da9af951bf08d714ba6ae170e3857b. Production UI and pricing are unchanged. Full live audit still requires a final successful run.
- Later parity run 35692588351 encountered HTTP 502 on UAE offer f36afef8d45d26feb839b46d; prior checked quotes matched. A separate repeat returned HTTP 200. This is an availability failure, not a verified price mismatch; do not mark all live checks green.
- At 06:03 UTC Europe held a renewing publication lease and the current manifest was still the Korean generation. China, UAE, Georgia and Japan publications remain unconfirmed. Public API count observed earlier was 76,059 (six fewer than initial public count), without a market collapse.

Outstanding: observe remaining cutovers and fresh source results; verify <=15m UAE inventory after its cutover and Autohome <=10% from reports; observe bounded automatic continuation; close live availability/browser checks; record final actual counts. VPN-specific failure remains unidentified. Code deployment, a successful checkpoint round trip and scheduled jobs do not prove full advertisement readiness or sufficient low-power supply.
