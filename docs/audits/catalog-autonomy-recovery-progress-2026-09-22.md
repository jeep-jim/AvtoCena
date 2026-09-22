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
