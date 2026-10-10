# User-facing interface copy

- Write public-site and CRM interface text for the person using the product. This applies to headings, helper text, empty states, tooltips, notifications and errors.
- Do not expose implementation commentary: raw data, read models, normalization, fallback paths, storage formats, hidden reference records, placeholders or deployment details. Explain the user's next action or the practical meaning instead.
- Keep necessary integration settings and protocol identifiers accurate (for example, a credential or an API field in integration documentation). Do not remove required attribution, legal notices or meaningful uncertainty about vehicle data.
- Use clear Russian labels for ordinary controls. Preserve stored values and calculation behavior when changing labels.
- Use sentence case for interface headings, labels and buttons: capitalize the first letter, without all-caps styling or decorative wide letter spacing. Preserve proper names, acronyms, currency codes and user-entered text.
- When editing a page, check adjacent visible copy as well. Do not claim that every page is free of technical wording without actually checking it.

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
