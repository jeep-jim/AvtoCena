# Encyclopedia V2 — release readiness checkpoint

Status: **not approved for production publication**. This is a validated staging checkpoint; no live catalog, calculator, site or deployment has been changed.

## Exact staged totals

| Entity | Count |
|---|---:|
| Sources | 928 |
| Brands | 255 |
| Models | 1,619 |
| Generations | 1,293 |
| Facelifts | 105 |
| Variants / modifications | 19,240 |
| Media records | 449 |

Target window: Japan 2015–2026; other active markets 2020–2026. Older facts are retained only where required to identify a vehicle overlapping the target window.

## Data quality checkpoint

- JSON/semantic validation errors: 0.
- Safe alias collisions: 0.
- Recorded source conflicts: 0.
- Source records: 928 across 131 domains.
- English/Latin canonical public identities remain separate from 851 localized/source aliases.
- The staging search index contains 105,620 entries.

## Publication blockers

- Brand logo pairs technically ready: 195/255; missing: 60.
- Logo pairs with publication/rights approval: 0; therefore publication-ready brands: 0.
- Models with an approved canonical cover: 59/1619; missing: 1560.
- Review-only entities still requiring approval: 1560 models and 18941 variants.
- Exact documented 30-minute power records: 0; missing values are intentionally not calculated.

## Production rule

Only approved entities may be compiled into the live resolver. Review-only aliases can be evaluated in shadow mode, but they must not silently rename a listing or supply calculator inputs. Price calculation may inherit a specification only after an exact make + model + generation/variant match and field-level evidence pass.

See `proposed-production-migration.md` for the non-executed rollout plan. Design and live deployment remain separate work.
