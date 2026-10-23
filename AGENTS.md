# User-facing interface copy

- Owner instruction 23.10.2026: fill the existing permanent encyclopedia foundation. Do not restart model discovery or rebuild/reparse the model list. Prioritize activation of saved reviewed batches, verified use in catalog calculations, then missing-field completion across the existing makes. Preserve records, revisions, manual edits and exact technical identities. The accepted iterative plan is docs/encyclopedia/2026-10-23-night-morning-recap-and-plan.md; unknown certified power must remain unknown.

- Write public-site and CRM interface text for the person using the product. This applies to headings, helper text, empty states, tooltips, notifications and errors.
- Do not expose implementation commentary: raw data, read models, normalization, fallback paths, storage formats, hidden reference records, placeholders or deployment details. Explain the user's next action or the practical meaning instead.
- Keep necessary integration settings and protocol identifiers accurate (for example, a credential or an API field in integration documentation). Do not remove required attribution, legal notices or meaningful uncertainty about vehicle data.
- Use clear Russian labels for ordinary controls. Preserve stored values and calculation behavior when changing labels.
- Use sentence case for interface headings, labels and buttons: capitalize the first letter, without all-caps styling or decorative wide letter spacing. Preserve proper names, acronyms, currency codes and user-entered text.
- When editing a page, check adjacent visible copy as well. Do not claim that every page is free of technical wording without actually checking it.

# Owner interface correction — 19.10.2026

- Before changing an existing interface, read the relevant roadmap entries and inspect the working reference. Preserve established wording, order and control locations unless the owner requests a change. Europe is the catalog layout reference.
- Original listing links belong in the existing offer information/specification disclosures. Do not duplicate them under the vehicle title.

# Daily work log

- Before starting work, read the latest entries in `roadmap.md` and the relevant section for the current task. Keep this rule across sessions.

- After each completed work session, append a dated Russian entry to `roadmap.md`, preserving earlier entries. Use the user's local calendar date when known. Record actual changes, verification, publication status and unresolved items; never claim unverified completion. Do this as part of the work, without a separate reminder.

# Editable vehicle specifications

- Owner policy updated 06.10.2026: missing editable specifications (including horsepower, certified power, engine volume, fuel, drive, transmission and body) alone must not reject an otherwise valid listing. Keep missing fields honest and let the existing card parameter controls complete calculation. Never fabricate specifications or display an incomplete calculation as a confirmed delivered total.
- Owner policy superseded 06.10.2026 14:12 Asia/Krasnoyarsk: no admission caps by price, horsepower, source share or model-year count. Non-Japan inventory is at most six calendar years old using actual source day/month/year precision; Japan is 2010+. Recheck age at display time. Exclude trucks/buses with permitted gross mass above 3500 kg, not curb mass. Do not fabricate missing dates or mass.
- Default display order across markets: known price up to 15,000,000 RUB first, preferably verified <=160 hp; missing prices separately, >15,000,000 RUB last from cheaper to most expensive. Ranking never removes inventory. Preserve truthful pricing, allowed provenance, identity, deduplication, withdrawal/freshness and storage safeguards.
- Append every completed task and operational launch to roadmap.md during the session, not only at the end of the day. Preserve history and record unfinished runs explicitly.

- Owner exception 07.10.2026: Europe has a hard published inventory ceiling of 50,000 cars. Maintain freshness, prices and confirmed withdrawals; do not pursue Europe inventory growth beyond this cap. Other markets keep the no-count-cap policy. Source failures are not evidence of sale; retain publication safety guards.

- Owner instruction 09.10.2026: publish suitable Che168 inventory; exclude missing-model/invalid-year rows individually instead of blocking the entire feed by their count/share. Preserve identity, archive integrity, complete change-stream and nonempty-inventory guards, age policy, Russian display, pricing evidence and truck/bus permitted gross mass limit above3500kg.

# Owner collection and repository policy — 10.10.2026

