# AutoUncle Europe — access-policy qualification v1

Date: 2026-09-04

## Decision

- source: `autouncle_europe_candidate`
- registry route: `https://www.autouncle.co.uk/en-gb/used-cars`
- market: Europe
- class: `lead_only`
- `publishAllowed=false`
- public-site automated collection: **blocked without permission**
- current AvtoCena scope: manual public reference only

No automated AutoUncle public inventory list/detail probe was started after the source-permission check.

## Official terms checked

Official Terms of Service: `https://www.autouncle.com/en-GB/terms-of-service`

Last updated by AutoUncle: `27 November 2024`.

Section 4 (User Conduct) states that users agree not to scrape or collect data without permission.

AutoUncle also publishes an official B2B automotive API page:

`https://b2b.autouncle.com/en-gb/automotive-api`

The B2B page describes an authenticated API for automotive enterprises, using an API key and providing market valuation, deal rating, sales-time forecast and live comparables. This identifies a legitimate partner/API route, but the public website Terms of Service do not themselves grant permission for AvtoCena to scrape or collect public-site data.

## Qualification meaning for AvtoCena

AutoUncle is an aggregator and the registry previously recorded technically interesting listing price and vehicle-attribute signals, with original-offer identity/duplication risk still unresolved. Those signals are not enough to start public-site automated qualification while the official terms prohibit scraping/collection without permission.

Therefore:

- `autouncle_europe_candidate -> lead_only`
- `publishAllowed=false`
- do not automate collection from the public AutoUncle marketplace without permission
- re-open technical qualification only through an AutoUncle-authorized API/enterprise agreement or written permission whose scope explicitly permits the AvtoCena use case, required fields, retention and any republication

## Safety boundary

- `productionWrites=false`
- no Object Storage/catalog-generation writes
- no public AutoUncle inventory crawl after the terms check
- no bypass or workaround attempted

## Japan pause

Japan remains outside the active qualification queue by owner direction. No Japan branch is resumed or merged here.

## Next

Continue with another non-Japan `research_pending` source, checking official access/reuse conditions first. Only sources whose permission path remains open proceed to bounded no-write technical field qualification.
