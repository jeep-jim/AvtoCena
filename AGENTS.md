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