- Keep jeep-jim/AvtoCena public. Do not change repository visibility, add a second repository or introduce paid GitHub execution without a new explicit owner instruction.
- China uses the paid Che168 feed. Chinese HTML parsers are disabled by default and are extreme manual reserves only. Never enable them automatically in response to feed, storage or publisher failure. Only explicit owner action (including the owner-only CRM switch) may enable them.
- Collection controls in catalog/operations/collection-controls-v1.json govern market/source collection, not catalog visibility or provenance allowlists. Preserve existing publication, retention, identity, pricing and cursor safeguards. A network failure is not evidence of sale.
- Any new collector, recovery or source detail path must honor owner market/source switches. The feed and legacy Che168 parser have separate control IDs despite sharing an inventory sourceId. Never publish commercial feed files or control records into the public repository.

- Deployment trigger: changes only to GitHub workflows or documentation do not rebuild/restart the website. If changing only deploy-yandex.yml and needing its runtime/resource settings applied immediately, explicitly run that workflow (workflow_dispatch). App/runtime changes still trigger the usual deployment; do not touch app files just to force a deploy.

# Owner background-cost policy — 10.10.2026

- Automatic recovery/watchdog, exploratory full audits, performance probes and knowledge accumulation are manual-only until the owner explicitly re-enables them. Do not restore their schedule, workflow_run or push triggers as a side effect of another fix.
- Keep scheduled required market collectors and the paid China feed. China HTML reserves remain owner-controlled and off by default. No automatic retry loop may restart collection after failure.
- Preserve functional cache/index preparation on source/release changes and daily date rollover, essential CRM delivery/rates, and bounded retention cleanup. Do not move expensive preparation back into visitor requests by disabling those dependencies. Hourly cache-readiness polling is disabled.
- Never enable paid Smart Web Security without explicit owner approval. Existing application authentication, publication guards and request validation remain required.

# Owner-authorized GPT completion comments — 12.10.2026
- When implementing an identified CRM idea at the owner's request, include `ideaReports: [{number, text}]` in that release's `.github/market-runs/regcloud-deploy.json`. Keep the Russian comment brief: what was wrong, what changed, any remaining limitation. No credentials or customer data in this public marker.
- The production deployment publishes these comments only after its successful activation checks, using the display-only GPT service profile. It does not grant login credentials or CRM permissions. Do not impersonate an employee.
- Report only verified scope; never mark the whole idea complete when part remains unimplemented. Do not automatically start work on other ideas. Do not reuse a prior release's reports in a new marker.

# Owner Japan age update — 17.10.2026
- The owner explicitly lowered all active Japanese inventory and filter/calculator year bounds to 2008 inclusive. This supersedes earlier 2010+ rules. Non-Japan six-year age policy is unchanged. Purchased AJ System China/Korea are separate sources; do not disable the existing China supplier before acceptance of its replacement.

# Owner AJES local-limit update — 17.10.2026
- The owner explicitly removed the application daily request ceiling (19000/19020). Retain separate usage telemetry for main/stats/china/korea without resetting history. This does not override supplier quotas/refusals, IP provenance, cache/concurrency bounds, collection switches or the prohibition on bulk copying. Do not report the local usage counter as a supplier-enforced quota.

# Owner AJ System China price ceiling — 18.10.2026
- The second China feed (`ajes_china_feed`) must not display offers above 15,000,000 RUB. This supersedes its earlier ranking-only policy. Apply the ceiling to seller price and calculated delivered previews; do not change Che168 collection or erase stored inventory. Unknown final delivered totals must remain explicitly incomplete.

# Owner single-China update — 18.10.2026
- China now uses only AJ System, including old source=existing catalog links. Disable paid Che168 collection through its saved owner switch; preserve records and credentials for the upcoming UAE supplier migration. Do not enable HTML reserves. Remove supplier tabs from public catalogs. Existing directives to retain the old China source for comparison are superseded.
- UAE settings have not arrived. Do not repurpose the China endpoint or claim UAE is connected. Missing Korea specifications still require source evidence; never guess power.

