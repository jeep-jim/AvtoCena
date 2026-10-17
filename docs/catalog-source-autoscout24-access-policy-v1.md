# AutoScout24 Europe — access-policy qualification v1

Date: 2026-09-04

## Decision

- source: `autoscout_europe_open`
- registry route: `https://www.autoscout24.com/`
- market: Europe
- class: `lead_only`
- `publishAllowed=false`
- automated catalog ingestion/republication: **blocked under the current public terms**
- current allowed scope in AvtoCena: manual public reference/link-out only

No automated AutoScout24 inventory probe was started after the source-permission check below. This checkpoint intentionally stops before list/detail/API probing.

## Official public terms checked

### Consumer GTC

Official page: `https://www.autoscout24.com/company/agb/`

Effective date shown by AutoScout24: `01.04.2024`.

The relevant public terms state in section 8.2 that individual datasets may be displayed/printed through the online search masks, while automated queries using scripts, bypassing the search mask with search software, or similar measures are not permitted.

Section 8.3 additionally states that queried data may not be used to build a separate database and may not be used for commercial data exploitation/provision or other commercial exploitation; linking/integrating the database or individual database elements with other databases or meta-databases is not permitted.

### Dealer/company GTC

Official page: `https://www.autoscout24.com/company/agb-b2b/`

Effective date shown by AutoScout24: `01.04.2025`.

The company terms also list automated querying of the database by software as prohibited misuse, and prohibit copying database contents and making them available on other websites/media unless the copied material is the dealer's own content.

## Qualification meaning for AvtoCena

Earlier read-only baseline evidence in this project showed formally strong/exact-looking AutoScout24 rows. That technical signal does not override the source's current public access/reuse conditions.

AvtoCena is a commercial catalog/calculation product. Under the official terms above, using automated queries to populate an AvtoCena database and commercially reusing/re-publishing other sellers' vehicle data is outside the permitted public-route scope.

Therefore the source is not eligible for automated adapter/crawler work or production publication on the currently available public route.

Requalification is allowed only if one of the following becomes available and explicitly covers the intended use:

1. an official API/data feed whose terms permit AvtoCena's automated commercial use;
2. an AutoScout24 partner/dealer data agreement that permits this use;
3. written authorization from AutoScout24 covering automated querying and commercial database reuse/republication.

## Safety boundary

- `productionWrites=false`
- `publishAllowed=false`
- no Object Storage/catalog generation writes
- no list/detail/API crawl started for this qualification
- no workaround or bypass attempted

## Japan pause

Japan remains outside the active qualification queue by owner direction. This AutoScout24 checkpoint does not change the Japan pause and does not merge or resume any Japan research branch.

## Next

Continue only with another non-Japan `research_pending` candidate. Apply the same order: official access/reuse policy first; only if that does not block automation, continue to bounded no-write technical qualification.
