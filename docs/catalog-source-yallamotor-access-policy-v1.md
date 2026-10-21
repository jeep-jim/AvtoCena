# YallaMotor UAE — access-policy qualification v1

Date: 2026-09-04

## Decision

- source: `yallamotor_uae_candidate`
- registry route: `https://uae.yallamotor.com/used-cars`
- market: UAE
- class: `lead_only`
- `publishAllowed=false`
- automated public-site collection: **blocked by the current official Terms of Service**
- current AvtoCena scope: manual public reference only; even hyperlink use is restricted by YallaMotor's terms to non-commercial use unless separately permitted

No automated YallaMotor public inventory list/detail/API probe was started after the source-permission check.

## Official terms checked

Official Terms of Service: `https://www.yallamotor.com/terms-of-service`

Clause 7 (Access and Linking to the platform) states that users may not use any robot, spider, scraper or other automated means to access YallaMotor and collect content for any purpose, or otherwise copy/download content. The stated limited exception is for search engines and non-commercial public archives, and expressly does not cover websites containing classified listings.

The same clause allows hyperlinks only for non-commercial use and prohibits misleading association/endorsement.

The Terms also prohibit copying, distributing, reproducing, selling, leasing, assigning, renting or sublicensing the platform or its content.

## Qualification meaning for AvtoCena

The registry previously recorded technically interesting YallaMotor signals: AED price and some exact engine/power descriptions. Those signals cannot be used to justify automated public-site qualification because the source's own terms explicitly prohibit automated content collection for any purpose.

Therefore:

- `yallamotor_uae_candidate -> lead_only`
- `publishAllowed=false`
- do not run automated list/detail/API crawling on the public YallaMotor route
- do not reuse/re-publish YallaMotor listing content in the AvtoCena commercial catalog under the current public terms
- re-open exact technical qualification only if YallaMotor provides an official API/feed/partner agreement or written authorization explicitly covering AvtoCena automated collection, retention and republication

## Safety boundary

- `productionWrites=false`
- no Object Storage/catalog-generation writes
- no YallaMotor inventory crawl after the terms check
- no bypass or workaround attempted

## Japan pause

Japan remains outside the active qualification queue by owner direction. No Japan branch is resumed or merged here.

## Next

Continue with another non-Japan `research_pending` source. Preserve permission-first ordering before any technical crawler work.
