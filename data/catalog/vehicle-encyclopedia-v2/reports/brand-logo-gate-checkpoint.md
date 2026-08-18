# Brand denominator and logo gate checkpoint — 2026-08-17

This checkpoint implements the required first stage of the Encyclopedia without changing the live site, collectors, production knowledge or pricing/calculation code.

## What changed

- The original 185-name production list is now explicitly a baseline, not a global-completion claim.
- Nineteen additional active, source-backed brands discovered in current official manufacturer/group portfolios are staged in V2. The current staged denominator is therefore 204 brands.
- The denominator policy now also requires reconciliation against every parser's observed raw make strings and current official portfolios before completion can be claimed.
- A brand cannot be publication-ready until canonical identity/aliases, both logo themes, file integrity, source trace and rights review all pass.
- Generated text wordmarks and fallback logos are forbidden as completion evidence.

The nineteen official portfolio additions are AION, Alpine, ARCFOX, Dongfeng Aeolus, Dongfeng eπ, Dongfeng Nammi, FANGCHENGBAO, Farizon, firefly, Geely Galaxy, HEDMOS, HYPTEC, LEVC, LUXEED, ONVO, RADAR, SHANGJIE, STELATO and YANGWANG.

## Exact logo audit

The supplied `brand_1.zip` contains 284 PNG files and is byte-for-byte identical to the existing repository `drom-source` archive. Its dimensions were:

- 252 files at 90 × 60 px;
- 14 files at 90 × 61 px;
- 16 files at 91 × 61 px;
- 2 files at 91 × 60 px.

The existing site-ready theme library contained 195 dark and 195 light PNGs, all at 180 × 90 px.

V2 now contains an isolated normalized staging library of 390 PNG files: 195 complete dark/light pairs, every file exactly 90 × 60 px in RGBA mode. Visible marks keep their aspect ratio and are centered on a transparent canvas.

- 185 pairs have complete source-manifest trace and no fallback; these are linked to 370 `brand_logo` media records.
- 10 normalized pairs existed without a V2 brand owner before the official expansion. Alpine is now a staged brand, but its pair still lacks original source trace, leaving 9 unowned normalized pairs.
- 19 staged brands currently lack a source-traced technical logo pair.
- No logo is marked publication-approved yet because trademark/source rights review has not been cleared. Therefore publication-ready brands remain 0 by design.

## Denominator evidence still in review

The raw 284-file logo archive represents 198 unique logo identities. After normalization of known filename differences, 184 map to current V2 brands and 14 remain logo-only identity candidates.

The existing read-only import diagnostics contain 143 raw-make observations across 39 unique strings:

- 22 resolve to one V2 canonical brand or safe alias;
- 13 require identity/alias research;
- 4 are probable parser noise and remain reported rather than silently converted;
- 0 are silently rebound to another brand.

Combining the raw and normalized logo libraries leaves 23 unique logo-derived identity candidates still requiring official identity research. These candidates do not become canonical brands based on filenames alone.

## Current verified totals

- sources: 256;
- staged brands: 204;
- canonical models: 59;
- generations: 61;
- facelifts: 12;
- variants: 299;
- media: 429, including 370 staged brand-logo records;
- exact normalized logo files: 390;
- technical logo pairs linked to brands: 185;
- staged brands missing a source-traced technical pair: 19;
- publication-approved logo pairs: 0;
- publication-ready brands: 0.

`reports/brand-logo-assets.json`, `reports/brand-publication-readiness.json` and `reports/brand-denominator-candidates.json` are the machine-readable sources of these counts.

## Next fixed order

1. Reconcile the 13 unresolved parser make strings and 23 logo-derived candidates against official identities.
2. Continue current official portfolio audits, especially fast-changing Chinese portfolios, until no official active passenger/light-commercial brand remains outside the denominator.
3. Obtain and normalize authentic source-traced 90 × 60 dark/light logo pairs for the 19 known missing brands.
4. Complete alias/country review and logo rights approval brand by brand.
5. Only then return to broad model/generation/variant expansion; site integration remains a separate reviewed task.
