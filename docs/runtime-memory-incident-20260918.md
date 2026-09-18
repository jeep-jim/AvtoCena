# Runtime memory investigation, 18 September 2026

Status: diagnosis and a tested mitigation for detail-block retention. Not a confirmed production resolution. No production configuration or catalog objects were changed by this investigation.

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
