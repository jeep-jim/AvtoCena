# Runtime memory investigation, 18 September 2026

Status: runtime repairs are being deployed and verified. Detail-cache repair (#1021) and bounded recommendation pricing (#1022) are deployed; #1022 production workflow 35306894339 completed successfully. Gateway ARL protection is attached. Direct-container bypass closure remains blocked by automatic approval review; do not describe this as complete DDoS protection or a fully closed incident.

## Production evidence

- Container `avtocena-web` (`bbaohms2ccpm3vb4e73t`): 1 vCPU, 2 GB, concurrency 4. Deployment source: `.github/workflows/deploy-yandex.yml` at `b79fb9e76c7dd4449c1f4cc05e4894302fe72071`.
- Container log at **2026-09-18 06:32:05 UTC+3**: `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`, `signal: aborted`, followed by HTTP 502 for request `35f3cc09-0fe5-4b82-bcfd-09c491d9e7c2`. GC reported approximately 1043 MB of JS heap. This is not evidence that the full 2 GB container allocation was exhausted.
- The same log view contains other 502s and `504 Execution timeout exceeded`. No request path was established for the OOM request; the log alone does not identify the allocating function or prove DDoS.
- Container monitoring, selected 15 September 00:00 to 18 September 00:00 UTC+3: at **17 September 12:18:40**, p50 1.77 s, p95 21.68 s, p99 28.50 s. This is one graph point, not a daily aggregate.
- Object Storage bucket `avtocena-prod-catalog-71426`, observed `catalog/public/offers/` rows: `02.json` 9.42 MB, `03.json` 8.22 MB, `0d.json` 7.68 MB, `15.json` 9.6 MB. They were last modified at 18 September 04:44 in the console's timezone.
- `catalog/public/projection/all.json`: **167.95 MB**. Market projections: China 71.72 MB, Europe 57.54 MB, Korea 21.87 MB, Georgia 12.78 MB, Japan 3 MB, UAE 1.05 MB. These are the console's rounded stored sizes, not measured heap usage.
- Smart Web Security security-profile list in folder `b1g9vq73onqb7dp5hgqg` is empty. Domain-protection proxy list is also empty. This does not establish the absence of all provider-level network protection.

Sources:
- [Container logs](https://console.yandex.cloud/folders/b1g9vq73onqb7dp5hgqg/serverless-containers/containers/bbaohms2ccpm3vb4e73t/logs)
- [Container monitoring](https://console.yandex.cloud/folders/b1g9vq73onqb7dp5hgqg/serverless-containers/containers/bbaohms2ccpm3vb4e73t/monitoring)
- [Detail blocks](https://console.yandex.cloud/folders/b1g9vq73onqb7dp5hgqg/storage/buckets/avtocena-prod-catalog-71426?key=catalog%2Fpublic%2Foffers%2F)
- [Projection objects](https://console.yandex.cloud/folders/b1g9vq73onqb7dp5hgqg/storage/buckets/avtocena-prod-catalog-71426?key=catalog%2Fpublic%2Fprojection%2F)
- [Security profiles](https://console.yandex.cloud/folders/b1g9vq73onqb7dp5hgqg/smartwebsecurity/profiles)

## Reproduced retention defect

`readDetailShardObject` kept up to **64 complete parsed blocks**, bounded only by entry count. Expiry was checked only for the requested key; expired blocks for other keys remained strongly referenced. TTL started before storage I/O finished, permitting another read if a slow load exceeded TTL. Concurrent reads of different blocks had no shared limit.

The offline probe calls the actual `getOfferFromCurrentShard` reader with a mock storage backend. It reads 64 distinct hash buckets, each containing 250 synthetic records. Each JSON block is **9,013,175 bytes**. It performs no production requests or writes.

| Probe | Heap before | Heap after 64 blocks | RSS after |
| --- | ---: | ---: | ---: |
| Previous cache | 32.9 MiB | 574.7 MiB | 769.6 MiB |
| Bounded cache | 32.7 MiB | 49.9 MiB | 384.2 MiB |

Heap is sampled after explicit GC in both cases. After-load heap reduction is `(574.7 - 49.9) / 574.7 = 91.3%` in this synthetic probe. These numbers are not production latency or memory measurements. The probe demonstrates excess retention; it does not reproduce the exact production OOM or attribute every 502 to this cache.

Reproduce against each checkout:

```sh
node --expose-gc --max-old-space-size=1024 --import tsx scripts/catalog-detail-cache-memory-probe.mjs /path/to/checkout
```

## Prepared mitigation

- At most 8 completed detail blocks and 32 MiB of serialized JSON retained; the byte budget is deliberately below the heap allocation because decoded objects also have overhead.
- At most 4 underlying detail-block loads at once; duplicate pending keys share a promise.
- Expired unrelated entries are removed on cache access. TTL starts after load completion. Failed reads can retry. Clearing caches prevents older pending work from repopulating them.
- Oversized blocks remain readable but are not retained.
- Catalog records, prices, photographs, completeness gates, publication flows and cloud resource allocation are not changed.

Validation: six targeted tests passed (cache limits/recency, expiry, concurrent sharing/limit, failure retry, reset race, existing detail splitting and missing-ID recovery); TypeScript checks passed.

## Still required before declaring the incident resolved

1. Review the independent all-market, per-market, per-brand and immutable-generation projection caches. They can hold overlapping records; fix must preserve publication-cutover fallback, counts and pricing filters. This PR does not claim to fix them.
2. Profile the two catalog searches per offer's related-cars section and pricing of up to 96 candidates before final display selection. This code path is confirmed; its share of production latency is not measured.
3. Correlate request paths with OOM/502/504 events and add bounded operational timing/cache metrics, avoiding customer data in logs.
4. After deployment, compare memory, latency and errors on the deployed revision. A green unit test or an active container is insufficient evidence of recovery.
5. Configure and verify traffic protection separately. Inspect the public direct container URL before enabling protection only at the gateway, so requests cannot simply bypass it. Do not close that URL until gateway authorization/routing is ready.

## Repairs and verification during the follow-up

- #1021 merged at `54736f8c7cceedcd3b2f4e6d2b6548a4dd9465ce`; public `/api/health` confirmed that exact release. Homepage, `/cars`, and two observed offer links returned HTTP 200. Local end-to-end timings are not backend timings: a health probe spent 5.56 s in TLS negotiation, so these probes cannot substantiate a backend speedup percentage.
- #1022 merged at `fd022982a0764fdcb05eaf519cc1e61accee497a`. Full CI passed and deployment **35306894339 succeeded**, including production gates. Similar rails price four candidates at a time, stopping when filled, continuing after rejected candidates or when more model diversity is needed. Previously up to 96 candidates were priced for eight cards.
- The earlier deployment 35306209158 reached its product-feed check and logged repeated 30 s timeouts; it was superseded by #1022. Code inspection confirmed feed GET loaded the full 167.95 MB projection even for a valid existing binary. The follow-up makes feed GET read manifest + metadata + object existence only. Publication already writes the feed before activating a generation; a missing/mismatched feed returns 503 + Retry-After instead of rebuilding from a public request.
- Sitemap readers share one load per generation and cache only id/date/image URL fields (one entry, 32 MiB serialized cap, 5 minute TTL). Generation mismatch is not cached and can be retried.
- Market readers reuse rows from an already loaded all-market snapshot. Same-generation standalone market cache entries are released; unrelated expired entries are removed; expiry starts after a completed load. Existing cutover fallbacks and public pricing gates remain in place. Brand snapshots are capped at 8 entries / 32 MiB and two concurrent reads; immutable fallback projections at 96 MiB and one concurrent read.

### Active gateway protection

Created ARL `avtocena-catalog-rate-limit` / `fevinh4d30r652n9fl8g` and security profile `avtocena-production` / `fevq0sbmcheksqlk1b22` in folder `b1g9vq73onqb7dp5hgqg`.

ARL rule `catalog-get-per-ip`: priority 100, HTTP method GET, request path PIRE regex `^/(cars(/.*)?|)$`, grouped by actual client IP, 60 requests per 10 seconds, block only requests exceeding the limit, dry-run disabled. It covers the homepage and catalog pages; static assets, API paths, form submissions and Telegram webhook are outside this rule. All other traffic is allowed. ML training consent was unchecked. No claim is made that this one rate-limit rule stops distributed attacks.

Gateway `d5d4tne6a7djd0o5ip14` reached Active with this added root extension:

```yaml
x-yc-apigateway:
  smartWebSecurity:
    securityProfileId: fevq0sbmcheksqlk1b22
```

The existing HTTP integrations and logging remain active. Health via avtocena.com returned 200 after attachment. A deliberate rate-limit firing test has not been performed; avoid sending a burst through expensive production pages solely to force 429s.

### Remaining access-control step requiring explicit approval

Automatic approval review rejected switching both gateway routes to authenticated `serverless_containers` using the existing deploy service account, citing broad routing/access-control changes and an overprivileged account. That change was **not saved**. Subsequent cloud-browser calls timed out; the last verified active configuration remains public HTTP forwarding plus the SWS extension above.

Safer proposed operation for approval:

1. Create service account `avtocena-gateway-invoker`, with no keys and only `serverless-containers.containerInvoker` **on container `bbaohms2ccpm3vb4e73t`**, not the whole folder.
2. Preserve the domains, root route, proxy path parameter, logging and SWS extension. On both routes use `type: serverless_containers`, the same container ID and the dedicated account ID.
3. Before closing public access, verify homepage, catalog query parameters, offer page, health, authenticated CRM routing and webhook rejection of unauthenticated requests. Do not submit real leads or send Telegram messages as a probe.
4. Remove public invocation only after these checks. Verify direct container invocation is denied while the same site routes still work through the gateway.

This closes a currently open bypass around the gateway's protection. Do not claim it is already closed. For a routing rollback after closure, restore public invocation first, then the original HTTP integrations; avoid leaving the live gateway unable to invoke its backend.

## Confirmed read-model divergence

Post-deploy parity run 35307538476 at 04:36 UTC reports active manifest
`gen_1789644640780_c0bf7914` / 65,170 offers, while every current market
projection belongs to `gen_1789695301544_1e962b8d` / 65,304 offers (Korea
14,513 vs active 14,379). This predates #1023. It forces generation-checked
catalog readers into immutable fallback and causes the new strict feed/sitemap
readers to return 503. Do not remove generation checks to conceal this.

The repair trigger rebuilds derived read models from the active immutable
generation, including the prebuilt feed and overview, then runs parity audit.
The repair now acquires `catalog/import-lock.json`, the same object-storage
lease used by the active ProAuctions publisher. It refuses an existing active
lease; its 40-minute expiry exceeds the workflow's 30-minute hard timeout.
The lease is released on success/failure only if still owned by this repair.
Four behavioral lock tests and ten existing read-model policy tests passed.
Actual production repair outcome must be recorded after execution.

### Recovery result and remaining cold-read optimization

Repair workflow **35309657977 succeeded** at 05:13 UTC. All 65,170 raw rows
and all six market projections match active generation
`gen_1789644640780_c0bf7914`; mismatches are empty. All 30 sampled detail
records resolved. Feed was rebuilt with 31,683 eligible products, 2,749,864
compressed bytes. Deploy **35309657916 succeeded** and public health confirmed
`c0f79afd6b450b5ebd458ce7e84fe25521d1d53d`. Public sitemap shard 0 returned
200 with 5,000 URLs, but the cold request took 29.8 s locally (7.1 s TLS).

The recovered overview contains 65,167 *visible* rows because current policy
filters three of the raw records. The homepage compared visible counts to raw
manifest counts, rejecting this valid compact snapshot and loading the full
projection. The builder now records separately verified raw `sourceTotal`
counts. The homepage requires those counts to match the manifest, keeps the
visible total, checks enough sample cards, and rejects false zeroes. Legacy
snapshots still require exact counts.

Publication also prepares a separate sitemap projection containing only IDs,
dates and image URLs. Cold sitemap requests use that compact object after a
generation check; older generations retain the existing bounded fallback.
This avoids reading the 167.95 MB search projection for a sitemap request.
23 targeted tests passed, including real homepage reader assertions that no
large objects are read and a cold sitemap test with no full projection read.
