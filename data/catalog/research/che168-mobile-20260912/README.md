# Che168 domestic mobile evidence — 2026-09-12

Ordinary public browser navigation to `https://m.che168.com/china/list/` loaded domestic listings without an account. The only locale choice used was **Continue to Chinese Site**. No challenge was solved, no credentials or cookies were imported/exported, and no Global inventory was substituted.

Two observed listings and their named parameter panels were captured:

| infoid | Cash CNY | Registration (not manufacture) | Odometer | Exact cc | Source PS / kW | Photos | Named rows |
|---|---:|---|---:|---:|---|---:|---:|
| 58328510, Lavida 2023 1.5L | 76,800 | 2023-05 | 29,000 km | 1,498 | 110 / 81 | 16 | 172 |
| 59859616, BMW X5 2023 30Li | 428,000 | 2024-07 | 24,000 km | 1,998 | 258 / 190 | 23 | 176 |

The BMW source says petrol + 48V mild hybrid. Its published ICE power is not evidence for all utilization inputs. Neither capture establishes manufacturing date through a named production-date field. Both parser results remain `needs_data`, `totalRub=null`; no production calculations/publication were performed.

The Lavida search displayed 919 results. This is the site's count, not collected eligible inventory. `pagination.json` preserves before/after snapshots of an unfiltered list where an ordinary scroll loaded additional cards. It does not establish complete or deduplicated coverage.

The `.json` files contain actual DOM captures, with tracking parameters removed from the identity URL. The `.dom.html.gz` files preserve the full rendered DOM, including recommendations; the parser only consumes the bound table and gallery. No photo binaries are stored. Initial single-string DOM reads were truncated by the browser transport; the committed files were recaptured in 50,000-character chunks, then checked against the DOM length.

Uncompressed UTF-8 DOM evidence:
- 58328510: 1,081,609 bytes, SHA256 `de84b5367f78a9bcdafc3e295b59588e5f06e6b9519805e033916383f6157334`.
- 59859616: 1,176,541 bytes, SHA256 `76c7b726c06dda34d4a2d8233cd19f26d34d39558645b4d111848dda068db0f8`.

## Transport qualification still required

The current cloud browser can render these mobile pages. An ordinary HTTP GET from the shell instead returned a security-verification document. Browser access is therefore not proof that GitHub Actions or production HTTP collection works.

`che168-mobile-canary.yml` performs one bounded, read-only qualification from a normal GitHub runner, preserving DOM/table artifacts. It has no production secrets, publish step, schedule, imported credentials, stealth settings or alternative network route. It stops on errors or access challenges. Three captures are a transport test, never catalog acceptance or a reduction of production collection limits. Do not turn this probe into a full crawl before its artifacts demonstrate usable bound listings.

The first canary run 34674242537 failed before opening a page: the downloaded Chromium headless shell could not start its sandbox on Ubuntu 24. Artifact 10291493885 contains the launch error, not a Che168 access response. The corrected probe selects preinstalled Chrome, whose Ubuntu sandbox profile is supplied normally; it does not disable AppArmor or Chromium sandboxing. See Chromium's [sandbox explanation](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md).

The existing domestic HTTP registry/publisher and all quality gates remain unchanged.

## Other requested sources

Dongchedi's own homepage menu exposes a longer `/usedcar/x-...` route. Ordinary navigation to that observed link also redirected to `login-required`; the bare entry URL was not the only cause. No account exists and no login was attempted.

Guazi's domestic list/detail can be read through search extraction, but direct browsing of its Chinese buy URL redirected to `en.guazi.com`. Search-extracted domestic finance prices must not become cash prices or a claim of working production collection.

No current same-car domestic/Global Che168 price pair was verified. The owner's conditional permission to consider Global is not satisfied.
