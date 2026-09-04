# mobile.de Europe — access-policy qualification v1

Date: 2026-09-04

## Decision

- source: `mobile_de_open`
- registry route: `https://www.mobile.de/`
- market: Europe
- class: `lead_only`
- `publishAllowed=false`
- public-page automated ingestion/republication: **blocked**
- current AvtoCena scope: manual public reference/link-out only

No mobile.de inventory crawler/list/detail/API probe was started after the permission check below.

## Official terms checked

Official terms index: `https://www.mobile.de/en/service/agbIndex/`

Current Professional Domain GTC: `https://www.mobile.de/en/service/agbProfessional`

The current professional terms shown by mobile.de are valid from `01.04.2026`. Article 11 states that users may search only through the search screens provided by mobile.de; bypassing those search screens using unauthorized search tools is not permitted. It further prohibits extracting/reusing/integrating mobile.de contents and expressly prohibits data mining, robots, grabbing, scraping and similar data collection/extraction technologies.

The public-domain GTC published by mobile.de contains the same core restriction in its scraping/system-integrity section: search is to be performed through the provided search masks, while extracting/reusing content and data-mining/robots/grabbing/scraping are prohibited.

## Official permitted route exists, but requires an agreement

mobile.de also publishes official `Search-API` terms:

`https://www.mobile.de/service/pdfs/agb_search_api_2016_en.pdf`

Those terms describe access to mobile.de listing data through a Search-API by an `API PARTNER`. Use is limited to an API Partner Agreement and to the Partner Application/scope defined by that agreement. The same document does not grant a general public right to copy or commercially republish the data outside that agreed scope.

This is useful for AvtoCena because it identifies the correct future route: **partner/API access**, not scraping the public marketplace.

## Qualification meaning for AvtoCena

The registry currently records a technically promising baseline for mobile.de, but technical field completeness is irrelevant for production publication while public automated extraction/reuse is prohibited.

Therefore:

- `mobile_de_open -> lead_only`
- `publishAllowed=false`
- do not run public list/detail scraping qualification
- do not build or refresh an AvtoCena catalog from the public mobile.de website
- re-open exact technical qualification only through an official Search-API/partner agreement or other written mobile.de permission that explicitly covers AvtoCena's intended commercial use, retention and republication

## Safety boundary

- `productionWrites=false`
- no Object Storage/catalog-generation writes
- no public inventory crawler requests after the terms check
- no bypass, CAPTCHA handling or unauthorized search-tool access

## Japan pause

Japan remains paused by owner direction and is not part of this branch/workstream.

## Next

Continue with another non-Japan `research_pending` candidate, always checking official access/reuse conditions before any automated technical probe.