# Owner Dubicars update — 18.10.2026
- UAE Dubicars is now authorized through the purchased auto-api.com API. Publish its entire inventory without age, price, power, body or count filters. Keep identity, honest specifications, withdrawal, completed-sync and secret-storage safeguards. The new key belongs only in AUTO_API_DUBICARS_KEY, never in public source or logs.

# Owner corrections — 19.10.2026, 12:20 Asia/Krasnoyarsk
- Exclude trucks from all markets, including light/mixed-weight truck families Elf, Canter and Dutro even when gross mass is absent or <=3500 kg. This supersedes their previous exception and the Dubicars truck allowance. Do not classify pickups or passenger/light vans as trucks solely from N1 or a generic van label.
- China domestic delivery starts in Ussuriysk: Ussuriysk to Ussuriysk is 0 RUB. Use the same origin for route distance, display and calculation. Preserve separately configured international logistics and commercial city anchors.
- Seller prices use the official CBR quote divided by its nominal. Do not use a cached effective rate with a spread; exchange reserves remain separate expenses. Verify source/feed differences by exact listing identity and timestamps, never guess a replacement price.

# Owner China supplier return — 19.10.2026
- Owner has renewed auto-api.com Che168, disabled AJ System China and enabled che168_feed in CRM. China catalog routing, overview and counts must respect this current choice, including bookmarked source URLs. This supersedes the 18.10 single-AJES-China instruction. Preserve the calculation engine, private credentials, collection/publication guards and disabled HTML reserves.

# Owner Dubicars displacement update — 19.10.2026
- Supplier confirmed displacement is in litres; owner explicitly requests using it for UAE automatic calculations. Convert supplied litres to engineCc (×1000), retain the raw value and unit provenance, and restore missing volumes from saved paid-feed labels. Preserve existing exact/manual values, calculation rules, other markets and missing-power safeguards. Legacy documented integer cc remains supported. This supersedes treating paid-feed litre values as unusable for calculation.

# Owner daily continuity — 19.10.2026
- Every work session must append results under the actual Asia/Krasnoyarsk calendar date in roadmap.md. Start a new dated entry when the date changes; preserve all prior history, commits/releases, verification evidence and unfinished items. This is a task log and knowledge recovery record, not a claim of a database backup.


# Owner sole paid-feed policy — 20.10.2026
- Korea uses only the purchased Encar feed sold by Mikhail (internal sourceId ajes_korea_feed). Japan uses his paid feed; China and UAE use AutoAPI. Do not supplement Korean search, recommendations or counts with historical Encar/KCar parser inventory, including source=existing bookmarks. Keep archives without presenting them as current paid-feed cars. European, Georgian and Green Corner collectors remain in their existing state.
- Fix missing Korean calculation specifications within the purchased feed contract. Do not infer horsepower from engine displacement, model name or another listing; preserve supplier restrictions and exact identity.

# Owner data storage policy — 20.10.2026
- Use the configured REG object storage (owner-stated capacity 1000 GB) for durable application data, uploaded media and archives. Keep the server disk for runtime, bounded caches/logs and limited deployment rollback copies. Do not introduce local bulk feed/archive copies. Preserve storage credentials, existing object keys and publication guards; running Docker layers require local disk and must be bounded through safe retention.

# Owner UAE manual specifications — 20.10.2026
- UAE seller/feed horsepower and displacement are untrusted and must not populate catalog specifications or automatic customs calculations. This supersedes the 19.10 supplier-displacement instruction. Apply to new intake and already retained UAE records/projections; do not restore values from titles, source tables or stored feed labels.
- Show seller price until parameters are manually supplied. Preserve separate employee-saved calculations and existing manual input/save flow. Other markets and source inventory controls remain unchanged.

# Owner next model year — 20.10.2026
- The manual parameter form must calculate a new car selected as next model year (2027 during 2026). Keep the selected year; use an explicit new-vehicle scenario without fabricating a manufacturing date or shifting the import/tariff year. Explicit future production dates and years beyond next year remain invalid. Feed rows do not automatically gain this manual scenario.

