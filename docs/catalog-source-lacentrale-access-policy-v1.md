# La Centrale Europe — access-policy qualification v1

Date: 2026-09-04

## Decision

- source: `lacentrale_europe_candidate`
- registry route: `https://www.lacentrale.fr/`
- market: Europe
- class: `lead_only`
- `publishAllowed=false`
- automated catalog ingestion/republication from the public site: **blocked under the current official CGU**
- current AvtoCena scope: manual public reference only; any hyperlink/use of site material remains subject to La Centrale's stated authorization conditions

No automated La Centrale inventory list/detail/API probe was started after the source-permission check below.

## Official terms checked

Official page: `https://www.lacentrale.fr/informations/mentions-legales`

The current La Centrale "Mentions Légales et Conditions Générales d'Utilisation" state in Article 5 (Propriété Intellectuelle):

- using the site grants no right in the site/content; only strictly personal use is authorized;
- reproduction, representation or diffusion of all or part of the site/content is prohibited without prior written and express authorization from Groupe La Centrale;
- databases accessible through the site are protected, and extraction or reuse of all or a substantial part is subject to prior written approval;
- database data is made available to the public only for pure consultation;
- any extraction or reuse that is not exclusively and strictly necessary for pure consultation, without prior written approval, exceeds the normal conditions of use.

The official mobile-app legal page publishes the same core database rule: public data is for pure consultation, and extraction/reuse outside that purpose requires prior written approval.

## Qualification meaning for AvtoCena

The registry previously identified La Centrale as technically promising because public listings expose verified inventory, price, fuel and canonical body categories. That technical signal does not grant a right to automate extraction or republish the database in a commercial AvtoCena catalog.

Therefore:

- `lacentrale_europe_candidate -> lead_only`
- `publishAllowed=false`
- do not start public list/detail/API crawler qualification on the current route
- do not build/refresh the AvtoCena catalog from La Centrale public database contents
- re-open technical exact qualification only after prior written authorization from Groupe La Centrale or an official data/API/partner feed whose terms explicitly permit AvtoCena's intended automated commercial use, retention and republication

## Safety boundary

- `productionWrites=false`
- no Object Storage/catalog-generation writes
- no La Centrale inventory crawl after the official terms check
- no bypass or workaround attempted

## Japan pause

Japan remains outside the active qualification queue by owner direction. No Japan qualification branch is resumed or merged here.

## Next

Continue with another non-Japan `research_pending` candidate. Preserve the same order: official access/reuse policy first; only if it does not block automation, continue to bounded no-write technical field qualification.
