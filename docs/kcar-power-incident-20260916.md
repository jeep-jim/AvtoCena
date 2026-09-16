# K Car power incident — 2026-09-16

Live first-page Genesis inspection confirms persisted 34, 100, 104, 111, 134 and 150 hp values with `kcar_exact_detail_rvo_hrspow[_hp]` provenance. This is not a complete market audit. Evidence: `data/catalog/research/kcar-power-incident-20260916.json`.

`EC61398692` (G80 2.5T, stored 34 hp) now returns a successful K Car response with `이미 판매완료된 차량입니다.` (already sold), without `rvo`. Our detail still displays an active, calculated offer. Therefore current source horsepower cannot be rechecked for this record; do not claim a fresh API response contains 34 hp. A separate freshness repair is necessary.

Additional live same-ID checks confirm active `EC61407710` (G80 2.5 AWD, 2497 cc) returns `hrspow: 100` and `CAR_STATUS010` directly from the K Car API. Therefore at least this wrong published value is faithful extraction of an unreliable source field, not a UI-only issue. `EC61401182` (stored 134 hp) also reports already sold. Active G90 `EC61408822` returns 380 hp; this spot check does not independently verify specifications for the remaining inventory.

## Containment

- Quarantine the `hrspow` provenance and legacy saved-source K Car power for public hp and delivered prices, including compact V3 attested projections.
- Retain incoming raw power as ambiguous, not exact; inventory-mode collection can retain other vehicle data. Strict exact-power intake fails closed until independent verification exists.
- Clear derived kW, ICE kW and utilization kW during normalization, preventing rejected horsepower from surviving through dependent fields.
- Stop saved-source recovery from turning old hrspow attestations into newly trusted power.
- Replace the detail tile's fabricated default 100 hp with an unknown label.
- Independently verified official power remains outside this source-specific quarantine.

This is containment, not corrected specifications. Existing unsafe calculated K Car cards will be omitted by the current public card gate. No guessed hp values or mass data overwrites are part of this patch. Historical records remain available for audit. The stored active/sold state is not repaired by this code change.

## Verification

61 focused tests pass, including actual incident values, compact stored prices, hp/kW removal, raw evidence retention, legacy recovery, other power sources and source freshness behavior. Web TypeScript check passes.

## Remaining work

1. Audit all persisted K Car rows and bind year/engine/trim to independent technical evidence before restoring horsepower or delivered prices.
2. Recheck listing availability and retire confirmed sold records through the catalog publication workflow; do not treat transient fetch failures as sold.
3. Audit other markets by source, including prices, displacement, fuel, dates and images. The Genesis sample is not evidence that other markets are correct.
4. Encar unknown horsepower remains unknown unless a specific configuration is independently verified; do not fill a brand-wide default.
5. Recompute customs-dependent prices only after specification validation and verify the live list/detail output after deployment.
