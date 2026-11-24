# China source producer — replacement path

This directory is independent of the old publisher. It does not call provider APIs, write remote objects, change schedules, import the old catalog storage module or call a pricing engine. Its output is **private source data**, not a visitor-serving SQLite index.

## Exports

- `openSavedChe168Snapshot` in `saved-che168-snapshot.mjs`: strict raw GET adapter for the existing saved gzip CSV parts. It returns `{source, rows, assertComplete}`. CSV parsing includes every year and every record; no admission filter is applied.
- `prepareChinaSource` in `che168-source.mjs`: local SQLite materialization, full saved delta replay, normalization and reconciliation. Returns `{source, reconciliation, paths, offers()}`. `offers()` is an async iterable and verifies its complete output file when exhausted.
- `normalizeChe168Row`, `chinaOfferId`, `CHINA_SOURCE_ID` in `normalize-che168.mjs`: pure v2 source mapping. No encyclopedia or calculation lookup. Existing pure semantic vocabulary helpers remain unchanged.

## Saved snapshot input

```js
const saved = await openSavedChe168Snapshot({
  readObject, // async (exactKey, {maxBytes}) => Buffer; saved objects only, no JSON/seed fallback
  manifestKey: 'catalog/provider-snapshots/che168/<binding>/manifest.json',
  manifestSha256, // SHA256 of actual returned manifest bytes, not an ETag
  expectedTerminalCursor, // captured intended end of the saved changes chain
  schema: 'auto-api-che168-v2',
});
```

The saved manifest is `{version:1,binding,config,complete:true,parts:[{index,bytes,sha256}]}`. `config` has `version`, `host`, `date`, `filename:'active_offer.csv'`, `delimiter:'|'`, `initialCursor`, `bytes`, `etag`, `modifiedAt`. Binding is SHA256 of `JSON.stringify(config)`. Each `00000.csv.gz` part is verified against its decoded byte count and digest. Full exhaustion is required before `assertComplete()` succeeds. The source descriptor is `{provider:'auto_api_che168',schema,snapshotBinding,snapshotManifestSha256,initialCursor,expectedTerminalCursor,observedAt}`.

The v2 CSV decoder requires `inner_id,url,mark,model,year,price,images,extra` columns. It preserves the raw fields privately, decodes quoted pipes/newlines and emits `{row:{inner_id,data},origin:{key,sha256,line}}`. This schema is explicit. A v3 snapshot cannot use the v2 mapper; unsupported versions fail before materialization. API v3 support requires a separately verified mapping of its actual fields and units.

## Materialization input

```js
const prepared = await prepareChinaSource({
  source: saved.source,
  snapshotRows: saved.rows,
  assertSnapshotComplete: saved.assertComplete,
  changePages, // AsyncIterable<SavedPage>, all pages in the captured chain
  resolveSavedDetail, // async ({runId,cursor,changeId,innerId}) => {row,origin} | null
  outputDir, // absolute NEW directory; the producer refuses an existing directory
});
```

`SavedPage` is `{runId?,cursor,receivedAt,payload:{meta:{cur_change_id,next_change_id},result:Change[]},origin:{key,sha256}}`. `Change` has numeric `id`, `inner_id`, `change_type:'added'|'changed'|'removed'`, `data`, and optional `created_at`. The port must read and bind actual saved object bytes; it must not synthesize metadata from an older read or call a provider for missing details. `origin.sha256` is the actual saved object digest. Receipt time records observation when an explicit event time is unavailable.

Nonempty pages advance the exact cursor. A final empty page at `expectedTerminalCursor` is mandatory. A later saved run may start at the prior empty cursor; an extra page after the terminal page of the same run is rejected. Duplicate event IDs must have identical contents. Price-only changes require an existing full active row; otherwise a saved full detail is required. Missing details remain unresolved until a later full detail or explicit removal resolves them. A 404/missing record never means sold.

## Output and gates

Every emitted item is `{offer,source:{provider,sourceId,schema,snapshotBinding,initialCursor,terminalCursor,observedAt,rawSha256,origin}}`.

Stable IDs are `SHA256('autohome_used_china_open:' + inner_id).slice(0,24)`. Source prices remain CNY. Missing make/model/year/price/power are represented as unknown and counted; no minimum year, power limit, vehicle quota or pricing admission is hidden in this stage. Conflicting PS/kW remain unresolved. Peak electric power does not become certified 30-minute power. Bound named technical tables are retained for the next, frozen enrichment stage; rounded litres are not converted to exact cc.

The private output directory contains `source.sqlite`, `offers.ndjson`, `dispositions.ndjson`, `reconciliation.json` and `source-manifest.json`. Files use mode `0600`, directory `0700`. SQLite retains raw payloads, event identities and tombstones. These files must not enter public workflow artifacts or visitor responses. The manifest records hashes/bytes of all four data files and `classification:'private_source'`.

Reconciliation verifies:

- snapshot rows = unique snapshot IDs + identical duplicates;
- change records = unique events + identical repeated events;
- final unique IDs = active + removed + unresolved;
- active = normalized + invalid identity/URL rows.

`sourceComplete` and `exactCursorClosure` require complete snapshot verification, exact captured terminal cursor and zero unresolved details. Invalid normalized rows remain individually recorded; `normalizationComplete` is false when any exist. `publicationReady` is always false. Failures leave `incomplete.json` and no source manifest; partial files must not be activated.

The caller separately pins producer code, configured source and captured root identities before/after the build. It owns market rules, explicit treatment of invalid rows, frozen encyclopedia/calculation context, prepared prices/index, remote durability, market-only activation, browser checks and rollback. Reading a supplied stream does not prove it is the supplier's latest state. The source producer cannot authorize any of those actions.

## Local verification

`node --test tests/catalog-next-source.test.mjs` on the existing Node runtime with `node:sqlite` and TypeScript module support. Fixtures are explicitly synthetic; they do not establish live inventory size, supplier entitlement, serving correctness or public latency.