# Owner catalog discovery/layout — 20.10.2026
- Desktop catalog filters belong on the left, without a filled outer panel, separated from results by a vertical rule. Preserve the mobile sheet and compact sort button. This supersedes the earlier right-sidebar placement.
- Opening model selection must expose the complete available directory, with incremental rendering allowed but no silent fifty-model cap. Base-model discovery includes its variants even when an exact base record exists; exact technical identity for calculations remains separate.
- The existing autocatalog is the intended future editable knowledge core. Do not automatically promote feed observations to verified specifications or fill missing 30-minute power without evidence. The owner requested search/layout first and encyclopedia population in a subsequent stage.

# Owner China age and market order — 21.10.2026
- China inventory starts at 2014 inclusive, superseding its six-year rule. Apply to feed intake, retained publication and filters; preserve date validity and other admission safeguards.
- Public market order: China, all Japan (auctions and Green Corner), Korea, UAE, Europe, Georgia.

# Owner permanent encyclopedia — 21.10.2026
- /cars/autocatalog is now the permanent editable encyclopedia, independent of live inventory. Keep one canonical model with distinct annual/technical variants. Never automatically replace its initial snapshot or overwrite administrator edits during feed refreshes.
- Only active TopAvto owner/admin roles may edit; visitors, other dealers and managers have read access. Preserve revision conflicts, history and source/status fields.
- Import only already saved catalog/cached observations and existing references; do not turn the encyclopedia into unrestricted bulk copying of partner feeds. Keep observed specs separate from verified facts. Unknown 30-minute power stays empty and never derives from peak/system power. Calculation fallback integration requires a later explicit acceptance of exact verified matching.

# Owner encyclopedia presentation — 21.10.2026
- Encyclopedia discovery is country-independent: no market filters or country-bound make/model identity. Keep provenance internally and exact technical differences, without exposing markets as encyclopedia navigation.
- Use existing catalog theme tokens and standard page styling. Compact text-first list/grid controls are icons to the left of the alphabet; add-model action belongs below reset in the left sidebar. No introductory explanations or download actions.
- Brand, model and year accordions open independently and remain open when other rows are used. Respect the public template's data-ac-preserve-open convention. Within a selected make show all matching models, a model alphabet and a back-to-makes action.

- Owner clarification21.10.2026: reuse the actual catalog SVG chevrons, view icons and breadcrumb component in the encyclopedia. No text-glyph arrows. View icons and alphabet stay on one row (alphabet scrolls horizontally on narrow screens); active controls use the catalog bright red#ff353d, not the light theme burgundy --ac-accent. Inactive alphabet buttons are white in the light theme.


# Owner full-width encyclopedia redesign — 21.10.2026
- Latest instruction supersedes encyclopedia sidebar placement and horizontal alphabet scrolling: filters belong across the top, add-model action on the left, directory content uses the full width. No horizontal scrolling in the alphabet, tables or editor; wrap controls/values and stack cells on narrow screens.
- Eliminate accumulating nesting indentation. Brand/model disclosures remain independent on the same left/right boundaries. Select years in a wrapping row within the model workspace. Use compact primary columns and full-width expandable details/inline editing, retaining every technical field, provenance/status and revision protection.
- Reuse existing catalog breadcrumbs, SVG arrows, view icons and theme colors. Keep the view icons immediately left of the wrapping alphabet, active bright red and inactive white in light theme. No invented backgrounds, introductory explanations, exports or country navigation.

# Owner ASTRA bulk encyclopedia authorization — 23.10.2026

- The owner explicitly authorizes importing all useful open ASTRA vehicle data, including 3000-eDatenblatt and 4000-Typengenehmigungen_TAS, and its exact technical catalog. This supersedes the no-discovery restriction for this open source only. Preserve existing canonical records, manual edits, revisions and evidence history. Keep international makes/models/type codes unchanged; translate ordinary parameter labels to Russian. Retain exact approval/type/variant/version identities and unresolved conflicts; never derive certified 30-minute power from peak power or mistake manufacture dates for model years. Durable source corpora belong in REG object storage, not the production disk or public git. Partner feed restrictions remain unchanged.
