# Proposed Encyclopedia V2 production migration

Status: proposed, not executed. The current branch remains staging-only and `productionConnected` remains `false`.

## 1. Compile an approved runtime snapshot

Create a separate compiler in the later integration PR. Its input is the immutable reviewed V2 checkpoint; its output is the existing `VehicleKnowledgeModel` / `VehicleKnowledgeVariant` JSON contract. The compiler must:

- export only brands, models, generations, facelifts, variants and media that pass their publication gates;
- preserve V2 IDs and reject an existing-ID collision unless an explicit reviewed merge rule exists;
- export only source-backed aliases marked `safe`;
- retain original source spellings for diagnostics without making review-only spellings auto-resolvable;
- copy exact technical values and evidence; never derive hp from kW or 30-minute power from peak power;
- emit deterministic chunks of no more than 250 records and a checksum manifest.

## 2. Map V2 to the current calculator input

| V2 entity/field | Runtime consumer | Gate |
|---|---|---|
| Brand + Model canonical identity | listing public make/model | one unambiguous safe resolver match |
| safe localized/source aliases | catalog resolver | source-backed, collision-free alias |
| Generation + Facelift | listing enrichment | exact model plus year/platform containment; no regional guess |
| Variant engine/fuel/power/transmission/drive | pricing input | one exact variant match and evidence for every copied field |
| `power30MinKw` | EV/PHEV utilization/tax input | exact eligible homologation/registry evidence only |
| model/generation media | encyclopedia/SEO card | exact identity, reusable license/attribution and approved status |

If a listing matches only a review entity, keep the original listing text, surface the candidate in diagnostics and do not feed its fields to the calculator.

## 3. Shadow resolver before visible renaming

Run the V2 resolver alongside the current production resolver without changing cards or prices. Store only aggregate diagnostics:

- exact resolved / unresolved / ambiguous counts per market;
- disagreements between current and V2 canonical make/model;
- exact variant match rate and missing calculation fields;
- aliases causing more than one candidate;
- price-input deltas with the customer-visible result disabled.

The shadow pass must cover all six markets and preserve the Japan baseline. Any collision or unexplained price-input delta blocks promotion.

## 4. Controlled rollout

1. Enable canonical English brand/model names for exact, approved identities only.
2. Enable read-only encyclopedia links and non-indexed model pages for approved entities.
3. Enable calculator enrichment only for exact approved variants, first as a small canary and then market by market.
4. Enable SEO indexing only after canonical URL, title, description, structured-data and duplicate-page audits pass.
5. Keep a single feature flag that restores the current resolver and knowledge snapshot without changing marketplace source data.

## 5. SEO projection

Generate eligible pages from approved entities only:

```text
/cars/brand/<brand>
/cars/brand/<brand>/model/<model>
/cars/brand/<brand>/model/<model>/<generation>
/cars/brand/<brand>/model/<model>/<generation>/<variant>
```

Brand pages require an approved identity and both logo themes. Model pages require an approved canonical cover and useful verified content. Generation and variant pages require enough unique verified specifications to avoid thin/duplicate pages. Review-only EEA observation containers are never public generations.

## 6. Required pre-deploy evidence

- zero schema/semantic validation errors;
- zero safe alias collisions and all source conflicts explicitly resolved or withheld;
- approved logo pair for every published brand;
- approved canonical cover for every published model;
- full regression tests for current listing names, especially localized China/Korea/Japan aliases;
- all-six-market shadow audit and calculator comparison;
- reviewed migration diff, rollback snapshot and explicit user authorization for production deployment.
